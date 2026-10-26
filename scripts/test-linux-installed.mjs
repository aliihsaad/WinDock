// Run as an ordinary user inside a disposable Linux package-test container.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

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
// No compositor or systemd user manager is available in CI: validate packaged
// startup and HTTP. Without a user manager the host runs in its window as before.
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
  assert.match(output, /runs in this window/, "without a user manager the window says it is the host");
  const pin = output.match(/PIN:\s+(\d{6})\b/)?.[1];
  assert.ok(pin, "launcher displays a pairing PIN");
  const status = spawnSync("windock", ["status"], { env: { ...process.env, PORT: "18620" }, encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /terminal window/, "status points at the window that shows the PIN");
  const base = "http://127.0.0.1:18620";
  const health = await (await fetch(`${base}/health`)).json();
  assert.deepEqual({ ok: health.ok, app: health.app, platform: health.platform },
    { ok: true, app: "windock", platform: "linux" });
  assert.equal(health.hostName, hostname(), "discovery reports this PC's name");
  assert.match(health.hostId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal((await readFile(`${configDir}/config.json.host-id`, "utf8")).trim(), health.hostId,
    "normal-user startup persists the public PC identity beside its config");
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

// What windock.service runs: the host publishes its PIN privately for `windock status`, not in its log.
const runtime = await mkdtemp(join(tmpdir(), "windock-runtime-"));
const statusFile = join(runtime, "windock", "host.json");
const serviceEnv = {
  ...process.env, XDG_RUNTIME_DIR: runtime, WINDOCK_STATUS_FILE: statusFile, WINDOCK_APP_SCOPES: "1",
  HYPRLAND_INSTANCE_SIGNATURE: "package-test-no-compositor", PORT: "18621",
};
const service = spawn("/usr/lib/windock/node", ["/usr/lib/windock/src/platform/linux-service.js"], { env: serviceEnv, stdio: ["ignore", "pipe", "pipe"] });
let journal = "";
service.stdout.on("data", (b) => { journal += b; });
service.stderr.on("data", (b) => { journal += b; });
const serviceExited = once(service, "exit");
try {
  // The host answers on its port a moment before it publishes the PIN; status
  // calls that moment "a terminal window", so wait for the published details.
  let shown;
  for (let i = 0; i < 100; i++) {
    assert.equal(service.exitCode, null, journal);
    shown = spawnSync("windock", ["status"], { env: serviceEnv, encoding: "utf8" });
    if (shown.status === 0 && /running in the background/.test(shown.stdout)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(shown.status, 0, `${shown.stdout}${shown.stderr}${journal}`);
  assert.match(shown.stdout, /running in the background/);
  assert.match(shown.stdout, /Address:\s+http:\/\/\S+:18621/);
  const servicePin = shown.stdout.match(/PIN:\s+(\d{6})\b/)?.[1];
  assert.ok(servicePin, "status shows the background host's PIN");
  assert.equal((await stat(statusFile)).mode & 0o777, 0o600, "the published PIN is readable only by the user");
  assert.equal((await stat(join(runtime, "windock"))).mode & 0o777, 0o700);
  const auth = await fetch("http://127.0.0.1:18621/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: servicePin }),
  });
  assert.equal(auth.status, 200, "pairing with the published PIN works");
  assert.match(journal, /WinDock host ready in the background/);
  assert.ok(!journal.includes(servicePin), "the PIN stays out of the service log");
} finally {
  service.kill("SIGTERM");
  await serviceExited;
}
const after = spawnSync("windock", ["status"], { env: serviceEnv, encoding: "utf8" });
assert.equal(after.status, 3, "a stopped host's leftover details are not shown");
console.log("Installed Linux app: launch, runtime, PIN pairing, background host details, assets, saved dock and native signature PASS");
