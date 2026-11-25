import type { DisplayMode, ProviderId, UserSettings } from '../storage/types';
import type { CacheStats } from '../translation/cache';
import type { OllamaPullProgress } from '../translation/providers/ollama';
import type {
  ErrorCode,
  ProviderStatus,
  TranslateFormat,
  TranslateItem,
  TranslatedItem,
} from '../translation/types';

export const PORT_TRANSLATE = 'bitext-translate';
export const PORT_OLLAMA_PULL = 'bitext-ollama-pull';

export interface PageState {
  supported: boolean;
  active: boolean;
  hostname: string;
  done: number;
  total: number;
  failed: number;
  displayMode: DisplayMode;
}

export type ContentCommand =
  | { type: 'bt:get-state' }
  | { type: 'bt:toggle-page' }
  | { type: 'bt:enable-page' }
  | { type: 'bt:stop-page' }
  | { type: 'bt:set-display-mode'; mode: DisplayMode }
  | { type: 'bt:translate-selection-text'; text: string }
  | { type: 'bt:navigation' };

export type PortTranslateMessage =
  | {
      id: number;
      type: 'translate';
      items: TranslateItem[];
      sourceLang: string;
      targetLang: string;
      format: TranslateFormat;
      priority: 1 | 2;
      context?: string;
    }
  | {
      id: number;
      type: 'convert';
      text: string;
      useTaiwanPhrases?: boolean;
    };

export type PortTranslateReply =
  | { id: number; ok: true; items?: TranslatedItem[]; text?: string }
  | { id: number; ok: false; code: ErrorCode; message: string; httpStatus?: number };

export type OllamaPullPortRequest = {
  type: 'pull';
  baseUrl: string;
  model: string;
};

export type OllamaPullPortReply =
  | { type: 'progress'; progress: OllamaPullProgress }
  | { type: 'done' }
  | { type: 'error'; code: ErrorCode; message: string };

export type RuntimeMessage =
  | { type: 'bt:popup-tab-action'; tabId: number; command: ContentCommand }
  | { type: 'bt:test-provider'; settings: UserSettings; providerId: Exclude<ProviderId, 'chrome-builtin'> }
  | { type: 'bt:ollama-detect'; baseUrl: string }
  | { type: 'bt:lmstudio-detect'; baseUrl: string }
  | { type: 'bt:cache-stats' }
  | { type: 'bt:cache-clear' }
  | { type: 'bt:open-options'; section?: string }
  | { type: 'bt:open-onboarding' }
  | { type: 'bt:badge'; text: string };

export type RuntimeReply =
  | { ok: true; state?: PageState; status?: ProviderStatus; stats?: CacheStats; text?: string }
  | { ok: false; error: string; code?: ErrorCode };
