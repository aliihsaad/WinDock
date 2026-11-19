import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { createRenderWatch } from "../src/render-watch.js";
import { findBlendPath, nextVersionName } from "../src/versioned-save.js";
import { createConfigStore } from "../src/config.js";
import { createApp } from "../server.js";

import { createTapCounter } from "../public/quick-access.js";
import { idleGate } from "../public/idle.js";
const t = createChecker("bench");
{
  let idle = false; const gate = idleGate({ idle: () => idle });
  t.deepEqual([gate(), gate(), gate()], [true, true, true], "active phone: every tick runs");
  idle = true; t.deepEqual([gate(), gate(), gate(), gate(), gate(), gate(), gate(), gate()], [false, false, false, true, false, false, false, true], "idle phone: one tick in four runs");
  idle = false; t.equal(gate(), true, "touching the phone resumes full speed at once");
}
{
  let clock = 0; const c = createTapCounter({ now: () => clock });
  const counts = []; for (let i = 0; i < 5; i++) { clock += 150; counts.push(c.tap(100, 100)); }
  t.deepEqual(counts, [1, 2, 3, 4, 5], "quick nearby taps count up to five");
  clock += 2000; t.equal(c.tap(100, 100), 1, "a pause starts a new count");
  clock += 100; t.equal(c.tap(400, 400), 1, "a tap far away starts a new count");
}

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
const aiCalls = [];
const app = await createApp({
  fetchAi: async (url, init) => { aiCalls.push(init.headers["x-goog-api-key"]); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "A normal map stores direction." }] } }] }) }; },
  assistantKeys: { get: () => ({ key: "AIzaSyA-fake_key_for_tests_0123456789abcdef", model: "gemini-flash-latest" }), status: () => ({ configured: true, model: "gemini-flash-latest" }), set: async () => {} },
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
  // PC -> phone cast: only the local PC may send, only YouTube links are accepted.
  const castHeaders = { "x-windock-cast": "local" };
  t.equal((await call("/api/cast")).json.id, 0, "nothing cast yet");
  t.equal((await call("/api/cast/send", { method: "POST", body: { url: "https://youtu.be/dQw4w9WgXcQ" } })).status, 403, "send needs the local header");
  t.equal((await call("/api/cast/send", { method: "POST", headers: castHeaders, body: { url: "https://evil.com/watch?v=dQw4w9WgXcQ" } })).status, 400, "non-YouTube link refused");
  t.equal((await call("/api/cast/send", { method: "POST", headers: castHeaders, body: { url: "https://youtu.be/dQw4w9WgXcQ", extra: 1 } })).status, 400, "extra fields refused");
  t.equal((await call("/api/cast/send", { method: "POST", headers: castHeaders, body: { url: "https://youtu.be/dQw4w9WgXcQ" } })).status, 200, "local PC can send a YouTube link");
  const got = (await call("/api/cast")).json;
  t.deepEqual([got.id, got.url, got.ageMs < 5000], [1, "https://m.youtube.com/watch?v=dQw4w9WgXcQ", true], "phone sees the normalised link once");
  t.equal((await call("/api/cast", { auth: false })).status, 401, "unpaired client cannot read the cast");
  const say = async (body) => (await call("/api/assistant", { method: "POST", body })).json;
  t.equal((await say({ text: "volume down" })).say, "Quieter.", "assistant runs a PC command");
  const power = await say({ text: "shut down the pc" });
  t.deepEqual([power.needsConfirm, power.say], ["shutdown", "Shut the PC down?"], "power asks first");
  t.equal((await say({ confirm: "shutdown" })).say, "Shutting down.", "power runs only after a confirm");
  t.equal((await call("/api/assistant", { method: "POST", body: { confirm: "volume-up" } })).status, 400, "only power verbs can be confirmed");
  t.equal((await say({ text: "what is a normal map" })).say, "A normal map stores direction.", "questions go to the AI");
  t.equal(aiCalls.length, 1, "the AI is asked once, only for the question");
  t.equal((await call("/api/assistant", { method: "POST", body: { text: "x", extra: 1 } })).status, 400, "assistant rejects extra fields");
  t.equal((await call("/api/assistant", { auth: false })).status, 401, "assistant needs pairing");
  t.equal((await call("/api/assistant/key", { method: "POST", body: { key: "x" } })).status, 403, "only the PC itself can set the key");
  t.equal((await call("/cast")).status, 200, "send-to-phone page opens on the PC");
  t.equal((await call("/api/updates/local/check", { method: "POST", body: {} })).status, 403, "tray update check needs its local header");
  t.equal((await call("/api/updates/local/install", { method: "POST", body: {} })).status, 403, "tray install needs its local header");
  t.equal((await call("/api/updates/local/check", { method: "POST", headers: { "x-windock-update": "local" }, body: { x: 1 } })).status, 400, "tray update takes no options");
  t.ok([409, 501].includes((await call("/api/updates/local/install", { method: "POST", headers: { "x-windock-update": "local" }, body: {} })).status), "install before a check (or off Windows) is refused");
} finally {
  app.hub.close(); app.inputHub.close(); app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
}
t.done("bench verification passed");
