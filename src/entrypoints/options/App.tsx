import { useEffect, useRef, useState } from 'preact/hooks';
import { AppearancePicker } from '@/components/AppearancePicker';
import { StatusNotice, ToggleSwitch } from '@/components/Controls';
import { BrandMark, CheckIcon, TrashIcon } from '@/components/Icons';
import { PROVIDER_LABEL_KEY, ProviderConfigPanel } from '@/components/ProviderConfigPanel';
import { createTranslator, type MessageKey } from '@/core/i18n';
import type { RuntimeMessage, RuntimeReply } from '@/core/messaging/protocol';
import {
  exportSettingsJson,
  getSettings,
  importSettingsJson,
  isProviderConfigured,
  resetSettings,
  subscribeSettings,
  updateSettings,
} from '@/core/storage/settings';
import { applyThemeToDocument } from '@/core/storage/theme';
import {
  DEFAULT_SETTINGS,
  type ProviderId,
  type SelectionTrigger,
  type UserSettings,
} from '@/core/storage/types';
import type { CacheStats } from '@/core/translation/cache';
import { getLanguageLabel, LANGUAGES } from '@/core/translation/languages';

type SectionId = 'providers' | 'appearance' | 'reading' | 'sites' | 'data';

const NAV_ITEMS: Array<{ id: SectionId; key: MessageKey }> = [
  { id: 'providers', key: 'navProviders' },
  { id: 'appearance', key: 'navAppearance' },
  { id: 'reading', key: 'navReading' },
  { id: 'sites', key: 'navSites' },
  { id: 'data', key: 'navData' },
];

