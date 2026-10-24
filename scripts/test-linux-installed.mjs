// Run as an ordinary user inside a disposable Linux package-test container.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

assert.notEqual(process.getuid(), 0, "test the app without root");
for (const tool of ["node", "npm", "cargo", "rustc"]) {
  assert.notEqual(spawnSync("sh", ["-c", `command -v ${tool}`]).status, 0, `${tool} must not be installed globally`);
}
const version = spawnSync("windock", ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
assert.match(version.stdout, /^WinDock \d+\.\d+\.\d+/);
const unsupported = spawnSync("windock", [], { env: { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: "" }, encoding: "utf8" });
assert.equal(unsupported.status, 1);
assert.match(unsupported.stderr, /Hyprland desktop session/);
const check = spawnSync("/usr/lib/windock/windock-input", ["check"], { encoding: "utf8" });
assert.equal(check.status, 0, check.stderr);
assert.equal(JSON.parse(check.stdout).wtype, true);
assert.equal(JSON.parse(check.stdout).wlCopy, true);

const configDir = `${homedir()}/.config/windock`;
await mkdir(configDir, { recursive: true });
const saved = { version: 1, tiles: [{ kind: "control", verb: "mute-toggle", label: "Keep my dock" }] };
await writeFile(`${configDir}/config.json`, JSON.stringify(saved));
// No compositor is available in CI: only validate packaged startup and HTTP.
const child = spawn("windock", [], {
  env: { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: "package-test-no-compositor", PORT: "18620" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (b) => { output += b; });
child.stderr.on("data", (b) => { output += b; });
const exited = once(child, "exit");
try {
  for (let i = 0; i < 100 && !output.includes("WinDock host ready"); i++) {
    assert.equal(child.exitCode, null, output);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(output, /WinDock host ready/);
  const pin = output.match(/PIN:\s+(\d{4})\b/)?.[1];
  assert.ok(pin, "launcher displays a pairing PIN");
  const base = "http://127.0.0.1:18620";
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, app: "windock", platform: "linux" });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /WinDock/);
  const auth = await fetch(`${base}/api/auth`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }),
  });
  assert.equal(auth.status, 200, "pairing with the displayed PIN works");
  assert.deepEqual(await (await fetch(`${base}/api/tiles`)).json(), saved);
  const image = spawnSync("/usr/lib/windock/windock-input", ["signature", `${homedir()}/signature-test`], {
    input: JSON.stringify({ color: "black", strokes: [[[0.1, 0.2], [0.6, 0.8]]] }), encoding: "utf8",
  });
  assert.equal(image.status, 0, image.stderr);
  assert.match(image.stdout, /\.png/);
} finally {
  child.kill("SIGTERM");
  await exited;
}
assert.deepEqual(JSON.parse(await readFile(`${configDir}/config.json`, "utf8")), saved);
console.log("Installed Linux app: launch, runtime, PIN pairing, assets, saved dock and native signature PASS");
