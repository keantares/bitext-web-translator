import type { ProviderId } from '../../storage/types';
import { cleanTranslationOutput } from '../opencc';
import {
  buildBatchPrompt,
  buildSinglePrompt,
  inlineTagsMatch,
  parseBatchResponse,
  stripInlineMarkers,
  type ChatPrompt,
} from '../prompts';
import {
  TranslationError,
  type TranslateRequest,
  type TranslateResponse,
  type TranslatedItem,
} from '../types';

export type ChatCompleteFn = (prompt: ChatPrompt, signal?: AbortSignal) => Promise<string>;

export function mapHttpError(
  status: number,
  bodyText: string,
  provider: ProviderId,
): TranslationError {
  if (status === 401) {
    return new TranslationError('auth_failed', `Authentication failed (${status}): ${bodyText.slice(0, 200)}`, {
      httpStatus: status,
      provider,
    });
  }
  if (status === 403) {
    if (provider === 'ollama' || provider === 'lmstudio') {
      return new TranslationError('cors_403', 'Local server rejected browser extension origin (HTTP 403)', {
        httpStatus: 403,
        provider,
      });
    }
    return new TranslationError('auth_failed', `Access forbidden (${status}): ${bodyText.slice(0, 200)}`, {
      httpStatus: status,
      provider,
    });
  }
  if (status === 429) {
    return new TranslationError('rate_limited', `Rate limited (${status}): ${bodyText.slice(0, 200)}`, {
      httpStatus: status,
      provider,
    });
  }
  return new TranslationError('http_error', `HTTP ${status}: ${bodyText.slice(0, 200)}`, {
    httpStatus: status,
    provider,
  });
}

export async function runLlmTranslationBatch(
  request: TranslateRequest,
  complete: ChatCompleteFn,
): Promise<TranslateResponse> {
  const { items, sourceLang, targetLang, format, context, signal } = request;
  if (items.length === 0) return { items: [] };

  const resolved = new Map<number, string>();

  // 1. Try batch translation first
  try {
    const prompt = buildBatchPrompt({ items, sourceLang, targetLang, format, context });
    const raw = await complete(prompt, signal);
    const parsed = parseBatchResponse(raw, items);
    if (parsed) {
      for (const item of items) {
        const candidate = parsed.get(item.id);
        if (!candidate) continue;
        const cleaned = cleanTranslationOutput(candidate, targetLang);
        if (!cleaned) continue;
        if (format === 'tags' && !inlineTagsMatch(item.text, cleaned)) {
          continue;
        }
        resolved.set(item.id, cleaned);
      }
    }
  } catch (err) {
    // Propagate abort / auth / rate-limit / CORS / network errors immediately
    if (err instanceof TranslationError) {
      if (['aborted', 'auth_failed', 'rate_limited', 'cors_403', 'missing_key', 'missing_model', 'missing_url', 'network'].includes(err.code)) {
        throw err;
      }
    }
    if (signal?.aborted) {
      throw new TranslationError('aborted', 'Request cancelled');
    }
  }

  // 2. Fallback per item for any missing or tag-corrupted items
  const output: TranslatedItem[] = [];
  for (const item of items) {
    if (signal?.aborted) {
      throw new TranslationError('aborted', 'Request cancelled');
    }
    const existing = resolved.get(item.id);
    if (existing !== undefined) {
      output.push({ id: item.id, text: existing });
      continue;
    }

    try {
      const singlePrompt = buildSinglePrompt({
        text: item.text,
        sourceLang,
        targetLang,
        format,
        context,
      });
      const rawSingle = await complete(singlePrompt, signal);
      let cleaned = cleanTranslationOutput(rawSingle, targetLang);

      // If tagged output still breaks tag structure, retry once in plain text
      if (format === 'tags' && (!cleaned || !inlineTagsMatch(item.text, cleaned))) {
        const plainPrompt = buildSinglePrompt({
          text: stripInlineMarkers(item.text),
          sourceLang,
          targetLang,
          format: 'text',
          context,
        });
        cleaned = cleanTranslationOutput(await complete(plainPrompt, signal), targetLang);
      }

      if (cleaned) {
        output.push({ id: item.id, text: cleaned });
      } else {
        output.push({ id: item.id, text: '', failed: true });
      }
    } catch (err) {
      if (err instanceof TranslationError && ['aborted', 'auth_failed', 'cors_403'].includes(err.code)) {
        throw err;
      }
      output.push({ id: item.id, text: '', failed: true });
    }
  }

  return { items: output };
}
