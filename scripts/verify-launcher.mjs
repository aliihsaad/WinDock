import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { normalizeLayout, fitLayout, renderPages, pageCount, moveToTile, GRIDS, ICON_SCALE, ICON_SIZES } from "../public/launcher.js";
import { tileKey } from "../public/tiles.js";
import { createIconCache, FALLBACK_ICON } from "../src/icons.js";
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
for (const count of [12, 16]) {
  const preference = normalizeLayout({ perPage: count });
  t.equal(preference.columns, 4, `${count} icons keep four columns`);
  t.equal(preference.rows, count / 4, `${count} icons add rows instead of columns`);
}
t.ok(normalizeLayout({ perPage: 8 }).iconSize >= normalizeLayout({ perPage: 12 }).iconSize && normalizeLayout({ perPage: 12 }).iconSize > normalizeLayout({ perPage: 16 }).iconSize, "tablet densities never enlarge the phone icon");
t.deepEqual(Object.keys(GRIDS), Object.keys(ICON_SIZES), "every grid has an icon size");
t.deepEqual(Object.keys(GRIDS), Object.keys(ICON_SCALE), "every grid has a viewport share");
t.equal(normalizeLayout({ perPage: 10 }).perPage, 4, "an unsupported density resets to the spacious preset");
t.equal(normalizeLayout({ columns: 4, rows: 3 }).perPage, 12, "old twelve-icon layouts migrate without changing capacity");
const tablet = normalizeLayout({ perPage: 16 });
t.deepEqual(fitLayout(tablet, { height: 500 }), normalizeLayout({ perPage: 8 }), "a tablet density on a short screen is drawn as eight");
t.equal(fitLayout(tablet, { height: 639 }).perPage, 8, "just under the threshold is still a phone");
t.equal(fitLayout(tablet, { height: 640 }), tablet, "from the threshold the tablet density stands");
t.equal(fitLayout(tablet, {}), tablet, "without a viewport the preference stands");
t.equal(fitLayout(layout, { height: 300 }), layout, "phone densities are never rewritten");
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
t.equal(pageCount(tiles, tablet), 2, "sixteen per page: seventeen tiles fill two pages");
t.equal((renderPages({ tiles }, tablet).match(/class="dock-page"/g) || []).length, 2, "tablet pages render the larger capacity");
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

for (const throws of [false, true]) {
  let time = 100, attempts = 0;
  const recovered = Buffer.from("recovered icon");
  const retryCache = createIconCache({ appIcon: async () => {
    if (++attempts > 1) return recovered;
    if (throws) throw new Error("helper temporarily unavailable");
    return null;
  } }, { now: () => time, retryAfterMs: 5000 });
  t.equal(await retryCache(tiles[0]), null, "temporary failure returns a fallback");
  time += 4999;
  t.equal(await retryCache(tiles[0]), null, "missing icons back off briefly");
  t.equal(attempts, 1, "repeated missing icon requests do not flood the helper");
  time++;
  const results = await Promise.all([retryCache(tiles[0]), retryCache(tiles[0])]);
  t.ok(results.every((result) => result === recovered), "real icon recovers after a temporary failure");
  t.equal(attempts, 2, "concurrent recovery requests share one extraction");
  time += 5000;
  t.equal(await retryCache(tiles[0]), recovered, "recovered icons stay cached");
  t.equal(attempts, 2, "successful icons are not extracted again");
}

const png = await readFile(new URL("../public/icon-192.png", import.meta.url));
const nativeCalls = [];
const provider = createWindowsProvider({ helperPath: "H.exe", exec: async (file, args) => {
  if (file === "H.exe") { nativeCalls.push(args); return { stdout: JSON.stringify({ png: args[1].includes("missing") ? null : png.toString("base64") }) }; }
  return { stdout: args.at(-1).includes("WScript.Shell") ? JSON.stringify([{ name: "App", target: "C:\\Apps\\real.exe", icon: "C:\\Icons\\app.dll,-4" }, { name: "Missing icon", target: "C:\\Apps\\missing.exe" }]) : "[]" };
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
  const fallback = await fetch(base + "/api/apps/icon?id=" + encodeURIComponent("c:/apps/missing.exe"), { headers: { cookie } });
  t.equal(fallback.headers.get("content-type"), "image/svg+xml", "unavailable icons still have a usable placeholder");
  t.equal(fallback.headers.get("cache-control"), "private, no-store", "phones must never cache a failed icon lookup");
  await fallback.arrayBuffer();
} finally {
  app.server.closeAllConnections(); await app.hub.close(); await new Promise((r) => app.server.close(r)); await rm(dir, { recursive: true, force: true });
}

// Linux themes ship scalable SVG icons; they are served as images that cannot run script.
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const svgApp = await createApp({
  provider: {
    id: "test", displayName: "Test",
    listInstalledApps: async () => [{ id: "svg-app", name: "SVG", target: "svg-app", icon: "svg-app" }, { id: "html-app", name: "HTML", target: "html-app", icon: "html-app" }],
    listRunningApps: async () => [],
    appIcon: async (item) => (item.id === "svg-app" ? svg : Buffer.from("<html><script>alert(1)</script>")),
  },
  configStore: {}, trustLoopback: true, pin: "6433",
});
await new Promise((r) => svgApp.server.listen(0, "127.0.0.1", r));
try {
  const svgBase = `http://127.0.0.1:${svgApp.server.address().port}`;
  const response = await fetch(svgBase + "/api/apps/icon?id=svg-app");
  t.equal(response.headers.get("content-type"), "image/svg+xml", "theme SVG icons keep their type");
  t.ok(response.headers.get("content-security-policy").includes("sandbox"), "a theme SVG opened directly cannot run script");
  t.ok(Buffer.from(await response.arrayBuffer()).equals(svg), "SVG bytes are served unchanged");
  const html = await fetch(svgBase + "/api/apps/icon?id=html-app");
  t.ok(Buffer.from(await html.arrayBuffer()).equals(FALLBACK_ICON), "bytes that are neither PNG nor SVG get the placeholder");
  t.equal(html.headers.get("cache-control"), "private, no-store", "a rejected icon is retried later");
} finally {
  svgApp.server.closeAllConnections(); await svgApp.hub.close(); await new Promise((r) => svgApp.server.close(r));
}
t.done("launcher verification passed");
