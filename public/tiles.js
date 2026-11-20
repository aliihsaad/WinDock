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
export function tileKey(tile) {
  if (!tile || typeof tile !== "object") return "";
  // Macro, folder and wake ids already carry their own prefix ("macro:…").
  if (["macro", "group", "wake", "tool"].includes(tile.kind)) return tile.id;
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
      if (tile.kind === "macro") return { kind: "macro", id: tile.id, label: tile.label, steps: tile.steps };
      if (tile.kind === "tool") return { kind: "tool", id: tile.id, label: tile.label };
      if (tile.kind === "wake") return { kind: "wake", id: tile.id, mac: tile.mac, label: tile.label };
      if (tile.kind === "group") return { kind: "group", id: tile.id, label: tile.label, items: toWireTiles(tile.items) };
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

export function hasTile(tiles, key) {
  return (Array.isArray(tiles) ? tiles : []).some((t) => tileKey(t) === key);
}

/** Append an app tile. Adding one that is already pinned is a no-op. */
export function addAppTile(tiles, app) {
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
  if (hasTile(list, tileKey(tile))) return list;
  return [...list, tile];
}

/**
 * Append a control tile. Adding one that is already pinned is a no-op.
 * `value` is required for verbs that take one (volume-set, brightness-set) and
 * is stored on the tile so tapping it sends a complete control request.
 */
export function addControlTile(tiles, verb, label, value = null) {
  const list = toWireTiles(tiles);
  if (typeof verb !== "string" || !verb) return list;
  const tile = { kind: "control", verb, label: label || verb };
  if (value !== null && value !== undefined) {
    if (!Number.isInteger(value)) return list;
    tile.value = value;
  }
  if (hasTile(list, tileKey(tile))) return list;
  return [...list, tile];
}

/** Remove the tile with this key. Removing an absent key is a no-op. */
export function removeTile(tiles, key) {
  return toWireTiles(tiles).filter((t) => tileKey(t) !== key);
}

/**
 * Move a tile by `delta` positions, clamped to the list bounds.
 * Returns the list unchanged when the tile is absent or already at the edge.
 */
export function moveTile(tiles, key, delta) {
  const list = toWireTiles(tiles);
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

/** Random id for a new macro or dock folder, matching the host's id pattern. */
export function newTileId(prefix, random = () => Math.random().toString(36).slice(2, 10)) {
  return `${prefix}:${random().replace(/[^a-z0-9]/g, "").slice(0, 12).padEnd(6, "0")}`;
}

/** Append a macro made of {type: "app"|"control"|"wait"} steps. Empty step lists are ignored. */
export function addMacroTile(tiles, label, steps, id = newTileId("macro")) {
  const list = toWireTiles(tiles);
  if (!Array.isArray(steps) || steps.length === 0) return list;
  const tile = { kind: "macro", id, label: String(label || "").trim() || "Macro", steps };
  return hasTile(list, tileKey(tile)) ? list : [...list, tile];
}

/** Append a Wake-on-LAN tile for a MAC address typed as aa:bb:cc:dd:ee:ff or aa-bb-... */
export function addWakeTile(tiles, label, mac) {
  const list = toWireTiles(tiles);
  const hex = String(mac || "").trim().replace(/[:-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex) || /^0+$/.test(hex) || /^f+$/.test(hex)) return list;
  const tile = { kind: "wake", id: `wake:${hex}`, mac: hex.match(/../g).join(":").toUpperCase(), label: String(label || "").trim() || "Wake PC" };
  return hasTile(list, tileKey(tile)) ? list : [...list, tile];
}

/**
 * Move the tiles named by `keys` into a new dock folder at the first one's position.
 * Folders cannot contain folders; fewer than one eligible tile changes nothing.
 */
export function groupTiles(tiles, keys, label, id = newTileId("group")) {
  const list = toWireTiles(tiles);
  const wanted = new Set(keys || []);
  const picked = list.filter((t) => wanted.has(tileKey(t)) && t.kind !== "group");
  if (!picked.length) return list;
  const group = { kind: "group", id, label: String(label || "").trim() || "Folder", items: picked };
  const first = list.findIndex((t) => wanted.has(tileKey(t)) && t.kind !== "group");
  const rest = list.filter((t) => !picked.includes(t));
  rest.splice(Math.min(first, rest.length), 0, group);
  return rest;
}

/** Dissolve a dock folder back into its tiles at the same position. */
export function ungroupTile(tiles, key) {
  const list = toWireTiles(tiles);
  const at = list.findIndex((t) => tileKey(t) === key && t.kind === "group");
  if (at === -1) return list;
  const have = new Set(list.map(tileKey));
  const items = list[at].items.filter((item) => !have.has(tileKey(item)));
  return [...list.slice(0, at), ...items, ...list.slice(at + 1)];
}

/** Take one tile out of a dock folder and put it on the dock after the folder. An emptied folder is removed. */
export function removeFromGroup(tiles, groupKey, itemKey) {
  const list = toWireTiles(tiles);
  const at = list.findIndex((t) => tileKey(t) === groupKey && t.kind === "group");
  if (at === -1) return list;
  const group = list[at];
  const item = group.items.find((i) => tileKey(i) === itemKey);
  if (!item) return list;
  const items = group.items.filter((i) => i !== item);
  const out = [...list];
  out.splice(at, 1, ...(items.length ? [{ ...group, items }] : []));
  if (!out.some((t) => tileKey(t) === tileKey(item))) out.splice(at + (items.length ? 1 : 0), 0, item);
  return out;
}

/** The built-in "PC control on phone Tara" tile; added once, not duplicated. */
export function addPhoneControlTile(tiles) {
  const list = toWireTiles(tiles);
  const tile = { kind: "tool", id: "tool:phone-control", label: "PC control on phone Tara" };
  return hasTile(list, tileKey(tile)) ? list : [tile, ...list];
}
