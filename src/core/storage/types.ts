export type AccentColor = 'teal' | 'navy' | 'indigo' | 'petrol' | 'brick';
export type PaperTone = 'warm' | 'cool';
export type ThemeMode = 'system' | 'light' | 'dark';
export type TranslationStyle = 'bar' | 'dotted' | 'tint' | 'clean';
export type DisplayMode = 'bilingual' | 'translation-only';
export type SelectionTrigger = 'icon' | 'immediate';
export type UiLocale = 'auto' | 'zh-TW' | 'en';

export type ProviderId =
  | 'chrome-builtin'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai-compatible'
  | 'ollama'
  | 'lmstudio';

export interface AppearanceSettings {
  accentColor: AccentColor;
  paperTone: PaperTone;
  themeMode: ThemeMode;
  translationStyle: TranslationStyle;
  displayMode: DisplayMode;
  uiLocale: UiLocale;
}

export interface ProviderCredentials {
  openai: { apiKey: string; model: string; baseUrl: string };
  anthropic: { apiKey: string; model: string; baseUrl: string };
  gemini: { apiKey: string; model: string; baseUrl: string };
  'openai-compatible': { apiKey: string; model: string; baseUrl: string };
  ollama: { baseUrl: string; model: string };
  lmstudio: { baseUrl: string; model: string };
}

export interface ReadingSettings {
  sourceLang: string;
  targetLang: string;
  selectionEnabled: boolean;
  selectionTrigger: SelectionTrigger;
  alwaysTranslateHosts: string[];
  neverTranslateHosts: string[];
}

export interface CacheSettings {
  enabled: boolean;
  maxEntries: number;
}

export interface UserSettings {
  onboardingCompleted: boolean;
  activeProvider: ProviderId;
  providers: ProviderCredentials;
  appearance: AppearanceSettings;
  reading: ReadingSettings;
  cache: CacheSettings;
}

export interface AccentDefinition {
  id: AccentColor;
  lightHex: string;
  darkHex: string;
  transLightHex: string;
  transDarkHex: string;
}

export const ACCENT_PALETTES: readonly AccentDefinition[] = [
  { id: 'teal', lightHex: '#0F6E66', darkHex: '#55B8AA', transLightHex: '#235C56', transDarkHex: '#9ED8CF' },
  { id: 'navy', lightHex: '#1D4E78', darkHex: '#6EA8DC', transLightHex: '#244B6E', transDarkHex: '#A9CBEB' },
  { id: 'indigo', lightHex: '#2E4DA7', darkHex: '#82A0F8', transLightHex: '#30488C', transDarkHex: '#B7C8FA' },
  { id: 'petrol', lightHex: '#166075', darkHex: '#61B6CC', transLightHex: '#1D5869', transDarkHex: '#A4D8E6' },
  { id: 'brick', lightHex: '#A63D33', darkHex: '#E58076', transLightHex: '#8A352D', transDarkHex: '#F0AAA3' },
] as const;

export const DEFAULT_SETTINGS: UserSettings = {
  onboardingCompleted: false,
  activeProvider: 'chrome-builtin',
  providers: {
    openai: {
      apiKey: '',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.openai.com/v1',
    },
    anthropic: {
      apiKey: '',
      model: 'claude-haiku-4-5',
      baseUrl: 'https://api.anthropic.com',
    },
    gemini: {
      apiKey: '',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com',
    },
    'openai-compatible': {
      apiKey: '',
      model: '',
      baseUrl: '',
    },
    ollama: {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
    },
    lmstudio: {
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: '',
    },
  },
  appearance: {
    accentColor: 'teal',
    paperTone: 'warm',
    themeMode: 'system',
    translationStyle: 'bar',
    displayMode: 'bilingual',
    uiLocale: 'auto',
  },
  reading: {
    sourceLang: 'auto',
    targetLang: 'zh-TW',
    selectionEnabled: true,
    selectionTrigger: 'icon',
    alwaysTranslateHosts: [],
    neverTranslateHosts: [],
  },
  cache: {
    enabled: true,
    maxEntries: 5000,
  },
};
