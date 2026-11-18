/**
 * Key chords: modifiers plus one key, for creative apps such as Blender and DaVinci Resolve.
 * One table serves validation here and is mirrored by the Windows helper (native/win/Shortcuts.cs).
 */
export const MODIFIERS = Object.freeze(["ctrl", "shift", "alt", "win"]);
const NAMED = [
  "Space", "Enter", "Tab", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Comma", "Period", "Slash", "Backslash", "Minus", "Equal", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Backquote",
  "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter",
];
export const KEYS = Object.freeze(new Set([
  ...NAMED,
  ..."abcdefghijklmnopqrstuvwxyz0123456789",
  ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1)),
  ...Array.from({ length: 10 }, (_, i) => "Numpad" + i),
]));

/** Returns a clean chord or null. `repeat` presses the key several times (frame stepping). */
export function validateChord(message) {
  if (!message || message.type !== "chord") return null;
  const allowed = ["type", "mods", "key", "repeat"];
  if (Object.keys(message).some((k) => !allowed.includes(k))) return null;
  if (!Array.isArray(message.mods) || message.mods.length > 4) return null;
  if (new Set(message.mods).size !== message.mods.length || !message.mods.every((m) => MODIFIERS.includes(m))) return null;
  if (typeof message.key !== "string" || !KEYS.has(message.key)) return null;
  const repeat = message.repeat === undefined ? 1 : message.repeat;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) return null;
  const mods = MODIFIERS.filter((m) => message.mods.includes(m));
  return repeat === 1 ? { type: "chord", mods, key: message.key } : { type: "chord", mods, key: message.key, repeat };
}
