/**
 * Pure dock-list operations.
 *
 * The dock is an ordered list, and every edit is a pure transformation of that
 * list: add, remove, move. Keeping these free of the DOM means the editing
 * behaviour is provable headlessly instead of only by tapping a phone.
 *
 * Every function returns a NEW array and never mutates its input, so a failed
 * server round-trip can be rolled back by simply keeping the old list.
 */

/**
 * Stable identity for a tile within the dock.
 * A valued control is keyed by verb AND value, so "Volume 25%" and
 * "Volume 75%" are two distinct tiles rather than one colliding pair.
 */
export const MAX_TILES = 200;
export const MAX_FOLDERS = 40;
export const MAX_FOLDER_TILES = 60;

export function tileKey(tile) {
  if (!tile || typeof tile !== "object") return "";
  if (tile.kind === "folder") return `folder:${tile.id}`;
  if (tile.kind !== "control") return `app:${tile.id}`;
  return tile.value === undefined || tile.value === null
    ? `control:${tile.verb}`
    : `control:${tile.verb}:${tile.value}`;
}

/**
 * Strip runtime-only fields before sending tiles back to the host.
 * `running` is computed per request by the server; echoing it back would
 * persist a snapshot of live state into the config file.
 */
export function toWireTiles(tiles) {
  if (!Array.isArray(tiles)) return [];
  return tiles
    .map((tile) => {
      if (!tile || typeof tile !== "object") return null;
      if (tile.kind === "folder") {
        const children = toWireTiles(tile.tiles).filter((child) => child.kind !== "folder");
        return children.length ? { kind: "folder", id: tile.id, label: tile.label, tiles: children } : null;
      }
      if (tile.kind === "control") {
        const out = { kind: "control", verb: tile.verb, label: tile.label };
        if (tile.value !== undefined && tile.value !== null) out.value = tile.value;
        return out;
      }
      if (tile.kind === "app") {
        return {
          kind: "app",
          id: tile.id,
          target: tile.target,
          label: tile.label,
          args: tile.args || "",
          icon: tile.icon || "",
        };
      }
      return null;
    })
    .filter(Boolean);
}

/** Every app and control in the dock, including the ones inside folders. */
export function flattenTiles(tiles) {
  return (Array.isArray(tiles) ? tiles : []).flatMap((t) => (t?.kind === "folder" ? flattenTiles(t.tiles) : t ? [t] : []));
}

export function countTiles(tiles) {
  return flattenTiles(tiles).length;
}

export function hasTile(tiles, key) {
  return (Array.isArray(tiles) ? tiles : []).some((t) => tileKey(t) === key || (t?.kind === "folder" && hasTile(t.tiles, key)));
}

/** Where a tile lives: its folder (or null for a page) and its index there. */
export function findTile(tiles, key) {
  const list = Array.isArray(tiles) ? tiles : [];
  for (let i = 0; i < list.length; i += 1) {
    if (tileKey(list[i]) === key) return { tile: list[i], folder: null, index: i };
    if (list[i]?.kind === "folder") {
      const inner = (list[i].tiles || []).findIndex((t) => tileKey(t) === key);
      if (inner >= 0) return { tile: list[i].tiles[inner], folder: list[i], index: inner };
    }
  }
  return null;
}

export function folders(tiles) {
  return (Array.isArray(tiles) ? tiles : []).filter((t) => t?.kind === "folder");
}

/** The folder an app sits in, by app id, or null. Used for picker labels. */
export function folderOfApp(tiles, id) {
  return folders(tiles).find((f) => (f.tiles || []).some((t) => t.kind === "app" && t.id === id)) || null;
}

/** Insert a leaf at the end of the dock, or at the end of a folder. */
function insertLeaf(list, tile, folderKey) {
  if (hasTile(list, tileKey(tile)) || countTiles(list) >= MAX_TILES) return list;
  if (!folderKey) return [...list, tile];
  const at = list.findIndex((t) => tileKey(t) === folderKey && t.kind === "folder");
  if (at < 0 || list[at].tiles.length >= MAX_FOLDER_TILES) return list;
  const next = [...list];
  next[at] = { ...list[at], tiles: [...list[at].tiles, tile] };
  return next;
}

