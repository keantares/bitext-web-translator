import type { ResolvedLocale } from '../i18n';

export interface LanguageOption {
  code: string;
  labelEn: string;
  labelZhTw: string;
  promptName: string;
  chromeCode: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'zh-TW', labelEn: 'Traditional Chinese', labelZhTw: '繁體中文', promptName: 'Traditional Chinese (Taiwan usage)', chromeCode: 'zh-Hant' },
  { code: 'zh-CN', labelEn: 'Simplified Chinese', labelZhTw: '簡體中文', promptName: 'Simplified Chinese', chromeCode: 'zh' },
  { code: 'en-US', labelEn: 'English (US)', labelZhTw: '美式英文', promptName: 'American English', chromeCode: 'en' },
  { code: 'en-GB', labelEn: 'English (UK)', labelZhTw: '英式英文', promptName: 'British English', chromeCode: 'en' },
  { code: 'ja', labelEn: 'Japanese', labelZhTw: '日文', promptName: 'Japanese', chromeCode: 'ja' },
  { code: 'ko', labelEn: 'Korean', labelZhTw: '韓文', promptName: 'Korean', chromeCode: 'ko' },
  { code: 'fr', labelEn: 'French', labelZhTw: '法文', promptName: 'French', chromeCode: 'fr' },
  { code: 'de', labelEn: 'German', labelZhTw: '德文', promptName: 'German', chromeCode: 'de' },
  { code: 'es', labelEn: 'Spanish', labelZhTw: '西班牙文', promptName: 'Spanish', chromeCode: 'es' },
  { code: 'pt', labelEn: 'Portuguese', labelZhTw: '葡萄牙文', promptName: 'Portuguese', chromeCode: 'pt' },
  { code: 'it', labelEn: 'Italian', labelZhTw: '義大利文', promptName: 'Italian', chromeCode: 'it' },
  { code: 'vi', labelEn: 'Vietnamese', labelZhTw: '越南文', promptName: 'Vietnamese', chromeCode: 'vi' },
  { code: 'th', labelEn: 'Thai', labelZhTw: '泰文', promptName: 'Thai', chromeCode: 'th' },
] as const;

const BY_CODE = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

export function getLanguage(code: string): LanguageOption | undefined {
  return BY_CODE.get(code);
}

export function getLanguageLabel(code: string, locale: ResolvedLocale): string {
  if (code === 'auto') {
    return locale === 'zh-TW' ? '自動偵測' : 'Auto detect';
  }
  const match = BY_CODE.get(code);
  if (!match) return code;
  return locale === 'zh-TW' ? match.labelZhTw : match.labelEn;
}

export function normalizeDetectedLanguage(raw: string | undefined): string {
  if (!raw) return 'auto';
  const lower = raw.toLowerCase().trim();
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hant') || lower.startsWith('zh-hk')) {
    return 'zh-TW';
  }
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower === 'en-gb') return 'en-GB';
  if (lower.startsWith('en')) return 'en-US';
  const base = lower.split('-')[0] ?? '';
  return BY_CODE.has(base) ? base : 'auto';
}

export function toChromeLanguageCode(code: string): string {
  if (code === 'auto') return 'en';
  const match = BY_CODE.get(code);
  if (match) return match.chromeCode;
  return (code.split('-')[0] ?? 'en').toLowerCase();
}
