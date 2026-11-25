import type { UiLocale } from '../storage/types';
import { MESSAGES_EN, MESSAGES_ZH_TW, type MessageKey } from './messages';

export type { MessageKey };
export type ResolvedLocale = 'zh-TW' | 'en';

interface BrowserI18nLike {
  i18n?: {
    getUILanguage?: () => string;
  };
}

function detectBrowserLanguage(): string {
  const g = globalThis as { browser?: BrowserI18nLike; chrome?: BrowserI18nLike };
  return (
    g.browser?.i18n?.getUILanguage?.() ??
    g.chrome?.i18n?.getUILanguage?.() ??
    (typeof navigator !== 'undefined' ? navigator.language : 'en')
  );
}

export function resolveUiLocale(preference: UiLocale = 'auto', browserLang?: string): ResolvedLocale {
  if (preference === 'zh-TW' || preference === 'en') {
    return preference;
  }
  const detected = (browserLang ?? detectBrowserLanguage()).toLowerCase();

  if (detected.startsWith('zh')) {
    return 'zh-TW';
  }
  return 'en';
}

export function t(
  key: MessageKey,
  locale: ResolvedLocale = 'en',
  params?: Record<string, string>,
): string {
  const catalog = locale === 'zh-TW' ? MESSAGES_ZH_TW : MESSAGES_EN;
  let value: string = catalog[key] ?? MESSAGES_EN[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, v);
    }
  }
  return value;
}

export function createTranslator(preference: UiLocale = 'auto', browserLang?: string) {
  const locale = resolveUiLocale(preference, browserLang);
  return {
    locale,
    t: (key: MessageKey, params?: Record<string, string>) => t(key, locale, params),
  };
}
