import { createTranslator } from '@/core/i18n';
import {
  PORT_OLLAMA_PULL,
  PORT_TRANSLATE,
  type ContentCommand,
  type OllamaPullPortReply,
  type OllamaPullPortRequest,
  type PageState,
  type PortTranslateMessage,
  type PortTranslateReply,
  type RuntimeMessage,
  type RuntimeReply,
} from '@/core/messaging/protocol';
import { getSettings, subscribeSettings } from '@/core/storage/settings';
import { TranslationEngine } from '@/core/translation/engine';
import { convertSimplifiedToTaiwan } from '@/core/translation/opencc';
import { detectOllama, pullOllamaModel } from '@/core/translation/providers/ollama';
import { detectLMStudio } from '@/core/translation/providers/openai';
import { TranslationError } from '@/core/translation/types';

const MENU_TRANSLATE_PAGE = 'bitext-translate-page';
const MENU_TRANSLATE_SELECTION = 'bitext-translate-selection';

function isWebUrl(url: string | undefined): boolean {
  return Boolean(url && /^https?:\/\//i.test(url));
}

async function syncContextMenus(): Promise<void> {
  const settings = await getSettings();
  const { locale } = createTranslator(settings.appearance.uiLocale);
  const pageTitle = locale === 'zh-TW' ? 'BiText：翻譯這個網頁 / 顯示原文' : 'BiText: Translate page / Show original';
  const selTitle = locale === 'zh-TW' ? 'BiText：翻譯選取文字' : 'BiText: Translate selected text';

  try {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_TRANSLATE_PAGE,
      title: pageTitle,
      contexts: ['page'],
    });
    browser.contextMenus.create({
      id: MENU_TRANSLATE_SELECTION,
      title: selTitle,
      contexts: ['selection'],
    });
  } catch {
    // Context menus may already exist or be unavailable in restricted profiles
  }
}

async function sendToTab(tabId: number, command: ContentCommand): Promise<PageState | null> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, command, { frameId: 0 })) as PageState | undefined;
    return res ?? null;
  } catch {
    // Tab may have been open before install/reload; inject content script & CSS on demand.
    try {
      await browser.scripting.insertCSS({
        target: { tabId, frameIds: [0] },
        files: ['/content-scripts/content.css'],
      });
    } catch {
      // CSS file name may be empty/bundled if WXT inlined it
    }
    try {
      await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['/content-scripts/content.js'],
      });
      const res = (await browser.tabs.sendMessage(tabId, command, { frameId: 0 })) as PageState | undefined;
      return res ?? null;
    } catch {
      return null;
    }
  }
}

