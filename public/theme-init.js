(() => {
  try {
    const mode = localStorage.getItem('bitext:themeMode');
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute('content', mode === 'light' || mode === 'dark' ? mode : 'light dark');
    }
    const accent = localStorage.getItem('bitext:accentColor');
    if (accent) {
      document.documentElement.dataset.accent = accent;
    }
    const paper = localStorage.getItem('bitext:paperTone');
    if (paper) {
      document.documentElement.dataset.paper = paper;
    }
  } catch {
    // Storage may be unavailable; defaults in CSS apply safely.
  }
})();
