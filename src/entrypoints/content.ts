import './content/page.css';
import { createTranslator } from '@/core/i18n';
import type { ContentCommand } from '@/core/messaging/protocol';
import { getSettings, subscribeSettings } from '@/core/storage/settings';
import type { UserSettings } from '@/core/storage/types';
import { PageTranslator } from './content/page-translator';
import { SelectionTranslator } from './content/selection-translator';
import { showToast } from './content/toast';

export default defineContentScript({
  matches: ['https://*/*', 'http://*/*'],
  runAt: 'document_idle',
  async main() {
    const marker = '__bitextWebTranslatorLoaded';
    const win = window as unknown as Record<string, boolean>;
    if (win[marker]) return;
    win[marker] = true;

    let settings: UserSettings = await getSettings();
    let currentUrl = location.href;
    let resumeOnPageshow = false;

    let selectionTranslator: SelectionTranslator | null = null;
    const pageTranslator = new PageTranslator(settings, () => selectionTranslator?.dismiss());
    selectionTranslator = new SelectionTranslator(settings, () => !pageTranslator.isActive);

    const shouldAutoStart = (s: UserSettings): boolean => {
      const host = location.hostname.toLowerCase();
      if (!host) return false;
      if (s.reading.neverTranslateHosts.includes(host)) return false;
      return s.reading.alwaysTranslateHosts.includes(host);
    };

    const handleNavigation = () => {
      if (location.href === currentUrl) return;
      currentUrl = location.href;
      selectionTranslator?.dismiss();
      const wasActive = pageTranslator.isActive;
      pageTranslator.stop();
      if (wasActive || shouldAutoStart(settings)) {
        pageTranslator.start();
      }
    };

    subscribeSettings((next) => {
      settings = next;
      pageTranslator.updateSettings(next);
      selectionTranslator?.updateSettings(next);
    });

    browser.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      const { t } = createTranslator(settings.appearance.uiLocale);
      switch (message.type) {
        case 'bt:get-state':
          sendResponse(pageTranslator.getState());
          return;
        case 'bt:toggle-page': {
          const nowActive = pageTranslator.toggle();
          showToast({
            message: nowActive ? t('translating') : t('showOriginal'),
            tone: 'info',
            durationMs: 1800,
            theme: settings.appearance,
          });
          sendResponse(pageTranslator.getState());
          return;
        }
        case 'bt:enable-page':
          pageTranslator.start();
          sendResponse(pageTranslator.getState());
          return;
        case 'bt:stop-page':
          pageTranslator.stop();
          sendResponse(pageTranslator.getState());
          return;
        case 'bt:set-display-mode':
          pageTranslator.setDisplayMode(message.mode);
          sendResponse(pageTranslator.getState());
          return;
        case 'bt:translate-selection-text':
          selectionTranslator?.translateExplicitSelection(message.text);
          sendResponse(pageTranslator.getState());
          return;
        case 'bt:navigation':
          handleNavigation();
          sendResponse(pageTranslator.getState());
          return;
      }
    });

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);

    // Lightweight SPA URL watcher (works without requiring broad tabs permission)
    const navObserver = new MutationObserver(() => {
      if (location.href !== currentUrl) handleNavigation();
    });
    if (document.documentElement) {
      navObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    window.addEventListener('pagehide', () => {
      selectionTranslator?.dismiss();
      resumeOnPageshow = pageTranslator.isActive;
      pageTranslator.stop();
    });

    window.addEventListener('pageshow', (e) => {
      if (e.persisted && (resumeOnPageshow || shouldAutoStart(settings))) {
        pageTranslator.start();
      }
    });

    if (shouldAutoStart(settings)) {
      pageTranslator.start();
    }
  },
});
