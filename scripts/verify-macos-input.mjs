/** macOS touchpad, phone keyboard and signatures: the windock-input bridge and, when built, the Swift helper. */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createChecker } from "./lib/assert.mjs";
import { createMacInput, INPUT_HELPER, signatureDir } from "../src/platform/macos-input.js";
import { createMacProvider } from "../src/platform/macos.js";

const t = createChecker("macos-input");
const tmp = await mkdtemp(join(tmpdir(), "windock-macos-input-"));
const signature = { strokes: [[[0.1, 0.5], [0.9, 0.5]], [[0.5, 0.9]]], color: "blue" };

const tick = () => new Promise((resolve) => setImmediate(resolve));
const children = [];
function spawn(file, args, options) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  child.kill = () => { child.killed = true; child.emit("close", null); };
  child.message = (value) => child.stdout.write(JSON.stringify(value) + "\n");
  children.push({ child, file, args, options });
  return child;
}
const logs = [];
const dir = join(tmp, "Pictures", "WinDock", "Signatures");
const input = createMacInput({ helperPath: "/Applications/Win Dock/windock-input", spawn, startupMs: 100, stopMs: 30, signatures: () => dir, log: (line) => logs.push(line) });

// ---- touchpad: same protocol as the Windows and Linux helpers ----
const events = [];
const worker = input.open(undefined, (event) => events.push(event));
const pad = children.at(-1);
t.equal(pad.file, "/Applications/Win Dock/windock-input", "the helper path is used as-is, never through a shell");
t.deepEqual(pad.args, ["touchpad"], "touchpad has fixed argv");
t.equal(pad.options.shell, false, "no shell interpolation");
pad.child.message({ type: "ready" });
await worker.ready;
pad.child.message({ type: "focus", target: "7", editable: true, password: false, name: "Search", value: "secret" });
t.deepEqual(events, [{ type: "focus", target: "7", editable: true, password: false }], "focus metadata only, never names or values");
pad.child.message({ type: "input-error" });
t.equal(events.at(-1).type, "input-error", "blocked keyboard input is reported");
worker.send({ type: "text", target: "7", text: "مرحبا 👋🏽" });
t.deepEqual(JSON.parse(pad.child.stdin.read().toString()), { type: "text", target: "7", text: "مرحبا 👋🏽" }, "Unicode text reaches the helper unchanged");
worker.send({ type: "zoom", steps: 3 });
t.equal(pad.child.stdin.read().toString(), '{"type":"zoom","steps":3}\n', "zoom is streamed");
t.throws(() => worker.send({ type: "key", target: "7", key: "Control" }), "modifier keys are refused before the helper");
const closing = worker.close();
t.equal(pad.child.stdin.read().toString(), '{"type":"release"}\n', "close releases before ending stdin");
await tick();
pad.child.emit("close", 0);
await closing;

