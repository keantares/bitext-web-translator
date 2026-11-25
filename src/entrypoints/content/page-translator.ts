import {
  captureInlineLayout,
  renderInlineFragment,
  type InlineLayout,
} from '@/core/dom/inline';
import {
  CANDIDATE_SELECTORS,
  extractSourceText,
  findOwnerBlock,
  isAccountText,
  isBlock,
  isEligibleText,
  isFunctionalText,
  isPredominantlyChinese,
  splitLongText,
} from '@/core/dom/paragraphs';
import { createTranslator } from '@/core/i18n';
import type { PageState } from '@/core/messaging/protocol';
import type { DisplayMode, UserSettings } from '@/core/storage/types';
import { TranslationError, type TranslateItem } from '@/core/translation/types';
import { showToast } from './toast';
import { ContentTransport, formatErrorMessage } from './transport';

interface RowState {
  el: Element;
  text: string;
  lang: string;
  inline: InlineLayout | null;
  visible: boolean;
  near: boolean;
  status: 'waiting' | 'running' | 'done' | 'failed';
  output: HTMLElement | null;
  retryBtn: HTMLButtonElement | null;
  hiddenElements?: Set<Element>;
  hiddenTexts?: Map<Text, string>;
}

export function isPageSupported(): boolean {
  return (
    ['text/html', 'application/xhtml+xml'].includes(document.contentType) &&
    !document.querySelector('embed[type="application/pdf"]:only-child')
  );
}

export function applyPageAppearance(settings: UserSettings): void {
  const root = document.documentElement;
  root.dataset.btAccent = settings.appearance.accentColor;
  root.dataset.btStyle = settings.appearance.translationStyle;
  root.dataset.btDisplay = settings.appearance.displayMode;
}

export class PageTranslator {
  private settings: UserSettings;
  private readonly supported = isPageSupported();
  private activeSession: {
    stop: () => void;
    setDisplayMode: (mode: DisplayMode) => void;
    getProgress: () => { done: number; total: number; failed: number };
  } | null = null;
  private displayMode: DisplayMode;
  private onBeforeStart?: () => void;

  constructor(settings: UserSettings, onBeforeStart?: () => void) {
    this.settings = settings;
    this.displayMode = settings.appearance.displayMode;
    this.onBeforeStart = onBeforeStart;
    applyPageAppearance(settings);
  }

  get isActive(): boolean {
    return this.activeSession !== null;
  }

  getState(): PageState {
    const progress = this.activeSession?.getProgress() ?? { done: 0, total: 0, failed: 0 };
    return {
      supported: this.supported,
      active: this.activeSession !== null,
      hostname: location.hostname,
      done: progress.done,
      total: progress.total,
      failed: progress.failed,
      displayMode: this.displayMode,
    };
  }

  updateSettings(next: UserSettings): void {
    const prev = this.settings;
    this.settings = next;
    this.displayMode = next.appearance.displayMode;
    applyPageAppearance(next);

    if (this.activeSession) {
      this.activeSession.setDisplayMode(next.appearance.displayMode);
      const languageOrProviderChanged =
        prev.reading.sourceLang !== next.reading.sourceLang ||
        prev.reading.targetLang !== next.reading.targetLang ||
        prev.activeProvider !== next.activeProvider;
      if (languageOrProviderChanged) {
        this.stop();
        this.start();
      }
    }
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    document.documentElement.dataset.btDisplay = mode;
    this.activeSession?.setDisplayMode(mode);
  }

  toggle(): boolean {
    if (this.activeSession) {
      this.stop();
      return false;
    }
    this.start();
    return this.activeSession !== null;
  }

  stop(): void {
    this.activeSession?.stop();
    this.activeSession = null;
  }

