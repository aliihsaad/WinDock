/**
 * Repository test suite.
 *
 * Runs every gate oracle in sequence and prints SUITE OK only when all of them
 * exit zero AND print their own success marker. A script that exits zero without
 * its marker is treated as a failure, so a silently gutted oracle cannot make
 * the suite green.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dirname, "..", "scripts");

/** Each oracle and the marker it must print. */
const EXPECTED = {
  "verify-contract.mjs": "contract verification passed",
  "verify-inventory.mjs": "inventory verification passed",
  "verify-running.mjs": "running verification passed",
  "verify-launch.mjs": "launch verification passed",
  "verify-control.mjs": "control verification passed",
  "verify-auth.mjs": "auth verification passed",
  "verify-injection.mjs": "injection verification passed",
  "verify-discovery.mjs": "discovery verification passed",
  "verify-api.mjs": "api verification passed",
  "verify-sync.mjs": "sync verification passed",
  "verify-pwa.mjs": "pwa verification passed",
  "verify-editing.mjs": "editing verification passed",
  "verify-offline.mjs": "offline verification passed",
  "verify-android.mjs": "android verification passed",
  "verify-launcher.mjs": "launcher verification passed",
  "verify-capture.mjs": "capture verification passed",
};

// Guard against an oracle being added to scripts/ but never wired in here.
const onDisk = readdirSync(SCRIPTS)
  .filter((f) => f.startsWith("verify-") && f.endsWith(".mjs"))
  .sort();
const declared = Object.keys(EXPECTED).sort();
const missing = onDisk.filter((f) => !declared.includes(f));
if (missing.length) {
  process.stderr.write(`suite: oracle(s) not wired into the suite: ${missing.join(", ")}\n`);
  process.exit(1);
}
const absent = declared.filter((f) => !onDisk.includes(f));
if (absent.length) {
  process.stderr.write(`suite: declared oracle(s) missing from disk: ${absent.join(", ")}\n`);
  process.exit(1);
}

let failed = 0;
let total = 0;

for (const [script, marker] of Object.entries(EXPECTED)) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(SCRIPTS, script)], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${run.stdout || ""}${run.stderr || ""}`;
  const ms = Date.now() - started;
  total += 1;

  const okExit = run.status === 0;
  const okMarker = out.includes(marker);
  if (okExit && okMarker) {
    const count = (out.match(/^(\d+) assertions$/m) || [])[1] || "?";
    process.stdout.write(`  PASS  ${script.padEnd(24)} ${String(count).padStart(4)} assertions  ${ms}ms\n`);
    continue;
  }

  failed += 1;
  process.stdout.write(`  FAIL  ${script.padEnd(24)} exit=${run.status} marker=${okMarker}  ${ms}ms\n`);
  for (const line of out.trim().split("\n")) process.stdout.write(`        ${line}\n`);
}

process.stdout.write(`\n${total - failed}/${total} oracles passed\n`);
if (failed > 0) {
  process.stdout.write(`SUITE FAILED (${failed} failing)\n`);
  process.exit(1);
}
process.stdout.write("SUITE OK\n");