export default defineBackground(() => {
  const engine = new TranslationEngine();

  // Register all listeners synchronously at top level (MV3 SW requirement)
  browser.runtime.onInstalled.addListener(async (details) => {
    await syncContextMenus();
    if (details.reason === 'install') {
      const settings = await getSettings();
      if (!settings.onboardingCompleted) {
        const url = browser.runtime.getURL('/onboarding.html');
        await browser.tabs.create({ url });
      }
    }
  });

  subscribeSettings(() => {
    void syncContextMenus();
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id || (tab.url && !isWebUrl(tab.url))) return;
    if (info.menuItemId === MENU_TRANSLATE_PAGE) {
      await sendToTab(tab.id, { type: 'bt:toggle-page' });
    } else if (info.menuItemId === MENU_TRANSLATE_SELECTION && info.selectionText) {
      await sendToTab(tab.id, {
        type: 'bt:translate-selection-text',
        text: info.selectionText,
      });
    }
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'toggle-page-translation') return;
    let targetTab = tab;
    if (!targetTab?.id) {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      targetTab = active;
    }
    if (!targetTab?.id || (targetTab.url && !isWebUrl(targetTab.url))) return;
    await sendToTab(targetTab.id, { type: 'bt:toggle-page' });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && isWebUrl(changeInfo.url)) {
      void browser.tabs.sendMessage(tabId, { type: 'bt:navigation' }, { frameId: 0 }).catch(() => {});
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_TRANSLATE) {
      const group = `web-${crypto.randomUUID()}`;
      const sessionAbort = new AbortController();
      let open = true;

      port.onDisconnect.addListener(() => {
        open = false;
        sessionAbort.abort();
        engine.cancelGroup(group);
      });

      port.onMessage.addListener(async (msg: PortTranslateMessage) => {
        if (!Number.isSafeInteger(msg?.id)) return;
        let reply: PortTranslateReply;
        try {
          if (msg.type === 'translate') {
            const settings = await getSettings();
            const res = await engine.translate(settings, {
              items: msg.items,
              sourceLang: msg.sourceLang,
              targetLang: msg.targetLang,
              format: msg.format,
              priority: msg.priority,
              context: msg.context,
              group,
              signal: sessionAbort.signal,
            });
            reply = { id: msg.id, ok: true, items: res.items };
          } else if (msg.type === 'convert') {
            const text = convertSimplifiedToTaiwan(msg.text, msg.useTaiwanPhrases ?? true);
            reply = { id: msg.id, ok: true, text };
          } else {
            return;
          }
        } catch (err) {
          if (err instanceof TranslationError) {
            reply = {
              id: msg.id,
              ok: false,
              code: err.code,
              message: err.message,
              httpStatus: err.httpStatus,
            };
          } else {
            reply = {
              id: msg.id,
              ok: false,
              code: 'unknown',
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }
        if (open) {
          try {
            port.postMessage(reply);
          } catch {
            // Port closed mid-flight
          }
        }
      });
      return;
    }

    if (port.name === PORT_OLLAMA_PULL) {
      const pullAbort = new AbortController();
      let open = true;
      port.onDisconnect.addListener(() => {
        open = false;
        pullAbort.abort();
      });
      port.onMessage.addListener(async (msg: OllamaPullPortRequest) => {
        if (msg?.type !== 'pull') return;
        const post = (reply: OllamaPullPortReply) => {
          if (!open) return;
          try {
            port.postMessage(reply);
          } catch {
            open = false;
          }
        };
        try {
          await pullOllamaModel({
            baseUrl: msg.baseUrl,
            model: msg.model,
            signal: pullAbort.signal,
            onProgress: (progress) => post({ type: 'progress', progress }),
          });
          post({ type: 'done' });
        } catch (err) {
          const code = err instanceof TranslationError ? err.code : 'unknown';
          post({
            type: 'error',
            code,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
  });

  browser.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    (async (): Promise<RuntimeReply> => {
      switch (msg.type) {
        case 'bt:popup-tab-action': {
          const tab = await browser.tabs.get(msg.tabId).catch(() => null);
          if (!tab?.id || (tab.url && !isWebUrl(tab.url))) {
            return {
              ok: true,
              state: {
                supported: false,
                active: false,
                hostname: '',
                done: 0,
                total: 0,
                failed: 0,
                displayMode: 'bilingual',
              },
            };
          }
          const state = await sendToTab(tab.id, msg.command);
          if (!state) {
            return {
              ok: true,
              state: {
                supported: false,
                active: false,
                hostname: tab.url ? new URL(tab.url).hostname : '',
                done: 0,
                total: 0,
                failed: 0,
                displayMode: 'bilingual',
              },
            };
          }
          return { ok: true, state };
        }
        case 'bt:test-provider': {
          const status = await engine.testProvider(msg.settings, msg.providerId);
          return { ok: true, status };
        }
        case 'bt:ollama-detect': {
          const status = await detectOllama(msg.baseUrl);
          return { ok: true, status };
        }
        case 'bt:lmstudio-detect': {
          const status = await detectLMStudio(msg.baseUrl);
          return { ok: true, status };
        }
        case 'bt:cache-stats': {
          const stats = await engine.cacheStats();
          return { ok: true, stats };
        }
        case 'bt:cache-clear': {
          await engine.clearCache();
          return { ok: true };
        }
        case 'bt:open-options': {
          const base = browser.runtime.getURL('/options.html');
          const url = msg.section ? `${base}#${encodeURIComponent(msg.section)}` : base;
          await browser.tabs.create({ url });
          return { ok: true };
        }
        case 'bt:open-onboarding': {
          const url = browser.runtime.getURL('/onboarding.html');
          await browser.tabs.create({ url });
          return { ok: true };
        }
        case 'bt:badge': {
          const tabId = sender.tab?.id;
          if (tabId !== undefined) {
            await browser.action.setBadgeText({ tabId, text: msg.text });
            if (msg.text) {
              await browser.action.setBadgeBackgroundColor({ tabId, color: '#0F6E66' });
            }
          }
          return { ok: true };
        }
        default:
          return { ok: false, error: 'Unknown message' };
      }
    })().then(sendResponse, (err) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });
});
