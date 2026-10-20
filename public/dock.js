/**
 * Pure dock rendering.
 *
 * Kept free of DOM APIs and browser globals so the same code runs under Node in
 * the PWA gate. `renderTiles` returns an HTML string; the browser shell is the
 * only thing that touches `document`.
 */

import { icon, controlIcon } from "./icons.js";

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

export function renderAppIcon(app, lazy = false) {
  const initial = glyphFor({ ...app, label: app.name || app.label });
  return `<span class="app-icon"><span class="app-icon__fallback">${escapeHtml(initial)}</span><img src="/api/apps/icon?v=3&amp;id=${escapeHtml(encodeURIComponent(app.id))}" alt="" width="48" height="48" decoding="async"${lazy ? ' loading="lazy"' : ""}></span>`;
}

/**
 * Render one tile.
 * In editing mode the tile stops being an action button and grows reorder and
 * remove controls, so a tap cannot launch something while the user is arranging
 * the dock.
 */
/** The 2x2 preview inside a folder tile: the first four icons it holds. */
export function renderFolderPreview(folder) {
  const cells = (Array.isArray(folder?.tiles) ? folder.tiles : []).slice(0, 4).map((child) =>
    `<span class="folder-mini__cell">${child.kind === "app" ? renderAppIcon(child, true) : controlIcon(child.verb)}</span>`,
  );
  return `<span class="folder-mini">${cells.join("")}</span>`;
}

function renderFolderTile(tile, { editing = false } = {}) {
  const children = Array.isArray(tile.tiles) ? tile.tiles : [];
  const running = children.some((child) => child.kind === "app" && child.running === true);
  const classes = ["tile", "tile--folder"];
  if (running) classes.push("is-running");
  if (editing) classes.push("is-editing");
  const count = children.length + (children.length === 1 ? " item" : " items");
  return [
    `<button class="${classes.join(" ")}" type="button" data-action="${editing ? "folder-edit" : "folder"}"`,
    ` data-key="${escapeHtml(tile.id)}" data-tile-key="folder:${escapeHtml(tile.id)}"`,
    ` aria-label="${escapeHtml(tile.label)}, folder, ${count}" aria-haspopup="dialog">`,
    `<span class="tile__glyph" aria-hidden="true">${renderFolderPreview(tile)}</span>`,
    `<span class="tile__label">${escapeHtml(tile.label)}</span>`,
    !editing ? `<span class="tile__hint">${count}</span>` : "",
    running && !editing ? '<span class="tile__dot" aria-hidden="true"></span>' : "",
    "</button>",
  ].join("");
}

export function renderTile(tile, { editing = false, first = false, last = false, launcher = false } = {}) {
  if (tile?.kind === "folder") return renderFolderTile(tile, { editing });
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
    `<span class="tile__glyph" aria-hidden="true">${tile.kind === "app" ? renderAppIcon(tile) : controlIcon(tile.verb)}</span>`,
    `<span class="tile__label">${escapeHtml(tile.label)}</span>`,
    !editing ? `<span class="tile__hint">${tile.kind === "app" ? running ? "Running" : "Open app" : "Quick action"}</span>` : "",
    running && !editing ? '<span class="tile__dot" aria-hidden="true"></span>' : "",
  ].join("");

  if (!editing || launcher) {
    return [
      `<button class="${classes.join(" ")}" type="button"`,
      ` data-action="${editing ? "options" : escapeHtml(action)}" data-key="${escapeHtml(actionKey)}" data-tile-key="${escapeHtml(key)}"${valueAttr}`,
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
    ` aria-label="Move ${escapeHtml(tile.label)} earlier"${first ? " disabled" : ""}>${icon("left")}</button>`,
    `<button class="tile__remove" type="button" data-action="remove" data-key="${escapeHtml(key)}"`,
    ` aria-label="Remove ${escapeHtml(tile.label)}">${icon("trash")}</button>`,
    `<button class="tile__move" type="button" data-action="move-down" data-key="${escapeHtml(key)}"`,
    ` aria-label="Move ${escapeHtml(tile.label)} later"${last ? " disabled" : ""}>${icon("right")}</button>`,
    "</div>",
    "</div>",
  ].join("");
}

