/** G9: the HTTP API serves its documented routes under a live server. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { createApp } from "../server.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createConfigStore } from "../src/config.js";

const t = createChecker("api");
const PIN = "4321";

const INSTALLED = JSON.stringify([
  { name: "Firefox", target: "C:\\Apps\\firefox.exe", args: "", icon: "", source: "startmenu" },
  { name: "Notepad", target: "C:\\Windows\\notepad.exe", args: "", icon: "", source: "startmenu" },
]);
const RUNNING = JSON.stringify([
  { Id: 4812, ProcessName: "firefox", MainWindowTitle: "FF", Handle: 12, Path: "C:\\Apps\\firefox.exe" },
]);

const helperCalls = [];
const provider = createWindowsProvider({
  helperPath: "H.exe",
  exec: async (file, args) => {
    if (file === "H.exe") {
      helperCalls.push(args);
      if (args[0] === "nowplaying") return { stdout: '{"title":"Track","artist":"Band","playing":true}' };
      return { stdout: "" };
    }
    const script = args[args.length - 1];
    if (script.includes("MainWindowHandle")) return { stdout: RUNNING };
    if (script.includes("WScript.Shell")) return { stdout: INSTALLED };
    return { stdout: '{"cpu":10,"memTotal":100,"memFree":40,"battery":null,"charging":null}' };
  },
});

const dir = await mkdtemp(join(tmpdir(), "windock-api-"));
const configStore = createConfigStore({ path: join(dir, "config.json") });
// Loopback trust would short-circuit every auth check, since these requests
// originate from 127.0.0.1. Disabling it makes the entire suite below exercise
// the real pairing + session path; loopback trust itself is verified separately
// at the end of this file.
const app = await createApp({ provider, configStore, pin: PIN, trustLoopback: false });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const port = app.server.address().port;
const base = `http://127.0.0.1:${port}`;

let cookie = "";
async function call(path, { method = "GET", body, origin = base, withCookie = true } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (origin) headers.origin = origin;
  if (withCookie && cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response (static asset) */
  }
  return { status: res.status, json, text, headers: res.headers };
}

// ---- public routes ----
const health = await call("/health");
t.equal(health.status, 200, "GET /health is public and returns 200");
t.equal(health.json.ok, true, "health reports ok");
t.equal(health.json.platform, "windows", "health names the active provider");

// ---- static ----
const index = await call("/");
t.equal(index.status, 200, "GET / serves the PWA shell");
t.ok(index.text.includes("<title>WinDock</title>"), "the shell carries the app title");
t.equal(index.headers.get("x-content-type-options"), "nosniff", "static responses set nosniff");
const manifest = await call("/manifest.webmanifest");
t.equal(manifest.status, 200, "the manifest is served");
t.ok(manifest.headers.get("content-type").includes("manifest+json"), "manifest content type is correct");
t.equal((await call("/does-not-exist.js")).status, 404, "a missing asset returns 404");
t.equal((await call("/../server.js")).status, 404, "traversal above public is refused");

// ---- pairing ----
t.equal((await call("/api/auth", { method: "POST", body: { pin: "0000" } })).status, 401, "a wrong pin is refused");
t.equal((await call("/api/auth", { method: "POST", body: { pin: "12" } })).status, 400, "a malformed pin is refused");
t.equal(
  (await call("/api/auth", { method: "POST", body: { pin: PIN }, origin: "http://evil.test" })).status,
  403,
  "a cross-origin pairing attempt is refused",
);
const paired = await call("/api/auth", { method: "POST", body: { pin: PIN } });
t.equal(paired.status, 200, "the correct pin pairs successfully");
t.ok(cookie.startsWith("windock_session="), "pairing issues a session cookie");

// ---- authenticated routes ----
const state = await call("/api/state");
t.equal(state.status, 200, "GET /api/state succeeds when paired");
t.equal(state.json.platform, "windows", "state names the provider");
t.ok(Array.isArray(state.json.tiles), "state carries a tiles array");
t.ok(Array.isArray(state.json.running), "state carries a running array");
t.ok(Array.isArray(state.json.verbs), "state advertises the control verbs");

const installed = await call("/api/apps/installed");
t.equal(installed.status, 200, "GET /api/apps/installed succeeds");
t.equal(installed.json.apps.length, 2, "the installed inventory is returned");

// ---- tiles ----
const put = await call("/api/tiles", {
  method: "PUT",
  body: {
    tiles: [
      { kind: "app", id: "c:/apps/firefox.exe", target: "C:\\Apps\\firefox.exe", label: "Firefox" },
      { kind: "control", verb: "mute-toggle", label: "Mute" },
      { kind: "control", verb: "hack; rm -rf /", label: "Bad" },
    ],
  },
});
t.equal(put.status, 200, "PUT /api/tiles succeeds");
t.equal(put.json.tiles.length, 2, "the hostile tile is dropped on save");
t.ok(put.json.tiles.every((x) => x.verb !== "hack; rm -rf /"), "no hostile verb is persisted");

