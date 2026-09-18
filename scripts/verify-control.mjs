/** G5: every declared control verb maps to a native action on every provider. */
import { createChecker } from "./lib/assert.mjs";
import {
  CONTROL_VERBS,
  CONTROL_VERB_RANGES,
  DESTRUCTIVE_VERBS,
  validateControl,
  isControlVerb,
  isDestructiveVerb,
} from "../src/platform/contract.js";
import { controlArgv, unmappedVerbs, createWindowsProvider, HELPER_CONTROL } from "../src/platform/windows.js";
import { createLinuxProvider, LINUX_CONTROL } from "../src/platform/linux.js";

const t = createChecker("control");
const HELPER = "WinDockHelper.exe";

// Completeness: no declared verb may be silently unimplemented on either OS.
t.deepEqual(unmappedVerbs(), [], "every contract verb is mapped on Windows");
t.deepEqual(
  CONTROL_VERBS.filter((v) => !LINUX_CONTROL[v]),
  [],
  "every contract verb is mapped on Linux",
);
t.equal(Object.keys(HELPER_CONTROL).length, CONTROL_VERBS.length, "Windows map has no extra verbs");
t.equal(Object.keys(LINUX_CONTROL).length, CONTROL_VERBS.length, "Linux map has no extra verbs");
t.ok(CONTROL_VERBS.length >= 13, `expected at least 13 verbs, found ${CONTROL_VERBS.length}`);

// Valueless verbs produce a two-element argv; valued verbs append the integer.
for (const verb of CONTROL_VERBS) {
  const ranged = CONTROL_VERB_RANGES[verb];
  const argv = ranged ? controlArgv(verb, ranged.min) : controlArgv(verb);
  t.equal(argv[0], "control", `${verb} argv starts with the control verb`);
  t.equal(argv[1], verb, `${verb} argv names the verb`);
  t.equal(argv.length, ranged ? 3 : 2, `${verb} argv length matches its arity`);
  t.ok(argv.every((a) => typeof a === "string"), `${verb} argv is all strings`);
}

// Range enforcement, including the boundaries.
for (const [verb, range] of Object.entries(CONTROL_VERB_RANGES)) {
  t.ok(validateControl(verb, range.min).ok, `${verb} accepts its minimum ${range.min}`);
  t.ok(validateControl(verb, range.max).ok, `${verb} accepts its maximum ${range.max}`);
  t.ok(!validateControl(verb, range.min - 1).ok, `${verb} rejects below minimum`);
  t.ok(!validateControl(verb, range.max + 1).ok, `${verb} rejects above maximum`);
  t.ok(!validateControl(verb, 50.5).ok, `${verb} rejects a non-integer`);
  t.ok(!validateControl(verb, "50").ok, `${verb} rejects a numeric string`);
  t.ok(!validateControl(verb, NaN).ok, `${verb} rejects NaN`);
  t.ok(!validateControl(verb, null).ok, `${verb} requires a value`);
}

// A valueless verb must refuse a stray value rather than pass it to argv.
t.ok(!validateControl("mute-toggle", 5).ok, "valueless verb rejects an unexpected value");
t.ok(validateControl("mute-toggle", null).ok, "valueless verb accepts a null value");

// Negative control: unknown verbs never reach a command line.
for (const bad of ["reboot-now", "", "VOLUME-UP", "lock; rm -rf /", null, 42, {}]) {
  t.ok(!validateControl(bad, null).ok, `unknown verb rejected: ${JSON.stringify(bad)}`);
  t.ok(!isControlVerb(bad), `isControlVerb false for ${JSON.stringify(bad)}`);
  t.throws(() => controlArgv(bad, null), `controlArgv throws for ${JSON.stringify(bad)}`);
}

t.deepEqual([...DESTRUCTIVE_VERBS], ["lock", "sleep", "shutdown", "restart"], "destructive set is exact");
t.ok(isDestructiveVerb("shutdown"), "shutdown is destructive");
t.ok(!isDestructiveVerb("volume-up"), "volume-up is not destructive");

// Providers must dispatch the mapped argv and nothing else.
const winCalls = [];
const win = createWindowsProvider({
  exec: async (file, args) => {
    winCalls.push({ file, args });
    return { stdout: "" };
  },
  helperPath: HELPER,
});
await win.control("volume-set", 40);
t.equal(winCalls[0].file, HELPER, "windows control dispatches to the helper");
t.deepEqual(winCalls[0].args, ["control", "volume-set", "40"], "windows control argv is exact");
await t.rejects(() => win.control("nope", null), "windows control rejects an unknown verb");
await t.rejects(() => win.control("volume-set", 999), "windows control rejects an out-of-range value");
t.equal(winCalls.length, 1, "no exec is issued for rejected control input");

// Brightness firmware receives requests one at a time, and one failure must
// neither leak helper details nor poison the queue for the next press.
const brightnessCalls = [];
const releases = [];
const brightnessWin = createWindowsProvider({ helperPath: HELPER, exec: (file, args) => {
  brightnessCalls.push(args);
  return new Promise((resolve, reject) => releases.push({ resolve, reject }));
} });
const firstBrightness = brightnessWin.control("brightness-set", 25).catch(error => error);
const nextBrightness = brightnessWin.control("brightness-set", 50);
await Promise.resolve();
t.equal(brightnessCalls.length, 1, "brightness does not issue overlapping native commands");
releases[0].reject(new Error("private helper path / native failure"));
const brightnessError = await firstBrightness;
t.equal(brightnessError.status, 503, "brightness hardware failure has a useful HTTP status");
t.ok(brightnessError.message.includes("DDC/CI"), "brightness failure explains monitor support");
t.ok(!brightnessError.message.includes("private helper"), "native diagnostics stay out of user-facing errors");
t.equal(brightnessCalls.length, 2, "brightness queue continues after a rejected command");
t.deepEqual(brightnessCalls[1], ["control", "brightness-set", "50"], "queued brightness retains its requested value");
releases[1].resolve({ stdout: "" });
t.equal((await nextBrightness).ok, true, "the next brightness request can succeed");

const linCalls = [];
const lin = createLinuxProvider({
  exec: async (file, args) => {
    linCalls.push({ file, args });
    return { stdout: "" };
  },
});
await lin.control("volume-set", 40);
t.equal(linCalls[0].file, "pactl", "linux volume-set uses pactl");
t.deepEqual(linCalls[0].args, ["set-sink-volume", "@DEFAULT_SINK@", "40%"], "linux volume argv is exact");
await lin.control("media-play-pause", null);
t.equal(linCalls[1].file, "playerctl", "linux media control uses playerctl");
await t.rejects(() => lin.control("nope", null), "linux control rejects an unknown verb");

t.done("control verification passed");
