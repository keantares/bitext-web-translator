import type { ChatPrompt } from '../prompts';
import {
  TranslationError,
  type ProviderStatus,
  type TranslateRequest,
  type TranslateResponse,
  type TranslationProvider,
} from '../types';
import { mapHttpError, runLlmTranslationBatch } from './base-llm';

export interface RecommendedOllamaModel {
  name: string;
  sizeLabel: string;
  noteEn: string;
  noteZhTw: string;
  recommended?: boolean;
}

export const RECOMMENDED_OLLAMA_MODELS: readonly RecommendedOllamaModel[] = [
  {
    name: 'qwen2.5:3b',
    sizeLabel: '~1.9 GB',
    noteEn: 'Fast & accurate for CJK and English on most laptops',
    noteZhTw: '體積輕巧、中英日韓翻譯品質穩定，一般筆電即可順跑',
    recommended: true,
  },
  {
    name: 'gemma3:4b',
    sizeLabel: '~3.3 GB',
    noteEn: 'Balanced multilingual quality with smooth phrasing',
    noteZhTw: '多語系表現均衡，語句自然流暢',
  },
  {
    name: 'qwen2.5:7b',
    sizeLabel: '~4.7 GB',
    noteEn: 'Higher translation accuracy, recommended with dedicated GPU',
    noteZhTw: '翻譯精準度更高，建議搭配獨立顯示卡使用',
  },
] as const;

export const OLLAMA_CORS_COMMANDS = {
  windows: 'setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"',
  macos: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"',
  linux: 'sudo systemctl edit ollama.service\n# Add under [Service]:\n# Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"',
} as const;

export interface OllamaPullProgress {
  status: string;
  completed?: number;
  total?: number;
  percent?: number;
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/u, '');
}

export async function detectOllama(
  baseUrl = 'http://127.0.0.1:11434',
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<ProviderStatus> {
  const cleanUrl = trimSlash(baseUrl);
  if (!cleanUrl) {
    return { ok: false, code: 'missing_url', message: 'Ollama URL is required' };
  }
  try {
    const response = await fetchImpl(`${cleanUrl}/api/tags`, {
      method: 'GET',
      signal,
    });
    if (response.status === 403) {
      return {
        ok: false,
        code: 'cors_403',
        httpStatus: 403,
        message: 'Ollama rejected extension origin (HTTP 403). Configure OLLAMA_ORIGINS and restart Ollama.',
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        code: 'http_error',
        httpStatus: response.status,
        message: `HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    return { ok: true, code: 'ok', models };
  } catch (err) {
    return {
      ok: false,
      code: 'network',
      message: err instanceof Error ? err.message : 'Unable to reach Ollama at ' + cleanUrl,
    };
  }
}

export async function pullOllamaModel(
  params: {
    baseUrl?: string;
    model: string;
    onProgress?: (progress: OllamaPullProgress) => void;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<void> {
  const cleanUrl = trimSlash(params.baseUrl ?? 'http://127.0.0.1:11434');
  const fetchImpl = params.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const model = params.model.trim();
  if (!model) {
    throw new TranslationError('missing_model', 'Model name is required', { provider: 'ollama' });
  }

  let response: Response;
  try {
    response = await fetchImpl(`${cleanUrl}/api/pull`, {
      method: 'POST',
      signal: params.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    });
  } catch (err) {
    if (params.signal?.aborted) {
      throw new TranslationError('aborted', 'Download cancelled', { provider: 'ollama' });
    }
    throw new TranslationError(
      'network',
      err instanceof Error ? err.message : 'Failed to connect to Ollama',
      { provider: 'ollama' },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw mapHttpError(response.status, text, 'ollama');
  }

  if (!response.body) {
    params.onProgress?.({ status: 'success', percent: 100 });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };
          if (parsed.error) {
            throw new TranslationError('http_error', parsed.error, { provider: 'ollama' });
          }
          const percent =
            parsed.total && parsed.total > 0 && typeof parsed.completed === 'number'
              ? Math.min(100, Math.round((parsed.completed / parsed.total) * 100))
              : undefined;
          params.onProgress?.({
            status: parsed.status ?? 'downloading',
            completed: parsed.completed,
            total: parsed.total,
            percent,
          });
        } catch (err) {
          if (err instanceof TranslationError) throw err;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements TranslationProvider {
  readonly id = 'ollama' as const;
  readonly modelName: string;
  readonly supportsInlineTags = true;
  readonly maxConcurrency = 1;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaConfig) {
    this.baseUrl = trimSlash(config.baseUrl || 'http://127.0.0.1:11434');
    this.modelName = config.model.trim();
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private validateConfig(): void {
    if (!this.baseUrl) {
      throw new TranslationError('missing_url', 'Ollama URL is required', { provider: this.id });
    }
    if (!this.modelName) {
      throw new TranslationError('missing_model', 'Ollama model is required', { provider: this.id });
    }
  }

  private async complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
    this.validateConfig();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          stream: false,
          options: { temperature: 0.2 },
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
        err instanceof Error ? err.message : 'Unable to connect to Ollama',
        { provider: this.id },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw mapHttpError(response.status, text, this.id);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) {
      throw new TranslationError('http_error', data.error, { provider: this.id });
    }
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new TranslationError('invalid_response', 'Empty response from Ollama', { provider: this.id });
    }
    return content;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    return runLlmTranslationBatch(request, (prompt, signal) => this.complete(prompt, signal));
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderStatus> {
    return detectOllama(this.baseUrl, this.fetchImpl, signal);
  }
}