// A missing build or a missing permission must be explained on the host.
const failures = [];
const missing = input.open(() => failures.push("failed"));
children.at(-1).child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
await t.rejects(() => missing.ready, "missing helper fails startup");
t.ok(logs[0]?.includes("npm run build:macos"), "missing helper explains how to build it");
t.equal(failures.length, 1, "the hub is told the worker failed");
await missing.close();
logs.length = 0;
const denied = input.open(() => {});
const deniedChild = children.at(-1).child;
deniedChild.stderr.write("Accessibility permission is not granted, so the touchpad cannot move the pointer or type. Open System Settings → Privacy & Security → Accessibility and allow the app that runs WinDock (your terminal), then reopen the touchpad.\n");
await tick();
deniedChild.emit("close", 2);
await t.rejects(() => denied.ready, "a missing Accessibility permission fails startup");
t.ok(logs[0]?.includes("Privacy & Security"), "the permission failure says where to grant it");
t.ok(/WinDock's output on the Mac/.test(input.startupError) && !/update/i.test(input.startupError), "a startup failure points at the logged cause, not at updating");

// ---- signatures: fixed verbs, host-chosen folder ----
const save = input.saveSignature(signature);
await tick();
const saver = children.at(-1);
t.deepEqual(saver.args, ["signature", dir], "signature folder comes from the host, not the phone");
t.deepEqual(JSON.parse(saver.child.stdin.read().toString()), signature, "only validated strokes reach the helper");
saver.child.message({ type: "saved", path: join(dir, "Signature-x.png"), name: "Signature-x.png", width: 1600, height: 600, clipboard: false, pasteRequested: false });
saver.child.emit("close", 0);
t.equal((await save).name, "Signature-x.png", "save waits for the helper");
const insert = input.saveSignature(signature, true);
await tick();
const inserter = children.at(-1);
t.deepEqual(inserter.args, ["signature-insert", dir], "insertion uses a fixed verb");
inserter.child.message({ type: "saved", path: join(dir, "Signature-y.png"), clipboard: true, pasteRequested: false });
inserter.child.emit("close", 0);
t.equal((await insert).pasteRequested, false, "a clipboard-only insert does not claim a paste");
const failed = input.saveSignature(signature);
await tick();
children.at(-1).child.emit("close", 2);
let failure;
try { await failed; } catch (error) { failure = error; }
t.equal(failure?.status, 503, "a failed export is a 503");
t.ok(failure && !/windows|linux/i.test(failure.message), "macOS errors do not mention other hosts");
await t.rejects(() => input.saveSignature({ ...signature, path: "/etc/passwd" }), "clients cannot add a path");
input.dispose();
t.equal(signatureDir("/Users/x"), "/Users/x/Pictures/WinDock/Signatures", "signatures live under Pictures/WinDock");

// ---- the provider exposes it ----
const provider = createMacProvider({ exec: async () => ({ stdout: "" }), appDirs: [], capture: {} });
t.ok(["open", "saveSignature", "dispose"].every((m) => typeof provider.input?.[m] === "function"), "macOS provider has input");
t.equal(createMacProvider({ exec: async () => ({ stdout: "" }), appDirs: [], capture: {}, input: null }).input, null, "input can be injected");

// ---- the built helper, when present: validation, real rendering, no desktop input ----
if (process.platform === "darwin" && existsSync(INPUT_HELPER)) {
  const usage = spawnSync(INPUT_HELPER, ["launch", "x"], { encoding: "utf8" });
  t.equal(usage.status, 1, "unknown verbs are usage errors");
  const relative = spawnSync(INPUT_HELPER, ["signature", "relative/dir"], { input: JSON.stringify(signature), encoding: "utf8" });
  t.equal(relative.status, 2, "relative folders are refused");
  const out = join(tmp, "native", "Signatures");
  const run = spawnSync(INPUT_HELPER, ["signature", out], { input: JSON.stringify(signature), encoding: "utf8" });
  t.equal(run.status, 0, `native export succeeds ${run.stderr}`);
  const result = JSON.parse(run.stdout || "{}");
  t.equal(result.type, "saved", "native export reports success");
  t.equal(result.clipboard, false, "plain save does not touch the clipboard");
  const files = await readdir(out);
  t.deepEqual(files, [result.name], "exactly one PNG is written");
  t.ok(/^Signature-\d{4}-\d\d-\d\d-\d{6}-[0-9a-f]{32}\.png$/.test(result.name), "file name is timestamped and random");
  const png = await readFile(join(out, result.name));
  t.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "output is a PNG");
  t.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [1600, 600, 6], "1600x600 RGBA");
  const bad = spawnSync(INPUT_HELPER, ["signature", out], { input: JSON.stringify({ ...signature, color: "red" }), encoding: "utf8" });
  t.equal(bad.status, 2, "native validation refuses unknown ink");
  t.equal((await readdir(out)).length, 1, "a refused signature creates no file");
  const check = JSON.parse(spawnSync(INPUT_HELPER, ["check"], { encoding: "utf8" }).stdout || "{}");
  t.ok(["accessibility", "screenRecording", "frontmost"].every((key) => typeof check[key] === "boolean"), "check reports every permission");

  // The validator agrees with src/input.js on the same vectors as the Rust helper's tests.
  const good = [
    '{"type":"move","dx":-2048,"dy":2048}', '{"type":"zoom","steps":-8}', '{"type":"button","button":"right","down":true}',
    '{"type":"key","target":"12","key":"ArrowLeft"}', '{"type":"text","target":"1","text":"مرحبا 👋🏽\\ttab"}', '{"type":"focus"}',
    '{"type":"ping"}', '{"type":"release"}', JSON.stringify({ type: "text", target: "1", text: "🙂".repeat(512) }),
  ];
  const bads = [
    '{"type":"move","dx":2049,"dy":0}', '{"type":"move","dx":0.5,"dy":0}', '{"type":"move","dx":1.0,"dy":0}', '{"type":"zoom","steps":0}', '{"type":"zoom","steps":9}',
    '{"type":"button","button":"middle","down":true}', '{"type":"button","button":"left","down":1}', '{"type":"key","target":"1","key":"Control"}',
    '{"type":"text","target":"0","text":"hi"}', '{"type":"text","target":"../x","text":"hi"}', '{"type":"text","target":"1","text":""}',
    '{"type":"text","target":"1","text":"\\u001b[2J"}', '{"type":"release","path":"/etc"}', '{"type":"launch"}', '{"type":"move","dx":true,"dy":0}',
    "not json", "[]", JSON.stringify({ type: "text", target: "1", text: "🙂".repeat(513) }),
  ];
  const verdicts = spawnSync(INPUT_HELPER, ["parse"], { input: [...good, ...bads].join("\n") + "\n", encoding: "utf8" }).stdout.trim().split("\n").map((line) => JSON.parse(line));
  t.equal(verdicts.length, good.length + bads.length, "every line gets a verdict");
  t.deepEqual(verdicts.slice(0, good.length).map((v) => v.ok), good.map(() => true), "the helper accepts the protocol");
  t.deepEqual(verdicts.slice(good.length).map((v) => v.ok), bads.map(() => false), "the helper rejects everything else");
  t.deepEqual(verdicts.slice(0, 3).map((v) => v.type), ["move", "zoom", "button"], "verdicts name the message kind only");
  t.ok(verdicts.every((v) => !JSON.stringify(v).includes("tab")), "typed text never comes back out of the helper");
  const oversized = spawnSync(INPUT_HELPER, ["parse"], { input: '{"type":"ping"' + " ".repeat(8200) + "}\n", encoding: "utf8" });
  t.ok(/Input too large/.test(oversized.stdout), "lines over 8192 bytes are refused by the validator too");
} else {
  process.stdout.write(`native helper not built (${INPUT_HELPER}); run npm run build:macos to test it here\n`);
}

await rm(tmp, { recursive: true, force: true });
t.done("macos-input verification passed");