const after = await call("/api/state");
const ffTile = after.json.tiles.find((x) => x.kind === "app");
t.equal(ffTile.running, true, "a pinned app with a live process is marked running");

// ---- actions ----
const launch = await call("/api/apps/launch", { method: "POST", body: { id: "c:/windows/notepad.exe" } });
t.equal(launch.status, 200, "POST /api/apps/launch succeeds for a known app");
t.deepEqual(helperCalls.at(-1), ["launch", "C:\\Windows\\notepad.exe"], "launch reaches the helper with exact argv");
t.equal((await call("/api/apps/launch", { method: "POST", body: { id: "c:/nope.exe" } })).status, 404,
  "launching an unknown app returns 404");

const focus = await call("/api/apps/focus", { method: "POST", body: { pid: 4812 } });
t.equal(focus.status, 200, "POST /api/apps/focus succeeds for a live pid");
t.deepEqual(helperCalls.at(-1), ["focus", "4812"], "focus reaches the helper with exact argv");
t.equal((await call("/api/apps/focus", { method: "POST", body: { pid: 999999 } })).status, 404,
  "focusing a dead pid returns 404");
t.equal((await call("/api/apps/focus", { method: "POST", body: { pid: -1 } })).status, 400,
  "a negative pid is rejected");
t.equal((await call("/api/apps/focus", { method: "POST", body: { pid: "4812; id" } })).status, 400,
  "a non-numeric pid is rejected");

const control = await call("/api/control", { method: "POST", body: { verb: "volume-set", value: 30 } });
t.equal(control.status, 200, "POST /api/control succeeds for a valid verb");
t.deepEqual(helperCalls.at(-1), ["control", "volume-set", "30"], "control reaches the helper with exact argv");
t.equal((await call("/api/control", { method: "POST", body: { verb: "nope" } })).status, 400,
  "an unknown verb is rejected");
t.equal((await call("/api/control", { method: "POST", body: { verb: "volume-set", value: 500 } })).status, 400,
  "an out-of-range value is rejected");

const np = await call("/api/nowplaying");
t.equal(np.status, 200, "GET /api/nowplaying succeeds");
t.equal(np.json.nowPlaying.title, "Track", "now playing reports the current title");

t.equal((await call("/api/stats")).status, 200, "GET /api/stats succeeds");
t.equal((await call("/api/nope")).status, 404, "an unknown API route returns 404");

// ---- CSRF and body limits ----
t.equal(
  (await call("/api/control", { method: "POST", body: { verb: "lock" }, origin: "http://evil.test" })).status,
  403,
  "a cross-origin state change is refused even with a valid session",
);
const big = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", cookie, origin: base },
  body: JSON.stringify({ tiles: Array.from({ length: 200000 }, () => ({ kind: "control", verb: "lock" })) }),
});
t.equal(big.status, 413, "an oversized body is refused");

const badJson = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", cookie, origin: base },
  body: "{not json",
});
t.equal(badJson.status, 400, "a malformed JSON body is refused");

// ---- unauthenticated access ----
const saved = cookie;
cookie = "";
const anon = await fetch(`${base}/api/state`, { headers: { origin: base, cookie: "windock_session=bogus" } });
t.equal(anon.status, 401, "an invalid session cannot read state");
const anonAction = await fetch(`${base}/api/control`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, cookie: "windock_session=bogus" },
  body: JSON.stringify({ verb: "shutdown" }),
});
t.equal(anonAction.status, 401, "an invalid session cannot trigger a power action");
cookie = saved;

// ---- loopback trust is a real feature: verify it works when enabled ----
const trusting = await createApp({ provider, configStore, pin: PIN, trustLoopback: true });
await new Promise((r) => trusting.server.listen(0, "127.0.0.1", r));
const tport = trusting.server.address().port;
const trusted = await fetch(`http://127.0.0.1:${tport}/api/state`);
t.equal(trusted.status, 200, "loopback is trusted when trustLoopback is enabled");
await trusted.arrayBuffer();
await trusting.hub.close();
trusting.server.closeAllConnections?.();
await new Promise((r) => trusting.server.close(r));

await app.hub.close();
// fetch keeps connections alive; close() alone would wait for them forever.
app.server.closeAllConnections?.();
await new Promise((r) => app.server.close(r));
await rm(dir, { recursive: true, force: true });

t.done("api verification passed");
