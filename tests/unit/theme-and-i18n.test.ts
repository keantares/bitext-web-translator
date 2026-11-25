import { describe, expect, it, beforeEach } from 'vitest';
import { createTranslator, resolveUiLocale, t } from '@/core/i18n';
import { MESSAGES_EN, MESSAGES_ZH_TW } from '@/core/i18n/messages';
import { applyThemeToDocument, resolveColorSchemeContent } from '@/core/storage/theme';
import { ACCENT_PALETTES, DEFAULT_SETTINGS } from '@/core/storage/types';

describe('i18n', () => {
  it('has complete key parity between en and zh-TW catalogs', () => {
    expect(Object.keys(MESSAGES_ZH_TW).sort()).toEqual(Object.keys(MESSAGES_EN).sort());
  });

  it('resolves browser locale and explicit overrides', () => {
    expect(resolveUiLocale('auto', 'zh-TW')).toBe('zh-TW');
    expect(resolveUiLocale('auto', 'zh-HK')).toBe('zh-TW');
    expect(resolveUiLocale('auto', 'en-US')).toBe('en');
    expect(resolveUiLocale('auto', 'ja')).toBe('en');
    expect(resolveUiLocale('en', 'zh-TW')).toBe('en');
    expect(resolveUiLocale('zh-TW', 'en-US')).toBe('zh-TW');
  });

  it('interpolates template placeholders cleanly', () => {
    expect(t('alwaysTranslateHost', 'zh-TW', { host: 'nytimes.com' })).toBe('總是翻譯 nytimes.com');
    expect(t('alwaysTranslateHost', 'en', { host: 'nytimes.com' })).toBe('Always translate nytimes.com');
    const tr = createTranslator('zh-TW');
    expect(tr.t('appName')).toBe('BiText：網頁翻譯器');
  });
});

describe('design system defaults & theme helper', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-paper');
    localStorage.clear();
  });

  it('defaults to Forest Teal accent, Warm Ivory paper, and System theme', () => {
    expect(DEFAULT_SETTINGS.appearance.accentColor).toBe('teal');
    expect(DEFAULT_SETTINGS.appearance.paperTone).toBe('warm');
    expect(DEFAULT_SETTINGS.appearance.themeMode).toBe('system');
    expect(ACCENT_PALETTES.map((p) => p.id)).toEqual(['teal', 'navy', 'indigo', 'petrol', 'brick']);
  });

  it('maps themeMode to <meta name="color-scheme"> and mirrors to localStorage', () => {
    expect(resolveColorSchemeContent('system')).toBe('light dark');
    expect(resolveColorSchemeContent('light')).toBe('light');
    expect(resolveColorSchemeContent('dark')).toBe('dark');

    applyThemeToDocument({ themeMode: 'dark', accentColor: 'brick', paperTone: 'cool' });
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    expect(meta?.content).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('brick');
    expect(document.documentElement.dataset.paper).toBe('cool');
    expect(localStorage.getItem('bitext:themeMode')).toBe('dark');
    expect(localStorage.getItem('bitext:accentColor')).toBe('brick');
    expect(localStorage.getItem('bitext:paperTone')).toBe('cool');

    applyThemeToDocument({ themeMode: 'system', accentColor: 'teal', paperTone: 'warm' });
    expect(meta?.content).toBe('light dark');
    expect(localStorage.getItem('bitext:themeMode')).toBeNull();
  });
});
