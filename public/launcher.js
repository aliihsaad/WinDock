import { renderTile, renderTiles } from "./dock.js";
import { tileKey, moveTile } from "./tiles.js";

export function normalizeLayout(value = {}) {
  // Upgrade earlier row/column preferences to one of the three supported grids.
  const oldCapacity = Number(value?.columns) * Number(value?.rows);
  const perPage = [4, 6, 8].includes(Number(value?.perPage)) ? Number(value.perPage)
    : value?.perPage === undefined && [4, 6, 8].includes(oldCapacity) ? oldCapacity : 4;
  return {
    perPage,
    columns: perPage / 2,
    rows: 2,
    iconSize: { 4: 160, 6: 138, 8: 116 }[perPage],
    immersive: value?.immersive !== false,
    showLabels: value?.showLabels === true,
    background: ["aurora", "dusk", "ember", "midnight"].includes(value?.background) ? value.background : "aurora",
    theme: ["glass", "frost", "smoke"].includes(value?.theme) ? value.theme : "glass",
  };
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
