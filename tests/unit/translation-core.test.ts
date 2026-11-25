import { describe, expect, it } from 'vitest';
import {
  exportSettingsJson,
  importSettingsJson,
  isProviderConfigured,
  mergeSettings,
} from '@/core/storage/settings';
import { DEFAULT_SETTINGS } from '@/core/storage/types';
import { buildCacheKey, TranslationCache } from '@/core/translation/cache';
import {
  cleanTranslationOutput,
  convertSimplifiedToTaiwan,
  hasSimplifiedChars,
} from '@/core/translation/opencc';
import {
  buildBatchPrompt,
  inlineTagsMatch,
  parseBatchResponse,
} from '@/core/translation/prompts';
import { PriorityQueue } from '@/core/translation/queue';

describe('opencc & output cleaning', () => {
  it('converts Simplified Chinese to Taiwan Traditional with regional terms', () => {
    const input = '这个软件支持在线视频翻译和鼠标框选。';
    expect(hasSimplifiedChars(input)).toBe(true);
    const out = convertSimplifiedToTaiwan(input);
    expect(out).toContain('軟體');
    expect(out).toContain('影片');
    expect(out).toContain('滑鼠');
  });

  it('preserves inline <b0> tags during OpenCC conversion', () => {
    const input = '请阅读<b0>开源软件</b0>许可协议。';
    const out = convertSimplifiedToTaiwan(input);
    expect(out).toBe('請閱讀<b0>開源軟體</b0>許可協議。');
  });

  it('strips <think> reasoning tags and code fences and normalizes zh-TW', () => {
    const raw = '<think>Let me translate this carefully.</think>\n```text\n这个软件很好用\n```';
    expect(cleanTranslationOutput(raw, 'zh-TW')).toBe('這個軟體很好用');
  });
});

describe('prompts & inline tag validation', () => {
  it('validates balanced nested inline markers', () => {
    expect(inlineTagsMatch('Read <b0>the <b1>guide</b1></b0>', '閱讀<b0><b1>指南</b1></b0>')).toBe(true);
    expect(inlineTagsMatch('Read <b0>guide</b0>', '閱讀指南')).toBe(false);
    expect(inlineTagsMatch('Read <b0><b1>guide</b1></b0>', '閱讀<b1><b0>指南</b0></b1>')).toBe(false);
  });

  it('builds and parses multi-item <seg> batches', () => {
    const items = [
      { id: 10, text: 'Hello' },
      { id: 11, text: 'World' },
    ];
    const prompt = buildBatchPrompt({
      items,
      sourceLang: 'en-US',
      targetLang: 'zh-TW',
      format: 'text',
      context: 'Sample Page',
    });
    expect(prompt.user).toContain('<seg id="10">Hello</seg>');
    expect(prompt.user).toContain('<seg id="11">World</seg>');

    const parsed = parseBatchResponse('<seg id="10">你好</seg>\n<seg id="11">世界</seg>', items);
    expect(parsed?.get(10)).toBe('你好');
    expect(parsed?.get(11)).toBe('世界');
  });
});

describe('TranslationCache', () => {
  it('stores, retrieves, evicts oldest entries, and clears', async () => {
    const cache = new TranslationCache(100);
    const k1 = buildCacheKey({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      promptVersion: 'v1',
      targetLang: 'zh-TW',
      format: 'text',
      sourceText: 'Hello world',
    });
    await cache.put(k1, '你好世界');
    expect(await cache.get(k1)).toBe('你好世界');
    const stats = await cache.stats();
    expect(stats.count).toBe(1);
    expect(stats.estimatedBytes).toBeGreaterThan(0);

    await cache.clear();
    expect(await cache.get(k1)).toBeNull();
    expect((await cache.stats()).count).toBe(0);
  });
});

describe('PriorityQueue', () => {
  it('runs priority 1 tasks before priority 2 and supports group cancellation', async () => {
    const q = new PriorityQueue(1);
    const order: string[] = [];

    let releaseFirst!: () => void;
    const first = q.enqueue(
      () =>
        new Promise<void>((resolve) => {
          order.push('first');
          releaseFirst = resolve;
        }),
      { priority: 1, group: 'g1' },
    );

    const low = q.enqueue(async () => {
      order.push('low');
    }, { priority: 2, group: 'g2' });

    const high = q.enqueue(async () => {
      order.push('high');
    }, { priority: 1, group: 'g1' });

    const cancelled = q.enqueue(async () => {
      order.push('cancelled');
    }, { priority: 2, group: 'cancel-me' });

    q.cancelGroup('cancel-me');
    await expect(cancelled).rejects.toThrow();

    releaseFirst();
    await Promise.all([first, high, low]);
    expect(order).toEqual(['first', 'high', 'low']);
  });
});

describe('settings export/import', () => {
  it('strips API keys by default on export and preserves current keys on import', () => {
    const s = mergeSettings({
      ...DEFAULT_SETTINGS,
      providers: {
        ...DEFAULT_SETTINGS.providers,
        openai: { ...DEFAULT_SETTINGS.providers.openai, apiKey: 'sk-secret' },
      },
      appearance: { ...DEFAULT_SETTINGS.appearance, accentColor: 'brick' },
    });
    expect(isProviderConfigured(s, 'openai')).toBe(true);

    const jsonWithoutKeys = exportSettingsJson(s, false);
    expect(jsonWithoutKeys).not.toContain('sk-secret');

    const imported = importSettingsJson(jsonWithoutKeys, s);
    expect(imported.providers.openai.apiKey).toBe('sk-secret');
    expect(imported.appearance.accentColor).toBe('brick');
  });
});