  start(): void {
    if (this.activeSession || !this.supported || !document.body) return;
    this.onBeforeStart?.();

    const settings = this.settings;
    const { locale, t } = createTranslator(settings.appearance.uiLocale);
    const transport = new ContentTransport();
    const abort = new AbortController();

    const rows = new Map<Element, RowState>();
    const dirty = new Set<Element>();
    const renderQueue: Array<() => void> = [];

    let rafId: number | null = null;
    let drainTimer: number | null = null;
    let scanTimer: number | null = null;
    let running = 0;
    let generation = 0;
    let stopped = false;
    let started = false;
    let fatalShown = false;
    let currentDisplayMode: DisplayMode = this.displayMode;

    const maxParallelBatches =
      settings.activeProvider === 'ollama' ||
      settings.activeProvider === 'lmstudio' ||
      settings.activeProvider === 'chrome-builtin'
        ? 1
        : 3;

    const flushRenderQueue = () => {
      rafId = null;
      if (stopped) {
        renderQueue.length = 0;
        return;
      }
      const batch = renderQueue.splice(0, 24);
      for (const fn of batch) {
        if (stopped) break;
        fn();
      }
      if (renderQueue.length > 0 && !stopped) {
        rafId = requestAnimationFrame(flushRenderQueue);
      }
    };

    const scheduleRender = (fn: () => void) => {
      renderQueue.push(fn);
      if (rafId === null) {
        rafId = requestAnimationFrame(flushRenderQueue);
      }
    };

    const updateBadge = () => {
      if (stopped) return;
      let done = 0;
      let total = 0;
      for (const row of rows.values()) {
        if (row.visible || row.near || row.status !== 'waiting') {
          total++;
          if (row.status === 'done') done++;
        }
      }
      if (running > 0) {
        void transport.updateBadge('…');
      } else if (done > 0 && done >= total) {
        void transport.updateBadge('✓');
      }
    };

    const scheduleDrain = () => {
      if (!stopped && started && drainTimer === null) {
        drainTimer = window.setTimeout(() => {
          drainTimer = null;
          drain();
        }, 0);
      }
    };

    const observeEntries = (entries: IntersectionObserverEntry[], field: 'visible' | 'near') => {
      for (const entry of entries) {
        const row = rows.get(entry.target);
        if (row) {
          row[field] = entry.isIntersecting && entry.intersectionRect.height > 0;
        }
      }
      scheduleDrain();
    };

    const visibleObserver = new IntersectionObserver((entries) => observeEntries(entries, 'visible'));
    let nearObserver: IntersectionObserver | null = null;

    const fitOutput = (el: Element, output: HTMLElement) => {
      const style = getComputedStyle(el);
      let layout: string | undefined;
      if (style.display.includes('flex') && style.flexDirection.startsWith('row')) layout = 'flex';
      else if (style.display.includes('grid')) layout = 'grid';
      if (layout === output.dataset.btLayout) return;
      if (layout) output.dataset.btLayout = layout;
      else delete output.dataset.btLayout;
    };

    const rebuildNearObserver = () => {
      nearObserver?.disconnect();
      nearObserver = new IntersectionObserver((entries) => observeEntries(entries, 'near'), {
        rootMargin: `0px 0px ${Math.round(window.innerHeight * 1.5)}px 0px`,
      });
      for (const [el, row] of rows) {
        nearObserver.observe(el);
        if (row.output) fitOutput(el, row.output);
      }
    };
    rebuildNearObserver();
    window.addEventListener('resize', rebuildNearObserver);

    const readOriginal = (node: Text): string => {
      // Text nodes emptied by translation-only mode still hold their original text.
      for (const row of rows.values()) {
        const saved = row.hiddenTexts?.get(node);
        if (saved !== undefined && node.data === '') return saved;
      }
      return node.data;
    };

    const showOriginalInsideRow = (row: RowState) => {
      if (row.hiddenElements) {
        for (const child of row.hiddenElements) {
          child.removeAttribute('data-bt-hidden-original');
        }
        row.hiddenElements.clear();
      }
      if (row.hiddenTexts) {
        for (const [textNode, originalValue] of row.hiddenTexts) {
          if (textNode.isConnected && textNode.data === '') {
            textNode.data = originalValue;
          }
        }
        row.hiddenTexts.clear();
      }
    };

    const hideOriginalInsideRow = (row: RowState) => {
      if (!row.output) return;
      const hiddenElements = (row.hiddenElements ??= new Set());
      const hiddenTexts = (row.hiddenTexts ??= new Map());
      for (const child of [...row.el.childNodes]) {
        if (child === row.output || child === row.retryBtn) continue;
        if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as Element;
          if (!el.matches('.bt-target, .bt-retry')) {
            el.setAttribute('data-bt-hidden-original', 'true');
            hiddenElements.add(el);
          }
        } else if (child.nodeType === Node.TEXT_NODE) {
          const textNode = child as Text;
          if (textNode.data.trim() && !hiddenTexts.has(textNode)) {
            hiddenTexts.set(textNode, textNode.data);
            textNode.data = '';
          }
        }
      }
    };

