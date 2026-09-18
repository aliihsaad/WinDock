import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createExec } from "../src/platform/index.js";
import { primaryAddress } from "../src/discovery.js";

assert.equal(process.platform, "win32", "run this hardware check on Windows");
const root = resolve(import.meta.dirname, "..");
const packageDir = join(root, "artifacts", "WinDock-win-x64");
const helperPath = join(packageDir, "WinDockHelper.exe");
const fixturePath = join(root, "artifacts", "probe", "WinDockProbe.exe");
const exec = createExec();
const provider = createWindowsProvider({ exec, helperPath });
const temp = await mkdtemp(join(tmpdir(), "windock-native-"));
const signal = join(temp, "probe.json");
let probe;
async function waitForFile(path) {
  for (let i = 0; i < 100; i++) {
    try { return await readFile(path, "utf8"); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
try {
  await provider.launchApp({ target: fixturePath, args: `"${signal}" "Work Space" "x&y"` });
  probe = JSON.parse(await waitForFile(signal));
  assert.deepEqual(probe.arguments, ["Work Space", "x&y"]);
  assert.ok((await provider.listRunningApps()).some(app => app.pid === probe.pid));
  await provider.focusApp(probe);
  await provider.closeApp(probe);
  await waitForFile(signal + ".closed");
  console.log("PASS native launch arguments, enumeration, focus and polite close");

  // Preserve the user's setting: write the existing scalar, not a new level.
  // The integer control interface rounds to percent, so only test its setter
  // when the current scalar already represents an integer percentage.
  try {
    const before = JSON.parse((await exec(helperPath, ["volume"])).stdout).volume;
    const percent = Math.round(before * 100);
    if (Math.abs(before - percent / 100) < 0.0001) {
      await provider.control("volume-set", percent);
      const after = JSON.parse((await exec(helperPath, ["volume"])).stdout).volume;
      assert.ok(Math.abs(before - after) < 0.0001);
      console.log("PASS Core Audio read and set current volume without changing the level");
    } else console.log("PASS Core Audio read; skipped setter to preserve fractional volume");
  } catch (error) {
    if (error.code === 2) console.log("UNVERIFIED Core Audio: no accessible endpoint");
    else throw error;
  }
  await provider.nowPlaying();
  console.log("PASS now-playing command (an active media session is optional)");

  const result = await promisify(execFile)(join(packageDir, "WinDockTray.exe"), ["--smoke-test"], {
    cwd: temp, windowsHide: true, timeout: 30000,
    env: { ...process.env, PORT: "18620", WINDOCK_CONFIG: join(temp, "config.json") },
  });
  assert.match(result.stdout, /TRAY OK/);
  console.log("PASS packaged tray starts bundled Node from a different working directory and stops its server");
  console.log(`WINDOWS SMOKE OK; LAN address ${primaryAddress()}`);
} finally {
  if (probe) {
    try { await readFile(signal + ".closed"); }
    catch {
      await provider.closeApp(probe).catch(() => {});
      try { await waitForFile(signal + ".closed"); }
      catch { try { process.kill(probe.pid); } catch { /* fixture already exited */ } }
    }
  }
  await rm(temp, { recursive: true, force: true });
}
