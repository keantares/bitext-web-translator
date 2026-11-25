const LABEL_SELECTORS = [
  'button',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="option"]',
  'a[rel~="tag"]',
  ':is(nav,[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"],[role="tablist"]) :is(a[href],[role="link"],[aria-current="page"])',
  'a:is([href*="/category/"],[href*="/categories/"],[href*="/tag/"],[href*="/tags/"],[href*="/topics/"]):not(:is(p,blockquote,h1,h2,h3,h4,h5,h6) a)',
].join(',');

const BLOCK_SELECTORS = `p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,dd,dt,figcaption,div,${LABEL_SELECTORS}`;
export const CANDIDATE_SELECTORS = `${BLOCK_SELECTORS},a[href]`;
const PROSE_SELECTORS = 'p,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dd,dt';
const SKIPPED_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'pre',
  'kbd',
  'samp',
  'textarea',
  'input',
  'select',
  'svg',
  'math',
  '[contenteditable]:not([contenteditable="false"])',
  '[translate="no"]',
  '.notranslate',
  '[hidden]',
  '[aria-hidden="true"]',
  '.sr-only',
  '.visually-hidden',
  '[class~="material-icons"]',
  '[class*="material-icons-"]',
  '[class*="material-symbols-"]',
  '.bt-target',
  '.bt-retry',
  '[data-bt-ui]',
].join(',');

const EXCLUDED_SELECTORS = `code,${SKIPPED_SELECTORS}`;

export const HAN_REGEX = /\p{Script=Han}/u;
export const LETTER_REGEX = /\p{L}/u;

export function isCompactLink(el: Element): boolean {
  if (!el.matches('a[href]') || el.closest(PROSE_SELECTORS) || el.querySelector(`${PROSE_SELECTORS},article`)) {
    return false;
  }
  const display = getComputedStyle(el).display;
  if (['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display)) return true;
  const parent = el.parentElement;
  if (!parent?.querySelector(':scope > a[href] ~ a[href]')) return false;
  return [...parent.childNodes].every((node) =>
    node.nodeType === Node.TEXT_NODE
      ? !(node.textContent ?? '').trim()
      : node.nodeType !== Node.ELEMENT_NODE ||
        (node as Element).matches('a[href],font.bt-target[data-bt-target]'),
  );
}

export function isBlock(el: Element): boolean {
  return el.matches(BLOCK_SELECTORS) || isCompactLink(el);
}

export function findOwnerBlock(el: Element | null): Element | null {
  for (
    let hit = el?.closest(CANDIDATE_SELECTORS) ?? null;
    hit;
    hit = hit.parentElement?.closest(CANDIDATE_SELECTORS) ?? null
  ) {
    if (isBlock(hit)) return hit;
  }
  return null;
}

export function isLabelElement(el: Element): boolean {
  const link = el.closest('a[href]');
  return Boolean(el.closest(LABEL_SELECTORS)) || Boolean(link && isCompactLink(link));
}

export function collectTextNodes(
  block: Element,
  withBreaks = false,
  withCode = false,
): Node[] {
  if (block.closest(EXCLUDED_SELECTORS)) return [];
  const nodes: Node[] = [];
  const walker = document.createTreeWalker(
    block,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (withCode && node.parentElement?.closest('code')) return NodeFilter.FILTER_REJECT;
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        const el = node as Element;
        if (withCode && el.tagName === 'CODE' && !el.matches(SKIPPED_SELECTORS)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (el.matches(EXCLUDED_SELECTORS) || isBlock(el)) return NodeFilter.FILTER_REJECT;
        if (withBreaks && el.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node);
  }
  return nodes;
}

export type TextReader = (node: Text) => string;
export type TextRecorder = (value: string, node: Node | null) => void;

export function extractSourceText(
  block: Element,
  read: TextReader = (node) => node.data,
  record?: TextRecorder,
): string {
  const containers = new Map<Element, Element>([[block, block]]);
  function lineContainer(el: Element): Element {
    const cached = containers.get(el);
    if (cached) return cached;
    const startsLine = /^(block|list-item|flow-root|flex|grid|table)$/.test(
      getComputedStyle(el).display,
    );
    const resolved = startsLine || !el.parentElement ? el : lineContainer(el.parentElement);
    containers.set(el, resolved);
    return resolved;
  }

  let text = '';
  let previous: Element | undefined;
  const append = (value: string, node: Node | null) => {
    text += value;
    if (record) record(value, node);
  };

  for (const node of collectTextNodes(block, true, Boolean(record))) {
    if (node.nodeName === 'BR') {
      append('\n', null);
      continue;
    }
    const el = node.parentElement;
    if (!el) continue;
    let value = node.nodeName === 'CODE' ? (node.textContent ?? '') : read(node as Text);
    if (/[\r\n]/u.test(value)) {
      const ws = (getComputedStyle(el) as CSSStyleDeclaration & { whiteSpaceCollapse?: string })
        .whiteSpaceCollapse;
      const preserve = ['preserve', 'preserve-breaks', 'break-spaces'].includes(ws ?? '');
      value = value.replace(/\r\n?|\n/gu, preserve ? '\n' : ' ');
    }
    if (value.trim()) {
      const container = lineContainer(el);
      if (
        previous &&
        container !== previous &&
        !/\n[^\S\n]*$/u.test(text) &&
        !/^[^\S\n]*\n/u.test(value)
      ) {
        append('\n', null);
      }
      previous = container;
    }
    append(value, node);
  }

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .join('\n')
    .trim();
}

export function isEligibleText(text: string): boolean {
  return Array.from(text).length > 1 && LETTER_REGEX.test(text);
}

// Count other words, not letters: a Chinese post often names English products.
export function isPredominantlyChinese(text: string): boolean {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = text.match(/[^\P{L}\p{Script=Han}]+/gu)?.length ?? 0;
  return han > 0 && han >= words * 2;
}

function letterTextNodes(el: Element): Text[] {
  return collectTextNodes(el).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE && LETTER_REGEX.test((node as Text).data),
  );
}

const HANDLE_REGEX = /^@[\p{L}\p{N}_.-]+(?:@[\p{L}\p{N}_.-]+)?$/u;
const WEB_ADDRESS_REGEX = /^(?:https?:\/\/)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:\/\S*)?$/u;

// A social profile link shows a @handle, or shares its address with another link that does.
function isProfileLink(link: Element | null | undefined): boolean {
  const href = link?.getAttribute('href');
  if (!link || !href || href.startsWith('#')) return false;
  if (HANDLE_REGEX.test((link.textContent ?? '').trim())) return true;
  return [...document.querySelectorAll(`a[href="${CSS.escape(href)}"]`)].some((other) =>
    HANDLE_REGEX.test((other.textContent ?? '').trim()),
  );
}

// Account names, handles and bare web addresses are names, not prose.
// A post that mentions one is still translated.
export function isAccountText(el: Element, rowText: string): boolean {
  if (rowText.length > 60) return false;
  if (WEB_ADDRESS_REGEX.test(rowText)) return true;
  const lines = rowText.split('\n');
  if (lines.length === 2 && HANDLE_REGEX.test(lines[1]!)) return true;
  const nodes = letterTextNodes(el);
  if (nodes.length === 0) return false;
  if (nodes.every((node) => isProfileLink(node.parentElement?.closest('a[href]')))) return true;
  const text = nodes
    .map((node) => node.data.trim())
    .join(' ')
    .trim();
  // An account switcher button reads "Name @handle".
  if (isLabelElement(el) && /(?:^|\s)@\s?[\p{L}\p{N}_.-]+$/u.test(text)) return true;
  if (lines.length > 1) return false;
  // The same name elsewhere is a profile link, as in a profile page's top bar.
  for (const link of document.querySelectorAll('a[href]')) {
    if ((link.textContent ?? '').trim() === text && isProfileLink(link)) return true;
  }
  // A profile page shows the name in a small box with the page's own @handle, outside any post.
  const page = location.pathname.split('/')[1]?.toLowerCase();
  if (!page || isLabelElement(el) || el.closest('article') || text.length > 50) return false;
  const own = `@${page}`;
  for (let box = el.parentElement, depth = 0; box && depth < 3; box = box.parentElement, depth++) {
    if ((box.textContent ?? '').trim().length > text.length + own.length + 20) return false;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Text).data.trim().toLowerCase() === own) return true;
    }
  }
  return false;
}

