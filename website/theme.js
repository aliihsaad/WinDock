// Apply the saved appearance before styles load, so dark visits do not flash light.
(() => {
  const key = 'tara-website-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => value === 'light' || value === 'dark';
  let preference = null;
  let toggles = [];
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) preference = saved;
  } catch { /* The switch still works when browser storage is unavailable. */ }

  function applyTheme() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101613' : '#f6f5f0';
    for (const toggle of toggles) {
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      toggle.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
    }
  }
  applyTheme();
  system.addEventListener('change', () => { if (!preference) applyTheme(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    applyTheme();
  });
  document.addEventListener('DOMContentLoaded', () => {
    toggles = [...document.querySelectorAll('[data-theme-toggle]')];
    toggles.forEach(toggle => { toggle.hidden = false; });
    applyTheme();
    toggles.forEach(toggle => toggle.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch { /* Keep this visit's choice. */ }
      applyTheme();
    }));
  });
})();