    const syncRowDisplayMode = (row: RowState) => {
      if (!row.output) return;
      if (currentDisplayMode === 'translation-only') {
        hideOriginalInsideRow(row);
      } else {
        showOriginalInsideRow(row);
      }
    };

    const forgetRow = (el: Element, row: RowState) => {
      visibleObserver.unobserve(el);
      nearObserver?.unobserve(el);
      rows.delete(el);
      showOriginalInsideRow(row);
      row.output?.remove();
      row.retryBtn?.remove();
    };

    // The reader reads both Chinese scripts. With a Chinese target, leave Chinese paragraphs as they are.
    // A site's own language tag is unreliable for kanji-only text, so judge the text itself.
    // A source language chosen by the reader still decides.
    const { sourceLang, targetLang } = settings.reading;
    const isReadableAsIs = (text: string) =>
      targetLang.startsWith('zh') &&
      (sourceLang === 'auto' || sourceLang.startsWith('zh')) &&
      isPredominantlyChinese(text);

    const scan = (root: Element) => {
      const candidates = new Set<Element>(root.querySelectorAll(CANDIDATE_SELECTORS));
      const parent = findOwnerBlock(root);
      if (parent) candidates.add(parent);
      if (rows.has(root)) candidates.add(root);

      const useInlineTags = settings.activeProvider !== 'chrome-builtin';

      for (const el of candidates) {
        const old = rows.get(el);
        const text = isBlock(el) ? extractSourceText(el, readOriginal) : '';
        const lang =
          sourceLang === 'auto' ? el.closest('[lang]')?.getAttribute('lang') || 'auto' : sourceLang;
        if (
          !isEligibleText(text) ||
          isReadableAsIs(text) ||
          isFunctionalText(el, text) ||
          isAccountText(el, text)
        ) {
          if (old) forgetRow(el, old);
          continue;
        }
        const inline = useInlineTags ? captureInlineLayout(el, readOriginal) : null;
        if (
          old &&
          old.text === text &&
          old.lang === lang &&
          old.inline?.key === inline?.key &&
          (!old.output || old.output.parentNode === el)
        ) {
          if (old.output) fitOutput(el, old.output);
          continue;
        }
        if (old) forgetRow(el, old);
        const row: RowState = {
          el,
          text,
          lang,
          inline,
          visible: false,
          near: false,
          status: 'waiting',
          output: null,
          retryBtn: null,
        };
        rows.set(el, row);
        visibleObserver.observe(el);
        nearObserver?.observe(el);
      }
    };

    const reconcile = () => {
      scanTimer = null;
      if (stopped) return;
      for (const [el, row] of rows) {
        if (!el.isConnected) forgetRow(el, row);
      }
      for (const root of dirty) {
        if (root.isConnected) scan(root);
      }
      dirty.clear();
      scheduleDrain();
    };