/**
 * Append an app tile. Adding one that is already pinned is a no-op.
 * Pass a folder key to drop it straight into that folder.
 */
export function addAppTile(tiles, app, folderKey = "") {
  const list = toWireTiles(tiles);
  if (!app || typeof app !== "object" || !app.id || !app.target) return list;
  const tile = {
    kind: "app",
    id: app.id,
    target: app.target,
    label: app.name || app.label || app.id,
    args: app.args || "",
    icon: app.icon || "",
  };
  return insertLeaf(list, tile, folderKey);
}

/**
 * Append a control tile. Adding one that is already pinned is a no-op.
 * `value` is required for verbs that take one (volume-set, brightness-set) and
 * is stored on the tile so tapping it sends a complete control request.
 */
export function addControlTile(tiles, verb, label, value = null, folderKey = "") {
  const list = toWireTiles(tiles);
  if (typeof verb !== "string" || !verb) return list;
  const tile = { kind: "control", verb, label: label || verb };
  if (value !== null && value !== undefined) {
    if (!Number.isInteger(value)) return list;
    tile.value = value;
  }
  return insertLeaf(list, tile, folderKey);
}

/**
 * Remove the tile with this key, wherever it is. Removing a folder removes
 * everything in it, and a folder left empty disappears with its last tile.
 */
export function removeTile(tiles, key) {
  return toWireTiles(
    toWireTiles(tiles)
      .filter((t) => tileKey(t) !== key)
      .map((t) => (t.kind === "folder" ? { ...t, tiles: t.tiles.filter((c) => tileKey(c) !== key) } : t)),
  );
}

/** Short random id for a new folder, safe for the host's [a-z0-9-] rule. */
export function newFolderId(random = Math.random) {
  return "f" + Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
}

/**
 * Put a tile into a new folder that takes the tile's place on its page.
 * A tile that is already inside a folder is lifted out of it first.
 * At the folder limit nothing changes, matching what the host will accept.
 */
export function createFolder(tiles, key, label = "Folder", id = newFolderId()) {
  const list = toWireTiles(tiles);
  const found = findTile(list, key);
  if (!found || found.tile.kind === "folder" || hasTile(list, `folder:${id}`)) return list;
  if (folders(list).length >= MAX_FOLDERS) return list;
  const folder = { kind: "folder", id, label: String(label || "").trim().slice(0, 40) || "Folder", tiles: [found.tile] };
  if (!found.folder) return list.map((t) => (tileKey(t) === key ? folder : t));
  const without = removeTile(list, key);
  const at = without.findIndex((t) => tileKey(t) === tileKey(found.folder));
  const next = [...without];
  next.splice(at < 0 ? next.length : at + 1, 0, folder);
  return next;
}

/** Move a tile into an existing folder, from a page or from another folder. */
export function addToFolder(tiles, key, folderKey) {
  const list = toWireTiles(tiles);
  const found = findTile(list, key);
  const target = list.find((t) => tileKey(t) === folderKey && t.kind === "folder");
  if (!found || !target || found.tile.kind === "folder" || found.folder?.id === target.id) return list;
  if (target.tiles.length >= MAX_FOLDER_TILES) return list;
  // Removing first can drop an emptied source folder, so look the target up again.
  return removeTile(list, key).map((t) => (tileKey(t) === folderKey ? { ...t, tiles: [...t.tiles, found.tile] } : t));
}

/** Lift a tile out of its folder and place it right after that folder. */
export function takeOutOfFolder(tiles, key) {
  const list = toWireTiles(tiles);
  const found = findTile(list, key);
  if (!found?.folder) return list;
  const folderAt = list.findIndex((t) => tileKey(t) === tileKey(found.folder));
  const next = removeTile(list, key);
  const stillThere = next.findIndex((t) => tileKey(t) === tileKey(found.folder)) >= 0;
  next.splice(stillThere ? folderAt + 1 : folderAt, 0, found.tile);
  return next;
}

