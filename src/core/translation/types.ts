import type { ProviderId } from '../storage/types';

export type TranslateFormat = 'text' | 'tags';

export interface TranslateItem {
  id: number;
  text: string;
}

export interface TranslateRequest {
  items: TranslateItem[];
  sourceLang: string;
  targetLang: string;
  format: TranslateFormat;
  context?: string;
  priority?: 1 | 2;
  group?: string;
  signal?: AbortSignal;
}

export interface TranslatedItem {
  id: number;
  text: string;
  failed?: boolean;
}

export interface TranslateResponse {
  items: TranslatedItem[];
}

export type ErrorCode =
  | 'missing_key'
  | 'missing_model'
  | 'missing_url'
  | 'auth_failed'
  | 'rate_limited'
  | 'cors_403'
  | 'network'
  | 'http_error'
  | 'invalid_response'
  | 'unavailable'
  | 'aborted'
  | 'unknown';

export class TranslationError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus?: number;
  readonly provider?: ProviderId;

  constructor(code: ErrorCode, message: string, opts?: { httpStatus?: number; provider?: ProviderId }) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.httpStatus = opts?.httpStatus;
    this.provider = opts?.provider;
  }
}

export interface ProviderStatus {
  ok: boolean;
  code: 'ok' | ErrorCode | 'downloadable' | 'downloading';
  message?: string;
  models?: string[];
  httpStatus?: number;
}

export interface TranslationProvider {
  readonly id: ProviderId;
  readonly modelName: string;
  readonly supportsInlineTags: boolean;
  readonly maxConcurrency: number;
  translate(request: TranslateRequest): Promise<TranslateResponse>;
  testConnection(signal?: AbortSignal): Promise<ProviderStatus>;
}
