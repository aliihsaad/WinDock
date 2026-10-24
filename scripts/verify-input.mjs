import { WebSocket } from "ws";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { createChecker } from "./lib/assert.mjs";
import { validateInput, validateSignature } from "../src/input.js";
import { createWindowsInput } from "../src/platform/input.js";
import { createApp } from "../server.js";
import { TouchpadGestures } from "../public/touchpad-gestures.js";

const t = createChecker("input");
for (const bad of [null, [], {}, { type: "move", dx: 0.5, dy: 0 }, { type: "move", dx: 2049, dy: 0 }, { type: "move", dx: NaN, dy: 0 }, { type: "button", button: "middle", down: true }, { type: "button", button: "left", down: 1 }, { type: "release", path: "unsafe" }, { type: "launch" }]) t.equal(validateInput(bad), null, "invalid input rejected");
for (const message of [{ type: "move", dx: -2048, dy: 2048 }, { type: "scroll", dx: 0, dy: -120 }, { type: "button", button: "left", down: false }, { type: "release" }, { type: "ping" }]) t.deepEqual(validateInput(message), message, "valid event preserved");
for (const steps of [-8, -1, 1, 8]) t.deepEqual(validateInput({ type: "zoom", steps }), { type: "zoom", steps }, "bounded zoom accepted");
for (const steps of [0, -9, 9, .5, "1", null, NaN, Infinity]) t.equal(validateInput({ type: "zoom", steps }), null, "invalid zoom rejected");
t.equal(validateInput({ type: "zoom", steps: 1, key: "Alt" }), null, "zoom cannot inject arbitrary keys");
const signature = { strokes: [[[.1, .2], [.6, .7]], [[.2, .8]]], color: "black" };
for (const text of ["Hello 🙂", "مرحبا 👋🏽", "漢字 café", "x".repeat(1024)]) {
  const message = { type: "text", target: "1", text };
  t.deepEqual(validateInput(message), message, "Unicode text survives validation");
}
for (const text of ["", "x".repeat(1025), "\ud800", "\udc00", "\u0000", "\u001b"]) t.equal(validateInput({ type: "text", target: "1", text }), null, "malformed or oversized text rejected");
for (const target of ["", "0", "../app", 1]) t.equal(validateInput({ type: "text", target, text: "hi" }), null, "target must be a host-issued token");
t.equal(validateInput({ type: "key", target: "1", key: "Control" }), null, "keyboard cannot leave modifiers held");
t.deepEqual(validateInput({ type: "key", target: "1", key: "Enter" }), { type: "key", target: "1", key: "Enter" }, "explicit Enter supported");
t.deepEqual(validateSignature(signature), signature, "signature vectors accepted");
for (const bad of [{ ...signature, path: "C:\\unwanted.png" }, { ...signature, color: "red" }, { strokes: [], color: "black" }, { strokes: [[[2, .5]]], color: "black" }, { strokes: [[[NaN, .5]]], color: "black" }, { strokes: [Array(2049).fill([0, 0])], color: "black" }, { strokes: Array(65).fill([[0, 0]]), color: "black" }]) t.throws(() => validateSignature(bad), "invalid signature rejected before native work");

