/** G15: tiles can be added, removed and reordered from the dock UI. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import {
  tileKey,
  toWireTiles,
  hasTile,
  addAppTile,
  addControlTile,
  removeTile,
  moveTile,
  availableControls,
  catalogVerbs,
  CONTROL_CATALOG,
} from "../public/tiles.js";
import { renderTiles, renderTile, renderControlPicker } from "../public/dock.js";
import { CONTROL_VERBS, verbTakesValue } from "../src/platform/contract.js";
import { normalizeTile } from "../src/config.js";
import { createApp } from "../server.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createConfigStore } from "../src/config.js";

const t = createChecker("editing");
const APP = { id: "c:/a.exe", target: "C:\\A.exe", name: "Alpha" };
const APP2 = { id: "c:/b.exe", target: "C:\\B.exe", name: "Beta" };

// ---- keys ----
t.equal(tileKey({ kind: "control", verb: "lock" }), "control:lock", "control tiles key on their verb");
t.equal(tileKey({ kind: "app", id: "c:/a.exe" }), "app:c:/a.exe", "app tiles key on their id");
t.equal(tileKey(null), "", "a null tile has no key");

// ---- add ----
let tiles = addAppTile([], APP);
t.equal(tiles.length, 1, "an app tile is added to an empty dock");
t.equal(tiles[0].label, "Alpha", "the app name becomes the tile label");
t.equal(tiles[0].kind, "app", "the added tile is an app tile");
t.deepEqual(addAppTile(tiles, APP), tiles, "adding the same app twice is a no-op");
t.deepEqual(addAppTile(tiles, { id: "", target: "" }), tiles, "an invalid app is not added");
t.deepEqual(addAppTile(tiles, null), tiles, "a null app is not added");

tiles = addControlTile(tiles, "mute-toggle", "Mute");
t.equal(tiles.length, 2, "a control tile is added alongside app tiles");
t.equal(tiles[1].kind, "control", "the added control tile has the control kind");
t.equal(tiles[1].verb, "mute-toggle", "the control tile carries its verb");
t.deepEqual(addControlTile(tiles, "mute-toggle", "Mute"), tiles, "adding the same control twice is a no-op");
t.deepEqual(addControlTile(tiles, "", "x"), tiles, "an empty verb is not added");

// Immutability: the helpers must never mutate the caller's array.
const original = [...tiles];
addAppTile(tiles, APP2);
removeTile(tiles, "app:c:/a.exe");
moveTile(tiles, "app:c:/a.exe", 1);
t.deepEqual(tiles, original, "editing helpers never mutate their input");

// ---- remove ----
const removed = removeTile(tiles, "app:c:/a.exe");
t.equal(removed.length, 1, "removing a tile shortens the dock");
t.ok(!hasTile(removed, "app:c:/a.exe"), "the removed tile is gone");
t.ok(hasTile(removed, "control:mute-toggle"), "the other tile survives removal");
t.deepEqual(removeTile(tiles, "app:nope"), toWireTiles(tiles), "removing an absent key is a no-op");
t.deepEqual(removeTile([], "x"), [], "removing from an empty dock is safe");

// ---- reorder ----
let three = addAppTile(addControlTile(addAppTile([], APP), "lock", "Lock"), APP2);
t.deepEqual(three.map(tileKey), ["app:c:/a.exe", "control:lock", "app:c:/b.exe"], "initial order is insertion order");

t.deepEqual(
  moveTile(three, "app:c:/b.exe", -1).map(tileKey),
  ["app:c:/a.exe", "app:c:/b.exe", "control:lock"],
  "a tile moves one place earlier",
);
t.deepEqual(
  moveTile(three, "app:c:/a.exe", 1).map(tileKey),
  ["control:lock", "app:c:/a.exe", "app:c:/b.exe"],
  "a tile moves one place later",
);
t.deepEqual(moveTile(three, "app:c:/a.exe", -1).map(tileKey), three.map(tileKey), "the first tile cannot move earlier");
t.deepEqual(moveTile(three, "app:c:/b.exe", 1).map(tileKey), three.map(tileKey), "the last tile cannot move later");
t.deepEqual(moveTile(three, "nope", 1).map(tileKey), three.map(tileKey), "moving an absent tile is a no-op");
t.deepEqual(moveTile(three, "app:c:/a.exe", 0).map(tileKey), three.map(tileKey), "a zero move is a no-op");
t.deepEqual(
  moveTile(three, "app:c:/a.exe", 99).map(tileKey),
  ["control:lock", "app:c:/b.exe", "app:c:/a.exe"],
  "an oversized move clamps to the end",
);

// ---- wire format ----
const wire = toWireTiles([{ kind: "app", id: "x", target: "t", label: "L", running: true, bogus: 1 }]);
t.equal(wire[0].running, undefined, "the runtime running flag is stripped before saving");
t.equal(wire[0].bogus, undefined, "unknown fields are stripped before saving");
t.equal(wire[0].id, "x", "the id survives the wire conversion");
t.deepEqual(toWireTiles([{ kind: "nope" }, null, 7]), [], "junk entries are dropped from the wire format");

// ---- catalogue ----
const verbs = catalogVerbs();
t.deepEqual(
  CONTROL_VERBS.filter((v) => !verbs.includes(v)),
  [],
  "every host control verb is offered by the picker catalogue",
);
t.deepEqual(
  verbs.filter((v) => !CONTROL_VERBS.includes(v)),
  [],
  "the catalogue offers no verb the host does not implement",
);
t.equal(new Set(verbs).size, verbs.length, "no verb appears twice in the catalogue");
t.ok(CONTROL_CATALOG.length >= 4, "the catalogue is grouped for a phone-sized list");

const groups = availableControls(CONTROL_VERBS, [{ kind: "control", verb: "lock", label: "Lock" }]);
const flat = groups.flatMap((g) => g.items);
t.ok(flat.length >= CONTROL_VERBS.length, `every verb is represented (${flat.length} entries)`);
t.equal(flat.find((i) => i.verb === "lock").pinned, true, "an already-pinned control is marked pinned");
t.equal(flat.find((i) => i.verb === "sleep").pinned, false, "an unpinned control is not marked pinned");

// Valued verbs MUST ship a value in the catalogue. A valueless entry would
// render a tile whose tap sends an incomplete request the host rejects.
for (const verb of CONTROL_VERBS.filter(verbTakesValue)) {
  const entries = flat.filter((i) => i.verb === verb);
  t.ok(entries.length > 0, `${verb} is offered in the picker`);
  t.ok(
    entries.every((e) => Number.isInteger(e.value)),
    `${verb} picker entries all carry an integer value`,
  );
}
// Valueless verbs must NOT carry one.
for (const verb of CONTROL_VERBS.filter((v) => !verbTakesValue(v))) {
  t.ok(
    flat.filter((i) => i.verb === verb).every((e) => e.value === undefined),
    `${verb} picker entries carry no value`,
  );
}

// Two presets of the same verb are distinct tiles, not a collision.
const twoVolumes = addControlTile(addControlTile([], "volume-set", "Volume 25%", 25), "volume-set", "Volume 75%", 75);
t.equal(twoVolumes.length, 2, "two presets of one verb coexist as separate tiles");
t.deepEqual(
  twoVolumes.map(tileKey),
  ["control:volume-set:25", "control:volume-set:75"],
  "valued tiles key on verb and value",
);
t.deepEqual(
  addControlTile(twoVolumes, "volume-set", "Volume 25%", 25),
  twoVolumes,
  "re-adding an identical preset is a no-op",
);
t.equal(addControlTile([], "volume-set", "x", 1.5).length, 0, "a non-integer value is refused");

// Pinned marking must be value-aware.
const pinnedVolume = availableControls(CONTROL_VERBS, twoVolumes).flatMap((g) => g.items);
t.equal(pinnedVolume.find((i) => i.verb === "volume-set" && i.value === 25).pinned, true,
  "the pinned volume preset is marked pinned");
t.equal(pinnedVolume.find((i) => i.verb === "volume-set" && i.value === 50).pinned, false,
  "an unpinned preset of the same verb is not marked pinned");

// ---- the original defect: a valued verb with no value must be rejected ----
t.equal(normalizeTile({ kind: "control", verb: "brightness-set", label: "B" }), null,
  "a valued verb with no value is rejected by the host (regression: it used to be accepted)");
t.equal(normalizeTile({ kind: "control", verb: "volume-set", label: "V" }), null,
  "volume-set with no value is rejected");
t.equal(normalizeTile({ kind: "control", verb: "volume-set", value: 500 }), null,
  "an out-of-range value is rejected");
t.equal(normalizeTile({ kind: "control", verb: "volume-set", value: 12.5 }), null,
  "a fractional value is rejected");
t.equal(normalizeTile({ kind: "control", verb: "lock", value: 50 }), null,
  "a valueless verb carrying a value is rejected");
const okValued = normalizeTile({ kind: "control", verb: "volume-set", value: 40, label: "V40" });
t.ok(okValued && okValued.value === 40, "positive control: a correctly valued tile is accepted");
const okPlain = normalizeTile({ kind: "control", verb: "lock", label: "Lock" });
t.ok(okPlain && okPlain.value === undefined, "positive control: a valueless verb is accepted without a value");

// ---- rendering ----
const view = { tiles: three };
const normal = renderTiles(view);
t.ok(!normal.includes('data-action="remove"'), "the normal dock shows no remove buttons");
t.ok(normal.includes('data-action="launch"'), "the normal dock shows launch actions");

const edit = renderTiles(view, { editing: true });
t.equal((edit.match(/data-action="remove"/g) || []).length, 3, "every tile gets a remove button when editing");
t.equal((edit.match(/data-action="move-up"/g) || []).length, 3, "every tile gets a move-up button when editing");
t.ok(!edit.includes('data-action="launch"'), "editing mode removes launch actions so a tap cannot fire one");
t.ok(!edit.includes('data-action="control"'), "editing mode removes control actions");
t.equal((edit.match(/disabled/g) || []).length, 2, "the first and last tiles have one disabled move each");
t.ok(edit.includes("is-editing"), "editing tiles carry the editing class");

const single = renderTile({ kind: "app", id: "x", label: "X" }, { editing: true, first: true, last: true });
t.equal((single.match(/disabled/g) || []).length, 2, "a lone tile cannot move in either direction");

const pickerHtml = renderControlPicker(groups);
t.ok(pickerHtml.includes('data-verb="lock"'), "the control picker renders verbs");
t.ok(pickerHtml.includes("picker__group"), "the control picker renders group headings");
t.ok(/data-verb="lock"[^>]*disabled/.test(pickerHtml), "an already-pinned control is disabled in the picker");
t.equal(renderControlPicker([]), '<li class="picker__empty">No controls available.</li>', "an empty catalogue renders an empty state");
t.equal(renderControlPicker(null), '<li class="picker__empty">No controls available.</li>', "a null catalogue renders an empty state");

// XSS: labels reach the picker and the dock.
const hostile = renderControlPicker([{ group: '<img src=x onerror="a()">', items: [] }]);
t.ok(!hostile.includes("<img"), "a hostile group name cannot inject an element");

// ---- the host accepts an edited list end to end ----
const provider = createWindowsProvider({
  helperPath: "H.exe",
  exec: async (file, args) => {
    if (file === "H.exe") return { stdout: "" };
    const script = args[args.length - 1];
    if (script.includes("MainWindowHandle")) return { stdout: "[]" };
    if (script.includes("WScript.Shell")) return { stdout: "[]" };
    return { stdout: "{}" };
  },
});
const dir = await mkdtemp(join(tmpdir(), "windock-edit-"));
const configStore = createConfigStore({ path: join(dir, "config.json") });
const app = await createApp({ provider, configStore, pin: "1111", trustLoopback: true });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;

const put = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: toWireTiles(three) }),
});
t.equal(put.status, 200, "the host accepts an edited tile list");
const saved = await put.json();
t.deepEqual(saved.tiles.map(tileKey), three.map(tileKey), "the host persists the exact order sent");

const reordered = moveTile(three, "app:c:/b.exe", -1);
const put2 = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: toWireTiles(reordered) }),
});
t.equal(put2.status, 200, "the host accepts a reordered list");
t.deepEqual((await put2.json()).tiles.map(tileKey), reordered.map(tileKey), "the new order round-trips");

const emptied = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: [] }),
});
t.equal(emptied.status, 200, "the host accepts removing every tile");
t.equal((await emptied.json()).tiles.length, 0, "an emptied dock persists as empty");

app.server.closeAllConnections?.();
await app.hub.close();
await new Promise((r) => app.server.close(r));
await rm(dir, { recursive: true, force: true });

t.done("editing verification passed");
