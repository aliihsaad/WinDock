import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { normalizeLayout, renderPages, pageCount, moveToTile } from "../public/launcher.js";
import { tileKey } from "../public/tiles.js";
import { createIconCache } from "../src/icons.js";
import { createApp } from "../server.js";
import { createConfigStore } from "../src/config.js";
import { createWindowsProvider } from "../src/platform/windows.js";

const t = createChecker("launcher");
const layout = normalizeLayout({ perPage: 8 });
t.equal(normalizeLayout(null).perPage, 4, "new docks default to four large icons");
t.deepEqual(normalizeLayout({ columns: -1, rows: 100, iconSize: "script" }), normalizeLayout(), "invalid stored settings cannot break the grid");
for (const count of [4, 6, 8]) {
  const preference = normalizeLayout({ perPage: count });
  t.equal(preference.columns, count / 2, `${count} icons use the requested number of columns`);
  t.equal(preference.rows, 2, `${count} icons use two rows`);
}
t.ok(normalizeLayout({ perPage: 4 }).iconSize > normalizeLayout({ perPage: 6 }).iconSize && normalizeLayout({ perPage: 6 }).iconSize > layout.iconSize, "icons become smaller as density increases");
t.equal(normalizeLayout({ columns: 4, rows: 2 }).perPage, 8, "old eight-icon layouts migrate without changing capacity");
t.equal(normalizeLayout({ columns: 6, rows: 2 }).columns, 2, "old unsupported layouts reset to the spacious preset");
t.equal(normalizeLayout({ background: 'url(https://example.com)', theme: 'unknown' }).background, 'aurora', "background settings only accept bundled scenes");
const preference = normalizeLayout({ perPage: 6, immersive: false, showLabels: true, background: 'dusk', theme: 'frost' });
t.deepEqual(normalizeLayout(JSON.parse(JSON.stringify(preference))), preference, "appearance and mode preferences survive storage round trips");
t.equal(normalizeLayout().showLabels, false, "immersive mode starts without app names");
t.equal(normalizeLayout().immersive, true, "immersive mode is enabled by default");
const tiles = Array.from({ length: 17 }, (_, i) => ({ kind: "app", id: `c:/apps/${i}.exe`, target: `C:\\Apps\\${i}.exe`, label: `App ${i}` }));
t.equal(pageCount(tiles, layout), 3, "overflow creates a partially populated third page");
t.equal(pageCount([], layout), 1, "empty dock keeps one page");
const markup = renderPages({ tiles }, layout, true);
t.equal((markup.match(/class="dock-page"/g) || []).length, 3, "all pages render");
t.equal((markup.match(/data-action="options"/g) || []).length, 17, "every editing tile opens options");
t.ok(!markup.includes('data-action="launch"'), "editing tiles cannot dispatch launch");
const reordered = moveToTile(tiles, tileKey(tiles[1]), tileKey(tiles[12]));
t.equal(reordered[12].id, tiles[1].id, "dragging across pages moves to the destination");
t.equal(tiles[1].id, "c:/apps/1.exe", "a canceled drag can restore the untouched original list");
t.equal(new Set(reordered.map(tileKey)).size, 17, "cross-page moves never duplicate or drop an app");
t.deepEqual(moveToTile(tiles, "missing", tileKey(tiles[0])), tiles, "a stale drag key is ignored");

let active = 0, peak = 0, calls = 0;
const iconCache = createIconCache({ appIcon: async () => { active++; calls++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return Buffer.from("icon"); } });
await Promise.all([...tiles, tiles[0]].map(iconCache));
t.equal(calls, 17, "simultaneous duplicate icon requests share extraction");
t.ok(peak <= 3, "large libraries limit native extraction concurrency");
t.equal((await createIconCache({ appIcon: async () => { throw new Error("missing resource"); } })(tiles[0])), null, "missing resource is a graceful fallback");

const png = await readFile(new URL("../public/icon-192.png", import.meta.url));
const nativeCalls = [];
const provider = createWindowsProvider({ helperPath: "H.exe", exec: async (file, args) => {
  if (file === "H.exe") { nativeCalls.push(args); return { stdout: JSON.stringify({ png: png.toString("base64") }) }; }
  return { stdout: args.at(-1).includes("WScript.Shell") ? JSON.stringify([{ name: "App", target: "C:\\Apps\\real.exe", icon: "C:\\Icons\\app.dll,-4" }]) : "[]" };
} });
const dir = await mkdtemp(join(tmpdir(), "windock-icons-"));
const app = await createApp({ provider, configStore: createConfigStore({ path: join(dir, "config.json") }), trustLoopback: false, pin: "6432" });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;
try {
  const path = "/api/apps/icon?id=" + encodeURIComponent("c:/apps/real.exe");
  const unauthorized = await fetch(base + path);
  t.equal(unauthorized.status, 401, "icons require pairing"); await unauthorized.text();
  const auth = await fetch(base + "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "6432" }) });
  const cookie = auth.headers.get("set-cookie").split(";")[0]; await auth.text();
  const response = await fetch(base + path, { headers: { cookie } });
  t.equal(response.status, 200, "paired client gets its installed app icon");
  t.equal(response.headers.get("content-type"), "image/png", "native icon has PNG content type");
  t.ok(Buffer.from(await response.arrayBuffer()).equals(png), "binary icon bytes survive the API round trip");
  t.ok(response.headers.get("cache-control").startsWith("private"), "icons are never cached publicly");
  t.deepEqual(nativeCalls[0], ["icon", "C:\\Apps\\real.exe", "C:\\Icons\\app.dll,-4"], "native arguments come only from installed inventory");
  const unknown = await fetch(base + "/api/apps/icon?id=" + encodeURIComponent("C:\\secret.txt"), { headers: { cookie } });
  t.equal(unknown.status, 404, "arbitrary file paths cannot reach the extractor"); await unknown.text();
  const second = await fetch(base + path, { headers: { cookie } }); await second.arrayBuffer();
  t.equal(nativeCalls.length, 1, "repeat requests use the server icon cache");
} finally {
  app.server.closeAllConnections(); await app.hub.close(); await new Promise((r) => app.server.close(r)); await rm(dir, { recursive: true, force: true });
}
t.done("launcher verification passed");
