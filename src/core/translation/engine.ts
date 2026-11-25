import type { ProviderId, UserSettings } from '../storage/types';
import { buildCacheKey, TranslationCache, type CacheStats } from './cache';
import { PROMPT_VERSION } from './prompts';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';
import { OpenAICompatibleProvider } from './providers/openai';
import { PriorityQueue } from './queue';
import {
  TranslationError,
  type ProviderStatus,
  type TranslateItem,
  type TranslateRequest,
  type TranslateResponse,
  type TranslatedItem,
  type TranslationProvider,
} from './types';

export function createRemoteProvider(
  settings: UserSettings,
  overrideProvider?: Exclude<ProviderId, 'chrome-builtin'>,
  fetchImpl?: typeof fetch,
): TranslationProvider {
  const id = overrideProvider ?? settings.activeProvider;
  switch (id) {
    case 'openai':
      return new OpenAICompatibleProvider({
        id: 'openai',
        baseUrl: settings.providers.openai.baseUrl || 'https://api.openai.com/v1',
        apiKey: settings.providers.openai.apiKey,
        model: settings.providers.openai.model,
        requireApiKey: true,
        fetchImpl,
      });
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: settings.providers.anthropic.apiKey,
        model: settings.providers.anthropic.model,
        baseUrl: settings.providers.anthropic.baseUrl,
        fetchImpl,
      });
    case 'gemini':
      return new GeminiProvider({
        apiKey: settings.providers.gemini.apiKey,
        model: settings.providers.gemini.model,
        baseUrl: settings.providers.gemini.baseUrl,
        fetchImpl,
      });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        id: 'openai-compatible',
        baseUrl: settings.providers['openai-compatible'].baseUrl,
        apiKey: settings.providers['openai-compatible'].apiKey,
        model: settings.providers['openai-compatible'].model,
        requireApiKey: false,
        fetchImpl,
      });
    case 'ollama':
      return new OllamaProvider({
        baseUrl: settings.providers.ollama.baseUrl,
        model: settings.providers.ollama.model,
        fetchImpl,
      });
    case 'lmstudio':
      return new OpenAICompatibleProvider({
        id: 'lmstudio',
        baseUrl: settings.providers.lmstudio.baseUrl,
        model: settings.providers.lmstudio.model,
        requireApiKey: false,
        maxConcurrency: 1,
        fetchImpl,
      });
    case 'chrome-builtin':
      throw new TranslationError(
        'unavailable',
        'Chrome Built-in Translator runs directly in the page context.',
        { provider: 'chrome-builtin' },
      );
  }
}

export class TranslationEngine {
  private readonly cache: TranslationCache;
  private readonly queue: PriorityQueue;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts?: { cache?: TranslationCache; fetchImpl?: typeof fetch }) {
    this.cache = opts?.cache ?? new TranslationCache();
    this.queue = new PriorityQueue(3);
    this.fetchImpl = opts?.fetchImpl;
  }

  cancelGroup(group: string): void {
    this.queue.cancelGroup(group);
  }

  async cacheStats(): Promise<CacheStats> {
    return this.cache.stats();
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  async testProvider(
    settings: UserSettings,
    providerId: Exclude<ProviderId, 'chrome-builtin'>,
    signal?: AbortSignal,
  ): Promise<ProviderStatus> {
    const provider = createRemoteProvider(settings, providerId, this.fetchImpl);
    return provider.testConnection(signal);
  }

  async translate(settings: UserSettings, request: TranslateRequest): Promise<TranslateResponse> {
    const provider = createRemoteProvider(settings, undefined, this.fetchImpl);
    this.cache.setMaxEntries(settings.cache.maxEntries);
    this.queue.setMaxConcurrency(provider.maxConcurrency);

    const results = new Map<number, TranslatedItem>();
    const uncached: TranslateItem[] = [];
    const keyMap = new Map<number, string>();

    for (const item of request.items) {
      const key = buildCacheKey({
        provider: provider.id,
        model: provider.modelName,
        promptVersion: PROMPT_VERSION,
        targetLang: request.targetLang,
        format: request.format,
        sourceText: item.text,
      });
      keyMap.set(item.id, key);

      if (settings.cache.enabled) {
        const hit = await this.cache.get(key);
        if (hit !== null) {
          results.set(item.id, { id: item.id, text: hit });
          continue;
        }
      }
      uncached.push(item);
    }

    if (uncached.length > 0) {
      const response = await this.queue.enqueue(
        () =>
          provider.translate({
            ...request,
            items: uncached,
          }),
        {
          priority: request.priority ?? 2,
          group: request.group,
          signal: request.signal,
        },
      );

      for (const item of response.items) {
        results.set(item.id, item);
        if (settings.cache.enabled && !item.failed && item.text) {
          const key = keyMap.get(item.id);
          if (key) {
            await this.cache.put(key, item.text);
          }
        }
      }
    }

    return {
      items: request.items.map(
        (item) => results.get(item.id) ?? { id: item.id, text: '', failed: true },
      ),
    };
  }
}
