import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeSettings } from '@/core/storage/settings';
import { DEFAULT_SETTINGS } from '@/core/storage/types';
import { TranslationCache } from '@/core/translation/cache';
import { TranslationEngine } from '@/core/translation/engine';
import { AnthropicProvider } from '@/core/translation/providers/anthropic';
import {
  checkChromeBuiltinAvailability,
  ChromeBuiltinClient,
} from '@/core/translation/providers/chrome-builtin';
import { GeminiProvider } from '@/core/translation/providers/gemini';
import {
  detectOllama,
  OllamaProvider,
  pullOllamaModel,
} from '@/core/translation/providers/ollama';
import { detectLMStudio, OpenAICompatibleProvider } from '@/core/translation/providers/openai';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Cloud & Local Providers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    const g = globalThis as Record<string, unknown>;
    delete g.Translator;
    delete g.LanguageDetector;
  });

  it('OpenAI provider sends bearer token and translates batch with tag fallback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      // First call (batch): deliberately omit <b0> tag on item 1 to test fallback
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '<seg id="0">你好</seg>\n<seg id="1">閱讀指南</seg>' } }],
        }),
      )
      // Second call (single retry for item 1): returns valid <b0> tag
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '閱讀<b0>指南</b0>' } }],
        }),
      );

    const provider = new OpenAICompatibleProvider({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4.1-mini',
      fetchImpl: fetchMock,
    });

    const result = await provider.translate({
      items: [
        { id: 0, text: 'Hello' },
        { id: 1, text: 'Read <b0>guide</b0>' },
      ],
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'tags',
    });

    expect(result.items).toEqual([
      { id: 0, text: '你好' },
      { id: 1, text: '閱讀<b0>指南</b0>' },
    ]);
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Authorization).toBe('Bearer sk-test');
  });

  it('Anthropic provider sends required browser-access and version headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: 'text', text: '世界你好' }],
      }),
    );

    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5',
      fetchImpl: fetchMock,
    });

    const res = await provider.translate({
      items: [{ id: 0, text: 'Hello world' }],
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'text',
    });

    expect(res.items[0]?.text).toBe('世界你好');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('Gemini provider sends x-goog-api-key header (not URL query) and parses candidates', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '早安' }] } }],
      }),
    );

    const provider = new GeminiProvider({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      fetchImpl: fetchMock,
    });

    const res = await provider.translate({
      items: [{ id: 0, text: 'Good morning' }],
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'text',
    });

    expect(res.items[0]?.text).toBe('早安');
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(String(url)).not.toContain('AIza-test');
    expect(String(url)).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
  });

  it('Ollama detects models, diagnoses HTTP 403 CORS, streams /api/pull progress, and strips <think>', async () => {
    const fetch403 = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    const corsStatus = await detectOllama('http://127.0.0.1:11434', fetch403);
    expect(corsStatus.ok).toBe(false);
    expect(corsStatus.code).toBe('cors_403');

    const fetchTags = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ models: [{ name: 'qwen2.5:3b' }, { name: 'gemma3:4b' }] }),
    );
    const okStatus = await detectOllama('http://127.0.0.1:11434', fetchTags);
    expect(okStatus.ok).toBe(true);
    expect(okStatus.models).toEqual(['qwen2.5:3b', 'gemma3:4b']);

    // Streaming pull progress
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ status: 'downloading', completed: 500, total: 1000 }) + '\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ status: 'success', completed: 1000, total: 1000 }) + '\n',
          ),
        );
        controller.close();
      },
    });
    const fetchPull = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const progressEvents: number[] = [];
    await pullOllamaModel({
      model: 'qwen2.5:3b',
      fetchImpl: fetchPull,
      onProgress: (p) => {
        if (typeof p.percent === 'number') progressEvents.push(p.percent);
      },
    });
    expect(progressEvents).toEqual([50, 100]);

    // Chat translation strips <think> and normalizes Simplified to Taiwan Traditional
    const fetchChat = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        message: { content: '<think>reasoning</think>\n这个软件非常棒' },
      }),
    );
    const ollama = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
      fetchImpl: fetchChat,
    });
    const translated = await ollama.translate({
      items: [{ id: 0, text: 'This software is awesome' }],
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'text',
    });
    expect(translated.items[0]?.text).toBe('這個軟體非常棒');
  });

  it('LM Studio detects loaded models', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'qwen2.5-7b-instruct' }] }),
    );
    const status = await detectLMStudio('http://127.0.0.1:1234/v1', fetchMock);
    expect(status.ok).toBe(true);
    expect(status.models).toEqual(['qwen2.5-7b-instruct']);
  });

  it('Chrome Built-in client detects availability, tracks download progress, and translates', async () => {
    expect((await checkChromeBuiltinAvailability('en-US', 'zh-TW')).code).toBe('unavailable');

    const g = globalThis as Record<string, unknown>;
    g.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({
        detect: async () => [{ detectedLanguage: 'en', confidence: 0.99 }],
      }),
    };
    g.Translator = {
      availability: async () => 'downloadable',
      create: async (opts: { monitor?: (m: { addEventListener: (t: string, fn: (e: { loaded: number; total: number }) => void) => void }) => void }) => {
        opts.monitor?.({
          addEventListener: (_t, fn) => fn({ loaded: 75, total: 100 }),
        });
        return {
          translate: async (text: string) => `譯:${text}`,
        };
      },
    };

    expect((await checkChromeBuiltinAvailability('en-US', 'zh-TW')).code).toBe('downloadable');

    const client = new ChromeBuiltinClient();
    const downloads: number[] = [];
    const res = await client.translateBatch(
      {
        items: [{ id: 0, text: 'Read <b0>docs</b0>' }],
        sourceLang: 'auto',
        targetLang: 'zh-TW',
        format: 'tags',
      },
      (pct) => downloads.push(pct),
    );
    expect(downloads).toEqual([75]);
    expect(res.items[0]?.text).toBe('譯:Read docs');
  });

  it('TranslationEngine reuses IndexedDB/memory cache on repeat calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '快取測試' } }],
      }),
    );
    const engine = new TranslationEngine({
      cache: new TranslationCache(100),
      fetchImpl: fetchMock,
    });
    const settings = mergeSettings({
      ...DEFAULT_SETTINGS,
      activeProvider: 'openai',
      providers: {
        ...DEFAULT_SETTINGS.providers,
        openai: { ...DEFAULT_SETTINGS.providers.openai, apiKey: 'sk-test' },
      },
    });

    const r1 = await engine.translate(settings, {
      items: [{ id: 0, text: 'Cache test' }],
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'text',
    });
    const r2 = await engine.translate(settings, {
      items: [{ id: 0, text: 'Cache test' }],
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'text',
    });

    expect(r1.items[0]?.text).toBe('快取測試');
    expect(r2.items[0]?.text).toBe('快取測試');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
