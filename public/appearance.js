// Android persists appearance per PC identity; browsers retain origin-local storage.
// Run before performance.js so a restored manual choice applies before first paint.
(() => {
  const keys = ["windock-performance", "windock-layout"];
  const values = new Map();
  const memoryOnly = document.currentScript?.hasAttribute("data-memory-only");
  const origin = location.origin;
  let native, snapshot;
  if (!memoryOnly) {
    for (const key of keys) {
      try { values.set(key, localStorage.getItem(key)); } catch {}
    }
    try {
      native = window.WinDockAndroid;
      snapshot = JSON.parse(native?.getAppearance(origin, JSON.stringify(Object.fromEntries(values))) || "null");
      if (!snapshot || typeof snapshot.scope !== "string" || typeof snapshot.values !== "object" || !snapshot.values) snapshot = null;
    } catch { snapshot = null; }
  }
  const mirror = (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* A denied web store must not disable native persistence. */ }
  };
  for (const key of keys) {
    if (snapshot) {
      const restored = snapshot?.values[key];
      const value = typeof restored === "string" ? restored : null;
      // Also clear a previous PC's legacy values when an address is reassigned.
      mirror(key, value);
      values.set(key, value);
    }
  }
  window.WinDockPreferences = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (!keys.includes(key)) return;
      value = String(value);
      values.set(key, value);
      if (memoryOnly) return;
      if (snapshot) {
        try { native.saveAppearance(origin, snapshot.scope, key, value); } catch {}
      }
      mirror(key, value);
    },
  };
})();
