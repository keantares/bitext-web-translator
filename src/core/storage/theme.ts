import type { AccentColor, PaperTone, ThemeMode } from './types';

const LS_MODE = 'bitext:themeMode';
const LS_ACCENT = 'bitext:accentColor';
const LS_PAPER = 'bitext:paperTone';

export function resolveColorSchemeContent(mode: ThemeMode): 'light dark' | 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return 'light dark';
}

export function applyThemeToDocument(
  theme: { themeMode: ThemeMode; accentColor: AccentColor; paperTone: PaperTone },
  doc: Document = document,
): void {
  const root = doc.documentElement;
  root.dataset.accent = theme.accentColor;
  root.dataset.paper = theme.paperTone;

  let meta = doc.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.name = 'color-scheme';
    doc.head.prepend(meta);
  }
  meta.content = resolveColorSchemeContent(theme.themeMode);

  try {
    if (theme.themeMode === 'system') {
      localStorage.removeItem(LS_MODE);
    } else {
      localStorage.setItem(LS_MODE, theme.themeMode);
    }
    localStorage.setItem(LS_ACCENT, theme.accentColor);
    localStorage.setItem(LS_PAPER, theme.paperTone);
  } catch {
    // Ignore storage quota or private context errors
  }
}
