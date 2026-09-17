/**
 * Pure dock rendering.
 *
 * Kept free of DOM APIs and browser globals so the same code runs under Node in
 * the PWA gate. `renderTiles` returns an HTML string; the browser shell is the
 * only thing that touches `document`.
 */

/** Minimal HTML-escape for text interpolated into the dock. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CONTROL_GLYPH = {
  "volume-up": "🔊",
  "volume-down": "🔉",
  "volume-set": "🎚️",
  "mute-toggle": "🔇",
  "media-play-pause": "⏯️",
  "media-next": "⏭️",
  "media-previous": "⏮️",
  "media-stop": "⏹️",
  "brightness-set": "☀️",
  lock: "🔒",
  sleep: "🌙",
  shutdown: "⏻",
  restart: "🔁",
};

export function glyphFor(tile) {
  if (tile.kind === "control") return CONTROL_GLYPH[tile.verb] || "•";
  const name = String(tile.label || tile.id || "?").trim();
  return name.slice(0, 1).toUpperCase() || "?";
}

/**
 * Render one tile.
 * In editing mode the tile stops being an action button and grows reorder and
 * remove controls, so a tap cannot launch something while the user is arranging
 * the dock.
 */
export function renderTile(tile, { editing = false, first = false, last = false } = {}) {
  const running = tile.kind === "app" && tile.running === true;
  const classes = ["tile", `tile--${tile.kind}`];
  if (running) classes.push("is-running");
  if (editing) classes.push("is-editing");
  const action = tile.kind === "control" ? "control" : "launch";
  const hasValue = tile.kind === "control" && tile.value !== undefined && tile.value !== null;
  const key =
    tile.kind === "control"
      ? `control:${tile.verb}${hasValue ? `:${tile.value}` : ""}`
      : `app:${tile.id}`;
  const actionKey = tile.kind === "control" ? tile.verb : tile.id;
  // A valued verb carries its value on the element; tapping a tile with no
  // value would send an incomplete request the host correctly rejects.
  const valueAttr = hasValue ? ` data-value="${escapeHtml(String(tile.value))}"` : "";

  const body = [
    `<span class="tile__glyph" aria-hidden="true">${escapeHtml(glyphFor(tile))}</span>`,
    `<span class="tile__label">${escapeHtml(tile.label)}</span>`,
    running && !editing ? '<span class="tile__dot" aria-hidden="true"></span>' : "",
  ].join("");

  if (!editing) {
    return [
      `<button class="${classes.join(" ")}" type="button"`,
      ` data-action="${escapeHtml(action)}" data-key="${escapeHtml(actionKey)}"${valueAttr}`,
      ` aria-label="${escapeHtml(tile.label)}"${running ? ' aria-pressed="true"' : ""}>`,
      body,
      "</button>",
    ].join("");
  }

  return [
    `<div class="${classes.join(" ")}" data-key="${escapeHtml(key)}">`,
    body,
    '<div class="tile__edit">',
    `<button class="tile__move" type="button" data-action="move-up" data-key="${escapeHtml(key)}"`,
    ` aria-label="Move ${escapeHtml(tile.label)} earlier"${first ? " disabled" : ""}>◀</button>`,
    `<button class="tile__remove" type="button" data-action="remove" data-key="${escapeHtml(key)}"`,
    ` aria-label="Remove ${escapeHtml(tile.label)}">✕</button>`,
    `<button class="tile__move" type="button" data-action="move-down" data-key="${escapeHtml(key)}"`,
    ` aria-label="Move ${escapeHtml(tile.label)} later"${last ? " disabled" : ""}>▶</button>`,
    "</div>",
    "</div>",
  ].join("");
}

export function renderTiles(state, { editing = false } = {}) {
  const tiles = Array.isArray(state?.tiles) ? state.tiles : [];
  if (tiles.length === 0) {
    return '<p class="empty">No tiles pinned yet. Open <b>Add</b> to pin an app or a control.</p>';
  }
  return tiles
    .map((tile, i) =>
      renderTile(tile, { editing, first: i === 0, last: i === tiles.length - 1 }),
    )
    .join("");
}

/** Render the grouped control picker from `availableControls()` output. */
export function renderControlPicker(groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length === 0) return '<li class="picker__empty">No controls available.</li>';
  return list
    .map((group) =>
      [
        `<li class="picker__group">${escapeHtml(group.group)}</li>`,
        ...group.items.map(
          (item) =>
            `<li><button type="button" data-verb="${escapeHtml(item.verb)}"${
              item.value === undefined || item.value === null
                ? ""
                : ` data-value="${escapeHtml(String(item.value))}"`
            }${item.pinned ? " disabled" : ""}>${escapeHtml(item.label)}${
              item.pinned ? " ✓" : ""
            }</button></li>`,
        ),
      ].join(""),
    )
    .join("");
}

export function renderNowPlaying(np) {
  if (!np || !np.title) return "";
  const icon = np.playing ? "▶" : "❚❚";
  return [
    '<div class="np">',
    `<span class="np__icon" aria-hidden="true">${icon}</span>`,
    `<span class="np__title">${escapeHtml(np.title)}</span>`,
    np.artist ? `<span class="np__artist">${escapeHtml(np.artist)}</span>` : "",
    "</div>",
  ].join("");
}