const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'summary',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="treeitem"]',
].join(',');

const FUNCTIONAL_AREA_SELECTORS = [
  'nav',
  'footer',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="toolbar"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tablist"]',
  '[role="search"]',
].join(',');

function isShortText(text: string): boolean {
  const value = text.trim();
  const spaced =
    /\s/u.test(value) ||
    /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{P}\p{S}]+$/u.test(value);
  return spaced ? value.split(/\s+/u).length <= 3 : Array.from(value).length <= 8;
}

// Readers want what people wrote. Controls, navigation, sidebars and short links stay as written.
export function isFunctionalText(el: Element, rowText: string): boolean {
  if (isLabelElement(el) || el.closest(FUNCTIONAL_AREA_SELECTORS)) return true;
  const side = el.closest('aside,[role="complementary"]');
  if (side && !side.closest('article')) return true;
  if (rowText.includes('\n') || !isShortText(rowText)) return false;
  const nodes = letterTextNodes(el);
  return (
    nodes.length > 0 &&
    nodes.every((node) => {
      const hit = node.parentElement?.closest(INTERACTIVE_SELECTORS);
      // A quoted post is a clickable card inside a post. Its text is still a post.
      return Boolean(hit) && !(hit!.matches('[role="link"]') && hit!.closest('article'));
    })
  );
}

export function splitLongText(text: string, maxLength = 1450): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let chunk = '';
  for (const token of text.match(/[^\s。！？.!?]+[。！？.!?]*\s*|[\s\S]/gu) ?? []) {
    if (chunk && chunk.length + token.length > maxLength) {
      chunks.push(chunk);
      chunk = '';
    }
    for (const char of token) {
      if (chunk.length + char.length > maxLength) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += char;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
