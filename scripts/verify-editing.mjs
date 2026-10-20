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
  flattenTiles,
  countTiles,
  findTile,
  folderOfApp,
  createFolder,
  addToFolder,
  takeOutOfFolder,
  renameFolder,
  ungroupFolder,
  newFolderId,
  MAX_TILES as CLIENT_MAX_TILES,
  MAX_FOLDERS as CLIENT_MAX_FOLDERS,
  MAX_FOLDER_TILES as CLIENT_MAX_FOLDER_TILES,
} from "../public/tiles.js";
import { renderTiles, renderTile, renderControlPicker, renderFolderGrid } from "../public/dock.js";
import { CONTROL_VERBS, verbTakesValue } from "../src/platform/contract.js";
import { normalizeTile, normalizeTiles, MAX_TILES, MAX_FOLDERS, MAX_FOLDER_TILES } from "../src/config.js";
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
const app = await createApp({ provider, configStore, pin: "111111", trustLoopback: true });
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

// ---- folders over the wire ----
let grouped = createFolder(three, "app:c:/a.exe", "Work", "f-work");
grouped = addToFolder(grouped, "app:c:/b.exe", "folder:f-work");
const put3 = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: toWireTiles(grouped) }),
});
t.equal(put3.status, 200, "the host accepts a dock with a folder");
const savedFolder = (await put3.json()).tiles;
t.equal(savedFolder[0].kind, "folder", "the folder round-trips");
t.deepEqual(savedFolder[0].tiles.map(tileKey), ["app:c:/a.exe", "app:c:/b.exe"], "folder contents round-trip in order");
const stateRes = await (await fetch(`${base}/api/state`)).json();
t.equal(typeof stateRes.tiles[0].tiles[0].running, "boolean", "apps inside folders get live running state");

// ---- folder limit over the wire: nothing is silently dropped ----
// A 41st folder placed before the others used to make the host keep the first
// 40 it saw, losing the last existing folder and the apps inside it.
const full = Array.from({ length: MAX_FOLDERS }, (_, i) => ({ kind: "folder", id: `f${i}`, label: `F${i}`, tiles: [{ kind: "app", id: `x${i}`, target: `X${i}` }] }));
const putFull = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: full }),
});
t.equal(putFull.status, 200, "the host accepts exactly the folder limit");
await putFull.arrayBuffer();
const extra = { kind: "folder", id: "f-new", label: "New", tiles: [{ kind: "app", id: "y", target: "Y" }] };
const putOver = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: [extra, ...full] }),
});
t.equal(putOver.status, 400, "one folder too many is refused instead of trimmed");
t.ok((await putOver.json()).error.includes(String(MAX_FOLDERS)), "the refusal names the folder limit");
const afterOver = (await (await fetch(`${base}/api/state`)).json()).tiles;
t.deepEqual(afterOver.map(tileKey), full.map(tileKey), "a refused save leaves every existing folder in place");
const tooManyInside = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: [{ kind: "folder", id: "big", tiles: Array.from({ length: MAX_FOLDER_TILES + 1 }, (_, i) => ({ kind: "app", id: `z${i}`, target: `Z${i}` })) }] }),
});
t.equal(tooManyInside.status, 400, "an overfull folder is refused instead of trimmed");
await tooManyInside.arrayBuffer();
const tooManyTiles = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ tiles: Array.from({ length: MAX_TILES + 1 }, (_, i) => ({ kind: "app", id: `w${i}`, target: `W${i}` })) }),
});
t.equal(tooManyTiles.status, 400, "a dock over the tile limit is refused instead of trimmed");
await tooManyTiles.arrayBuffer();

app.server.closeAllConnections?.();
await app.hub.close();
await new Promise((r) => app.server.close(r));
await rm(dir, { recursive: true, force: true });

