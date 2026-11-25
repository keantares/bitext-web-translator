import type { ChatPrompt } from '../prompts';
import {
  TranslationError,
  type ProviderStatus,
  type TranslateRequest,
  type TranslateResponse,
  type TranslationProvider,
} from '../types';
import { mapHttpError, runLlmTranslationBatch } from './base-llm';

export const GEMINI_PRESET_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
] as const;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GeminiProvider implements TranslationProvider {
  readonly id = 'gemini' as const;
  readonly modelName: string;
  readonly supportsInlineTags = true;
  readonly maxConcurrency = 3;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey.trim();
    this.modelName = config.model.trim();
    this.baseUrl = (config.baseUrl?.trim() || 'https://generativelanguage.googleapis.com').replace(
      /\/+$/u,
      '',
    );
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private validateConfig(): void {
    if (!this.apiKey) {
      throw new TranslationError('missing_key', 'Gemini API key is required', { provider: this.id });
    }
    if (!this.modelName) {
      throw new TranslationError('missing_model', 'Gemini model is required', { provider: this.id });
    }
  }

  private async complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
    this.validateConfig();
    const modelPath = encodeURIComponent(this.modelName);
    const url = `${this.baseUrl}/v1beta/models/${modelPath}:generateContent`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: prompt.system }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt.user }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      });
    } catch (err) {
      if (signal?.aborted) {
        throw new TranslationError('aborted', 'Request cancelled', { provider: this.id });
      }
      throw new TranslationError(
        'network',
        err instanceof Error ? err.message : 'Network error connecting to Gemini',
        { provider: this.id },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw mapHttpError(response.status, text, this.id);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new TranslationError('invalid_response', 'Empty response from Gemini', { provider: this.id });
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
