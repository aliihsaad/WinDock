/** G3: running-window enumeration yields stable app identities. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import {
  parseRunning,
  parseStats,
  appIdFromTarget,
  createWindowsProvider,
  RUNNING_PS,
  PS_FLAGS,
  POWERSHELL,
} from "../src/platform/windows.js";

const t = createChecker("running");
const fixtures = join(import.meta.dirname, "..", "test", "fixtures");
const read = (f) => readFileSync(join(fixtures, f), "utf8");

const running = parseRunning(read("running.json"));
const pids = running.map((r) => r.pid);

t.equal(running.length, 2, "only windowed, valid processes survive");
t.ok(pids.includes(4812), "windowed firefox is present");
t.ok(pids.includes(1200), "windowed explorer is present");
t.ok(!pids.includes(9001), "process with handle 0 is excluded");
t.ok(!pids.includes(0), "pid 0 is excluded");
t.equal(new Set(pids).size, pids.length, "duplicate pids collapse to one entry");
t.deepEqual(pids, [...pids].sort((a, b) => a - b), "entries are sorted by pid");

const ff = running.find((r) => r.pid === 4812);
t.equal(
  ff.id,
  appIdFromTarget("C:\\Program Files\\Mozilla Firefox\\firefox.exe"),
  "running id matches the installed id for the same executable",
);
t.equal(ff.title, "WinDock - Mozilla Firefox", "window title is preserved");
t.ok(Number.isInteger(ff.handle) && ff.handle !== 0, "window handle is a non-zero integer");

for (const bad of ["", "not json", "null", "[]", "{}"]) {
  t.ok(Array.isArray(parseRunning(bad)), `malformed running input yields an array: ${JSON.stringify(bad)}`);
}
t.ok(parseRunning(read("running.json")).length > 0, "negative control: valid fixture is not empty");

const stats = parseStats(read("stats.json"));
t.equal(stats.cpu, 37, "cpu percentage is rounded");
t.equal(stats.memory, 63, "memory percentage is computed from total and free");
t.equal(stats.battery, 88, "battery percentage is read");
t.equal(stats.charging, true, "charging flag is read");
const emptyStats = parseStats("");
t.equal(emptyStats.cpu, null, "absent stats degrade to null rather than NaN");
t.equal(emptyStats.memory, null, "absent memory degrades to null");

let captured = null;
const provider = createWindowsProvider({
  exec: async (file, args) => {
    captured = { file, args };
    return { stdout: read("running.json") };
  },
});
t.equal((await provider.listRunningApps()).length, 2, "provider returns parsed running apps");
t.equal(captured.file, POWERSHELL, "provider invokes powershell.exe");
t.deepEqual(captured.args, [...PS_FLAGS, RUNNING_PS], "provider passes the constant running script");

t.done("running verification passed");