// ---- folders: pure helpers ----
{
  const A = { id: "a", target: "A", name: "A" }, B = { id: "b", target: "B", name: "B" }, C = { id: "c", target: "C", name: "C" };
  let dock = addAppTile(addAppTile(addAppTile([], A), B), C);
  const before = toWireTiles(dock);
  let f = createFolder(dock, "app:a", "Work", "f1");
  t.deepEqual(dock, before, "createFolder never mutates its input");
  t.equal(f[0].kind, "folder", "a new folder takes the tile's place");
  t.deepEqual(f[0].tiles.map(tileKey), ["app:a"], "the tile moves inside the new folder");
  t.equal(countTiles(f), 3, "folders don't change the tile count");
  f = addToFolder(f, "app:c", "folder:f1");
  t.deepEqual(f.map(tileKey), ["folder:f1", "app:b"], "a tile moved into a folder leaves its page");
  t.equal(folderOfApp(f, "c")?.label, "Work", "the picker can tell which folder an app is in");
  t.ok(hasTile(f, "app:c"), "hasTile looks inside folders");
  t.deepEqual(addAppTile(f, C), f, "an app inside a folder can't be added again");
  t.deepEqual(addAppTile(f, { id: "d", target: "D", name: "D" }, "folder:f1")[0].tiles.map(tileKey), ["app:a", "app:c", "app:d"], "the picker can add straight into a folder");
  t.deepEqual(moveTile(f, "app:c", -1)[0].tiles.map(tileKey), ["app:c", "app:a"], "moving inside a folder reorders the folder");
  t.deepEqual(takeOutOfFolder(f, "app:a").map(tileKey), ["folder:f1", "app:a", "app:b"], "a tile taken out lands right after its folder");
  t.deepEqual(takeOutOfFolder(takeOutOfFolder(f, "app:a"), "app:c").map(tileKey), ["app:c", "app:a", "app:b"], "taking out the last tile removes the empty folder");
  t.deepEqual(removeTile(f, "app:a")[0].tiles.map(tileKey), ["app:c"], "removing a tile inside a folder works");
  t.deepEqual(removeTile(f, "folder:f1").map(tileKey), ["app:b"], "removing a folder removes what is in it");
  t.equal(renameFolder(f, "folder:f1", "  Games  ")[0].label, "Games", "folders can be renamed");
  t.equal(renameFolder(f, "folder:f1", "   ")[0].label, "Work", "a blank name is ignored");
  t.deepEqual(ungroupFolder(f, "folder:f1").map(tileKey), ["app:a", "app:c", "app:b"], "ungrouping puts tiles back where the folder stood");
  const two = addToFolder(createFolder(f, "app:b", "Other", "f2"), "app:a", "folder:f2");
  t.deepEqual(two.map((x) => x.tiles.map(tileKey)), [["app:c"], ["app:b", "app:a"]], "tiles can move between folders");
  t.deepEqual(createFolder(f, "app:c", "Sub", "f3").map(tileKey), ["folder:f1", "folder:f3", "app:b"], "making a folder from a folder's tile lifts it out first");
  t.deepEqual(createFolder(f, "folder:f1", "Nested", "f4"), toWireTiles(f), "folders can't go inside folders");
  t.equal(findTile(f, "app:c").folder.id, "f1", "findTile reports the containing folder");
  t.equal(flattenTiles(f).length, 3, "flattenTiles lists every leaf");
  t.ok(/^[a-z0-9-]{1,32}$/.test(newFolderId()), "generated folder ids match the host's rule");
  t.equal(CLIENT_MAX_TILES, MAX_TILES, "phone and host agree on the tile limit");
  t.equal(CLIENT_MAX_FOLDERS, MAX_FOLDERS, "phone and host agree on the folder limit");
  t.equal(CLIENT_MAX_FOLDER_TILES, MAX_FOLDER_TILES, "phone and host agree on the folder size limit");
  const atLimit = Array.from({ length: MAX_FOLDERS }, (_, i) => ({ kind: "folder", id: `g${i}`, label: `G${i}`, tiles: [{ kind: "app", id: `g${i}`, target: "G", label: "G" }] }));
  const withLoose = [{ kind: "app", id: "loose", target: "L", label: "L" }, ...atLimit];
  t.deepEqual(createFolder(withLoose, "app:loose", "One more", "g-new"), toWireTiles(withLoose), "the phone won't create a folder past the limit");
}

