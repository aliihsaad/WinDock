import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createWindowsCapture } from "../src/platform/capture.js";
import { createApp } from "../server.js";
import { createChecker } from "./lib/assert.mjs";

const t = createChecker("capture");
const children = [];
function spawn(file, args, options) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  child.kill = () => { child.killed = true; child.emit("close", null); };
  child.message = (message) => child.stdout.write(JSON.stringify(message) + "\n");
  child.finish = (code = 0) => { child.stdout.end(); child.stderr.end(); child.emit("close", code); };
  child.saved = (kind = "recording") => child.message({ type: "saved", name: "capture.mp4", path: "C:\\Videos\\WinDock\\capture.mp4", kind });
  children.push({ child, file, args, options });
  return child;
}
const capture = createWindowsCapture({ helperPath: "C:\\Win Dock & safe\\helper.exe", spawn, startupMs: 1000, stopMs: 1000 });
t.equal(capture.status().phase, "idle", "starts idle without a capture process");
t.equal(children.length, 0, "status never starts native work");
const first = capture.start(), duplicate = capture.start();
t.equal(children.length, 1, "duplicate start shares one worker");
t.deepEqual(children[0].args, ["capture", "record"], "only fixed recording argv reaches helper");
t.equal(children[0].file, "C:\\Win Dock & safe\\helper.exe", "helper path remains opaque");
t.equal(children[0].options.shell, false, "never invokes a shell");
t.equal(children[0].options.windowsHide, true, "no command window");
t.equal(capture.status().phase, "starting", "starting is visible");
children[0].child.message({ type: "recording", startedAt: Date.now() });
t.equal((await first).phase, "recording", "ready acknowledgement starts the timer");
t.equal((await duplicate).startedAt, capture.status().startedAt, "duplicate start keeps same recording");
const stop = capture.stop();
t.equal(capture.status().phase, "stopping", "saving phase is visible");
t.equal(children[0].child.stdin.read().toString(), "stop\n", "stop asks encoder to finalize");
await t.rejects(() => capture.start(), "cannot start while old recording saves");
children[0].child.saved(); children[0].child.finish();
t.equal((await stop).phase, "idle", "completed recording clears worker");
t.equal(capture.status().lastCapture.kind, "recording", "saved recording remains discoverable");
t.equal((await capture.stop()).phase, "idle", "repeated stop is harmless");
const screenshot = capture.screenshot(), duplicateShot = capture.screenshot();
t.equal(children.length, 2, "duplicate screenshot shares pending capture");
t.deepEqual(children[1].args, ["capture", "screenshot"], "screenshot uses fixed argv");
children[1].child.saved("screenshot"); children[1].child.finish();
t.equal((await screenshot).lastCapture.kind, "screenshot", "screenshot reports its type");
t.equal((await duplicateShot).lastCapture.name, "capture.mp4", "same result delivered to duplicate caller");
const broken = capture.start(); children[2].child.stderr.write("private native diagnostics"); children[2].child.finish(2);
await t.rejects(() => broken, "native failure is reported");
t.equal(capture.status().phase, "error", "failure clears active recording");
t.ok(!capture.status().error.includes("private"), "native diagnostics stay private");
const retry = capture.start(); children[3].child.message({ type: "recording", startedAt: Date.now() }); await retry;
const disposed = capture.dispose();
t.equal(capture.status().phase, "stopping", "host disposal finalizes a recording");
children[3].child.saved(); children[3].child.finish(); await disposed;
await t.rejects(() => capture.start(), "disposed service rejects new recording");
await t.rejects(() => capture.screenshot(), "disposed service rejects screenshots");

const timeoutCapture = createWindowsCapture({ helperPath: "H.exe", spawn, startupMs: 15, stopMs: 15 });
await t.rejects(() => timeoutCapture.start(), "unresponsive startup has a deadline");
t.ok(children.at(-1).child.killed, "unresponsive owned worker is terminated");
const noFile = timeoutCapture.start(); children.at(-1).child.finish(0);
await t.rejects(() => noFile, "zero exit without saved result is a failure");
const earlyStart = timeoutCapture.start();
const earlyStop = timeoutCapture.stop();
children.at(-1).child.message({ type: "recording", startedAt: Date.now() });
t.equal((await earlyStart).phase, "stopping", "late ready does not undo an early stop");
await t.rejects(() => earlyStop, "unresponsive stop has a deadline");
await timeoutCapture.dispose();

// HTTP routes must retain pairing, origin checks and the no-arbitrary-options boundary.
const calls = [];
const provider = { id: "test", displayName: "Test", capture: {
  status: () => ({ available: true, phase: "idle" }),
  screenshot: async () => { calls.push("screenshot"); return { phase: "idle" }; },
  start: async () => { calls.push("start"); return { phase: "recording" }; },
  stop: async () => { calls.push("stop"); return { phase: "idle" }; },
  dispose: async () => {},
} };
const app = await createApp({ provider, pin: "4321", trustLoopback: false, configStore: {} });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
let cookie = "";
async function request(path, method = "GET", body, origin = base) {
  const response = await fetch(base + path, { method, headers: { cookie, origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const json = await response.json();
  return { status: response.status, json, cache: response.headers.get("cache-control") };
}
try {
  for (const action of ["screenshot", "start", "stop"]) t.equal((await request("/api/capture/" + action, "POST", {})).status, 401, `${action} needs pairing`);
  t.equal((await request("/api/capture")).status, 401, "capture paths/status need pairing");
  await request("/api/auth", "POST", { pin: "4321" });
  const status = await request("/api/capture");
  t.equal(status.status, 200, "paired client can discover capture status");
  t.equal(status.cache, "no-store", "recording state is not cached");
  for (const action of ["screenshot", "start", "stop"]) {
    t.equal((await request("/api/capture/" + action, "POST", {}, "https://evil.example")).status, 403, `${action} rejects foreign origin`);
    t.equal((await request("/api/capture/" + action, "POST", { path: "C:\\other.txt", audio: true })).status, 400, `${action} refuses client paths/options`);
    t.equal((await request("/api/capture/" + action, "POST", {})).status, 200, `${action} dispatches for paired client`);
  }
  t.deepEqual(calls, ["screenshot", "start", "stop"], "rejected calls never reach native actions");
  t.equal((await request("/api/capture/start")).status, 404, "GET never starts a recording");
  t.equal((await request("/api/capture/unknown", "POST", {})).status, 404, "unknown action rejected");
  provider.capture.start = async () => { throw Object.assign(new Error("Capture unavailable"), { status: 503 }); };
  t.equal((await request("/api/capture/start", "POST", {})).status, 503, "capture failure remains an actionable response");
  delete provider.capture;
  t.equal((await request("/api/capture")).json.available, false, "unsupported platforms advertise unavailable");
  t.equal((await request("/api/capture/start", "POST", {})).status, 501, "unsupported platforms cannot start");
} finally { app.server.closeAllConnections(); await app.hub.close(); await new Promise((resolve) => app.server.close(resolve)); }
t.done("capture verification passed");
