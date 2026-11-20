// A blocking head script applies the preference before styles or the app paint.
// Keep this dependency-free so it also works in the cached shell and WebView.
(() => {
  const key = "tara-performance";
  const memoryOnly = document.currentScript?.hasAttribute("data-memory-only");
  const autoEnabled = new URLSearchParams(location.search).get("perf") === "1";
  const normalize = (value) => ["on", "off"].includes(value) ? value : "auto";
  let preference = "auto";
  try { if (!memoryOnly) preference = normalize((window.TaraPreferences || localStorage).getItem(key)); } catch { /* Storage may be unavailable. */ }
  const enabled = () => preference === "on" || (preference === "auto" && autoEnabled);
  // Phones with few cores or little memory get lighter glass blur on their own, which is the costliest effect.
  const nav = typeof navigator === "object" ? navigator : {}, weak = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 3;
  const apply = () => { document.documentElement.classList.toggle("perf", enabled()); document.documentElement.classList.toggle("lite", weak && !enabled()); };
  window.TaraPerformance = {
    get preference() { return preference; },
    get enabled() { return enabled(); },
    get autoEnabled() { return autoEnabled; },
    setPreference(value) {
      preference = normalize(value);
      try { if (!memoryOnly) (window.TaraPreferences || localStorage).setItem(key, preference); } catch { /* Still apply for this session. */ }
      apply();
    },
    scrollBehavior(smooth = true) {
      return !smooth || enabled() || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    },
  };
  apply();
})();
