import { useEffect, useState } from 'preact/hooks';
import { createTranslator, type MessageKey } from '@/core/i18n';
import {
  ACCENT_PALETTES,
  type AccentColor,
  type AppearanceSettings,
  type DisplayMode,
  type PaperTone,
  type ThemeMode,
  type TranslationStyle,
  type UiLocale,
} from '@/core/storage/types';
import { SegmentedControl } from './Controls';
import { BrandMark, CheckIcon } from './Icons';

const ACCENT_LABEL_KEY: Record<AccentColor, MessageKey> = {
  teal: 'accentTeal',
  navy: 'accentNavy',
  indigo: 'accentIndigo',
  petrol: 'accentPetrol',
  brick: 'accentBrick',
};

const STYLE_OPTIONS: Array<{ value: TranslationStyle; key: MessageKey }> = [
  { value: 'bar', key: 'styleBar' },
  { value: 'dotted', key: 'styleDotted' },
  { value: 'tint', key: 'styleTint' },
  { value: 'clean', key: 'styleClean' },
];

export function AppearancePicker({
  appearance,
  onPatch,
  compact = false,
}: {
  appearance: AppearanceSettings;
  onPatch: (patch: Partial<AppearanceSettings>) => void;
  compact?: boolean;
}) {
  const { locale, t } = createTranslator(appearance.uiLocale);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const patch = <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => {
    onPatch({ [key]: value });
  };

  const previewTrClass =
    appearance.displayMode === 'translation-only'
      ? 'mt-1 text-[var(--bt-text)]'
      : appearance.translationStyle === 'bar'
        ? 'mt-1.5 border-l-[2.5px] border-[var(--bt-accent)] pl-2.5 text-[var(--bt-trans)]'
        : appearance.translationStyle === 'dotted'
          ? 'mt-1.5 underline decoration-dotted decoration-[var(--bt-accent)] underline-offset-4 text-[var(--bt-trans)]'
          : appearance.translationStyle === 'tint'
            ? 'mt-1.5 rounded-[6px] bg-[var(--bt-accent-soft)] px-2 py-1 text-[var(--bt-trans)]'
            : 'mt-1.5 text-[var(--bt-text-muted)]';

  return (
    <div class="space-y-5">
      {/* Live editorial preview */}
      <div class="rounded-[12px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-4 shadow-[var(--bt-shadow)]">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[12px] font-medium text-[var(--bt-text-muted)]">
            {t('appearancePreview')}
          </span>
          <div class="inline-flex items-center gap-2">
            <BrandMark size={22} />
            <span class="rounded-full bg-[var(--bt-accent)] px-3 py-1 text-[12px] font-medium text-[var(--bt-on-accent)]">
              {t('translatePage')}
            </span>
          </div>
        </div>
        <div class="rounded-[10px] border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] p-3.5">
          {appearance.displayMode !== 'translation-only' && (
            <p class="bt-serif text-[14px] leading-relaxed text-[var(--bt-text)]">
              At low tide, a small pool forms between the rocks.
            </p>
          )}
          <p class={`text-[14px] leading-relaxed ${previewTrClass}`}>
            {locale === 'zh-TW'
              ? '退潮時，岩石之間會形成一個小水池。'
              : 'At low tide, a small pool forms between the rocks. (Translated)'}
          </p>
        </div>
      </div>

      {/* Accent 5 colors */}
      <div class="space-y-2">
        <div class="text-[13px] font-medium text-[var(--bt-text)]">{t('accentColorTitle')}</div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {ACCENT_PALETTES.map((palette) => {
            const selected = appearance.accentColor === palette.id;
            return (
              <button
                key={palette.id}
                type="button"
                aria-pressed={selected}
                onClick={() => patch('accentColor', palette.id)}
                class={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-left text-[13px] cursor-pointer ${
                  selected
                    ? 'border-[var(--bt-accent)] bg-[var(--bt-accent-soft)] font-semibold text-[var(--bt-text)]'
                    : 'border-[var(--bt-border)] bg-[var(--bt-surface)] text-[var(--bt-text)] hover:border-[var(--bt-border-strong)]'
                }`}
              >
                <span
                  class="bt-swatch-dot relative grid h-4 w-4 shrink-0 place-items-center rounded-full"
                  style={{ backgroundColor: palette.lightHex }}
                >
                  {selected && <CheckIcon size={11} class="text-white" />}
                </span>
                <span class="truncate">{t(ACCENT_LABEL_KEY[palette.id])}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Paper surface + Theme mode */}
      <div class="grid sm:grid-cols-2 gap-4">
        <div class="space-y-2">
          <div class="text-[13px] font-medium text-[var(--bt-text)]">{t('paperToneTitle')}</div>
          <SegmentedControl<PaperTone>
            value={appearance.paperTone}
            onChange={(v) => patch('paperTone', v)}
            options={[
              { value: 'warm', label: t('paperWarm') },
              { value: 'cool', label: t('paperCool') },
            ]}
          />
        </div>

        <div class="space-y-2">
          <div class="text-[13px] font-medium text-[var(--bt-text)]">{t('themeModeTitle')}</div>
          <SegmentedControl<ThemeMode>
            value={appearance.themeMode}
            onChange={(v) => patch('themeMode', v)}
            options={[
              {
                value: 'system',
                label: systemDark ? t('themeSystemCurrentDark') : t('themeSystemCurrentLight'),
              },
              { value: 'light', label: t('themeLight') },
              { value: 'dark', label: t('themeDark') },
            ]}
          />
        </div>
      </div>

      {!compact && (
        <>
          {/* Webpage translation style */}
          <div class="space-y-2">
            <div class="text-[13px] font-medium text-[var(--bt-text)]">
              {t('translationStyleTitle')}
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STYLE_OPTIONS.map((opt) => {
                const selected = appearance.translationStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patch('translationStyle', opt.value)}
                    class={`rounded-[10px] border px-3 py-2 text-[13px] cursor-pointer ${
                      selected
                        ? 'border-[var(--bt-accent)] bg-[var(--bt-accent-soft)] font-semibold text-[var(--bt-text)]'
                        : 'border-[var(--bt-border)] bg-[var(--bt-surface)] text-[var(--bt-text)] hover:border-[var(--bt-border-strong)]'
                    }`}
                  >
                    {t(opt.key)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Default display mode + UI locale */}
          <div class="grid sm:grid-cols-2 gap-4">
            <div class="space-y-2">
              <div class="text-[13px] font-medium text-[var(--bt-text)]">
                {t('defaultDisplayModeTitle')}
              </div>
              <SegmentedControl<DisplayMode>
                value={appearance.displayMode}
                onChange={(v) => patch('displayMode', v)}
                options={[
                  { value: 'bilingual', label: t('modeBilingual') },
                  { value: 'translation-only', label: t('modeTranslationOnly') },
                ]}
              />
            </div>

            <div class="space-y-2">
              <label for="bt-ui-locale" class="block text-[13px] font-medium text-[var(--bt-text)]">
                {t('uiLocaleTitle')}
              </label>
              <select
                id="bt-ui-locale"
                value={appearance.uiLocale}
                onChange={(e) => patch('uiLocale', (e.target as HTMLSelectElement).value as UiLocale)}
                class="w-full rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-3 py-1.5 text-[13px] text-[var(--bt-text)]"
              >
                <option value="auto">{t('localeAuto')}</option>
                <option value="zh-TW">繁體中文（台灣）</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
