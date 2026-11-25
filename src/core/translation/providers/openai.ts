import type { ProviderId } from '../../storage/types';
import type { ChatPrompt } from '../prompts';
import {
  TranslationError,
  type ProviderStatus,
  type TranslateRequest,
  type TranslateResponse,
  type TranslationProvider,
} from '../types';
import { mapHttpError, runLlmTranslationBatch } from './base-llm';

export const OPENAI_PRESET_MODELS = [
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o-mini',
  'gpt-4.1',
] as const;

export interface OpenAIConfig {
  id: Extract<ProviderId, 'openai' | 'openai-compatible' | 'lmstudio'>;
  baseUrl: string;
  apiKey?: string;
  model: string;
  requireApiKey?: boolean;
  maxConcurrency?: number;
  fetchImpl?: typeof fetch;
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/u, '');
}

export class OpenAICompatibleProvider implements TranslationProvider {
  readonly id: OpenAIConfig['id'];
  readonly modelName: string;
  readonly supportsInlineTags = true;
  readonly maxConcurrency: number;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requireApiKey: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAIConfig) {
    this.id = config.id;
    this.baseUrl = trimSlash(config.baseUrl);
    this.apiKey = (config.apiKey ?? '').trim();
    this.modelName = config.model.trim();
    this.requireApiKey = config.requireApiKey ?? config.id === 'openai';
    this.maxConcurrency = config.maxConcurrency ?? (config.id === 'lmstudio' ? 1 : 3);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private validateConfig(): void {
    if (!this.baseUrl) {
      throw new TranslationError('missing_url', 'API Base URL is required', { provider: this.id });
    }
    if (this.requireApiKey && !this.apiKey) {
      throw new TranslationError('missing_key', 'API Key is required', { provider: this.id });
    }
    if (!this.modelName) {
      throw new TranslationError('missing_model', 'Model name is required', { provider: this.id });
    }
  }

  private async complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
    this.validateConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: this.modelName,
          temperature: 0.2,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      });
    } catch (err) {
      if (signal?.aborted) {
        throw new TranslationError('aborted', 'Request cancelled', { provider: this.id });
      }
      throw new TranslationError(
        'network',
        err instanceof Error ? err.message : 'Network error connecting to server',
        { provider: this.id },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw mapHttpError(response.status, text, this.id);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new TranslationError('invalid_response', 'Empty response from model', { provider: this.id });
    }
    return content;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    return runLlmTranslationBatch(request, (prompt, signal) => this.complete(prompt, signal));
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderStatus> {
    try {
      if (this.id === 'lmstudio') {
        return await detectLMStudio(this.baseUrl, this.fetchImpl, signal);
      }
      this.validateConfig();
      const reply = await this.complete(
        {
          system: 'Reply with OK only.',
          user: 'Hello',
        },
        signal,
      );
      return { ok: Boolean(reply.trim()), code: 'ok', message: reply.trim().slice(0, 60) };
    } catch (err) {
      if (err instanceof TranslationError) {
        return { ok: false, code: err.code, message: err.message, httpStatus: err.httpStatus };
      }
      return { ok: false, code: 'unknown', message: err instanceof Error ? err.message : String(err) };
    }
  }
}

export async function detectLMStudio(
  baseUrl = 'http://127.0.0.1:1234/v1',
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<ProviderStatus> {
  const cleanUrl = trimSlash(baseUrl);
  if (!cleanUrl) {
    return { ok: false, code: 'missing_url', message: 'LM Studio URL is required' };
  }
  try {
    const response = await fetchImpl(`${cleanUrl}/models`, {
      method: 'GET',
      signal,
    });
    if (response.status === 403) {
      return { ok: false, code: 'cors_403', httpStatus: 403, message: 'LM Studio rejected extension origin (enable CORS)' };
    }
    if (!response.ok) {
      return { ok: false, code: 'http_error', httpStatus: response.status, message: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return { ok: true, code: 'ok', models };
  } catch (err) {
    return {
      ok: false,
      code: 'network',
      message: err instanceof Error ? err.message : 'Unable to reach LM Studio server',
    };
  }
}
