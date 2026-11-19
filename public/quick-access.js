/**
 * Quick access to the touchpad and signature pad.
 *
 * Opening them used to mean pulling down the quick-controls curtain first. Now a
 * side handle and a triple tap on empty dock space open the pad directly. Both can
 * be switched off; the default is on.
 */
const KEY = "tara-quick-input";
// Not TaraPreferences: that store only accepts its own fixed list of keys.
const store = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

export function quickInputEnabled(storage = store()) {
  try { return storage?.getItem(KEY) !== "off"; } catch { return true; }
}
export function setQuickInput(on, storage = store()) {
  try { storage?.setItem(KEY, on ? "on" : "off"); } catch { /* keeps its default */ }
}

/**
 * Counts consecutive taps that land close together in time and place.
 * `tap(x, y)` returns true on the third tap and then starts over.
 */
export function createTripleTap({ windowMs = 650, slop = 48, now = () => Date.now(), taps = 3 } = {}) {
  let hits = [];
  return {
    tap(x, y) {
      const t = now();
      hits = hits.filter((h) => t - h.t <= windowMs && Math.hypot(h.x - x, h.y - y) <= slop);
      hits.push({ t, x, y });
      if (hits.length >= taps) { hits = []; return true; }
      return false;
    },
    reset() { hits = []; },
  };
}

/** Counts consecutive nearby taps (3 opens the touchpad, 5 the keyboard). Returns the running count. */
export function createTapCounter({ windowMs = 650, slop = 48, now = () => Date.now() } = {}) {
  let hits = [];
  return {
    tap(x, y) {
      const t = now();
      hits = hits.filter((h) => t - h.t <= windowMs && Math.hypot(h.x - x, h.y - y) <= slop);
      hits.push({ t, x, y });
      return hits.length;
    },
    reset() { hits = []; },
  };
}

/** True for a tap on bare dock background rather than a control, tile or scrolling gesture. */
export function isBackgroundTarget(target) {
  return !!target && !target.closest?.("button, a, input, select, textarea, label, dialog, .tile, [role=button], .page-dot");
}
