import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { normalizeMac, magicPacket, broadcastAddresses, sendWake } from "../src/wake.js";
import { normalizeTiles, normalizeTile, createConfigStore, flattenTiles, MAX_MACRO_STEPS } from "../src/config.js";
import { addAppTile, addMacroTile, addWakeTile, groupTiles, ungroupTile, removeFromGroup, toWireTiles, tileKey } from "../public/tiles.js";
import { createApp } from "../server.js";

const t = createChecker("upgrades");

// ---- Wake-on-LAN packet ------------------------------------------------------
t.equal(normalizeMac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF", "dash MAC normalised");
t.equal(normalizeMac("aabbccddeeff"), "AA:BB:CC:DD:EE:FF", "bare MAC normalised");
for (const bad of [null, "", "aa:bb", "gg:bb:cc:dd:ee:ff", "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "aa:bb:cc:dd:ee:ff:00"])
  t.equal(normalizeMac(bad), null, "reject MAC " + JSON.stringify(bad));
const packet = magicPacket("AA:BB:CC:DD:EE:FF");
t.equal(packet.length, 102, "magic packet is 102 bytes");
t.ok(packet.subarray(0, 6).every((b) => b === 0xff), "starts with six 0xFF");
t.ok(Array.from({ length: 16 }, (_, i) => packet.subarray(6 + i * 6, 12 + i * 6).toString("hex")).every((h) => h === "aabbccddeeff"), "MAC repeated sixteen times");
t.throws(() => magicPacket("nope"), "invalid MAC cannot build a packet");
t.deepEqual(broadcastAddresses({
  eth0: [{ family: "IPv4", internal: false, address: "192.168.1.20", netmask: "255.255.255.0" }, { family: "IPv6", internal: false, address: "fe80::1", netmask: "ffff::" }],
  lo: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }],
}), ["255.255.255.255", "192.168.1.255"], "directed broadcast computed, loopback and IPv6 skipped");
const sent = [];
const fakeSocket = () => ({
  once() {}, bind(_port, cb) { cb(); }, setBroadcast() {}, close() { sent.push("closed"); },
  send(buf, port, address, cb) { sent.push([buf.length, port, address]); cb(null); },
});
const result = await sendWake("aa:bb:cc:dd:ee:ff", { createSocket: fakeSocket, addresses: ["255.255.255.255", "10.0.0.255"] });
t.equal(result.sent, 4, "sent to each address on ports 9 and 7");
t.deepEqual(sent.slice(0, 2), [[102, 9, "255.255.255.255"], [102, 7, "255.255.255.255"]], "packet sent to broadcast");
t.equal(sent.at(-1), "closed", "socket closed");

// ---- Tile schema -------------------------------------------------------------
const step = { type: "control", verb: "volume-set", value: 30 };
const macro = normalizeTile({ kind: "macro", id: "macro:abc123", label: "Study", steps: [{ type: "app", id: "notes", label: "Notes" }, { type: "wait", ms: 500 }, step] });
t.equal(macro.steps.length, 3, "macro keeps valid steps");
t.equal(normalizeTile({ kind: "macro", id: "macro:abc123", steps: [{ type: "control", verb: "shutdown" }] }), null, "macro cannot contain power verbs");
t.equal(normalizeTile({ kind: "macro", id: "macro:abc123", steps: [{ type: "control", verb: "lock" }, { type: "exec", cmd: "calc" }] }), null, "unknown and destructive steps dropped, empty macro rejected");
t.equal(normalizeTile({ kind: "macro", id: "macro:abc123", steps: [{ type: "control", verb: "volume-set", value: 500 }] }), null, "out-of-range value rejected");
t.equal(normalizeTile({ kind: "macro", id: "bad id!", steps: [step] }), null, "macro id pattern enforced");
t.equal(normalizeTile({ kind: "macro", id: "macro:abc123", steps: Array.from({ length: 4 }, () => ({ type: "wait", ms: 5000 })) }), null, "total wait time bounded");
t.equal(normalizeTile({ kind: "macro", id: "macro:abc123", steps: Array.from({ length: 30 }, () => ({ type: "control", verb: "mute-toggle" })) }).steps.length, MAX_MACRO_STEPS, "step count bounded");
t.equal(normalizeTile({ kind: "wake", mac: "aa-bb-cc-dd-ee-ff", label: "Desk" }).id, "wake:aabbccddeeff", "wake id derived from MAC, never trusted");
t.equal(normalizeTile({ kind: "wake", id: "wake:other", mac: "zz" }), null, "wake needs a valid MAC");

const app1 = { kind: "app", id: "notes", target: "notes.exe", label: "Notes", args: "", icon: "" };
const app2 = { kind: "app", id: "calc", target: "calc.exe", label: "Calc", args: "", icon: "" };
const group = normalizeTile({ kind: "group", id: "group:work01", label: "Work", items: [app1, app2, app1, { kind: "group", id: "group:inner1", items: [app1] }, { kind: "bogus" }] });
t.deepEqual(group.items.map((i) => i.id), ["notes", "calc"], "group de-duplicates and refuses nested groups and junk");
t.equal(normalizeTile({ kind: "group", id: "group:empty1", items: [] }), null, "empty group dropped");
t.equal(normalizeTiles([group, group]).length, 1, "duplicate group ids collapse");
t.deepEqual(flattenTiles([group, macro]).map((x) => x.id), ["group:work01", "notes", "calc", "macro:abc123"], "flatten exposes group items");

// ---- Browser-side tile helpers ----------------------------------------------
let tiles = addAppTile(addAppTile([], { id: "notes", target: "notes.exe", name: "Notes" }), { id: "calc", target: "calc.exe", name: "Calc" });
tiles = addMacroTile(tiles, "Study", macro.steps, "macro:abc123");
tiles = addWakeTile(tiles, "Laptop", "AA-BB-CC-DD-EE-FF");
t.equal(addWakeTile(tiles, "x", "nonsense").length, tiles.length, "bad MAC ignored by the UI helper");
t.equal(addMacroTile(tiles, "Empty", []).length, tiles.length, "empty macro ignored");
t.deepEqual(normalizeTiles(toWireTiles(tiles)).map(tileKey), tiles.map(tileKey), "new kinds survive a wire round trip");
const grouped = groupTiles(tiles, ["app:notes", "app:calc"], "Work", "group:work01");
t.deepEqual(grouped.map(tileKey), ["group:work01", "macro:abc123", "wake:aabbccddeeff"], "group replaces its tiles at the first position");
t.equal(grouped[0].items.length, 2, "group holds both apps");
t.deepEqual(ungroupTile(grouped, "group:work01").map(tileKey), tiles.map(tileKey), "ungroup restores the original order");
const partly = removeFromGroup(grouped, "group:work01", "app:calc");
t.deepEqual(partly.map(tileKey).slice(0, 2), ["group:work01", "app:calc"], "tile leaves the folder and lands after it");
const emptied = removeFromGroup(removeFromGroup(grouped, "group:work01", "app:calc"), "group:work01", "app:notes");
t.ok(!emptied.some((x) => x.kind === "group"), "emptied folder disappears");
t.equal(groupTiles(tiles, ["nothing"], "X").length, tiles.length, "grouping nothing changes nothing");

// ---- Host API ----------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "windock-upgrades-"));
const store = createConfigStore({ path: join(dir, "config.json") });
const calls = [];
const provider = {
  id: "test", displayName: "Test",
  listInstalledApps: async () => [{ id: "notes", name: "Notes", target: "notes.exe", source: "start" }],
  listRunningApps: async () => [{ id: "notes", pid: 7 }],
  launchApp: async (app) => { calls.push(["launch", app.id]); },
  focusApp: async () => {}, closeApp: async () => {},
  control: async (verb, value) => { calls.push(["control", verb, value]); },
  nowPlaying: async () => null, systemStats: async () => ({}),
};
const wakes = [];
const app = await createApp({ provider, configStore: store, pin: "572864", trustLoopback: false, wakeSender: async (mac) => { wakes.push(mac); return { sent: 2 }; } });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + app.server.address().port;
let cookie = "";
async function call(path, { method = "GET", body, auth = true } = {}) {
  const response = await fetch(base + path, { method, headers: { origin: base, ...(auth ? { cookie } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text };
}
try {
  const quick = normalizeTile({ kind: "macro", id: "macro:quick1", label: "Quick", steps: [{ type: "app", id: "notes", label: "Notes" }, { type: "wait", ms: 100 }, { type: "control", verb: "volume-set", value: 20 }] });
  const missing = normalizeTile({ kind: "macro", id: "macro:gone01", label: "Gone", steps: [{ type: "app", id: "removed", label: "Removed" }] });
  const wake = normalizeTile({ kind: "wake", mac: "aa:bb:cc:dd:ee:ff", label: "Laptop" });
  const inGroup = normalizeTile({ kind: "group", id: "group:box001", label: "Box", items: [normalizeTile({ kind: "wake", mac: "11:22:33:44:55:66", label: "Other" })] });
  await call("/api/auth", { method: "POST", body: { pin: "572864" }, auth: false });
  t.equal((await call("/api/macros/run", { method: "POST", body: { id: quick.id }, auth: false })).status, 401, "unpaired client cannot run macros");
  t.equal((await call("/api/wake", { method: "POST", body: { id: wake.id }, auth: false })).status, 401, "unpaired client cannot wake");
  t.equal((await call("/api/tiles", { method: "PUT", body: { tiles: [quick, missing, wake, inGroup] } })).status, 200, "tiles with new kinds saved");
  store.invalidate();
  t.deepEqual((await store.load()).tiles.map(tileKey), ["macro:quick1", "macro:gone01", "wake:aabbccddeeff", "group:box001"], "disk reload keeps the new tile kinds");
  const run = await call("/api/macros/run", { method: "POST", body: { id: quick.id } });
  t.equal(run.status, 200, "macro runs");
  t.deepEqual(calls, [["launch", "notes"], ["control", "volume-set", 20]], "steps ran in order through the provider");
  t.equal((await call("/api/macros/run", { method: "POST", body: { id: missing.id } })).status, 404, "missing app stops the macro with a clear error");
  t.equal((await call("/api/macros/run", { method: "POST", body: { id: "macro:nope00" } })).status, 404, "unknown macro rejected");
  t.equal((await call("/api/wake", { method: "POST", body: { id: wake.id } })).status, 200, "wake tile sends a packet");
  t.deepEqual(wakes, ["AA:BB:CC:DD:EE:FF"], "stored MAC was used");
  t.equal((await call("/api/wake", { method: "POST", body: { id: "wake:665544332211" } })).status, 404, "phone cannot wake an arbitrary MAC");
  t.equal((await call("/api/wake", { method: "POST", body: { id: "wake:112233445566" } })).status, 200, "wake tile inside a folder still works");
  const state = (await call("/api/state")).json;
  t.deepEqual(state.tiles.map((x) => x.kind), ["macro", "macro", "wake", "group"], "state exposes new kinds");
} finally {
  app.hub.close(); app.inputHub.close(); app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
t.done("upgrades verification passed");
