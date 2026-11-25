import { useEffect, useState } from 'preact/hooks';
import { SegmentedControl, StatusNotice, ToggleSwitch } from '@/components/Controls';
import { BrandMark, CheckIcon, ChevronRightIcon, GearIcon, GlobeIcon, SwapIcon } from '@/components/Icons';
import { PROVIDER_LABEL_KEY } from '@/components/ProviderConfigPanel';
import { createTranslator } from '@/core/i18n';
import type { ContentCommand, PageState, RuntimeMessage, RuntimeReply } from '@/core/messaging/protocol';
import {
  getProviderDisplayModel,
  getSettings,
  isProviderConfigured,
  saveSettings,
  subscribeSettings,
} from '@/core/storage/settings';
import { applyThemeToDocument } from '@/core/storage/theme';
import {
  DEFAULT_SETTINGS,
  type DisplayMode,
  type ProviderId,
  type UserSettings,
} from '@/core/storage/types';
import {
  getLanguageLabel,
  LANGUAGES,
  normalizeDetectedLanguage,
} from '@/core/translation/languages';

const ALL_PROVIDERS: readonly ProviderId[] = [
  'chrome-builtin',
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
  'ollama',
  'lmstudio',
];

export function App() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [tabId, setTabId] = useState<number | null>(null);
  const [pageState, setPageState] = useState<PageState | null>(null);
  const [detectedSource, setDetectedSource] = useState<string>('auto');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { locale, t } = createTranslator(settings.appearance.uiLocale);

  const sendTabCommand = async (id: number, command: ContentCommand): Promise<PageState | null> => {
    const msg: RuntimeMessage = { type: 'bt:popup-tab-action', tabId: id, command };
    const reply = (await browser.runtime.sendMessage(msg)) as RuntimeReply;
    if (reply.ok && reply.state) {
      setPageState(reply.state);
      return reply.state;
    }
    return null;
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const s = await getSettings();
      if (!active) return;
      setSettings(s);
      applyThemeToDocument(s.appearance);

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!active || !tab?.id) return;
      setTabId(tab.id);

      try {
        const lang = await browser.tabs.detectLanguage(tab.id);
        if (active) setDetectedSource(normalizeDetectedLanguage(lang));
      } catch {
        // Optional language detection may fail on restricted tabs
      }

      await sendTabCommand(tab.id, { type: 'bt:get-state' });
    })();

    const unsub = subscribeSettings((next) => {
      setSettings(next);
      applyThemeToDocument(next.appearance);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // Poll progress lightly while translating is active
  useEffect(() => {
    if (!tabId || !pageState?.active) return;
    if (pageState.total > 0 && pageState.done + pageState.failed >= pageState.total) return;
    const timer = window.setInterval(() => {
      void sendTabCommand(tabId, { type: 'bt:get-state' });
    }, 600);
    return () => window.clearInterval(timer);
  }, [tabId, pageState?.active, pageState?.done, pageState?.total, pageState?.failed]);

  const persist = async (next: UserSettings) => {
    setSettings(next);
    applyThemeToDocument(next.appearance);
    await saveSettings(next);
  };

  const openOptions = async (section?: string) => {
    const msg: RuntimeMessage = { type: 'bt:open-options', section };
    await browser.runtime.sendMessage(msg);
    window.close();
  };

  const handleTogglePage = async () => {
    if (!tabId || !pageState?.supported) return;
    setBusy(true);
    try {
      await sendTabCommand(tabId, { type: 'bt:toggle-page' });
    } finally {
      setBusy(false);
    }
  };

  const handleSwapLanguages = () => {
    const effectiveSource =
      settings.reading.sourceLang === 'auto' ? detectedSource : settings.reading.sourceLang;
    if (!effectiveSource || effectiveSource === 'auto') return;
    void persist({
      ...settings,
      reading: {
        ...settings.reading,
        sourceLang: settings.reading.targetLang,
        targetLang: effectiveSource,
      },
    });
  };

  const hostname = pageState?.hostname?.toLowerCase() ?? '';
  const isAlwaysHost = Boolean(hostname && settings.reading.alwaysTranslateHosts.includes(hostname));

  const handleToggleAlwaysHost = async (enabled: boolean) => {
    if (!hostname) return;
    const always = enabled
      ? [...new Set([...settings.reading.alwaysTranslateHosts, hostname])]
      : settings.reading.alwaysTranslateHosts.filter((h) => h !== hostname);
    const never = enabled
      ? settings.reading.neverTranslateHosts.filter((h) => h !== hostname)
      : settings.reading.neverTranslateHosts;
    await persist({
      ...settings,
      reading: {
        ...settings.reading,
        alwaysTranslateHosts: always,
        neverTranslateHosts: never,
      },
    });
    if (enabled && tabId && pageState?.supported && !pageState.active) {
      await sendTabCommand(tabId, { type: 'bt:enable-page' });
    }
  };

  const handleDisplayModeChange = async (mode: DisplayMode) => {
    await persist({
      ...settings,
      appearance: { ...settings.appearance, displayMode: mode },
    });
    if (tabId && pageState?.supported) {
      await sendTabCommand(tabId, { type: 'bt:set-display-mode', mode });
    }
  };

  const activeConfigured = isProviderConfigured(settings, settings.activeProvider);
  const activeModel = getProviderDisplayModel(settings, settings.activeProvider);
  const activeEngineLabel = activeModel
    ? `${t(PROVIDER_LABEL_KEY[settings.activeProvider])} · ${activeModel}`
    : t(PROVIDER_LABEL_KEY[settings.activeProvider]);

  const canSwap =
    settings.reading.sourceLang !== 'auto' ||
    (detectedSource !== 'auto' && detectedSource !== settings.reading.targetLang);

  const primaryLabel = pageState?.active
    ? pageState.total > 0 && pageState.done + pageState.failed < pageState.total
      ? `${t('showOriginal')} (${pageState.done}/${pageState.total})`
      : t('showOriginal')
    : t('translatePage');

  return (
    <main class="w-[336px] min-h-full bg-[var(--bt-surface)] text-[var(--bt-text)]">
      {/* Header */}
      <header class="flex items-center justify-between px-4 pt-3.5 pb-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <BrandMark size={32} />
          <div class="min-w-0 leading-tight">
            <h1 class="bt-serif text-[15px] font-semibold truncate">{t('appName')}</h1>
            <p class="text-[11px] text-[var(--bt-text-muted)] truncate">{t('appTagline')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void openOptions()}
          aria-label={t('settings')}
          title={t('settings')}
          class="rounded-[8px] p-1.5 text-[var(--bt-text-muted)] hover:bg-[var(--bt-surface-subtle)] hover:text-[var(--bt-text)] cursor-pointer transition-colors"
        >
          <GearIcon size={18} />
        </button>
      </header>

      <div class="px-4 pb-4 space-y-3">
        {/* Active provider pill + expandable quick switcher */}
        <div>
          <button
            type="button"
            aria-expanded={switcherOpen}
            onClick={() => setSwitcherOpen((o) => !o)}
            class="w-full flex items-center justify-between gap-2 rounded-[9px] border border-[var(--bt-border)] px-3 py-2 text-[13px] hover:border-[var(--bt-border-strong)] cursor-pointer transition-colors"
          >
            <span class="flex items-center gap-2 min-w-0">
              <span
                aria-hidden="true"
                class={`h-2 w-2 rounded-full shrink-0 ${
                  activeConfigured ? 'bg-[var(--bt-success)]' : 'bg-[var(--bt-warning)]'
                }`}
              />
              <span class="truncate font-medium">{activeEngineLabel}</span>
            </span>
            <span class="inline-flex items-center gap-0.5 text-[12px] text-[var(--bt-text-muted)] shrink-0">
              {t('switchProvider')}
              <ChevronRightIcon
                size={14}
                class={`transition-transform ${switcherOpen ? 'rotate-90' : ''}`}
              />
            </span>
          </button>

          {switcherOpen && (
            <div class="mt-1.5 rounded-[10px] border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] p-1.5 space-y-0.5">
              {ALL_PROVIDERS.map((pid) => {
                const ready = isProviderConfigured(settings, pid);
                const selected = settings.activeProvider === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => {
                      void persist({ ...settings, activeProvider: pid });
                      setSwitcherOpen(false);
                    }}
                    class={`w-full flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12px] cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[var(--bt-surface)] font-semibold text-[var(--bt-accent)]'
                        : 'text-[var(--bt-text)] hover:bg-[var(--bt-surface)]'
                    }`}
                  >
                    <span class="flex items-center gap-1.5 truncate">
                      {selected ? <CheckIcon size={13} /> : <span class="w-[13px]" />}
                      <span class="truncate">{t(PROVIDER_LABEL_KEY[pid])}</span>
                    </span>
                    <span
                      class={`text-[11px] shrink-0 ${
                        ready ? 'text-[var(--bt-success)]' : 'text-[var(--bt-text-muted)]'
                      }`}
                    >
                      {ready ? t('configured') : t('needsConfig')}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => void openOptions('providers')}
                class="w-full mt-1 border-t border-[var(--bt-border)] pt-1.5 pb-0.5 text-center text-[12px] font-medium text-[var(--bt-accent)] hover:underline cursor-pointer"
              >
                {t('openSettings')} ›
              </button>
            </div>
          )}
        </div>

        {/* Language pair row */}
        <div class="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-1.5">
          <select
            aria-label={t('sourceLanguage')}
            value={settings.reading.sourceLang}
            onChange={(e) =>
              void persist({
                ...settings,
                reading: {
                  ...settings.reading,
                  sourceLang: (e.target as HTMLSelectElement).value,
                },
              })
            }
            class="min-w-0 rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-2.5 py-1.5 text-[13px] text-[var(--bt-text)]"
          >
            <option value="auto">{t('autoDetect')}</option>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {getLanguageLabel(lang.code, locale)}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={!canSwap}
            onClick={handleSwapLanguages}
            aria-label={t('swapLanguages')}
            title={t('swapLanguages')}
            class="grid place-items-center h-8 w-7 rounded-[6px] text-[var(--bt-text-muted)] hover:bg-[var(--bt-surface-subtle)] hover:text-[var(--bt-text)] disabled:opacity-35 cursor-pointer"
          >
            <SwapIcon size={16} />
          </button>

          <select
            aria-label={t('targetLanguage')}
            value={settings.reading.targetLang}
            onChange={(e) =>
              void persist({
                ...settings,
                reading: {
                  ...settings.reading,
                  targetLang: (e.target as HTMLSelectElement).value,
                },
              })
            }
            class="min-w-0 rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-2.5 py-1.5 text-[13px] text-[var(--bt-text)]"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {getLanguageLabel(lang.code, locale)}
              </option>
            ))}
          </select>
        </div>

        {/* Missing setup warning */}
        {!activeConfigured && (
          <StatusNotice tone="warning">
            <div class="space-y-1.5">
              <div>{t('providerNeedsSetup')}</div>
              <button
                type="button"
                onClick={() => void openOptions('providers')}
                class="font-semibold underline cursor-pointer"
              >
                {t('openSettings')}
              </button>
            </div>
          </StatusNotice>
        )}

        {/* Primary pill CTA */}
        <button
          type="button"
          disabled={busy || !pageState?.supported}
          onClick={() => void handleTogglePage()}
          class="w-full rounded-full bg-[var(--bt-accent)] py-2.5 px-4 text-[14px] font-semibold text-[var(--bt-on-accent)] flex items-center justify-center gap-2 cursor-pointer hover:opacity-95 disabled:opacity-45 disabled:cursor-not-allowed transition-opacity"
        >
          <GlobeIcon size={17} />
          <span>{primaryLabel}</span>
          {!pageState?.active && (
            <kbd class="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-medium bt-mono">
              Alt A
            </kbd>
          )}
        </button>

        {pageState && !pageState.supported && (
          <p class="text-[12px] text-[var(--bt-text-muted)] text-center">{t('pageUnsupported')}</p>
        )}

        {/* Quick options card */}
        <div class="rounded-[10px] bg-[var(--bt-surface-subtle)] divide-y divide-[var(--bt-border)]">
          <div class="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
            <label for="bt-popup-selection" class="cursor-pointer select-none">
              {t('selectionTranslate')}
            </label>
            <ToggleSwitch
              id="bt-popup-selection"
              checked={settings.reading.selectionEnabled}
              onChange={(checked) =>
                void persist({
                  ...settings,
                  reading: { ...settings.reading, selectionEnabled: checked },
                })
              }
            />
          </div>

          {hostname && pageState?.supported && (
            <div class="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
              <label for="bt-popup-always" class="cursor-pointer select-none truncate">
                {t('alwaysTranslateHost', { host: hostname })}
              </label>
              <ToggleSwitch
                id="bt-popup-always"
                checked={isAlwaysHost}
                onChange={(checked) => void handleToggleAlwaysHost(checked)}
              />
            </div>
          )}

          <div class="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
            <span>{t('displayMode')}</span>
            <SegmentedControl<DisplayMode>
              compact
              value={settings.appearance.displayMode}
              onChange={(m) => void handleDisplayModeChange(m)}
              options={[
                { value: 'bilingual', label: t('modeBilingual') },
                { value: 'translation-only', label: t('modeTranslationOnly') },
              ]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
