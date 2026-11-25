import { LETTER_REGEX, splitLongText } from '@/core/dom/paragraphs';
import { createTranslator } from '@/core/i18n';
import type { AccentColor, UserSettings } from '@/core/storage/types';
import { getLanguageLabel } from '@/core/translation/languages';
import { TranslationError } from '@/core/translation/types';
import { ContentTransport, formatErrorMessage } from './transport';

const KANA_REGEX = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const EXCLUDED_SELECTOR =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-bt-ui]';

const ACCENT_HEX: Record<AccentColor, [string, string, string, string]> = {
  teal: ['#0F6E66', '#55B8AA', '#FFFDF8', '#0D201E'],
  navy: ['#1D4E78', '#6EA8DC', '#FDFEFF', '#0B1926'],
  indigo: ['#2E4DA7', '#82A0F8', '#FDFEFF', '#0D1633'],
  petrol: ['#166075', '#61B6CC', '#FDFEFF', '#081F26'],
  brick: ['#A63D33', '#E58076', '#FFFDFB', '#290D0A'],
};

function detectSelectionSource(range: Range, text: string): string {
  const node = range.startContainer;
  // A selection may start inside a comment or the document itself, which has no closest().
  const first = asElement(node);
  if (!first) return 'auto';
  const language = first.closest('[lang]')?.getAttribute('lang') || 'auto';
  if (KANA_REGEX.test(text) || /^ja(?:-|$)/i.test(language)) return 'ja';
  if (
    !/\p{Script=Han}/u.test(text) ||
    /[\p{Script=Hangul}\p{Script=Latin}]/u.test(text) ||
    /^ko(?:-|$)/i.test(language) ||
    node.nodeType !== Node.TEXT_NODE
  ) {
    return language;
  }
  const block =
    first.closest('p,li,dd,dt,figcaption,blockquote,td,th,h1,h2,h3,h4,h5,h6,div') ?? first;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  let before = (node as Text).data.slice(Math.max(0, range.startOffset - 80), range.startOffset);
  while (before.length < 80 && walker.previousNode()) {
    before = (walker.currentNode as Text).data.slice(-80) + before;
  }
  if (KANA_REGEX.test(before.slice(-80))) return 'ja';

  if (range.endContainer.nodeType === Node.TEXT_NODE && block.contains(range.endContainer)) {
    walker.currentNode = range.endContainer;
    let after = (walker.currentNode as Text).data.slice(range.endOffset, range.endOffset + 80);
    while (after.length < 80 && walker.nextNode()) {
      after += (walker.currentNode as Text).data.slice(0, 80);
    }
    if (KANA_REGEX.test(after.slice(0, 80))) return 'ja';
  }
  return language;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(
  shapes: Array<{ tag: 'circle' | 'ellipse' | 'path' | 'rect'; attrs: Record<string, string> }>,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of shapes) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.attrs)) {
      el.setAttribute(k, v);
    }
    svg.append(el);
  }
  return svg;
}

function asElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export class SelectionTranslator {
  private settings: UserSettings;
  private readonly canTrigger: () => boolean;
  private triggerHost: HTMLElement | null = null;
  private popoverHost: HTMLElement | null = null;
  private popoverAnchor: Range | null = null;
  private activeAbort: AbortController | null = null;
  private activeTransport: ContentTransport | null = null;
  private pointerPressed = false;
  private readonly controller = new AbortController();

  constructor(settings: UserSettings, canTrigger: () => boolean) {
    this.settings = settings;
    this.canTrigger = canTrigger;
    this.attachEvents();
  }

  updateSettings(next: UserSettings): void {
    this.settings = next;
    if (!next.reading.selectionEnabled) {
      this.dismiss();
    }
  }

  dismiss(): void {
    this.pointerPressed = false;
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.activeTransport?.disconnect();
    this.activeTransport = null;
    this.triggerHost?.remove();
    this.triggerHost = null;
    this.popoverHost?.remove();
    this.popoverHost = null;
    this.popoverAnchor = null;
  }

  destroy(): void {
    this.dismiss();
    this.controller.abort();
  }

  private getThemeCss() {
    const { accentColor, paperTone, themeMode } = this.settings.appearance;
    const [accL, accD, onAccL, onAccD] = ACCENT_HEX[accentColor];
    const bgL = paperTone === 'cool' ? '#FDFEFF' : '#FFFDF8';
    const bgD = paperTone === 'cool' ? '#181D26' : '#1F1C18';
    const bdL = paperTone === 'cool' ? '#D9E1EC' : '#E4D9C3';
    const bdD = paperTone === 'cool' ? '#303A4A' : '#3B352B';
    const txL = paperTone === 'cool' ? '#1A212C' : '#24211C';
    const txD = paperTone === 'cool' ? '#E8EDF5' : '#EEE6D8';
    const muL = paperTone === 'cool' ? '#5C687A' : '#6B6355';
    const muD = paperTone === 'cool' ? '#9CA8BC' : '#ADA493';
    const scheme = themeMode === 'system' ? 'light dark' : themeMode;
    return { accL, accD, onAccL, onAccD, bgL, bgD, bdL, bdD, txL, txD, muL, muD, scheme };
  }

  private computeAnchor(selection: Selection): Range | null {
    if (!selection.focusNode || !selection.rangeCount) return null;
    const anchor = document.createRange();
    anchor.setStart(selection.focusNode, selection.focusOffset);
    anchor.collapse(true);
    const rect = anchor.getBoundingClientRect();
    if (!rect.height && !rect.width) {
      const range = selection.getRangeAt(0);
      const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      let node: Node | null =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer
          : walker.nextNode();
      let end: Text | null = null;
      while (node) {
        if (range.intersectsNode(node) && (node as Text).length) {
          end = node as Text;
        }
        node = walker.nextNode();
      }
      if (!end) return null;
      anchor.selectNodeContents(end);
      anchor.collapse(false);
    }
    return anchor;
  }

  private placeHost(host: HTMLElement, anchor: Range | null): boolean {
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;

    let rect: DOMRect;
    if (anchor) {
      if (!anchor.startContainer.isConnected) return false;
      rect = anchor.getBoundingClientRect();
      if (
        (!rect.height && !rect.width) ||
        rect.top >= height ||
        rect.bottom <= 0 ||
        rect.right < 0 ||
        rect.left > width
      ) {
        return false;
      }
    } else {
      rect = new DOMRect(width / 2 - 180, 96, 360, 0);
    }

    const hostWidth = host.offsetWidth || 320;
    const hostHeight = host.offsetHeight || 96;
    const x = Math.max(8, Math.min(rect.right - 24, width - hostWidth - 8));
    const below = rect.bottom + 8;
    const above = rect.top - hostHeight - 8;
    const y = below + hostHeight <= height - 8 ? below : Math.max(8, above);

    host.style.setProperty('--bt-x', `${Math.round(x)}px`, 'important');
    host.style.setProperty('--bt-y', `${Math.round(y)}px`, 'important');
    return true;
  }

  private reposition = () => {
    if (this.popoverHost && !this.placeHost(this.popoverHost, this.popoverAnchor)) {
      this.dismiss();
    }
    if (this.triggerHost && this.popoverAnchor && !this.placeHost(this.triggerHost, this.popoverAnchor)) {
      this.dismiss();
    }
  };

  private showTriggerIcon(anchor: Range, text: string, detectedSource: string): void {
    this.dismiss();
    const { accL, accD, onAccL, onAccD, scheme } = this.getThemeCss();
    const { t } = createTranslator(this.settings.appearance.uiLocale);

    const host = document.createElement('div');
    host.dataset.btUi = 'selection-trigger';
    host.setAttribute('translate', 'no');
    host.setAttribute('popover', 'manual');

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        inset: var(--bt-y, 0px) auto auto var(--bt-x, 0px) !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        color-scheme: ${scheme} !important;
        z-index: 2147483646 !important;
      }
      button {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 50%;
        background: light-dark(${accL}, ${accD});
        color: light-dark(${onAccL}, ${onAccD});
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
        cursor: pointer;
        padding: 0;
        transition: transform 0.12s ease;
      }
      button:hover { transform: scale(1.07); }
      svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', t('selectionTranslate'));
    btn.title = t('selectionTranslate');
    btn.append(
      createSvgIcon([
        { tag: 'circle', attrs: { cx: '10', cy: '10', r: '7.2' } },
        { tag: 'ellipse', attrs: { cx: '10', cy: '10', rx: '3.1', ry: '7.2' } },
        { tag: 'path', attrs: { d: 'M3 10h14' } },
      ]),
    );
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPopover(anchor, text, detectedSource);
    });

    root.append(style, btn);
    document.documentElement.append(host);
    try {
      host.showPopover();
    } catch {
      // Fallback for environments without Popover API
    }
    this.triggerHost = host;
    this.popoverAnchor = anchor;
    this.placeHost(host, anchor);
  }

  public translateExplicitSelection(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !LETTER_REGEX.test(trimmed)) return;
    const sel = window.getSelection();
    const anchor = sel && sel.rangeCount > 0 ? this.computeAnchor(sel) : null;
    const detected =
      sel && sel.rangeCount > 0 ? detectSelectionSource(sel.getRangeAt(0), trimmed) : 'auto';
    this.openPopover(anchor, trimmed, detected);
  }

  private openPopover(anchor: Range | null, text: string, detectedSource: string): void {
    this.dismiss();
    const { locale, t } = createTranslator(this.settings.appearance.uiLocale);
    const { accL, accD, bgL, bgD, bdL, bdD, txL, txD, muL, muD, scheme } = this.getThemeCss();
    const sourceLang =
      this.settings.reading.sourceLang !== 'auto'
        ? this.settings.reading.sourceLang
        : detectedSource || 'auto';
    const targetLang = this.settings.reading.targetLang;

    const host = document.createElement('div');
    host.dataset.btUi = 'selection-popover';
    host.setAttribute('translate', 'no');
    host.setAttribute('popover', 'manual');
    host.lang = targetLang;

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        display: block !important;
        position: fixed !important;
        inset: var(--bt-y, 0px) auto auto var(--bt-x, 0px) !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        color-scheme: ${scheme} !important;
        z-index: 2147483647 !important;
        font-family: "Segoe UI Variable Text","Segoe UI",-apple-system,"PingFang TC","Microsoft JhengHei UI",system-ui,sans-serif !important;
      }
      .card {
        box-sizing: border-box;
        width: max-content;
        min-width: 240px;
        max-width: min(460px, calc(100vw - 16px));
        max-height: 46vh;
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        border: 1px solid light-dark(${bdL}, ${bdD});
        background: light-dark(${bgL}, ${bgD});
        color: light-dark(${txL}, ${txD});
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 12px 6px;
        border-bottom: 1px solid light-dark(${bdL}, ${bdD});
        color: light-dark(${muL}, ${muD});
        font-size: 11px;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font: 500 11px/1 inherit;
        padding: 4px 6px;
        cursor: pointer;
      }
      .icon-btn:hover {
        background: color-mix(in oklab, light-dark(${accL}, ${accD}) 12%, transparent);
        color: light-dark(${txL}, ${txD});
      }
      .icon-btn svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .body {
        padding: 10px 13px 12px;
        overflow: auto;
        overscroll-behavior: contain;
        font-size: 14px;
        line-height: 1.62;
        white-space: pre-line;
        overflow-wrap: anywhere;
        user-select: text;
      }
      .muted { color: light-dark(${muL}, ${muD}); }
      .error-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        color: light-dark(#B42318, #F97066);
      }
      .settings-btn {
        align-self: flex-start;
        border: 0;
        border-radius: 999px;
        padding: 5px 12px;
        background: light-dark(${accL}, ${accD});
        color: light-dark(#FFFDF8, #0D1E1C);
        font: 600 12px/1.2 inherit;
        cursor: pointer;
      }
    `;

    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'head';

    const langLabel = document.createElement('span');
    langLabel.textContent = `${getLanguageLabel(sourceLang, locale)} → ${getLanguageLabel(targetLang, locale)}`;

    const actions = document.createElement('span');
    actions.className = 'actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'icon-btn';
    copyBtn.setAttribute('aria-label', t('copy'));
    copyBtn.hidden = true;
    const copyTextSpan = document.createElement('span');
    copyTextSpan.textContent = t('copy');
    copyBtn.append(
      createSvgIcon([
        { tag: 'rect', attrs: { x: '7', y: '7', width: '9', height: '9', rx: '2' } },
        { tag: 'path', attrs: { d: 'M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7' } },
      ]),
      copyTextSpan,
    );

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon-btn';
    closeBtn.setAttribute('aria-label', t('close'));
    closeBtn.append(createSvgIcon([{ tag: 'path', attrs: { d: 'M5 5l10 10M15 5L5 15' } }]));
    closeBtn.addEventListener('click', () => this.dismiss());

    actions.append(copyBtn, closeBtn);
    head.append(langLabel, actions);

    const body = document.createElement('div');
    body.className = 'body muted';
    body.setAttribute('role', 'status');
    body.textContent = t('translating');

    card.append(head, body);
    root.append(style, card);
    document.documentElement.append(host);
    try {
      host.showPopover();
    } catch {
      // Fallback for environments without Popover API
    }

    this.popoverHost = host;
    this.popoverAnchor = anchor;
    this.placeHost(host, anchor);

    const abort = new AbortController();
    const transport = new ContentTransport();
    this.activeAbort = abort;
    this.activeTransport = transport;

    let finalTranslation = '';
    copyBtn.addEventListener('click', async () => {
      if (!finalTranslation) return;
      try {
        await navigator.clipboard.writeText(finalTranslation);
        copyTextSpan.textContent = t('copied');
        window.setTimeout(() => {
          copyTextSpan.textContent = t('copy');
        }, 1600);
      } catch {
        // Ignore clipboard errors in restricted frames
      }
    });

    void (async () => {
      try {
        // Keep paragraph separators locally so adjacent paragraphs are never merged
        const parts = text.split(/(\n+)/u).flatMap((seg) => splitLongText(seg));
        const items = parts.flatMap((part, id) => (LETTER_REGEX.test(part) ? [{ id, text: part }] : []));
        let offset = 0;
        while (offset < items.length) {
          if (abort.signal.aborted) return;
          const batch: Array<{ id: number; text: string }> = [];
          let len = 0;
          while (
            offset < items.length &&
            batch.length < 25 &&
            (!len || len + (items[offset]?.text.length ?? 0) <= 1450)
          ) {
            const item = items[offset++]!;
            len += item.text.length;
            batch.push(item);
          }
          const translated = await transport.translateItems({
            settings: this.settings,
            items: batch,
            sourceLang,
            targetLang,
            format: 'text',
            priority: 1,
            signal: abort.signal,
            onBuiltinDownload: (pct) => {
              if (!abort.signal.aborted) {
                body.textContent = `${t('translating')} (${pct}%)`;
              }
            },
          });
          if (abort.signal.aborted) return;
          const byId = new Map(translated.map((x) => [x.id, x]));
          for (const item of batch) {
            const ans = byId.get(item.id);
            if (!ans || ans.failed || !ans.text) {
              throw new TranslationError('invalid_response', 'Empty translation');
            }
            parts[item.id] = ans.text;
          }
        }
        if (abort.signal.aborted) return;
        finalTranslation = parts.join('');
        body.className = 'body';
        body.textContent = finalTranslation;
        copyBtn.hidden = false;
        this.placeHost(host, anchor);
      } catch (err) {
        if (abort.signal.aborted) return;
        const code = err instanceof TranslationError ? err.code : 'unknown';
        const message = formatErrorMessage(code, locale, err instanceof Error ? err.message : undefined);
        body.className = 'body error-row';
        body.textContent = '';
        const span = document.createElement('span');
        span.textContent = message;
        body.append(span);
        if (['missing_key', 'missing_model', 'missing_url', 'auth_failed', 'cors_403', 'unavailable'].includes(code)) {
          const openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'settings-btn';
          openBtn.textContent = t('settings');
          openBtn.addEventListener('click', () => {
            void transport.openOptions('providers');
            this.dismiss();
          });
          body.append(openBtn);
        }
        this.placeHost(host, anchor);
      } finally {
        transport.disconnect();
        if (this.activeTransport === transport) this.activeTransport = null;
      }
    })();
  }

  private attachEvents(): void {
    const opts = { capture: true, signal: this.controller.signal };

    document.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (this.popoverHost?.contains(event.target as Node) || this.triggerHost?.contains(event.target as Node)) {
          return;
        }
        this.dismiss();
        if (!this.settings.reading.selectionEnabled || !this.canTrigger()) return;
        this.pointerPressed =
          event.isPrimary &&
          event.pointerType === 'mouse' &&
          event.button === 0 &&
          !asElement(event.target as Node)?.closest(EXCLUDED_SELECTOR);
      },
      opts,
    );

    document.addEventListener(
      'pointercancel',
      () => {
        this.pointerPressed = false;
      },
      opts,
    );

    document.addEventListener(
      'pointerup',
      (event: PointerEvent) => {
        if (!this.pointerPressed || event.button !== 0 || event.pointerType !== 'mouse') return;
        this.pointerPressed = false;
        if (!this.settings.reading.selectionEnabled || !this.canTrigger()) return;
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) return;
        const first = asElement(selection.anchorNode);
        const last = asElement(selection.focusNode);
        if (!first || !last || first.closest(EXCLUDED_SELECTOR) || last.closest(EXCLUDED_SELECTOR)) {
          return;
        }
        const text = selection.toString().trim();
        if (!LETTER_REGEX.test(text)) return;
        const anchor = this.computeAnchor(selection);
        if (!anchor) return;
        const detected = detectSelectionSource(selection.getRangeAt(0), text);
        if (this.settings.reading.selectionTrigger === 'icon') {
          this.showTriggerIcon(anchor, text, detected);
        } else {
          this.openPopover(anchor, text, detected);
        }
      },
      opts,
    );

    document.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key === 'Escape') this.dismiss();
      },
      opts,
    );

    document.addEventListener('scroll', this.reposition, {
      capture: true,
      passive: true,
      signal: this.controller.signal,
    });
    window.addEventListener('resize', this.reposition, { signal: this.controller.signal });
  }
}
