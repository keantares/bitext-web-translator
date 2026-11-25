import { normalizeDetectedLanguage, toChromeLanguageCode } from '../languages';
import { stripInlineMarkers } from '../prompts';
import {
  TranslationError,
  type ProviderStatus,
  type TranslateRequest,
  type TranslateResponse,
  type TranslatedItem,
} from '../types';

interface ChromeTranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?: () => void;
}

interface ChromeDownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded?: number; total?: number }) => void,
  ): void;
}

interface ChromeTranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (monitor: ChromeDownloadMonitor) => void;
  }): Promise<ChromeTranslatorInstance>;
}

interface ChromeLanguageDetectorInstance {
  detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
}

interface ChromeLanguageDetectorStatic {
  availability(): Promise<string>;
  create(options?: { signal?: AbortSignal }): Promise<ChromeLanguageDetectorInstance>;
}

interface BuiltinAiGlobal {
  Translator?: ChromeTranslatorStatic;
  LanguageDetector?: ChromeLanguageDetectorStatic;
}

function getApi(): BuiltinAiGlobal {
  return globalThis as unknown as BuiltinAiGlobal;
}

export function isChromeBuiltinSupported(): boolean {
  const api = getApi();
  return typeof api.Translator?.availability === 'function' && typeof api.Translator?.create === 'function';
}

export async function checkChromeBuiltinAvailability(
  sourceLang: string,
  targetLang: string,
): Promise<ProviderStatus> {
  if (!isChromeBuiltinSupported()) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Chrome built-in Translator API requires desktop Chrome 138+.',
    };
  }
  const src = toChromeLanguageCode(sourceLang === 'auto' ? 'en-US' : sourceLang);
  const dst = toChromeLanguageCode(targetLang);
  if (src === dst) {
    return { ok: true, code: 'ok', message: 'available' };
  }
  try {
    const status = await getApi().Translator!.availability({
      sourceLanguage: src,
      targetLanguage: dst,
    });
    if (status === 'available' || status === 'readily') {
      return { ok: true, code: 'ok', message: status };
    }
    if (status === 'downloadable' || status === 'after-download') {
      return { ok: true, code: 'downloadable', message: status };
    }
    if (status === 'downloading') {
      return { ok: true, code: 'downloading', message: status };
    }
    return {
      ok: false,
      code: 'unavailable',
      message: `Language pair ${src} -> ${dst} is not available in Chrome Built-in Translator.`,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'unavailable',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export class ChromeBuiltinClient {
  private readonly instances = new Map<string, Promise<ChromeTranslatorInstance>>();
  private detectorPromise: Promise<ChromeLanguageDetectorInstance | null> | null = null;

  async detectLanguage(sampleText: string, signal?: AbortSignal): Promise<string> {
    const api = getApi();
    if (!api.LanguageDetector?.create) return 'en';
    try {
      if (!this.detectorPromise) {
        const availability = await api.LanguageDetector.availability();
        if (availability === 'unavailable' || availability === 'no') {
          return 'en';
        }
        this.detectorPromise = api.LanguageDetector.create({ signal }).catch(() => null);
      }
      const detector = await this.detectorPromise;
      if (!detector) return 'en';
      const results = await detector.detect(sampleText.slice(0, 600));
      const top = results[0];
      if (top && top.detectedLanguage && top.detectedLanguage !== 'und') {
        return toChromeLanguageCode(normalizeDetectedLanguage(top.detectedLanguage));
      }
    } catch {
      // Fallback to English source if detector is unavailable
    }
    return 'en';
  }

  private async getTranslator(
    sourceCode: string,
    targetCode: string,
    onDownloadProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<ChromeTranslatorInstance> {
    if (!isChromeBuiltinSupported()) {
      throw new TranslationError(
        'unavailable',
        'Chrome Built-in Translator API is not supported in this browser.',
        { provider: 'chrome-builtin' },
      );
    }

    const key = `${sourceCode}->${targetCode}`;
    let pending = this.instances.get(key);
    if (!pending) {
      const api = getApi().Translator!;
      const availability = await api.availability({
        sourceLanguage: sourceCode,
        targetLanguage: targetCode,
      });
      if (availability === 'unavailable' || availability === 'no') {
        throw new TranslationError(
          'unavailable',
          `Chrome Built-in Translator does not support ${sourceCode} -> ${targetCode}.`,
          { provider: 'chrome-builtin' },
        );
      }
      pending = api.create({
        sourceLanguage: sourceCode,
        targetLanguage: targetCode,
        signal,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            if (typeof e.loaded === 'number') {
              const pct =
                typeof e.total === 'number' && e.total > 0
                  ? Math.round((e.loaded / e.total) * 100)
                  : Math.round(e.loaded * 100);
              onDownloadProgress?.(Math.max(0, Math.min(100, pct)));
            }
          });
        },
      });
      this.instances.set(key, pending);
      pending.catch(() => this.instances.delete(key));
    }
    return pending;
  }

  async translateBatch(
    request: TranslateRequest,
    onDownloadProgress?: (percent: number) => void,
  ): Promise<TranslateResponse> {
    const { items, sourceLang, targetLang, signal } = request;
    if (items.length === 0) return { items: [] };

    const targetCode = toChromeLanguageCode(targetLang);
    let sourceCode =
      sourceLang && sourceLang !== 'auto'
        ? toChromeLanguageCode(sourceLang)
        : await this.detectLanguage(
            items
              .slice(0, 5)
              .map((i) => stripInlineMarkers(i.text))
              .join('\n'),
            signal,
          );

    if (sourceCode === targetCode) {
      return {
        items: items.map((item) => ({ id: item.id, text: stripInlineMarkers(item.text) })),
      };
    }

    const translator = await this.getTranslator(sourceCode, targetCode, onDownloadProgress, signal);
    const out: TranslatedItem[] = [];
    for (const item of items) {
      if (signal?.aborted) {
        throw new TranslationError('aborted', 'Request cancelled', { provider: 'chrome-builtin' });
      }
      const plain = stripInlineMarkers(item.text);
      try {
        const translated = (await translator.translate(plain)).trim();
        out.push({ id: item.id, text: translated || plain });
      } catch {
        out.push({ id: item.id, text: '', failed: true });
      }
    }
    return { items: out };
  }

  dispose(): void {
    for (const p of this.instances.values()) {
      void p.then((inst) => inst.destroy?.()).catch(() => {});
    }
    this.instances.clear();
  }
}