    const mutationObserver = new MutationObserver((records) => {
      for (const rec of records) {
        // Comment data changes are reported too. They never contain readable text.
        const node = rec.target;
        const parent =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as Element)
            : node.nodeType === Node.TEXT_NODE
              ? node.parentElement
              : null;
        if (!parent || parent.closest('.bt-target, .bt-retry, [data-bt-ui]')) continue;
        if (rec.type === 'childList') {
          const changes = [...rec.addedNodes, ...rec.removedNodes];
          if (
            changes.length > 0 &&
            changes.every(
              (n) =>
                n.nodeType === Node.ELEMENT_NODE &&
                (n as Element).matches('font.bt-target, button.bt-retry'),
            ) &&
            ![...rec.removedNodes].some((n) => n === rows.get(parent)?.output)
          ) {
            continue;
          }
        }
        // Translation-only mode empties original text nodes; that is not a page change.
        if (rec.type === 'characterData' && (rec.target as Text).data === '') {
          continue;
        }
        if (rec.type === 'attributes' && rec.attributeName === 'data-bt-hidden-original') {
          continue;
        }
        dirty.add(parent);
        if (
          rec.type === 'attributes' &&
          parent.parentElement &&
          (['role', 'href', 'rel'].includes(rec.attributeName ?? '') || parent.matches('a[href]'))
        ) {
          dirty.add(parent.parentElement);
        }
      }
      if (dirty.size > 0 && scanTimer === null) {
        scanTimer = window.setTimeout(reconcile, 60);
      }
    });

    const isRowCurrent = (row: RowState) =>
      !stopped &&
      row.el.isConnected &&
      rows.get(row.el) === row &&
      extractSourceText(row.el, readOriginal) === row.text;

    const showRetryButton = (row: RowState) => {
      if (!isRowCurrent(row) || row.retryBtn) return;
      scheduleRender(() => {
        if (!isRowCurrent(row) || row.retryBtn) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bt-retry';
        btn.dataset.btUi = 'retry';
        btn.textContent = t('retry');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          btn.remove();
          row.retryBtn = null;
          row.status = 'waiting';
          row.visible = true;
          scheduleDrain();
        });
        row.retryBtn = btn;
        row.el.append(btn);
      });
    };

    const applyTranslation = (
      unit: { row: RowState; text: string; inline: InlineLayout | null },
      translatedText: string,
      fragment: DocumentFragment | null,
    ) => {
      const { row } = unit;
      if (!isRowCurrent(row)) return;
      row.status = 'done';
      row.retryBtn?.remove();
      row.retryBtn = null;
      if (!translatedText || translatedText === (unit.inline?.plain ?? unit.text)) return;
      if (
        unit.inline &&
        captureInlineLayout(row.el, readOriginal)?.key !== unit.inline.key
      ) {
        return;
      }

      scheduleRender(() => {
        if (!isRowCurrent(row)) return;
        row.output?.remove();
        const output = document.createElement('font');
        output.className = 'bt-target';
        output.dataset.btTarget = '';
        output.lang = settings.reading.targetLang;
        output.append(fragment ?? translatedText);
        fitOutput(row.el, output);
        row.output = output;
        row.el.append(output);
        syncRowDisplayMode(row);
      });
    };

    const translateBatch = async (batch: RowState[], priority: 1 | 2) => {
      const units = batch.map((row) => ({ row, text: row.text, inline: row.inline }));

      const layouts = units.map(
        (unit) =>
          unit.inline?.pieces ??
          unit.text
            .split(/(\n+)/u)
            .flatMap((part) => splitLongText(part))
            .map((text) => ({ text, format: 'text' as const })),
      );
      const segments = layouts.flat().filter((piece) => isEligibleText(piece.text));
      const answers = new Map<number, string>();
      const failedIds = new Set<number>();

      for (let index = 0; index < segments.length && !stopped; ) {
        const items: TranslateItem[] = [];
        let size = 0;
        const format = segments[index]!.format;
        while (index < segments.length && items.length < 24 && segments[index]!.format === format) {
          const text = segments[index]!.text;
          if (size && size + text.length > 1400) break;
          items.push({ id: index++, text });
          size += text.length;
        }
        const reply = await transport.translateItems({
          settings,
          items,
          sourceLang: batch[0]?.lang ?? settings.reading.sourceLang,
          targetLang: settings.reading.targetLang,
          format,
          priority,
          context: document.title.slice(0, 200),
          signal: abort.signal,
          onBuiltinDownload: (pct) => {
            showToast({
              message:
                locale === 'zh-TW'
                  ? `正在下載 Chrome 內建翻譯語言包… ${pct}%`
                  : `Downloading Chrome Built-in translation pack… ${pct}%`,
              durationMs: pct >= 100 ? 1500 : 0,
              theme: settings.appearance,
            });
          },
        });
        for (const item of reply) {
          if (item.failed || !item.text) failedIds.add(item.id);
          else answers.set(item.id, item.text);
        }
      }

      let pos = 0;
      layouts.forEach((pieces, idx) => {
        let unitFailed = false;
        const parts = pieces.map(({ text }) => {
          if (!isEligibleText(text)) return text;
          const id = pos++;
          if (failedIds.has(id) || !answers.has(id)) {
            unitFailed = true;
            return '';
          }
          return answers.get(id)!;
        });
        const unit = units[idx]!;
        if (unitFailed) {
          unit.row.status = 'failed';
          showRetryButton(unit.row);
          return;
        }
        if (unit.inline && parts.every((replyText, i) => replyText === pieces[i]?.text)) {
          applyTranslation(unit, '', null);
          return;
        }
        const fragment = unit.inline ? renderInlineFragment(unit.inline, parts) : null;
        applyTranslation(unit, fragment ? (fragment.textContent ?? '') : parts.join(''), fragment);
      });
    };

    const handleBatchError = (batch: RowState[], err: unknown) => {
      if (stopped) return;
      const code = err instanceof TranslationError ? err.code : 'unknown';
      const isFatal = [
        'missing_key',
        'missing_model',
        'missing_url',
        'auth_failed',
        'cors_403',
        'unavailable',
      ].includes(code);

      if (isFatal) {
        if (!fatalShown) {
          fatalShown = true;
          showToast({
            message: formatErrorMessage(code, locale, err instanceof Error ? err.message : undefined),
            tone: 'error',
            actionLabel: t('settings'),
            onAction: () => void transport.openOptions('providers'),
            durationMs: 7000,
            theme: settings.appearance,
          });
        }
        controller.stop();
        return;
      }

      for (const row of batch) {
        row.status = 'failed';
        showRetryButton(row);
      }
    };

    const drain = () => {
      if (stopped || !started || running >= maxParallelBatches) return;
      const waiting = [...rows.values()].filter(
        (r) => r.status === 'waiting' && (r.visible || r.near),
      );
      waiting.sort((a, b) => Number(b.visible) - Number(a.visible));

      while (waiting.length > 0 && running < maxParallelBatches) {
        const first = waiting.shift()!;
        const batch: RowState[] = [first];
        let size = first.text.length;
        while (
          waiting.length > 0 &&
          batch.length < 24 &&
          waiting[0]!.visible === first.visible &&
          waiting[0]!.lang === first.lang &&
          size + waiting[0]!.text.length <= 1200
        ) {
          // Let the very first visible paragraph come back immediately for crisp perceived latency
          if (generation === 0 && first.visible) break;
          const nextRow = waiting.shift()!;
          batch.push(nextRow);
          size += nextRow.text.length;
        }
        generation++;
        for (const row of batch) row.status = 'running';
        running++;
        updateBadge();

        translateBatch(batch, first.visible ? 1 : 2)
          .catch((err) => handleBatchError(batch, err))
          .finally(() => {
            running--;
            updateBadge();
            scheduleDrain();
          });
      }
    };

    const controller = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        abort.abort();
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (drainTimer !== null) clearTimeout(drainTimer);
        if (scanTimer !== null) clearTimeout(scanTimer);
        renderQueue.length = 0;
        mutationObserver.disconnect();
        visibleObserver.disconnect();
        nearObserver?.disconnect();
        window.removeEventListener('resize', rebuildNearObserver);
        for (const row of rows.values()) {
          showOriginalInsideRow(row);
          row.output?.remove();
          row.retryBtn?.remove();
        }
        rows.clear();
        dirty.clear();
        void transport.updateBadge('');
        transport.disconnect();
        if (this.activeSession === controller) {
          this.activeSession = null;
        }
      },
      setDisplayMode: (nextMode: DisplayMode) => {
        currentDisplayMode = nextMode;
        for (const row of rows.values()) {
          syncRowDisplayMode(row);
        }
      },
      getProgress: () => {
        let done = 0;
        let failed = 0;
        let total = 0;
        for (const row of rows.values()) {
          if (row.visible || row.near || row.status !== 'waiting') {
            total++;
            if (row.status === 'done') done++;
            else if (row.status === 'failed') failed++;
          }
        }
        return { done, total, failed };
      },
    };

    this.activeSession = controller;
    scan(document.body);
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'lang',
        'hidden',
        'aria-hidden',
        'translate',
        'contenteditable',
        'class',
        'style',
        'role',
        'href',
        'rel',
        'target',
        'referrerpolicy',
      ],
    });

    started = true;
    scheduleDrain();
  }
}
