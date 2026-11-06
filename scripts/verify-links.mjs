import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { linkApp, linkFromTile } from "../src/links.js";
import { createConfigStore, normalizeTiles } from "../src/config.js";
import { addAppTile, toWireTiles, removeTile, tileKey, moveTile } from "../public/tiles.js";
import { renderTile } from "../public/dock.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createLinuxProvider } from "../src/platform/linux.js";
import { createApp } from "../server.js";

const t = createChecker("links");
const link = linkApp("https://example.com/watch?v=a&list=b#start", "Video <test>");
t.equal(linkApp("HTTPS://EXAMPLE.COM:443").id, linkApp("https://example.com/").id, "canonical URLs deduplicate");
t.equal(linkApp("http://192.168.1.1/").name, "192.168.1.1", "local website and default hostname label supported");
t.ok(linkApp("https://例え.テスト/🙂"), "international URL supported");
for (const value of [null, "", "example.com", "//example.com", "javascript:alert(1)", "file:///C:/Windows", "brave://newtab", "data:text/html,hi", "https://user:pass@example.com", "https://example.com/\n", "https://example.com/a b", "https://example.com/\\evil", "https://", "https://example.com/" + "x".repeat(2048)])
  t.equal(linkApp(value), null, "reject unsafe/ambiguous URL " + JSON.stringify(value));
t.equal(linkApp(link.target, "x".repeat(81)), null, "label is bounded");
t.equal(linkApp(link.target, "bad\nname"), null, "label controls rejected");
const long = linkApp("https://example.com/?q=" + "a".repeat(1000), "Long link");
const original = { kind: "app", id: "existing", target: "existing.exe", label: "Existing", args: "", icon: "" };
const tiles = normalizeTiles(addAppTile([original], link));
t.deepEqual(normalizeTiles(toWireTiles(tiles)), tiles, "old app-tile serialization preserves links and existing tiles");
t.equal(normalizeTiles(addAppTile([], long))[0].target, long.target, "long URL is never silently truncated");
t.equal(linkFromTile({ ...tiles[1], args: "--incognito" }), null, "caller arguments rejected");
t.equal(linkFromTile({ ...tiles[1], target: "https://other.example/" }), null, "id must match saved URL");
t.equal(normalizeTiles([{ ...tiles[1], target: "javascript:bad" }]).length, 0, "tampered config cannot become a launchable link");
t.equal(addAppTile(tiles, link).length, 2, "duplicate URL not pinned twice");
t.equal(moveTile(tiles, tileKey(tiles[1]), -1)[0].id, link.id, "link can be reordered");
t.equal(removeTile(tiles, tileKey(tiles[1])).length, 1, "removal preserves existing tile");
t.ok(renderTile(tiles[1]).includes("Open website") && !renderTile(tiles[1]).includes("Video <test>"), "website hint and escaped label");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
t.equal(new Set(ids).size, ids.length, "UI IDs are unique");
const calls = [];
let fail = false;
const windows = createWindowsProvider({ helperPath: "test-helper", exec: async (file, args) => {
  calls.push({ file, args });
  if (fail) throw new Error("private launch details");
  return { stdout: file === "test-helper" ? "" : "[]" };
} });
const linux = createLinuxProvider({ exec: async () => ({ stdout: "" }), input: null,
  launch: async (file, args, options) => { calls.push({ file, args, options }); if (fail) throw new Error("private launch details"); } });
await windows.openLink(link);
t.deepEqual(calls.at(-1), { file: "test-helper", args: ["open-link", link.target] }, "Windows uses URL-only argv and dedicated handler");
await linux.openLink(link);
t.deepEqual(calls.at(-1), { file: "xdg-open", args: [link.target], options: { wait: true } }, "Linux uses xdg-open with one URL argument");
for (const provider of [windows, linux]) {
  const before = calls.length;
  await t.rejects(() => provider.openLink({ ...link, args: "cmd" }), "provider refuses caller options");
  await t.rejects(() => provider.openLink({ ...link, target: "file:///etc/passwd" }), "provider revalidates protocol");
  t.equal(calls.length, before, "invalid link never invokes OS");
}
const dir = await mkdtemp(join(tmpdir(), "windock-links-"));
const store = createConfigStore({ path: join(dir, "config.json") });
const provider = { ...windows, listInstalledApps: async () => [], listRunningApps: async () => [] };
const app = await createApp({ provider, configStore: store, pin: "572864", trustLoopback: false });
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + app.server.address().port;
let cookie = "";
async function call(path, { method = "GET", body, origin = base, auth = true } = {}) {
  const response = await fetch(base + path, { method, headers: { origin, ...(auth ? { cookie } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}
try {
  t.equal((await call("/api/links", { method: "POST", body: { url: link.target } })).status, 401, "unpaired client cannot create links");
  await call("/api/auth", { method: "POST", body: { pin: "572864" } });
  t.equal((await call("/api/state")).json.canAddLinks, true, "capability advertised");
  t.equal((await call("/api/links", { method: "POST", body: { url: link.target }, origin: "https://evil.test" })).status, 403, "cross-origin rejected");
  for (const body of [{ url: "file:///tmp/x" }, { url: link.target, args: "cmd" }, { url: link.target, name: 42 }])
    t.equal((await call("/api/links", { method: "POST", body })).status, 422, "invalid link creation rejected");
  t.equal((await call("/api/links", { method: "POST", body: { url: link.target, name: link.name } })).json.app.id, link.id, "validated link returned without launch");
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: link.id } })).status, 404, "unpinned id cannot launch");
  await call("/api/tiles", { method: "PUT", body: { tiles } });
  store.invalidate();
  t.deepEqual((await store.load()).tiles, tiles, "disk reload preserves link and existing app");
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: link.id }, auth: false })).status, 401, "unpaired launch refused");
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: link.id, target: "file:///etc/passwd", args: "cmd" } })).status, 200, "legacy launch uses saved id only");
  t.deepEqual(calls.at(-1).args, ["open-link", link.target], "substituted URL and command ignored");
  t.equal((await call("/api/apps/installed")).json.apps[0].source, "link", "old clients can resolve link inventory");
  t.ok((await call("/api/apps/icon?id=" + encodeURIComponent(link.id))).text.includes("<svg"), "local icon served without contacting website");
  fail = true;
  const failed = await call("/api/apps/launch", { method: "POST", body: { id: link.id } });
  t.equal(failed.status, 422, "browser launch failure is actionable");
  t.ok(!failed.text.includes("private launch details"), "OS details not leaked");
  fail = false;
  provider.openLink = undefined;
  t.equal((await call("/api/state")).json.canAddLinks, false, "unsupported companion hides capability");
  t.equal((await call("/api/links", { method: "POST", body: { url: link.target } })).status, 404, "unsupported companion rejects create");
  provider.openLink = windows.openLink;
  await call("/api/tiles", { method: "PUT", body: { tiles: [original] } });
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: link.id } })).status, 404, "removed link is no longer launchable");
} finally {
  app.hub.close(); app.inputHub.close(); app.server.closeAllConnections();
  await new Promise(resolve => app.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
t.done("links verification passed");
