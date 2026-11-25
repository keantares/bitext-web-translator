import type { AccentColor, PaperTone, ThemeMode } from '@/core/storage/types';

export interface ToastOptions {
  message: string;
  tone?: 'info' | 'success' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
  theme?: { accentColor: AccentColor; paperTone: PaperTone; themeMode: ThemeMode };
}

const ACCENT_HEX: Record<AccentColor, [string, string]> = {
  teal: ['#0F6E66', '#55B8AA'],
  navy: ['#1D4E78', '#6EA8DC'],
  indigo: ['#2E4DA7', '#82A0F8'],
  petrol: ['#166075', '#61B6CC'],
  brick: ['#A63D33', '#E58076'],
};

let activeHost: HTMLElement | null = null;
let dismissTimer: number | null = null;

export function dismissToast(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  activeHost?.remove();
  activeHost = null;
}

export function showToast(options: ToastOptions): void {
  dismissToast();
  const accent = options.theme?.accentColor ?? 'teal';
  const paper = options.theme?.paperTone ?? 'warm';
  const mode = options.theme?.themeMode ?? 'system';
  const [accL, accD] = ACCENT_HEX[accent];

  const bgL = paper === 'cool' ? '#FDFEFF' : '#FFFDF8';
  const bgD = paper === 'cool' ? '#181D26' : '#1F1C18';
  const bdL = paper === 'cool' ? '#D9E1EC' : '#E4D9C3';
  const bdD = paper === 'cool' ? '#303A4A' : '#3B352B';
  const txL = paper === 'cool' ? '#1A212C' : '#24211C';
  const txD = paper === 'cool' ? '#E8EDF5' : '#EEE6D8';
  const scheme = mode === 'system' ? 'light dark' : mode;
  const dotColor =
    options.tone === 'error'
      ? 'light-dark(#B42318, #F97066)'
      : options.tone === 'success'
        ? 'light-dark(#157F47, #4CD48B)'
        : `light-dark(${accL}, ${accD})`;

  const host = document.createElement('div');
  host.dataset.btUi = 'toast';
  host.setAttribute('translate', 'no');
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial !important;
      position: fixed !important;
      right: 18px !important;
      bottom: 18px !important;
      z-index: 2147483647 !important;
      color-scheme: ${scheme} !important;
      font-family: "Segoe UI Variable Text","Segoe UI",-apple-system,"PingFang TC","Microsoft JhengHei UI",system-ui,sans-serif !important;
    }
    .box {
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(380px, calc(100vw - 36px));
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid light-dark(${bdL}, ${bdD});
      background: light-dark(${bgL}, ${bgD});
      color: light-dark(${txL}, ${txD});
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
      font-size: 13px;
      line-height: 1.45;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: none;
      background: ${dotColor};
    }
    .msg {
      flex: 1;
      overflow-wrap: anywhere;
    }
    .btn {
      flex: none;
      border: 0;
      border-radius: 999px;
      padding: 5px 11px;
      background: light-dark(${accL}, ${accD});
      color: light-dark(#FFFDF8, #0E1A18);
      font: 600 12px/1.2 inherit;
      cursor: pointer;
    }
    .close {
      flex: none;
      border: 0;
      background: transparent;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
      padding: 2px 4px;
      font-size: 14px;
      line-height: 1;
    }
    .close:hover { opacity: 1; }
  `;

  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('role', 'status');

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');

  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = options.message;

  box.append(dot, msg);

  if (options.actionLabel && options.onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = options.actionLabel;
    btn.addEventListener('click', () => {
      dismissToast();
      options.onAction?.();
    });
    box.append(btn);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', dismissToast);
  box.append(close);

  root.append(style, box);
  document.documentElement.append(host);
  activeHost = host;

  const duration = options.durationMs ?? 4500;
  if (duration > 0) {
    dismissTimer = window.setTimeout(dismissToast, duration);
  }
}
