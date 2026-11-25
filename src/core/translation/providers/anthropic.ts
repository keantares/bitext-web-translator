import type { ChatPrompt } from '../prompts';
import {
  TranslationError,
  type ProviderStatus,
  type TranslateRequest,
  type TranslateResponse,
  type TranslationProvider,
} from '../types';
import { mapHttpError, runLlmTranslationBatch } from './base-llm';

export const ANTHROPIC_PRESET_MODELS = [
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
] as const;

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class AnthropicProvider implements TranslationProvider {
  readonly id = 'anthropic' as const;
  readonly modelName: string;
  readonly supportsInlineTags = true;
  readonly maxConcurrency = 3;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey.trim();
    this.modelName = config.model.trim();
    this.baseUrl = (config.baseUrl?.trim() || 'https://api.anthropic.com').replace(/\/+$/u, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private validateConfig(): void {
    if (!this.apiKey) {
      throw new TranslationError('missing_key', 'Anthropic API key is required', { provider: this.id });
    }
    if (!this.modelName) {
      throw new TranslationError('missing_model', 'Anthropic model is required', { provider: this.id });
    }
  }

  private async complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
    this.validateConfig();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.modelName,
          max_tokens: 4096,
          temperature: 0.2,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
    } catch (err) {
      if (signal?.aborted) {
        throw new TranslationError('aborted', 'Request cancelled', { provider: this.id });
      }
      throw new TranslationError(
        'network',
        err instanceof Error ? err.message : 'Network error connecting to Anthropic',
        { provider: this.id },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw mapHttpError(response.status, text, this.id);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      throw new TranslationError('invalid_response', 'Empty response from Claude', { provider: this.id });
    }
    return text;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    return runLlmTranslationBatch(request, (prompt, signal) => this.complete(prompt, signal));
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderStatus> {
    try {
      this.validateConfig();
      const reply = await this.complete({ system: 'Reply with OK only.', user: 'Hello' }, signal);
      return { ok: Boolean(reply), code: 'ok', message: reply.slice(0, 60) };
    } catch (err) {
      if (err instanceof TranslationError) {
        return { ok: false, code: err.code, message: err.message, httpStatus: err.httpStatus };
      }
      return { ok: false, code: 'unknown', message: err instanceof Error ? err.message : String(err) };
    }
  }
}
