/**
 * Shortcut decks for creative apps. Each key is a chord the PC presses for you.
 * Only widely used default shortcuts are listed; an app that has been remapped may differ.
 */
export const MODIFIER_LABELS = Object.freeze({ ctrl: "Ctrl", shift: "Shift", alt: "Alt", win: "Win" });

const k = (label, key, mods = [], extra = {}) => ({ label, key, mods, ...extra });
const numpad = (n, label) => k(label, "Numpad" + n, [], { hint: String(n) });

export const DECKS = Object.freeze([
  {
    id: "blender", name: "Blender", match: /blender/i,
    pages: [
      { id: "tools", name: "Tools", keys: [
        k("Edit mode", "Tab"), k("Grab", "g"), k("Rotate", "r"), k("Scale", "s"),
        k("Extrude", "e"), k("Add", "a", ["shift"]), k("Select all", "a"), k("Deselect", "a", ["alt"]),
        k("Delete", "x"), k("Duplicate", "d", ["shift"]), k("Insert key", "i"), k("Search", "F3"),
        k("Undo", "z", ["ctrl"]), k("Redo", "z", ["ctrl", "shift"]), k("Play", "Space"), k("Save", "s", ["ctrl"]),
      ] },
      { id: "view", name: "View", layout: "numpad", keys: [
        numpad(7, "Top"), numpad(8, "Up"), numpad(9, "Opposite"),
        numpad(4, "Left"), numpad(5, "Ortho"), numpad(6, "Right"),
        numpad(1, "Front"), numpad(2, "Down"), numpad(3, "Side"),
        numpad(0, "Camera"), k("Frame sel", "NumpadDecimal", [], { hint: "." }), k("Local", "NumpadDivide", [], { hint: "/" }),
        k("Back", "Numpad1", ["ctrl"]), k("Left", "Numpad3", ["ctrl"]), k("Bottom", "Numpad7", ["ctrl"]),
        k("Frame all", "Home"), k("X-ray", "z", ["alt"]), k("Wire", "z", ["shift"]),
        k("Sidebar", "n"), k("Toolbar", "t"), k("Maximize", "Space", ["ctrl"]),
      ] },
      { id: "render", name: "Render", keys: [
        k("Render", "F12"), k("Animation", "F12", ["ctrl"]), k("Show render", "F11"), k("Cancel", "Escape"),
        k("Prev frame", "ArrowLeft"), k("Next frame", "ArrowRight"), k("Prev key", "ArrowDown"), k("Next key", "ArrowUp"),
        k("Save v+", "s", ["ctrl"], { action: "versioned-save" }),
      ] },
    ],
  },
  {
    id: "resolve", name: "DaVinci Resolve", match: /resolve|davinci/i,
    pages: [
      { id: "edit", name: "Edit", keys: [
        k("Play / pause", "Space"), k("Rewind", "j"), k("Stop", "k"), k("Forward", "l"),
        k("Mark in", "i"), k("Mark out", "o"), k("Split", "Backslash", ["ctrl"]), k("Blade tool", "b"),
        k("Select tool", "a"), k("Marker", "m"), k("Snapping", "n"), k("Fit timeline", "z", ["shift"]),
        k("Delete", "Delete"), k("Undo", "z", ["ctrl"]), k("Redo", "z", ["ctrl", "shift"]), k("Save", "s", ["ctrl"]),
        k("Prev edit", "ArrowUp"), k("Next edit", "ArrowDown"), k("Start", "Home"), k("End", "End"),
      ] },
      { id: "pages", name: "Pages", keys: [
        k("Media", "2", ["shift"]), k("Cut", "3", ["shift"]), k("Edit", "4", ["shift"]), k("Fusion", "5", ["shift"]),
        k("Color", "6", ["shift"]), k("Fairlight", "7", ["shift"]), k("Deliver", "8", ["shift"]),
      ] },
    ],
  },
  {
    id: "general", name: "General", match: null,
    pages: [
      { id: "keys", name: "Keys", keys: [
        k("Copy", "c", ["ctrl"]), k("Paste", "v", ["ctrl"]), k("Cut", "x", ["ctrl"]), k("Select all", "a", ["ctrl"]),
        k("Undo", "z", ["ctrl"]), k("Redo", "y", ["ctrl"]), k("Save", "s", ["ctrl"]), k("Find", "f", ["ctrl"]),
        k("Switch app", "Tab", ["alt"]), k("Desktop", "d", ["win"]), k("Snip", "s", ["win", "shift"]), k("Task view", "Tab", ["win"]),
        k("Rename", "F2"), k("Refresh", "F5"), k("Escape", "Escape"), k("Enter", "Enter"),
      ] },
    ],
  },
]);

/** The chord message for a deck key, optionally repeated. */
export function chordMessage(entry, repeat = 1) {
  const message = { type: "chord", mods: [...(entry.mods || [])], key: entry.key };
  if (repeat > 1) message.repeat = Math.min(20, repeat);
  return message;
}

/** Pick the deck for the first open window that belongs to a known app, or null. */
export function detectDeck(windows) {
  for (const deck of DECKS) {
    if (!deck.match) continue;
    if ((windows || []).some((w) => deck.match.test([w.name, w.id, w.title].filter(Boolean).join(" ")))) return deck.id;
  }
  return null;
}

/** Turn horizontal travel into whole frame steps, keeping the leftover distance for next time. */
export function scrubSteps(travel, carried = 0, pixelsPerStep = 14) {
  const total = travel + carried;
  const steps = Math.trunc(total / pixelsPerStep);
  return { steps, carried: total - steps * pixelsPerStep };
}
