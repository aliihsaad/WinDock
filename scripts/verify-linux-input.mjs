/** Linux touchpad, phone keyboard and signatures: the windock-input bridge. */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createChecker } from "./lib/assert.mjs";
import { createLinuxInput, INPUT_HELPER, signatureDir } from "../src/platform/linux-input.js";
import { createLinuxProvider } from "../src/platform/linux.js";

const t = createChecker("linux-input");
const tmp = await mkdtemp(join(tmpdir(), "windock-linux-input-"));
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
const input = createLinuxInput({ helperPath: "/opt/win dock/windock-input", spawn, startupMs: 100, stopMs: 30, signatures: async () => dir, log: (line) => logs.push(line) });

// ---- touchpad: same protocol as the Windows helper ----
const events = [];
const worker = input.open(undefined, (event) => events.push(event));
const pad = children.at(-1);
t.equal(pad.file, "/opt/win dock/windock-input", "the helper path is used as-is, never through a shell");
t.deepEqual(pad.args, ["touchpad"], "touchpad has fixed argv");
t.equal(pad.options.shell, false, "no shell interpolation");
pad.child.message({ type: "ready" });
await worker.ready;
pad.child.message({ type: "focus", target: "7", editable: true, password: false, name: "Search", value: "secret" });
t.deepEqual(events, [{ type: "focus", target: "7", editable: true, password: false }], "focus metadata only, never names or values");
pad.child.message({ type: "focus", target: "0x5bff1fbb9bd0", editable: true, password: false });
t.equal(events.length, 1, "window addresses are not valid tokens");
pad.child.message({ type: "input-error" });
t.equal(events.at(-1).type, "input-error", "blocked keyboard input is reported");
worker.send({ type: "text", target: "7", text: "مرحبا 👋🏽" });
t.deepEqual(JSON.parse(pad.child.stdin.read().toString()), { type: "text", target: "7", text: "مرحبا 👋🏽" }, "Unicode text reaches the helper unchanged");
worker.send({ type: "zoom", steps: 3 });
t.equal(pad.child.stdin.read().toString(), '{"type":"zoom","steps":3}\n', "zoom is streamed");
t.throws(() => worker.send({ type: "key", target: "7", key: "Control" }), "modifier keys are refused before the helper");
pad.child.stderr.write("AT-SPI focus tracking is unavailable (no bus); the keyboard button still works.\n");
const closing = worker.close();
t.equal(pad.child.stdin.read().toString(), '{"type":"release"}\n', "close releases before ending stdin");
await tick();
pad.child.emit("close", 0);
await closing;
t.deepEqual(logs, ["AT-SPI focus tracking is unavailable (no bus); the keyboard button still works."], "helper diagnostics reach the host log once");

// A missing build or a missing udev rule must be explained on the host.
logs.length = 0;
const failures = [];
const missing = input.open(() => failures.push("failed"));
children.at(-1).child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
await t.rejects(() => missing.ready, "missing helper fails startup");
t.ok(logs[0]?.includes("npm run build:linux"), "missing helper explains how to build it");
t.equal(failures.length, 1, "the hub is told the worker failed");
await missing.close();
logs.length = 0;
const denied = input.open(() => {});
const deniedChild = children.at(-1).child;
deniedChild.stderr.write("/dev/uinput is not writable by this user, so the touchpad cannot move the pointer. Install native/linux/70-windock-uinput.rules (docs/DEVELOPMENT.md, Linux host).\n");
await tick();
deniedChild.emit("close", 2);
await t.rejects(() => denied.ready, "uinput permission failure fails startup");
t.ok(logs[0]?.includes("70-windock-uinput.rules"), "uinput permission failure names the udev rule");

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
t.ok(failure && !/windows/i.test(failure.message), "Linux errors do not mention Windows");
await t.rejects(() => input.saveSignature({ ...signature, path: "/etc/passwd" }), "clients cannot add a path");
input.dispose();

// ---- the folder follows user-dirs.dirs ----
const home = join(tmp, "home");
await mkdir(join(home, ".config"), { recursive: true });
await writeFile(join(home, ".config", "user-dirs.dirs"), 'XDG_PICTURES_DIR="$HOME/Bilder"\n');
t.equal(await signatureDir({ env: {}, home }), join(home, "Bilder", "WinDock", "Signatures"), "localized Pictures folder is honoured");
t.equal(await signatureDir({ env: {}, home: join(tmp, "nobody") }), join(tmp, "nobody", "Pictures", "WinDock", "Signatures"), "English default without user-dirs.dirs");

// ---- the provider exposes it ----
const provider = createLinuxProvider({ exec: async () => ({ stdout: "" }), appDirs: [], capture: {} });
t.ok(["open", "saveSignature", "dispose"].every((m) => typeof provider.input?.[m] === "function"), "Linux provider has input");
t.equal(createLinuxProvider({ exec: async () => ({ stdout: "" }), appDirs: [], capture: {}, input: null }).input, null, "input can be injected");

// ---- the udev rule grants injection to the seat user only ----
const rule = await readFile(new URL("../native/linux/70-windock-uinput.rules", import.meta.url), "utf8");
const active = rule.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
t.equal(active.length, 1, "one udev rule");
t.ok(/KERNEL=="uinput"/.test(active[0]) && /TAG\+="uaccess"/.test(active[0]), "uinput is granted to the active seat user");
t.ok(!/MODE=|GROUP=/.test(active[0]), "no world- or group-writable uinput");

// ---- the built helper, when present: real rendering, no desktop input ----
if (existsSync(INPUT_HELPER)) {
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
  const check = spawnSync(INPUT_HELPER, ["check"], { encoding: "utf8" });
  const report = JSON.parse(check.stdout || "{}");
  t.ok(["uinput", "wtype", "wlCopy", "hyprland", "atspi"].every((key) => key in report), "check reports every requirement");
} else {
  process.stdout.write(`native helper not built (${INPUT_HELPER}); run npm run build:linux to test it here\n`);
}

t.ok(/WinDock's output on the PC/.test(input.startupError) && !/update/i.test(input.startupError),
  "a Linux startup failure points at the logged cause (udev rule, uinput, build), not at updating");

await rm(tmp, { recursive: true, force: true });
t.done("linux-input verification passed");
