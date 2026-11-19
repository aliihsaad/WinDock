/**
 * Screen rotation: auto follows the phone, landscape and portrait pin it.
 * In the Android app the native side holds the lock; in a browser the Screen
 * Orientation API is tried and quietly ignored where it is refused.
 */
export const ROTATION_MODES = Object.freeze(["auto", "landscape", "portrait"]);
const KEY = "tara-rotation";
// Not TaraPreferences: that store only accepts its own fixed list of keys.
const store = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

export function normalizeRotation(value) { return ROTATION_MODES.includes(value) ? value : "auto"; }
export function getRotation(storage = store()) {
  try { return normalizeRotation(storage?.getItem(KEY)); } catch { return "auto"; }
}
/** Portrait is only shown when the person has not pinned landscape. */
export function portraitAllowed(mode) { return normalizeRotation(mode) !== "landscape"; }

export function applyRotation(mode, { root = document.documentElement, android = window.TaraAndroid, screenRef = typeof screen !== "undefined" ? screen : null, storage = store() } = {}) {
  const next = normalizeRotation(mode);
  try { storage?.setItem(KEY, next); } catch { /* the lock below still applies this session */ }
  root.dataset.rotation = next;
  if (portraitAllowed(next)) root.setAttribute("data-rotate-ok", ""); else root.removeAttribute("data-rotate-ok");
  if (typeof android?.setOrientation === "function") { try { android.setOrientation(next); } catch { /* old app build */ } }
  else if (screenRef?.orientation) {
    try {
      if (next === "auto") screenRef.orientation.unlock?.();
      else Promise.resolve(screenRef.orientation.lock?.(next)).catch(() => {});
    } catch { /* browsers only allow this in fullscreen */ }
  }
  return next;
}
