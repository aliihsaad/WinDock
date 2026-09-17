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