// Gestures use the same code as the phone, with an input sink instead of the PC cursor.
const events = []; let time = 0, dragging = false;
const gesture = new TouchpadGestures({ now: () => time, dragging: () => dragging, move: (...xy) => events.push(["move", ...xy]), scroll: (...xy) => events.push(["scroll", ...xy]), zoom: (steps) => events.push(["zoom", steps]), click: (button) => events.push(["click", button]) });
gesture.down(1, 10, 10); gesture.update(1, 30, 15); gesture.up(1);
t.deepEqual(events.splice(0), [["move", 20, 5]], "movement does not become a tap");
gesture.down(1, 10, 10); time += 100; gesture.up(1);
t.deepEqual(events.splice(0), [["click", "left"]], "single tap clicks left");
gesture.down(1, 10, 10); gesture.down(2, 20, 10); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["click", "right"]], "two-finger tap clicks right once");
gesture.down(1, 10, 10); gesture.down(2, 110, 10); gesture.update(1, 10, 50); gesture.update(2, 110, 50); gesture.flush(); gesture.up(1); gesture.update(2, 150, 80); gesture.up(2);
t.deepEqual(events.splice(0), [["scroll", 0, 40]], "parallel slide scrolls without moving cursor after one finger lifts");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, 20, 0);
t.equal(gesture.flush(), true, "wait for the second pointer before classifying a staggered slide");
time += 16; gesture.update(2, 120, 0); gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["scroll", 20, 0]], "staggered horizontal slide does not zoom");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, -15, 0); gesture.update(2, 115, 0); gesture.flush();
gesture.update(1, 0, 0); gesture.update(2, 100, 0); gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["zoom", 2], ["zoom", -2]], "stretch zooms in and pinch zooms out without scrolling or clicking");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, -30, 0); gesture.flush(); time += 50; gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["zoom", 2]], "pinch also works with one stationary finger");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, -6, 0); gesture.update(2, 106, 0); gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["zoom", 1]], "small recognized pinch cannot produce a right click");
gesture.down(1, 0, 0); gesture.down(2, 100, 0);
for (let i = 1; i <= 6; i++) { gesture.update(1, -i, 0); gesture.update(2, 100 + i, 0); gesture.flush(); }
gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["zoom", 1]], "slow pinch accumulates below-threshold movement");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, -5000, 0); gesture.update(2, 5000, 0); gesture.flush(); gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["zoom", 8]], "large pinch is bounded and does not replay excess steps on idle frames");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, -15, 0); gesture.update(2, 115, 0); gesture.flush();
gesture.update(1, -15, 50); gesture.update(2, 115, 50); gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [["zoom", 2]], "recognized pinch stays zoom when fingers subsequently translate");
gesture.down(1, 10, 10); gesture.up(1, true);
t.deepEqual(events.splice(0), [], "cancel never clicks");
gesture.down(1, 10, 10); gesture.down(2, 20, 10); gesture.up(1, true); gesture.up(2);
t.deepEqual(events.splice(0), [], "cancel of either finger prevents right click");
dragging = true; gesture.down(1, 10, 10); gesture.up(1);
t.deepEqual(events.splice(0), [], "tap while dragging does not release the held button");
gesture.down(1, 0, 0); gesture.down(2, 100, 0); gesture.update(1, -20, 0); gesture.update(2, 120, 0); gesture.flush(); gesture.up(1); gesture.up(2);
t.deepEqual(events.splice(0), [], "pinch is disabled while dragging");
dragging = false; gesture.down(1, 0, 0); gesture.down(2, 0, 0); gesture.down(3, 0, 0); gesture.up(3); gesture.up(2); gesture.up(1);
t.deepEqual(events.splice(0), [], "three fingers do not click");

const children = [];
function spawn(file, args, options) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  child.kill = () => { child.killed = true; child.emit("close", null); };
  child.message = (value) => child.stdout.write(JSON.stringify(value) + "\n");
  children.push({ child, file, args, options }); return child;
}
const native = createWindowsInput({ helperPath: "C:\\Win & Dock\\helper.exe", spawn, startupMs: 100, stopMs: 30 });
const focusEvents = [];
const worker = native.open(undefined, event => focusEvents.push(event)); const entry = children.at(-1);
t.deepEqual(entry.args, ["touchpad"], "touchpad has fixed argv");
t.equal(entry.options.shell, false, "no shell interpolation");
t.equal(entry.options.windowsHide, true, "native helper stays hidden");
entry.child.message({ type: "ready" }); await worker.ready;
entry.child.message({ type: "focus", target: "12", editable: true, password: false, value: "must not be forwarded" });
t.deepEqual(focusEvents, [{ type: "focus", target: "12", editable: true, password: false }], "bridge forwards focus metadata only");
worker.send({ type: "text", target: "12", text: "Hello 🙂" });
t.deepEqual(JSON.parse(entry.child.stdin.read().toString()), { type: "text", target: "12", text: "Hello 🙂" }, "emoji text reaches native pipe unchanged");
worker.send({ type: "move", dx: 15, dy: 7 });
t.equal(entry.child.stdin.read().toString(), '{"type":"move","dx":15,"dy":7}\n', "bounded JSON is streamed to one worker");
worker.send({ type: "zoom", steps: -2 });
t.equal(entry.child.stdin.read().toString(), '{"type":"zoom","steps":-2}\n', "zoom uses the same validated persistent bridge");
t.throws(() => worker.send({ type: "shell" }), "bridge revalidates input");
const closing = worker.close();
t.equal(entry.child.stdin.read().toString(), '{"type":"release"}\n', "close releases before ending stdin");
entry.child.emit("close", 0); await closing;
t.throws(() => worker.send({ type: "ping" }), "closed worker cannot accept events");
const save = native.saveSignature(signature); const image = children.at(-1);
t.deepEqual(image.args, ["signature"], "signature cannot choose a destination or argv");
t.deepEqual(JSON.parse(image.child.stdin.read().toString()), signature, "only validated stroke data enters helper");
await t.rejects(() => native.saveSignature(signature), "concurrent save is refused");
image.child.message({ type: "saved", path: "C:\\Pictures\\WinDock\\Signatures\\test.png" }); image.child.emit("close", 0);
t.ok((await save).path.endsWith("test.png"), "save waits for native success");
const insert = native.saveSignature(signature, true); const pasted = children.at(-1);
t.deepEqual(pasted.args, ["signature-insert"], "insertion uses a fixed helper verb");
pasted.child.message({ type: "saved", path: "C:\\Pictures\\signature.png", clipboard: true, pasteRequested: false }); pasted.child.emit("close", 0);
t.equal((await insert).pasteRequested, false, "clipboard fallback does not claim paste succeeded");
const failedSave = native.saveSignature(signature); children.at(-1).child.emit("close", 2);
await t.rejects(() => failedSave, "failed native export never claims success");
const timeoutWorker = native.open(); await t.rejects(() => timeoutWorker.ready, "startup has a deadline"); await timeoutWorker.close();
t.ok(children.at(-1).child.killed, "unresponsive helper is bounded"); native.dispose();