export function renderTiles(state, { editing = false } = {}) {
  const tiles = Array.isArray(state?.tiles) ? state.tiles : [];
  if (tiles.length === 0) {
    return `<div class="empty"><span class="empty__icon">${icon("grid")}</span><h3>A little space for your favorites.</h3><p>No tiles pinned yet. Add your everyday apps<br>and controls to make this dock yours.</p><button type="button" class="button button--primary" data-open-picker>${icon("plus")} Add your first app</button></div>`;
  }
  return tiles
    .map((tile, i) =>
      renderTile(tile, { editing, first: i === 0, last: i === tiles.length - 1 }),
    )
    .join("");
}

/** The open folder: its tiles in a simple grid, or a hint when it is empty. */
export function renderFolderGrid(folder, { editing = false } = {}) {
  const children = Array.isArray(folder?.tiles) ? folder.tiles : [];
  if (!children.length) return '<p class="folder-sheet__empty">This folder is empty.</p>';
  return children.map((child) => renderTile(child, { editing, launcher: true })).join("");
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
            }${item.pinned ? " disabled" : ""}><span class="picker__symbol">${controlIcon(item.verb)}</span><span class="picker__name">${escapeHtml(item.label)}</span><span class="picker__add">${icon(item.pinned ? "check" : "plus")}</span></button></li>`,
        ),
      ].join(""),
    )
    .join("");
}

export function renderNowPlaying(np) {
  if (!np || !np.title) return "";
  return [
    '<div class="np">',
    `<span class="np__icon">${icon("music")}</span><div class="np__text"><span class="eyebrow">${np.playing ? "Now playing" : "Paused"}</span>`,
    `<strong class="np__title">${escapeHtml(np.title)}</strong>`,
    np.artist ? `<span class="np__artist">${escapeHtml(np.artist)}</span>` : "",
    `</div><button class="icon-button" type="button" data-action="control" data-key="media-play-pause" aria-label="Play / pause">${icon(np.playing ? "pause" : "play")}</button>`,
    "</div>",
  ].join("");
}

export function renderControls(verbs, allowDestructive = true) {
  const groups = [
    { title: "Sound", hint: "A little louder. A little quieter.", symbol: "volume", items: [["volume-down", "Quieter"], ["mute-toggle", "Mute"], ["volume-up", "Louder"]] },
    { title: "Playback", hint: "Keep the good stuff playing.", symbol: "music", items: [["media-previous", "Previous"], ["media-play-pause", "Play / pause"], ["media-next", "Next"]] },
    { title: "Display", hint: "Set your built-in screen brightness.", symbol: "sun", items: [["brightness-set", "25%", 25], ["brightness-set", "50%", 50], ["brightness-set", "100%", 100]] },
    { title: "Your PC", hint: "Power actions ask before continuing.", symbol: "monitor", items: [["lock", "Lock"], ["sleep", "Sleep"], ["restart", "Restart"], ["shutdown", "Shut down"]] },
  ];
  return groups.map((group) => {
    const items = group.items.filter(([verb]) => verbs.includes(verb) && (allowDestructive || !["sleep", "restart", "shutdown"].includes(verb)));
    if (!items.length) return "";
    return `<section class="control-card"><div class="control-card__heading"><span class="control-card__symbol">${icon(group.symbol)}</span><div><h3>${group.title}</h3><p>${group.hint}</p></div></div><div class="control-card__actions">${items.map(([verb, label, value]) => `<button type="button" data-action="control" data-key="${verb}"${value === undefined ? "" : ` data-value="${value}"`}>${controlIcon(verb)}<span>${label}</span></button>`).join("")}</div></section>`;
  }).join("");
}