// ---- folders: rendering ----
{
  const evil = { kind: "folder", id: "f1", label: '<img src=x onerror="alert(1)">', tiles: [{ kind: "app", id: "a", target: "A", label: "A", running: true }, { kind: "control", verb: "lock", label: "Lock" }] };
  const html = renderTile(evil, { launcher: true });
  t.ok(!html.includes("<img src=x"), "a hostile folder name is escaped");
  t.ok(html.includes('data-action="folder"') && html.includes('data-tile-key="folder:f1"'), "a folder tile opens the folder and is draggable");
  t.ok(html.includes("is-running"), "a folder shows a running dot when an app inside is running");
  t.ok(renderTile(evil, { launcher: true, editing: true }).includes('data-action="folder-edit"'), "in arrange mode a folder opens for arranging");
  t.equal((html.match(/folder-mini__cell/g) || []).length, 2, "the preview shows the folder's icons");
  t.ok(renderFolderGrid(evil).includes('data-action="launch"'), "apps inside an open folder launch on tap");
  t.ok(renderFolderGrid({ tiles: [] }).includes("empty"), "an empty folder shows a hint");
}

// ---- folders: host validation ----
{
  const leaf = (i) => ({ kind: "app", id: `x${i}`, target: `X${i}` });
  t.equal(normalizeTile({ kind: "folder", id: "f1", tiles: [leaf(1)] }), null, "a folder can't sneak in through normalizeTile");
  const nested = normalizeTiles([{ kind: "folder", id: "f1", label: "Out", tiles: [leaf(1), { kind: "folder", id: "f2", tiles: [leaf(2)] }] }]);
  t.deepEqual(nested[0].tiles.map((x) => x.id), ["x1"], "a folder inside a folder is dropped");
  t.equal(normalizeTiles([{ kind: "folder", id: "f1", tiles: [] }]).length, 0, "an empty folder is dropped");
  t.equal(normalizeTiles([{ kind: "folder", id: "BAD ID", tiles: [leaf(1)] }]).length, 0, "a folder id outside [a-z0-9-] is dropped");
  t.equal(normalizeTiles([{ kind: "folder", id: "f1", tiles: [leaf(1)] }])[0].label, "Folder", "a nameless folder gets a default name");
  t.equal(normalizeTiles([{ kind: "folder", id: "f1", label: "x".repeat(99), tiles: [leaf(1)] }])[0].label.length, 40, "folder names are capped");
  const dupes = normalizeTiles([leaf(1), { kind: "folder", id: "f1", tiles: [leaf(1), leaf(2)] }, { kind: "folder", id: "f1", tiles: [leaf(3)] }]);
  t.deepEqual(dupes.map((x) => x.kind === "folder" ? x.tiles.map((c) => c.id) : x.id), ["x1", ["x2"]], "keys stay unique across folders and duplicate folder ids are dropped");
  const many = normalizeTiles([...Array.from({ length: 150 }, (_, i) => leaf(i)), { kind: "folder", id: "f1", tiles: Array.from({ length: 80 }, (_, i) => leaf(1000 + i)) }]);
  t.equal(many.at(-1).tiles.length, Math.min(MAX_FOLDER_TILES, MAX_TILES - 150), "folder contents count toward the tile limit");
  t.ok(flattenTiles(many).length <= MAX_TILES, "the whole dock stays within the tile limit");
  const lots = normalizeTiles(Array.from({ length: MAX_FOLDERS + 5 }, (_, i) => ({ kind: "folder", id: `f${i}`, tiles: [leaf(i)] })));
  t.equal(lots.length, MAX_FOLDERS, "the number of folders is capped");
  t.equal(normalizeTiles(Array.from({ length: 300 }, (_, i) => leaf(i))).length, MAX_TILES, "a flat dock is capped at the tile limit");
}

t.done("editing verification passed");