export function renameFolder(tiles, folderKey, label) {
  const name = String(label || "").trim().slice(0, 40);
  if (!name) return toWireTiles(tiles);
  return toWireTiles(tiles).map((t) => (tileKey(t) === folderKey && t.kind === "folder" ? { ...t, label: name } : t));
}

/** Dissolve a folder, putting its tiles back on the page where it stood. */
export function ungroupFolder(tiles, folderKey) {
  return toWireTiles(tiles).flatMap((t) => (tileKey(t) === folderKey && t.kind === "folder" ? t.tiles : [t]));
}

/**
 * Move a tile by `delta` positions, clamped to the list bounds.
 * Returns the list unchanged when the tile is absent or already at the edge.
 */
export function moveTile(tiles, key, delta) {
  const list = toWireTiles(tiles);
  const found = findTile(list, key);
  if (found?.folder) {
    // Inside a folder the move happens among that folder's tiles.
    const folderKey = tileKey(found.folder);
    return list.map((t) => (tileKey(t) === folderKey ? { ...t, tiles: moveTile(t.tiles, key, delta) } : t));
  }
  const from = list.findIndex((t) => tileKey(t) === key);
  if (from === -1 || !Number.isInteger(delta) || delta === 0) return list;
  const to = Math.min(list.length - 1, Math.max(0, from + delta));
  if (to === from) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The controls offered in the picker, grouped for a phone-sized list.
 * Verbs are advertised by the host in `state.verbs`; this catalogue supplies
 * the human labels and grouping, and any verb the host does not advertise is
 * filtered out rather than offered and then rejected.
 */
export const CONTROL_CATALOG = Object.freeze([
  {
    group: "Volume",
    items: [
      { verb: "volume-up", label: "Volume Up" },
      { verb: "volume-down", label: "Volume Down" },
      { verb: "mute-toggle", label: "Mute" },
      { verb: "volume-set", label: "Volume 25%", value: 25 },
      { verb: "volume-set", label: "Volume 50%", value: 50 },
      { verb: "volume-set", label: "Volume 75%", value: 75 },
    ],
  },
  {
    group: "Media",
    items: [
      { verb: "media-play-pause", label: "Play / Pause" },
      { verb: "media-next", label: "Next Track" },
      { verb: "media-previous", label: "Previous" },
      { verb: "media-stop", label: "Stop" },
    ],
  },
  {
    group: "Display",
    items: [
      { verb: "brightness-set", label: "Brightness 25%", value: 25 },
      { verb: "brightness-set", label: "Brightness 50%", value: 50 },
      { verb: "brightness-set", label: "Brightness 100%", value: 100 },
    ],
  },
  {
    group: "Power",
    items: [
      { verb: "lock", label: "Lock" },
      { verb: "sleep", label: "Sleep" },
      { verb: "restart", label: "Restart" },
      { verb: "shutdown", label: "Shut Down" },
    ],
  },
]);

/** Every DISTINCT verb this catalogue can offer, flattened. */
export function catalogVerbs() {
  return [...new Set(CONTROL_CATALOG.flatMap((g) => g.items.map((i) => i.verb)))];
}

/**
 * The catalogue narrowed to what the host actually advertises, with tiles the
 * user already pinned marked so the picker can show them as added.
 */
export function availableControls(advertised, tiles) {
  const allowed = new Set(Array.isArray(advertised) ? advertised : []);
  const list = toWireTiles(tiles);
  return CONTROL_CATALOG.map((group) => ({
    group: group.group,
    items: group.items
      .filter((item) => allowed.has(item.verb))
      .map((item) => ({
        ...item,
        pinned: hasTile(list, tileKey({ kind: "control", verb: item.verb, value: item.value })),
      })),
  })).filter((group) => group.items.length > 0);
}
