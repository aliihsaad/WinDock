/**
 * Haptic feedback. The Vibration API works in the Android app (it holds the
 * VIBRATE permission) and in browsers that support it; everywhere else this is
 * a silent no-op. A saved preference lets people turn it off.
 */
const KEY = "windock-haptics";
// Not WinDockPreferences: that store only accepts its own fixed list of keys.
const store = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

export function hapticsEnabled(storage = store()) {
  try { return storage?.getItem(KEY) !== "off"; } catch { return true; }
}

export function setHaptics(on, storage = store()) {
  try { storage?.setItem(KEY, on ? "on" : "off"); } catch { /* preference stays at its default */ }
}

/** Vibrate for `pattern` milliseconds (or a pattern array). Returns whether a buzz was requested. */
export function buzz(pattern = 10, { storage, vibrate } = {}) {
  const fn = vibrate || (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? navigator.vibrate.bind(navigator) : null);
  if (!fn || !hapticsEnabled(storage ?? store())) return false;
  try { fn(pattern); return true; } catch { return false; }
}
