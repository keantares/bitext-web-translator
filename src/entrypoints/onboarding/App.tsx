import { useEffect, useState } from 'preact/hooks';
import { AppearancePicker } from '@/components/AppearancePicker';
import { StatusNotice } from '@/components/Controls';
import { BrandMark, GlobeIcon, ServerIcon, SparklesIcon } from '@/components/Icons';
import { PROVIDER_LABEL_KEY, ProviderConfigPanel } from '@/components/ProviderConfigPanel';
import { createTranslator } from '@/core/i18n';
import type { RuntimeMessage } from '@/core/messaging/protocol';
import { getSettings, updateSettings } from '@/core/storage/settings';
import { applyThemeToDocument } from '@/core/storage/theme';
import {
  DEFAULT_SETTINGS,
  type ProviderId,
  type UiLocale,
  type UserSettings,
} from '@/core/storage/types';
import { getLanguageLabel, LANGUAGES } from '@/core/translation/languages';

type Track = 'builtin' | 'cloud' | 'local';

const CLOUD_PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic', 'gemini', 'openai-compatible'];
const LOCAL_PROVIDERS: readonly ProviderId[] = ['ollama', 'lmstudio'];

export function App() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [track, setTrack] = useState<Track>('builtin');
  const [subProvider, setSubProvider] = useState<ProviderId>('chrome-builtin');
  const [finished, setFinished] = useState(false);

  const { locale, t } = createTranslator(settings.appearance.uiLocale);

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      applyThemeToDocument(s.appearance);
    })();
  }, []);

  const persist = (updater: (curr: UserSettings) => UserSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      applyThemeToDocument(next.appearance);
      return next;
    });
    return updateSettings(updater);
  };

  const pickTrack = (nextTrack: Track) => {
    setTrack(nextTrack);
    const defaultPid: ProviderId =
      nextTrack === 'builtin' ? 'chrome-builtin' : nextTrack === 'cloud' ? 'gemini' : 'ollama';
    setSubProvider(defaultPid);
    void persist((curr) => ({ ...curr, activeProvider: defaultPid }));
  };

  const pickSubProvider = (pid: ProviderId) => {
    setSubProvider(pid);
    void persist((curr) => ({ ...curr, activeProvider: pid }));
  };

  const complete = async () => {
    await persist((curr) => ({ ...curr, onboardingCompleted: true }));
    setFinished(true);
  };

  return (
    <div class="min-h-screen bg-[var(--bt-bg)] text-[var(--bt-text)]">
      <div class="mx-auto max-w-[820px] px-5 py-10 space-y-8">
        {/* Top bar */}
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <BrandMark size={42} />
            <div>
              <h1 class="bt-serif text-[24px] font-semibold leading-tight">
                {t('onboardingTitle')}
              </h1>
              <p class="mt-0.5 text-[14px] text-[var(--bt-text-muted)]">
                {t('onboardingSubtitle')}
              </p>
            </div>
          </div>

          <div class="flex rounded-full border border-[var(--bt-border)] bg-[var(--bt-surface)] p-0.5 text-[12px]">
            {(
              [
                { value: 'zh-TW' as UiLocale, label: '繁體中文' },
                { value: 'en' as UiLocale, label: 'English' },
              ] as const
            ).map((opt) => {
              const active = locale === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    void persist((curr) => ({
                      ...curr,
                      appearance: { ...curr.appearance, uiLocale: opt.value },
                    }))
                  }
                  class={`rounded-full px-3 py-1 cursor-pointer ${
                    active
                      ? 'bg-[var(--bt-accent)] text-[var(--bt-on-accent)] font-semibold'
                      : 'text-[var(--bt-text-muted)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </header>

        {finished ? (
          <div class="rounded-[16px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-8 text-center space-y-4 shadow-[var(--bt-shadow)]">
            <div class="mx-auto w-fit">
              <BrandMark size={52} />
            </div>
            <h2 class="bt-serif text-[22px] font-semibold">{t('onboardingDemoTitle')}</h2>
            <p class="mx-auto max-w-[500px] text-[14px] text-[var(--bt-text-muted)] leading-relaxed">
              {t('onboardingDemoBody')}
            </p>
            <div class="pt-2 flex justify-center gap-3">
              <button
                type="button"
                onClick={() =>
                  void browser.runtime.sendMessage({
                    type: 'bt:open-options',
                  } satisfies RuntimeMessage)
                }
                class="rounded-full border border-[var(--bt-border-strong)] px-5 py-2 text-[13px] font-medium cursor-pointer"
              >
                {t('openSettings')}
              </button>
              <button
                type="button"
                onClick={() => window.close()}
                class="rounded-full bg-[var(--bt-accent)] px-6 py-2 text-[13px] font-semibold text-[var(--bt-on-accent)] cursor-pointer"
              >
                {t('close')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Step 1: Choose provider track */}
            <section class="space-y-4">
              <h2 class="bt-serif text-[18px] font-semibold">{t('onboardingStep1')}</h2>

              <div class="grid md:grid-cols-3 gap-3">
                {(
                  [
                    {
                      id: 'builtin' as Track,
                      icon: GlobeIcon,
                      title: t('onboardingCardBuiltinTitle'),
                      desc: t('onboardingCardBuiltinDesc'),
                    },
                    {
                      id: 'cloud' as Track,
                      icon: SparklesIcon,
                      title: t('onboardingCardCloudTitle'),
                      desc: t('onboardingCardCloudDesc'),
                    },
                    {
                      id: 'local' as Track,
                      icon: ServerIcon,
                      title: t('onboardingCardLocalTitle'),
                      desc: t('onboardingCardLocalDesc'),
                    },
                  ] as const
                ).map((card) => {
                  const Icon = card.icon;
                  const active = track === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => pickTrack(card.id)}
                      class={`rounded-[14px] border p-4 text-left space-y-2 cursor-pointer transition-colors ${
                        active
                          ? 'border-[var(--bt-accent)] bg-[var(--bt-surface)] ring-1 ring-[var(--bt-accent)] shadow-xs'
                          : 'border-[var(--bt-border)] bg-[var(--bt-surface)]/75 hover:bg-[var(--bt-surface)]'
                      }`}
                    >
                      <div class="flex items-center gap-2 text-[var(--bt-accent)]">
                        <Icon size={20} />
                        <span class="text-[14px] font-semibold text-[var(--bt-text)]">
                          {card.title}
                        </span>
                      </div>
                      <p class="text-[12px] text-[var(--bt-text-muted)] leading-relaxed">
                        {card.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              {track === 'cloud' && (
                <div class="flex flex-wrap gap-2">
                  {CLOUD_PROVIDERS.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => pickSubProvider(pid)}
                      class={`rounded-full border px-3.5 py-1.5 text-[13px] cursor-pointer transition-colors ${
                        subProvider === pid
                          ? 'border-[var(--bt-accent)] bg-[var(--bt-accent)] text-[var(--bt-on-accent)] font-semibold'
                          : 'border-[var(--bt-border)] bg-[var(--bt-surface)] text-[var(--bt-text)]'
                      }`}
                    >
                      {t(PROVIDER_LABEL_KEY[pid])}
                    </button>
                  ))}
                </div>
              )}

              {track === 'local' && (
                <div class="flex flex-wrap gap-2">
                  {LOCAL_PROVIDERS.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => pickSubProvider(pid)}
                      class={`rounded-full border px-3.5 py-1.5 text-[13px] cursor-pointer transition-colors ${
                        subProvider === pid
                          ? 'border-[var(--bt-accent)] bg-[var(--bt-accent)] text-[var(--bt-on-accent)] font-semibold'
                          : 'border-[var(--bt-border)] bg-[var(--bt-surface)] text-[var(--bt-text)]'
                      }`}
                    >
                      {t(PROVIDER_LABEL_KEY[pid])}
                    </button>
                  ))}
                </div>
              )}

              <ProviderConfigPanel
                providerId={subProvider}
                settings={settings}
                onChangeSettings={(next) => void persist(() => next)}
                showActivateButton={false}
              />
            </section>

            {/* Step 2: Target language & Editorial appearance */}
            <section class="space-y-4">
              <h2 class="bt-serif text-[18px] font-semibold">{t('onboardingStep2')}</h2>

              <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-5">
                <div class="max-w-[300px] space-y-1.5">
                  <label for="bt-onboard-target" class="block text-[13px] font-medium">
                    {t('targetLanguage')}
                  </label>
                  <select
                    id="bt-onboard-target"
                    value={settings.reading.targetLang}
                    onChange={(e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      void persist((curr) => ({
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

                <AppearancePicker
                  compact
                  appearance={settings.appearance}
                  onPatch={(patch) =>
                    void persist((curr) => ({
                      ...curr,
                      appearance: { ...curr.appearance, ...patch },
                    }))
                  }
                />
              </div>
            </section>

            <StatusNotice tone="info">{t('shortcutDesc')}</StatusNotice>

            <footer class="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => void complete()}
                class="rounded-full border border-[var(--bt-border-strong)] px-5 py-2.5 text-[13px] text-[var(--bt-text-muted)] cursor-pointer hover:text-[var(--bt-text)]"
              >
                {t('onboardingSkip')}
              </button>
              <button
                type="button"
                onClick={() => void complete()}
                class="rounded-full bg-[var(--bt-accent)] px-7 py-2.5 text-[14px] font-semibold text-[var(--bt-on-accent)] cursor-pointer hover:opacity-95"
              >
                {t('onboardingFinish')}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
