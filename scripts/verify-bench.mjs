import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { createRenderWatch } from "../src/render-watch.js";
import { findBlendPath, nextVersionName } from "../src/versioned-save.js";
import { createConfigStore } from "../src/config.js";
import { createApp } from "../server.js";

const t = createChecker("bench");

// ---- Render watcher with a fake clock ----------------------------------------
{
  let clock = 0, load = 5, tick;
  const acted = [];
  const watch = createRenderWatch({ readStats: async () => ({ cpu: load }), act: async (a) => { acted.push(a); }, now: () => clock, setTimer: (fn) => { tick = fn; return 1; }, clearTimer: () => {} });
  t.throws(() => watch.arm("explode"), "unknown action rejected");
  watch.arm("sleep");
  for (let i = 0; i < 5; i++) { clock += 5000; await watch.tick(); }
  t.equal(watch.state().phase, "waiting", "idle PC is not mistaken for a finished render");
  load = 90; clock += 5000; await watch.tick();
  t.equal(watch.state().phase, "busy", "busy load is noticed");
  load = 5;
  for (let i = 0; i < 12; i++) { clock += 5000; await watch.tick(); }
  t.equal(watch.state().phase, "done", "quiet for 45s after busy is done");
  t.deepEqual(acted, ["sleep"], "the chosen action ran exactly once");
  watch.arm("notify"); clock += 11 * 60 * 1000; await watch.tick();
  t.equal(watch.state().phase, "expired", "never-busy watch expires");
  watch.arm("notify"); watch.disarm(); t.equal(watch.state().phase, "off", "disarm turns it off");
}

// ---- Versioned save names ----------------------------------------------------
t.equal(nextVersionName("scene.blend", []), "scene_v001.blend", "first version");
t.equal(nextVersionName("scene_v003.blend", ["scene_v003.blend", "scene_v007.blend"]), "scene_v008.blend", "continues after the highest");
t.equal(findBlendPath([{ id: "blender", title: "Blender* [D:\\work\\scene.blend]" }]), "D:\\work\\scene.blend", "path read from the title");
t.equal(findBlendPath([{ id: "blender", title: "Blender [..\\..\\x.blend]" }]), null, "relative path ignored");
t.equal(findBlendPath([{ id: "notepad", title: "x [D:\\a.blend]" }]), null, "only Blender windows count");

// ---- Routes: videos, render watch, versioned save ----------------------------
const dir = await mkdtemp(join(tmpdir(), "windock-bench-"));
await mkdir(join(dir, "clips", "sub"), { recursive: true });
await writeFile(join(dir, "clips", "a.mp4"), Buffer.alloc(1000, 7));
await writeFile(join(dir, "clips", "b.mkv"), Buffer.alloc(10));
await writeFile(join(dir, "clips", "notes.txt"), "secret");
await writeFile(join(dir, "outside.mp4"), "no");
const provider = { id: "test", displayName: "Test", listInstalledApps: async () => [], listRunningApps: async () => [{ id: "blender" }], launchApp: async () => {}, focusApp: async () => {}, closeApp: async () => {}, control: async () => {}, nowPlaying: async () => null, systemStats: async () => ({ cpu: 1 }) };
const saves = [];
const app = await createApp({
  provider, configStore: createConfigStore(join(dir, "config.json")), pin: "572864", trustLoopback: false,
  videoRoots: async () => [{ id: "clips", name: "Clips", path: join(dir, "clips") }],
  versionedSaver: async (w) => { saves.push(w); return { name: "scene_v002.blend" }; },
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + app.server.address().port;
let cookie = "";
async function call(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { origin: base, ...(auth ? { cookie } : {}), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.headers.get("set-cookie")) cookie = res.headers.get("set-cookie").split(";")[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let json; try { json = JSON.parse(buf.toString()); } catch { /* binary */ }
  return { status: res.status, json, buf, headers: res.headers };
}
try {
  await call("/api/auth", { method: "POST", body: { pin: "572864" }, auth: false });
  for (const p of ["/api/videos/roots", "/api/videos/list?root=clips", "/api/render-watch"]) t.equal((await call(p, { auth: false })).status, 401, "unpaired: " + p);
  t.deepEqual((await call("/api/videos/roots")).json.roots, [{ id: "clips", name: "Clips" }], "roots expose ids and names only");
  const list = (await call("/api/videos/list?root=clips")).json;
  t.ok(JSON.stringify(list).includes("a.mp4") && !JSON.stringify(list).includes("notes.txt"), "only video files listed");
  t.equal((await call("/api/videos/list?root=nope")).status, 404, "unknown root");
  for (const bad of ["..%2Foutside.mp4", "sub%2F..%2F..%2Foutside.mp4", "C%3A%5Cwindows%5Cx.mp4", "notes.txt"])
    t.ok([400, 404, 415].includes((await call("/api/videos/stream?root=clips&path=" + bad)).status), "refused: " + bad);
  const full = await call("/api/videos/stream?root=clips&path=a.mp4");
  t.equal(full.status, 200, "stream ok"); t.equal(full.buf.length, 1000, "whole file"); t.equal(full.headers.get("accept-ranges"), "bytes", "ranges advertised");
  const part = await call("/api/videos/stream?root=clips&path=a.mp4", { headers: { range: "bytes=10-19" } });
  t.equal(part.status, 206, "range gives 206"); t.equal(part.buf.length, 10, "range length");
  t.equal((await call("/api/videos/stream?root=clips&path=a.mp4", { headers: { range: "bytes=5000-6000" } })).status, 416, "unsatisfiable range");
  t.equal((await call("/api/render-watch")).json.phase, "off", "watch starts off");
  t.equal((await call("/api/render-watch", { method: "POST", body: { action: "notify" } })).json.phase, "waiting", "arm notify");
  t.equal((await call("/api/render-watch", { method: "POST", body: { action: "sleep" } })).json.action, "sleep", "sleep action can be armed when power actions are allowed");
  t.equal((await call("/api/render-watch", { method: "POST", body: { action: "format" } })).status, 400, "unknown action rejected");
  t.equal((await call("/api/render-watch", { method: "POST", body: { action: "off" } })).json.phase, "off", "turn off");
  t.equal((await call("/api/render-watch", { method: "POST", body: { action: "notify", extra: 1 } })).status, 400, "unknown fields rejected");
  t.equal((await call("/api/versioned-save", { method: "POST", body: {} })).json.name, "scene_v002.blend", "versioned save runs");
  t.equal(saves.length, 1, "saver got running windows");
} finally {
  app.hub.close(); app.inputHub.close(); app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
}
t.done("bench verification passed");