const received = [], sessions = [], provider = { id: "test", displayName: "Test", listRunningApps: async () => [], input: {
  open(_fail, emit) { emit({ type: "focus", target: "1", editable: true, password: false }); const session = { closed: false, ready: Promise.resolve(), send: (value) => received.push(value), close() { session.closed = true; } }; sessions.push(session); return session; },
  saveSignature: async () => ({ type: "saved", path: "Pictures/WinDock/Signatures/example.png" }), dispose() {},
} };
const app = await createApp({ provider, pin: "432187", trustLoopback: false, configStore: { load: async () => ({ tiles: [] }) } });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
let cookie = "";
async function request(path, body, origin = base) {
  const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { cookie, origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (res.headers.has("set-cookie")) cookie = res.headers.get("set-cookie").split(";")[0];
  return { code: res.status, data: await res.json() };
}
function socket(path = "/input", headers = { cookie, origin: base }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + path, { headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout")); }, 3000);
    ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    ws.once("message", (data) => { clearTimeout(timer); resolve({ ws, first: JSON.parse(data.toString()) }); });
  });
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
try {
  t.equal((await request("/api/input")).code, 401, "input capabilities require pairing");
  t.equal((await request("/api/signature", signature)).code, 401, "signature saving requires pairing");
  t.equal((await request("/api/signature/insert", signature)).code, 401, "signature insertion requires pairing");
  await t.rejects(() => socket(), "unpaired input websocket refused");
  await request("/api/auth", { pin: "432187" });
  t.equal((await request("/api/signature", signature, "https://evil.example")).code, 403, "foreign origin cannot save signatures");
  t.equal((await request("/api/signature/insert", signature, "https://evil.example")).code, 403, "foreign origin cannot paste a signature");
  await t.rejects(() => socket("/input", { cookie, origin: "https://evil.example" }), "foreign origin cannot control mouse");
  t.equal((await request("/api/signature", { ...signature, path: "bad" })).code, 400, "HTTP prevents arbitrary file paths");
  t.equal((await request("/api/signature", signature)).code, 200, "paired signature export succeeds");
  t.equal((await request("/api/signature/insert", signature)).code, 200, "paired signature insertion succeeds");
  const first = await socket(); t.equal(first.first.type, "ready", "input channel opens only after worker ready");
  const duplicate = await socket(); t.equal(duplicate.first.type, "error", "second device cannot steal mouse ownership"); duplicate.ws.close();
  const sync = await socket("/"); t.equal(sync.first.type, "snapshot", "dock sync still has its own channel");
  sync.ws.send(JSON.stringify({ type: "move", dx: 99, dy: 99 })); await wait(); t.equal(received.length, 0, "dock sync never controls mouse"); sync.ws.close();
  first.ws.send(JSON.stringify({ type: "button", button: "left", down: true })); first.ws.send(JSON.stringify({ type: "move", dx: 10, dy: -8 })); await wait();
  t.equal(received.length, 2, "paired validated input arrives in order");
  first.ws.send(JSON.stringify({ type: "zoom", steps: 1 })); await wait();
  t.deepEqual(received.at(-1), { type: "zoom", steps: 1 }, "paired zoom reaches native provider");
  const unicode = { type: "text", target: "1", text: "🙂".repeat(400) };
  first.ws.send(JSON.stringify(unicode)); await wait();
  t.deepEqual(received.at(-1), unicode, "Unicode frames larger than the old mouse-only limit reach the native provider");
  const closed = once(first.ws, "close"); first.ws.send(JSON.stringify({ type: "move", dx: 5000, dy: 0 })); await closed; await wait();
  t.equal(received.length, 4, "malformed movement never reaches Windows"); t.ok(sessions[0].closed, "malformed input releases mouse session");
  const oversized = await socket(); const oversizedClose = once(oversized.ws, "close"); oversized.ws.send("x".repeat(8193)); await oversizedClose; await wait();
  t.ok(sessions[1].closed, "oversized frame releases session");
  const idle = await socket(); await once(idle.ws, "close"); await wait(); t.ok(sessions[2].closed, "missing phone heartbeat releases ownership");
  const revoked = await socket(); app.sessions.revokeAll(); await once(revoked.ws, "close"); await wait(); t.ok(sessions[3].closed, "expired pairing releases live input");
} finally {
  await app.inputHub.close(); await app.hub.close(); app.server.closeAllConnections(); await new Promise((resolve) => app.server.close(resolve));
}

// A host without input or capture explains itself without naming an OS it may not be.
const bare = await createApp({ provider: { id: "test", displayName: "Test", listRunningApps: async () => [] }, pin: "432187", trustLoopback: false, configStore: { load: async () => ({ tiles: [] }) } });
await new Promise((resolve) => bare.server.listen(0, "127.0.0.1", resolve));
const bareBase = `http://127.0.0.1:${bare.server.address().port}`;
try {
  const auth = await fetch(bareBase + "/api/auth", { method: "POST", headers: { origin: bareBase, "content-type": "application/json" }, body: JSON.stringify({ pin: "432187" }) });
  const headers = { cookie: auth.headers.get("set-cookie").split(";")[0], origin: bareBase, "content-type": "application/json" };
  const post = async (path, body) => { const res = await fetch(bareBase + path, { method: "POST", headers, body: JSON.stringify(body) }); return { code: res.status, error: (await res.json()).error }; };
  t.equal((await (await fetch(bareBase + "/api/input", { headers })).json()).available, false, "a host without input reports it unavailable");
  const ws = new WebSocket(bareBase.replace("http:", "ws:") + "/input", { headers });
  const touchpad = JSON.parse((await once(ws, "message"))[0].toString()); ws.close();
  t.equal(touchpad.type, "error", "a host without input refuses the touchpad");
  const signatureReply = await post("/api/signature", signature), captureReply = await post("/api/capture/screenshot", {});
  t.equal(signatureReply.code, 501, "a host without input refuses signatures as unsupported");
  t.equal(captureReply.code, 501, "a host without capture refuses captures as unsupported");
  for (const [name, error] of [["touchpad", touchpad.error], ["signature", signatureReply.error], ["capture", captureReply.error]]) {
    t.ok(/WinDock on your PC/.test(error) && !/windows/i.test(error), `missing ${name} support names no operating system`);
  }
} finally {
  await bare.inputHub.close(); await bare.hub.close(); bare.server.closeAllConnections(); await new Promise((resolve) => bare.server.close(resolve));
}

// A helper that exits before `ready` is reported with the platform's own advice.
t.ok(/Update WinDock/.test(createWindowsInput({ helperPath: "H.exe" }).startupError), "Windows startup failures still suggest updating the host");
const stalled = await createApp({ provider: { id: "test", displayName: "Test", listRunningApps: async () => [], input: {
  startupError: "platform specific startup advice",
  open() { const ready = Promise.reject(new Error("helper exited")); ready.catch(() => {}); return { ready, send() {}, close: async () => {} }; },
  saveSignature: async () => ({}), dispose() {},
} }, pin: "432187", trustLoopback: false, configStore: { load: async () => ({ tiles: [] }) } });
await new Promise((resolve) => stalled.server.listen(0, "127.0.0.1", resolve));
const stalledBase = `http://127.0.0.1:${stalled.server.address().port}`;
try {
  const auth = await fetch(stalledBase + "/api/auth", { method: "POST", headers: { origin: stalledBase, "content-type": "application/json" }, body: JSON.stringify({ pin: "432187" }) });
  const ws = new WebSocket(stalledBase.replace("http:", "ws:") + "/input", { headers: { cookie: auth.headers.get("set-cookie").split(";")[0], origin: stalledBase } });
  const reply = JSON.parse((await once(ws, "message"))[0].toString()); ws.close();
  t.deepEqual(reply, { type: "error", error: "platform specific startup advice" }, "the phone gets the platform's startup advice");
} finally {
  await stalled.inputHub.close(); await stalled.hub.close(); stalled.server.closeAllConnections(); await new Promise((resolve) => stalled.server.close(resolve));
}
t.done("input verification passed");
