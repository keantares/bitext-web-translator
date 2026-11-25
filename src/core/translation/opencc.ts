import { Converter } from 'opencc-js/cn2t';

type ConvertFn = (text: string) => string;

let cnToTwpConverter: ConvertFn | null = null;
let cnToTConverter: ConvertFn | null = null;

function getCnToTwp(): ConvertFn {
  if (!cnToTwpConverter) {
    cnToTwpConverter = Converter({ from: 'cn', to: 'twp' });
  }
  return cnToTwpConverter;
}

function getCnToT(): ConvertFn {
  if (!cnToTConverter) {
    cnToTConverter = Converter({ from: 'cn', to: 't' });
  }
  return cnToTConverter;
}

const HAN_RUN = /[\p{Script=Han}]+/gu;
const TAG_SPLIT = /(<\/?b\d+>)/gu;

export function hasSimplifiedChars(text: string): boolean {
  if (!HAN_RUN.test(text)) return false;
  HAN_RUN.lastIndex = 0;
  return getCnToT()(text) !== text;
}

export function convertSimplifiedToTaiwan(text: string, useTaiwanPhrases = true): string {
  if (!text) return text;
  const fn = useTaiwanPhrases ? getCnToTwp() : getCnToT();
  // Preserve inline <b0>...</b0> tags untouched during conversion
  if (text.includes('<b') || text.includes('</b')) {
    return text
      .split(TAG_SPLIT)
      .map((part) => (/^<\/?b\d+>$/u.test(part) ? part : fn(part)))
      .join('');
  }
  return fn(text);
}

/**
 * Normalizes LLM / MT output:
 * - strips accidental <think>...</think> reasoning blocks emitted by local reasoning models
 * - trims surrounding code fences if a model wrapped output in ```
 * - when target is zh-TW, converts residual Simplified Chinese characters/phrases cleanly
 */
export function cleanTranslationOutput(raw: string, targetLang: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
  const fenced = /^```(?:text|markdown|html)?\s*\n([\s\S]*?)\n```$/u.exec(text);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  if (targetLang === 'zh-TW') {
    text = convertSimplifiedToTaiwan(text, true);
  }
  return text;
}
