import type { TranslateFormat } from '../translation/types';
import { extractSourceText, type TextReader } from './paragraphs';

const INLINE_SELECTOR = 'a[href],strong,b,code';
const MARKER_REGEX = /<\/?b\d+>/gu;

const escapeMarkup = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const unescapeMarkup = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&amp;', '&');

export type InlineSpec =
  | { tag: 'code'; literal: string }
  | { tag: 'strong' | 'b' }
  | {
      tag: 'a';
      href: string;
      target: string;
      referrerPolicy: string;
      rel: string;
    };

export interface InlinePiece {
  text: string;
  format: TranslateFormat;
}

export interface InlineLayout {
  plain: string;
  specs: InlineSpec[];
  pieces: InlinePiece[];
  key: string;
}

function describeElement(el: Element): InlineSpec | null {
  if (el.tagName === 'CODE') {
    return { tag: 'code', literal: el.textContent ?? '' };
  }
  if (el.tagName !== 'A') {
    const local = el.localName;
    if (local === 'strong' || local === 'b') {
      return { tag: local };
    }
    return null;
  }
  const anchor = el as HTMLAnchorElement;
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(anchor.protocol)) return null;
  const baseTarget = anchor.ownerDocument.querySelector<HTMLBaseElement>('base[target]')?.target ?? '';
  return {
    tag: 'a',
    href: anchor.href,
    target: anchor.target || baseTarget,
    referrerPolicy: anchor.referrerPolicy,
    rel: anchor.relList.contains('noreferrer') ? 'noreferrer noopener' : 'noopener',
  };
}

export function captureInlineLayout(block: Element, read: TextReader): InlineLayout | null {
  if (!block.querySelector(INLINE_SELECTOR)) return null;
  const specs: InlineSpec[] = [];
  const ids = new Map<Element, number | null>();
  const pieces: InlinePiece[] = [];
  let active: number[] = [];
  let buffer = '';
  let space = false;

  const closing = (tagIds: number[]) =>
    tagIds
      .slice()
      .reverse()
      .map((id) => `</b${id}>`)
      .join('');

  function pathFor(node: Node | null): number[] {
    const path: number[] = [];
    for (
      let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
      el && el !== block;
      el = el.parentElement
    ) {
      if (!el.matches(INLINE_SELECTOR)) continue;
      if (!ids.has(el)) {
        const spec = describeElement(el);
        ids.set(el, spec ? specs.push(spec) - 1 : null);
      }
      const id = ids.get(el);
      if (id !== null && id !== undefined) path.unshift(id);
    }
    return path;
  }

  function flush() {
    if (buffer) {
      pieces.push({ text: buffer + closing(active), format: 'tags' });
    }
    active = [];
    buffer = '';
  }

  function appendWord(value: string, path: number[]) {
    let shared = 0;
    while (shared < active.length && shared < path.length && active[shared] === path[shared]) {
      shared++;
    }
    let close = closing(active.slice(shared));
    let open = path
      .slice(shared)
      .map((id) => `<b${id}>`)
      .join('');
    const gap =
      space && (buffer || (pieces.length > 0 && pieces.at(-1)?.text !== '\n')) ? ' ' : '';
    if (
      buffer &&
      buffer.length + close.length + open.length + value.length + gap.length + closing(path).length >
        1450
    ) {
      flush();
      close = '';
      open = path.map((id) => `<b${id}>`).join('');
    }
    buffer += close + gap + open + value;
    active = path;
    space = false;
  }

  const plain = extractSourceText(block, read, (value, node) => {
    const path = pathFor(node);
    if (node?.nodeName === 'CODE') {
      appendWord(escapeMarkup(value.replace(/\s+/gu, ' ').slice(0, 140) || '…'), path);
      return;
    }
    for (const token of value.match(/\n|[^\S\n]+|[^\s]+/gu) ?? []) {
      if (token === '\n') {
        flush();
        space = false;
        if (pieces.length > 0) pieces.push({ text: '\n', format: 'text' });
      } else if (!token.trim()) {
        space = true;
      } else {
        let part = '';
        for (const char of token) {
          const next = escapeMarkup(char);
          if (part.length + next.length > 1300) {
            appendWord(part, path);
            part = '';
          }
          part += next;
        }
        if (part) appendWord(part, path);
      }
    }
  });

  flush();
  while (pieces.at(-1)?.text === '\n') pieces.pop();
  if (specs.length === 0 || pieces.length === 0) return null;
  return { plain, specs, pieces, key: JSON.stringify([specs, pieces]) };
}

function structureKey(tokens: string[]): string | null {
  const parents: string[] = [];
  const edges: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('</')) {
      if (parents.pop() !== token.slice(3, -1)) return null;
    } else {
      const id = token.slice(2, -1);
      edges.push(`${parents.at(-1) ?? ''}:${id}`);
      parents.push(id);
    }
  }
  return parents.length === 0 ? edges.sort().join(',') : null;
}

export function renderInlineFragment(layout: InlineLayout, replies: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  layout.pieces.forEach((piece, index) => {
    const reply = replies[index] ?? '';
    const expected = piece.text.match(MARKER_REGEX) ?? [];
    const actual = reply.match(MARKER_REGEX) ?? [];
    if (
      expected.length === 0 ||
      actual.length !== expected.length ||
      structureKey(actual) !== structureKey(expected)
    ) {
      fragment.append(unescapeMarkup(reply.replace(MARKER_REGEX, '')));
      return;
    }

    // Only original descriptors can create DOM elements; model text is strictly text nodes.
    const stack: Array<DocumentFragment | HTMLElement> = [fragment];
    for (const token of reply.split(/(<\/?b\d+>)/u)) {
      if (/^<\/b\d+>$/u.test(token)) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const match = /^<b(\d+)>$/u.exec(token);
      if (!match) {
        const top = stack.at(-1);
        if (top && top.nodeName !== 'CODE') {
          top.append(unescapeMarkup(token));
        }
        continue;
      }
      const spec = layout.specs[Number(match[1])];
      if (!spec) continue;
      const el = document.createElement(spec.tag);
      if (spec.tag === 'code') {
        el.textContent = spec.literal;
      } else if (spec.tag === 'a') {
        const anchor = el as HTMLAnchorElement;
        anchor.href = spec.href;
        if (spec.target) anchor.target = spec.target;
        if (spec.referrerPolicy) anchor.referrerPolicy = spec.referrerPolicy;
        anchor.rel = spec.rel;
      }
      stack.at(-1)?.append(el);
      stack.push(el);
    }
  });
  return fragment;
}
