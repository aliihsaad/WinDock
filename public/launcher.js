import { renderTile, renderTiles } from "./dock.js";
import { tileKey, moveTile } from "./tiles.js";

/** Supported grids, icons per page → [columns, rows]. Up to 8 fit a phone; 12 and 16 need a tablet's height. */
export const GRIDS = Object.freeze({ 4: [2, 2], 6: [3, 2], 8: [4, 2], 12: [4, 3], 16: [4, 4] });
export const ICON_SIZES = Object.freeze({ 4: 160, 6: 138, 8: 116, 12: 116, 16: 104 });
/** Share of the viewport height one icon may take in immersive mode. */
export const ICON_SCALE = Object.freeze({ 4: .44, 6: .38, 8: .32, 12: .24, 16: .19 });
export const PHONE_MAX_PER_PAGE = 8;
/** Viewport height from which the tablet densities are offered and honoured. */
export const LARGE_MIN_HEIGHT = 640;

export function normalizeLayout(value = {}) {
  // Upgrade earlier row/column preferences to the grid with the same shape.
  const requested = Number(value?.perPage);
  const legacy = Object.keys(GRIDS).find((count) => GRIDS[count][0] === Number(value?.columns) && GRIDS[count][1] === Number(value?.rows));
  const perPage = GRIDS[requested] ? requested : value?.perPage === undefined && legacy ? Number(legacy) : 4;
  const [columns, rows] = GRIDS[perPage];
  return {
    perPage,
    columns,
    rows,
    iconSize: ICON_SIZES[perPage],
    immersive: value?.immersive !== false,
    showLabels: value?.showLabels === true,
    background: ["aurora", "dusk", "ember", "midnight"].includes(value?.background) ? value.background : "aurora",
    theme: ["glass", "frost", "smoke"].includes(value?.theme) ? value.theme : "glass",
  };
}

/**
 * The grid to draw on this screen. A tablet density chosen on a tablet and
 * then opened on a phone falls back to the densest phone grid; the stored
 * preference is untouched, so the tablet gets its layout back.
 */
export function fitLayout(layout, { height } = {}) {
  if (layout.perPage <= PHONE_MAX_PER_PAGE || !(Number(height) < LARGE_MIN_HEIGHT)) return layout;
  const [columns, rows] = GRIDS[PHONE_MAX_PER_PAGE];
  return { ...layout, perPage: PHONE_MAX_PER_PAGE, columns, rows, iconSize: ICON_SIZES[PHONE_MAX_PER_PAGE] };
}

export function pageCount(tiles, layout) {
  return Math.max(1, Math.ceil(tiles.length / (layout.columns * layout.rows)));
}

export function renderPages(state, layout, editing = false) {
  if (!state.tiles.length) return renderTiles(state);
  const capacity = layout.columns * layout.rows;
  return Array.from({ length: pageCount(state.tiles, layout) }, (_, page) =>
    `<div class="dock-page" role="group" aria-label="Page ${page + 1}">${state.tiles.slice(page * capacity, (page + 1) * capacity).map((tile) => renderTile(tile, { editing, launcher: true })).join("")}</div>`
  ).join("");
}

export function moveToTile(tiles, key, targetKey) {
  const from = tiles.findIndex((tile) => tileKey(tile) === key);
  const to = tiles.findIndex((tile) => tileKey(tile) === targetKey);
  return from < 0 || to < 0 ? tiles : moveTile(tiles, key, to - from);
}