const PROVIDER_LIST: readonly ProviderId[] = [
  'chrome-builtin',
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
  'ollama',
  'lmstudio',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function App() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [section, setSection] = useState<SectionId>(() => {
    const hash = location.hash.replace('#', '') as SectionId;
    return NAV_ITEMS.some((n) => n.id === hash) ? hash : 'providers';
  });
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('chrome-builtin');
  const [cacheStats, setCacheStats] = useState<CacheStats>({ count: 0, estimatedBytes: 0 });
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [alwaysInput, setAlwaysInput] = useState('');
  const [neverInput, setNeverInput] = useState('');
  const [includeKeysExport, setIncludeKeysExport] = useState(false);
  const [dataNotice, setDataNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { locale, t } = createTranslator(settings.appearance.uiLocale);

  const loadCacheStats = async () => {
    const msg: RuntimeMessage = { type: 'bt:cache-stats' };
    const reply = (await browser.runtime.sendMessage(msg)) as RuntimeReply;
    if (reply.ok && reply.stats) setCacheStats(reply.stats);
  };

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      setSelectedProvider(s.activeProvider);
      applyThemeToDocument(s.appearance);
      await loadCacheStats();
    })();
    return subscribeSettings((next) => {
      setSettings(next);
      applyThemeToDocument(next.appearance);
    });
  }, []);

  const persist = (updater: (current: UserSettings) => UserSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      applyThemeToDocument(next.appearance);
      return next;
    });
    void updateSettings(updater);
  };

  const addHost = (listKey: 'alwaysTranslateHosts' | 'neverTranslateHosts', raw: string) => {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .replace(/\/.*$/u, '');
    if (!cleaned) return;
    const otherKey =
      listKey === 'alwaysTranslateHosts' ? 'neverTranslateHosts' : 'alwaysTranslateHosts';
    persist((curr) => ({
      ...curr,
      reading: {
        ...curr.reading,
        [listKey]: [...new Set([...curr.reading[listKey], cleaned])],
        [otherKey]: curr.reading[otherKey].filter((h) => h !== cleaned),
      },
    }));
    if (listKey === 'alwaysTranslateHosts') setAlwaysInput('');
    else setNeverInput('');
  };

  const removeHost = (listKey: 'alwaysTranslateHosts' | 'neverTranslateHosts', host: string) => {
    persist((curr) => ({
      ...curr,
      reading: {
        ...curr.reading,
        [listKey]: curr.reading[listKey].filter((h) => h !== host),
      },
    }));
  };

  const handleClearCache = async () => {
    await browser.runtime.sendMessage({ type: 'bt:cache-clear' } satisfies RuntimeMessage);
    await loadCacheStats();
    setCacheNotice(t('cacheCleared'));
    window.setTimeout(() => setCacheNotice(null), 3000);
  };

  const handleExport = () => {
    const json = exportSettingsJson(settings, includeKeysExport);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitext-web-translator-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const imported = importSettingsJson(text, settings);
      persist(() => imported);
      setDataNotice({ tone: 'success', text: t('importSuccess') });
    } catch {
      setDataNotice({ tone: 'error', text: t('importFailed') });
    }
  };

  const handleReset = async () => {
    if (!window.confirm(t('resetConfirm'))) return;
    const fresh = await resetSettings();
    setSettings(fresh);
    setSelectedProvider(fresh.activeProvider);
    applyThemeToDocument(fresh.appearance);
  };

  return (
    <div class="min-h-screen bg-[var(--bt-bg)] text-[var(--bt-text)]">
      <div class="mx-auto max-w-[980px] px-5 py-8 grid gap-6 md:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside class="space-y-5">
          <div class="flex items-center gap-3 px-2">
            <BrandMark size={36} />
            <div class="leading-tight">
              <div class="bt-serif text-[16px] font-semibold">{t('appShortName')}</div>
              <div class="text-[12px] text-[var(--bt-text-muted)]">{t('settings')}</div>
            </div>
          </div>

          <nav class="space-y-1" aria-label={t('settings')}>
            {NAV_ITEMS.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    history.replaceState(null, '', `#${item.id}`);
                  }}
                  class={`w-full rounded-[10px] px-3.5 py-2.5 text-left text-[14px] cursor-pointer ${
                    active
                      ? 'bg-[var(--bt-surface)] font-semibold text-[var(--bt-accent)] border border-[var(--bt-border)] shadow-xs'
                      : 'text-[var(--bt-text-muted)] hover:bg-[var(--bt-surface)]/60 hover:text-[var(--bt-text)]'
                  }`}
                >
                  {t(item.key)}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main class="space-y-5 min-w-0">
          {section === 'providers' && (
            <section class="space-y-4">
              <h1 class="bt-serif text-[22px] font-semibold">{t('navProviders')}</h1>
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {PROVIDER_LIST.map((pid) => {
                  const viewing = selectedProvider === pid;
                  const active = settings.activeProvider === pid;
                  const ready = isProviderConfigured(settings, pid);
                  return (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => setSelectedProvider(pid)}
                      class={`rounded-[12px] border p-3 text-left cursor-pointer transition-colors ${
                        viewing
                          ? 'border-[var(--bt-accent)] bg-[var(--bt-surface)] shadow-xs'
                          : 'border-[var(--bt-border)] bg-[var(--bt-surface)]/70 hover:bg-[var(--bt-surface)]'
                      }`}
                    >
                      <div class="flex items-center justify-between gap-1">
                        <span class="text-[13px] font-semibold truncate">
                          {t(PROVIDER_LABEL_KEY[pid])}
                        </span>
                        {active && <CheckIcon size={14} class="text-[var(--bt-accent)]" />}
                      </div>
                      <div class="mt-1 flex items-center gap-1.5 text-[11px]">
                        <span
                          class={`h-1.5 w-1.5 rounded-full ${
                            ready ? 'bg-[var(--bt-success)]' : 'bg-[var(--bt-border-strong)]'
                          }`}
                        />
                        <span class="text-[var(--bt-text-muted)]">
                          {active ? t('activeBadge') : ready ? t('configured') : t('needsConfig')}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <ProviderConfigPanel
                providerId={selectedProvider}
                settings={settings}
                onChangeSettings={(next) => persist(() => next)}
              />
            </section>
          )}

          {section === 'appearance' && (
            <section class="space-y-4">
              <h1 class="bt-serif text-[22px] font-semibold">{t('navAppearance')}</h1>
              <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5">
                <AppearancePicker
                  appearance={settings.appearance}
                  onPatch={(patch) =>
                    persist((curr) => ({ ...curr, appearance: { ...curr.appearance, ...patch } }))
                  }
                />
              </div>
            </section>
          )}

          {section === 'reading' && (
            <section class="space-y-4">
              <h1 class="bt-serif text-[22px] font-semibold">{t('navReading')}</h1>

              <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-5">
                <div class="grid sm:grid-cols-2 gap-4">
                  <div class="space-y-1.5">
                    <label for="bt-opt-source" class="block text-[13px] font-medium">
                      {t('sourceLanguage')}
                    </label>
                    <select
                      id="bt-opt-source"
                      value={settings.reading.sourceLang}
                      onChange={(e) => {
                        const val = (e.target as HTMLSelectElement).value;
                        persist((curr) => ({
                          ...curr,
                          reading: { ...curr.reading, sourceLang: val },
                        }));
                      }}
                      class="w-full rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-3 py-2 text-[13px]"
                    >
                      <option value="auto">{t('autoDetect')}</option>
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {getLanguageLabel(lang.code, locale)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label for="bt-opt-target" class="block text-[13px] font-medium">
                      {t('targetLanguage')}
                    </label>
                    <select
                      id="bt-opt-target"
                      value={settings.reading.targetLang}
                      onChange={(e) => {
                        const val = (e.target as HTMLSelectElement).value;
                        persist((curr) => ({
                          ...curr,
                          reading: { ...curr.reading, targetLang: val },
                        }));
                      }}
                      class="w-full rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-3 py-2 text-[13px]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {getLanguageLabel(lang.code, locale)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div class="border-t border-[var(--bt-border)] pt-4 space-y-3">
                  <div class="flex items-center justify-between gap-4">
                    <div class="text-[14px] font-medium">{t('selectionTranslate')}</div>
                    <ToggleSwitch
                      checked={settings.reading.selectionEnabled}
                      onChange={(selectionEnabled) =>
                        persist((curr) => ({
                          ...curr,
                          reading: { ...curr.reading, selectionEnabled },
                        }))
                      }
                    />
                  </div>

                  <div class="space-y-2 pl-0.5">
                    <div class="text-[13px] text-[var(--bt-text-muted)]">
                      {t('selectionBehaviorTitle')}
                    </div>
                    {(['icon', 'immediate'] as SelectionTrigger[]).map((mode) => (
                      <label
                        key={mode}
                        class="flex items-center gap-2.5 text-[13px] cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="selectionTrigger"
                          checked={settings.reading.selectionTrigger === mode}
                          onChange={() =>
                            persist((curr) => ({
                              ...curr,
                              reading: { ...curr.reading, selectionTrigger: mode },
                            }))
                          }
                        />
                        <span>{mode === 'icon' ? t('triggerIcon') : t('triggerImmediate')}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div class="border-t border-[var(--bt-border)] pt-4">
                  <div class="text-[14px] font-medium">{t('shortcutTitle')}</div>
                  <p class="mt-1 text-[12px] text-[var(--bt-text-muted)] leading-relaxed">
                    {t('shortcutDesc')}
                  </p>
                </div>
              </div>
            </section>
          )}

          {section === 'sites' && (
            <section class="space-y-4">
              <h1 class="bt-serif text-[22px] font-semibold">{t('navSites')}</h1>

              {(
                [
                  {
                    key: 'alwaysTranslateHosts' as const,
                    title: t('alwaysTranslateTitle'),
                    inputVal: alwaysInput,
                    setInput: setAlwaysInput,
                  },
                  {
                    key: 'neverTranslateHosts' as const,
                    title: t('neverTranslateTitle'),
                    inputVal: neverInput,
                    setInput: setNeverInput,
                  },
                ] as const
              ).map((group) => (
                <div
                  key={group.key}
                  class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-3"
                >
                  <h2 class="text-[15px] font-semibold">{group.title}</h2>
                  <form
                    class="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addHost(group.key, group.inputVal);
                    }}
                  >
                    <input
                      type="text"
                      value={group.inputVal}
                      placeholder={t('hostnamePlaceholder')}
                      onInput={(e) => group.setInput((e.target as HTMLInputElement).value)}
                      class="flex-1 rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-3 py-1.5 text-[13px] bt-mono"
                    />
                    <button
                      type="submit"
                      class="rounded-full bg-[var(--bt-accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--bt-on-accent)] cursor-pointer"
                    >
                      {t('add')}
                    </button>
                  </form>
                  {settings.reading[group.key].length === 0 ? (
                    <p class="text-[12px] text-[var(--bt-text-muted)]">{t('emptyList')}</p>
                  ) : (
                    <ul class="flex flex-wrap gap-2">
                      {settings.reading[group.key].map((host) => (
                        <li
                          key={host}
                          class="inline-flex items-center gap-2 rounded-full border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] px-3 py-1 text-[12px] bt-mono"
                        >
                          <span>{host}</span>
                          <button
                            type="button"
                            aria-label={`${t('remove')} ${host}`}
                            onClick={() => removeHost(group.key, host)}
                            class="text-[var(--bt-text-muted)] hover:text-[var(--bt-danger)] cursor-pointer"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}

          {section === 'data' && (
            <section class="space-y-4">
              <h1 class="bt-serif text-[22px] font-semibold">{t('navData')}</h1>

              {/* Cache Card */}
              <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-3">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <h2 class="text-[15px] font-semibold">{t('cacheTitle')}</h2>
                    <p class="text-[12px] text-[var(--bt-text-muted)] mt-0.5">
                      {t('cacheEnableLabel')}
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.cache.enabled}
                    onChange={(enabled) =>
                      persist((curr) => ({ ...curr, cache: { ...curr.cache, enabled } }))
                    }
                  />
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span class="text-[13px] text-[var(--bt-text-muted)]">
                    {t('cacheStatsText', {
                      count: String(cacheStats.count),
                      size: formatBytes(cacheStats.estimatedBytes),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleClearCache()}
                    class="inline-flex items-center gap-1.5 rounded-full border border-[var(--bt-border-strong)] px-3.5 py-1.5 text-[12px] font-medium hover:border-[var(--bt-danger)] hover:text-[var(--bt-danger)] cursor-pointer"
                  >
                    <TrashIcon size={14} />
                    {t('clearCacheBtn')}
                  </button>
                </div>
                {cacheNotice && <StatusNotice tone="success">{cacheNotice}</StatusNotice>}
              </div>

              {/* Export / Import / Reset Card */}
              <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-3.5">
                <h2 class="text-[15px] font-semibold">{t('backupTitle')}</h2>
                <label class="flex items-center gap-2 text-[13px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeKeysExport}
                    onChange={(e) => setIncludeKeysExport((e.target as HTMLInputElement).checked)}
                  />
                  <span>{t('includeKeysLabel')}</span>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExport}
                    class="rounded-full border border-[var(--bt-border-strong)] bg-[var(--bt-surface-subtle)] px-4 py-1.5 text-[13px] font-medium cursor-pointer hover:border-[var(--bt-accent)]"
                  >
                    {t('exportBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    class="rounded-full border border-[var(--bt-border-strong)] bg-[var(--bt-surface-subtle)] px-4 py-1.5 text-[13px] font-medium cursor-pointer hover:border-[var(--bt-accent)]"
                  >
                    {t('importBtn')}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json"
                    class="hidden"
                    onChange={(e) => void handleImportFile(e)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void browser.runtime.sendMessage({
                        type: 'bt:open-onboarding',
                      } satisfies RuntimeMessage)
                    }
                    class="rounded-full border border-[var(--bt-border)] px-4 py-1.5 text-[13px] text-[var(--bt-text-muted)] cursor-pointer hover:text-[var(--bt-text)]"
                  >
                    {t('reopenOnboardingBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReset()}
                    class="ml-auto rounded-full border border-[var(--bt-danger)]/40 px-4 py-1.5 text-[13px] text-[var(--bt-danger)] cursor-pointer hover:bg-[var(--bt-danger-soft)]"
                  >
                    {t('resetBtn')}
                  </button>
                </div>
                {dataNotice && <StatusNotice tone={dataNotice.tone}>{dataNotice.text}</StatusNotice>}
              </div>

              {/* Privacy & Data Summary */}
              <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-2">
                <h2 class="text-[15px] font-semibold">{t('privacyCardTitle')}</h2>
                <p class="text-[13px] text-[var(--bt-text-muted)] leading-relaxed">
                  {t('privacyCardBody')}
                </p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
