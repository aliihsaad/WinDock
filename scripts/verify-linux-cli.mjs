/** Linux `windock` command: background service start, PIN viewer, status, stop and fallbacks. */
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import {
  SESSION_VARS,
  UNIT,
  main,
  readStatus,
  renderSessionEnv,
  runtimePaths,
  screen,
  viewerKey,
  writeStatus,
} from "../src/platform/linux-cli.js";

const t = createChecker("linux-cli");
const tmp = await mkdtemp(join(tmpdir(), "windock-linux-cli-"));
const root = join(import.meta.dirname, "..");
const posix = process.platform !== "win32";

// ---- the unit, the desktop entry and the command agree on names and paths ----
const unit = await readFile(join(root, "native/linux/packaging/windock.service"), "utf8");
const line = (key) => unit.split("\n").filter((l) => l.startsWith(`${key}=`)).map((l) => l.slice(key.length + 1));
t.deepEqual(line("ExecStart"), ["/usr/lib/windock/node /usr/lib/windock/src/platform/linux-service.js"], "the unit runs the packaged service entry with the bundled Node");
const unitPaths = runtimePaths({ XDG_RUNTIME_DIR: "/run/user/1000" });
t.deepEqual(line("EnvironmentFile"), ["-%t/windock-session.env"], "the unit reads the session file the command writes, and starts without one");
t.equal(unitPaths.session, "/run/user/1000/windock-session.env".replaceAll("/", posix ? "/" : "\\"), "the command writes the session file the unit reads");
t.ok(line("Environment")[0]?.split(" ").includes("WINDOCK_STATUS_FILE=%t/windock/host.json"), "the host publishes where the command reads");
t.ok(line("Environment")[0]?.split(" ").includes("WINDOCK_APP_SCOPES=1"), "apps the service opens get their own scopes");
t.deepEqual([line("RuntimeDirectory")[0], line("RuntimeDirectoryMode")[0]], ["windock", "0700"], "systemd keeps the published PIN in a private directory and removes it on stop");
t.deepEqual(line("PartOf"), ["graphical-session.target"], "a session manager stops the host with the desktop session");
t.ok(!unit.includes("[Install]"), "nothing enables the host at login; the menu entry starts it");
const desktop = await readFile(join(root, "native/linux/packaging/windock.desktop"), "utf8");
t.ok(/^Actions=stop;$/m.test(desktop) && /^\[Desktop Action stop\]\nName=Stop WinDock\nExec=windock stop$/m.test(desktop), "launchers that show actions offer Stop WinDock");
const wrapper = await readFile(join(root, "native/linux/packaging/windock"), "utf8");
t.ok(wrapper.includes('exec /usr/lib/windock/node /usr/lib/windock/src/platform/linux-cli.js "$@"'), "the windock wrapper runs this command with its arguments");

// ---- session environment file ----
const sessionEnv = {
  WAYLAND_DISPLAY: "wayland-1", HYPRLAND_INSTANCE_SIGNATURE: "abc_1_2", PATH: "/usr/share/omarchy/bin:/usr/bin",
  XDG_DATA_DIRS: "/usr/local/share:/usr/share", PORT: "18620", WINDOCK_ALLOWED_HOSTS: "pc.lan",
  TERM: "foot", ANTHROPIC_API_KEY: "secret", DISPLAY: "", XAUTHORITY: "/tmp/it's", WINDOCK_CONFIG: "/a\nb",
};
const rendered = renderSessionEnv(sessionEnv);
t.equal(rendered, "WAYLAND_DISPLAY='wayland-1'\nHYPRLAND_INSTANCE_SIGNATURE='abc_1_2'\nXDG_DATA_DIRS='/usr/local/share:/usr/share'\nPATH='/usr/share/omarchy/bin:/usr/bin'\nPORT='18620'\nWINDOCK_ALLOWED_HOSTS='pc.lan'\n",
  "only session and WinDock settings are kept, single-quoted; empty values and ones needing quotes or line breaks are left out");
t.ok(!SESSION_VARS.includes("TERM") && !rendered.includes("secret"), "terminal and shell variables never reach the background host");
t.equal(runtimePaths({}), null, "without a runtime directory there is nowhere private to publish the PIN");
t.equal(runtimePaths({ XDG_RUNTIME_DIR: "relative" }), null, "a relative runtime directory is not trusted");

// ---- published host details ----
const statusFile = join(tmp, "run", "windock", "host.json");
const live = new Set([4242]);
const alive = (pid) => live.has(pid);
const published = { pid: 4242, endpoint: "http://192.168.1.20:8620", pin: "123456", session: { HYPRLAND_INSTANCE_SIGNATURE: "abc_1_2", WAYLAND_DISPLAY: "wayland-1" } };
await writeStatus(statusFile, published);
t.deepEqual(await readStatus(statusFile, { alive }), published, "details round-trip through the runtime file");
if (posix) {
  t.equal((await stat(statusFile)).mode & 0o777, 0o600, "only the user can read the published PIN");
  t.equal((await stat(join(tmp, "run", "windock"))).mode & 0o777, 0o700, "the published PIN's directory is private");
}
t.equal(await readStatus(statusFile, { alive: () => false }), null, "details of a host that is gone are ignored");
for (const [bad, why] of [[{ ...published, pin: 123456 }, "a numeric PIN"], [{ ...published, pin: "12345" }, "a short PIN"], [{ ...published, pid: "4242" }, "a string pid"], [{ ...published, endpoint: null }, "no address"]]) {
  await writeStatus(statusFile, bad);
  t.equal(await readStatus(statusFile, { alive }), null, `details with ${why} are rejected`);
}
await writeFile(statusFile, "{not json");
t.equal(await readStatus(statusFile, { alive }), null, "a damaged details file reads as no host");
t.equal(await readStatus(join(tmp, "missing.json"), { alive }), null, "no details file reads as no host");

// ---- connection window ----
t.equal(viewerKey("s"), "stop", "S stops WinDock");
t.equal(viewerKey("S"), "stop", "Shift+S stops WinDock");
for (const key of ["q", "Q", "\r", "\n", "\x1b", "\x03", "\x04"]) t.equal(viewerKey(key), "close", `${JSON.stringify(key)} closes only the window`);
for (const key of ["x", "\x1b[A", "sq", " "]) t.equal(viewerKey(key), null, `${JSON.stringify(key)} does nothing`);
const shown = screen("Started WinDock in the background.", published, true);
t.ok(shown.includes("  Address:  http://192.168.1.20:8620\n  PIN:      123456\n"), "the window shows the address and PIN");
t.ok(shown.includes("keeps running after you close this window") && shown.includes("Press S to stop WinDock"), "the window says closing it keeps WinDock running, and how to stop it");
t.ok(screen("x", published, false).includes("windock stop"), "without a terminal the command points at windock stop");

// ---- the command against a simulated systemd user manager ----
const runtime = join(tmp, "user-run");
const paths = runtimePaths({ XDG_RUNTIME_DIR: runtime });
const baseEnv = { XDG_RUNTIME_DIR: runtime, HYPRLAND_INSTANCE_SIGNATURE: "abc_1_2", WAYLAND_DISPLAY: "wayland-1", PATH: "/usr/bin" };

function fakeSystem({ load = "loaded", active = "inactive", manager = true, startFails = false, nextPid = 5000 } = {}) {
  const system = { load, active, calls: [], pid: null, journal: "" };
  system.run = async (file, args) => {
    system.calls.push([file, ...args].join(" "));
    if (file === "journalctl") return { code: 0, stdout: system.journal, stderr: "" };
    if (!manager) return { code: 1, stdout: "", stderr: "Failed to connect to bus" };
    const [, verb] = args;
    if (verb === "show") return { code: 0, stdout: `LoadState=${system.load}\nActiveState=${system.active}\n`, stderr: "" };
    if (verb === "start" || verb === "restart") {
      if (system.pid) live.delete(system.pid);
      if (startFails) {
        system.active = "failed";
        system.journal = "WinDock failed to start: listen EADDRINUSE: address already in use :::8620\n";
        return { code: 0, stdout: "", stderr: "" };
      }
      // What the service entry does once the host listens.
      system.pid = nextPid++;
      live.add(system.pid);
      const session = await readFile(paths.session, "utf8");
      const signature = /HYPRLAND_INSTANCE_SIGNATURE='([^']*)'/.exec(session)?.[1] ?? "";
      await writeStatus(paths.status, { pid: system.pid, endpoint: "http://192.168.1.20:8620", pin: String(100000 + system.pid), session: { HYPRLAND_INSTANCE_SIGNATURE: signature, WAYLAND_DISPLAY: "wayland-1" } });
      system.active = "active";
      return { code: 0, stdout: "", stderr: "" };
    }
    if (verb === "stop") {
      live.delete(system.pid);
      await rm(join(runtime, "windock"), { recursive: true, force: true });
      system.active = "inactive";
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unexpected ${verb}` };
  };
  return system;
}

async function command(argv, { system, env = baseEnv, probe = async () => false, interactive = false, stdin } = {}) {
  let stdout = "", stderr = "", foreground = null;
  const code = await main({
    argv, env, run: system.run, probe, alive, interactive, stdin,
    out: (text) => { stdout += text; }, err: (text) => { stderr += text; },
    foreground: async (_out, note) => { foreground = note; return null; },
    sleep: async () => {}, waitMs: 2000, pollMs: 100,
  });
  return { code, stdout, stderr, foreground };
}
const starts = (system) => system.calls.filter((c) => / (start|restart) /.test(` ${c} `));

const fresh = fakeSystem();
let result = await command([], { system: fresh });
t.equal(result.code, 0, "opening WinDock succeeds");
t.deepEqual(starts(fresh), [`systemctl --user start ${UNIT}`], "an inactive host is started as the user service");
t.ok(result.stdout.includes("Started WinDock in the background.") && result.stdout.includes("PIN:      105000"), "the window shows the PIN the started host published");
t.equal(await readFile(paths.session, "utf8"), "WAYLAND_DISPLAY='wayland-1'\nHYPRLAND_INSTANCE_SIGNATURE='abc_1_2'\nPATH='/usr/bin'\n", "the session the host should join is written before it starts");
if (posix) t.equal((await stat(paths.session)).mode & 0o777, 0o600, "the session file is private");

result = await command([], { system: fresh });
t.deepEqual(starts(fresh), [`systemctl --user start ${UNIT}`], "opening WinDock again starts no second host");
t.ok(result.stdout.includes("WinDock is running in the background.") && result.stdout.includes("PIN:      105000"), "a second open shows the running host's PIN");

result = await command([], { system: fresh, env: { ...baseEnv, HYPRLAND_INSTANCE_SIGNATURE: "new_3_4" } });
t.equal(starts(fresh).at(-1), `systemctl --user restart ${UNIT}`, "a host left from an earlier Hyprland instance is restarted for this one");
t.ok(result.stdout.includes("restarted for this desktop session") && result.stdout.includes("PIN:      105001"), "the restarted host's new PIN is shown");

const before = fresh.calls.length;
result = await command(["status"], { system: fresh });
t.equal(result.code, 0, "status succeeds while the host runs");
t.ok(result.stdout.includes("Address:  http://192.168.1.20:8620") && result.stdout.includes("PIN:      105001"), "status prints the address and PIN");
t.equal(fresh.calls.length, before, "status only reads the published details");

result = await command(["stop"], { system: fresh });
t.equal(fresh.calls.at(-1), `systemctl --user stop ${UNIT}`, "stop stops the user service");
t.ok(result.code === 0 && result.stdout.includes("WinDock stopped."), "stop confirms");
result = await command(["status"], { system: fresh });
t.equal(result.code, 3, "status reports a stopped host with the conventional exit code");
result = await command(["stop"], { system: fresh });
t.ok(result.code === 0 && result.stdout.includes("not running in the background"), "stopping a stopped host is harmless");

const oldWindow = fakeSystem();
result = await command([], { system: oldWindow, probe: async (port) => port === 8620 });
t.equal(result.code, 1, "a host already open in a terminal window blocks a second one");
t.ok(result.stderr.includes("already open in another window") && result.stderr.includes("8620"), "the message says to close that window first");
t.deepEqual(starts(oldWindow), [], "no background host is started next to it");
const keys = Object.assign(new EventEmitter(), { raw: [], setRawMode(on) { this.raw.push(on); }, resume() {}, pause() {} });
let closed = false;
const waiting = command([], { system: oldWindow, probe: async () => true, interactive: true, stdin: keys }).then((r) => { closed = true; return r; });
await new Promise((r) => setTimeout(r, 20));
t.ok(!closed, "opened from the menu, the window stays open so the message can be read");
keys.emit("data", Buffer.from("x"));
result = await waiting;
t.ok(result.code === 1 && result.stderr.includes("Press any key to close this window.") && keys.raw.join() === "true,false", "any key then closes it, restoring the terminal");
result = await command(["status"], { system: oldWindow, probe: async () => true });
t.ok(result.code === 0 && result.stdout.includes("terminal window"), "status points at the terminal window that shows its PIN");

const failing = fakeSystem({ startFails: true });
result = await command([], { system: failing });
t.equal(result.code, 1, "a host that cannot start is reported");
t.ok(result.stderr.includes("could not start") && result.stderr.includes("EADDRINUSE") && result.stderr.includes("journalctl --user --unit windock"), "the failure shows the journal's reason and where to look");

for (const [system, why] of [[fakeSystem({ manager: false }), "without a reachable user manager"], [fakeSystem({ load: "not-found" }), "when the unit is not installed"]]) {
  result = await command([], { system });
  t.ok(result.code === null && /runs in this window/.test(result.foreground), `${why}, the host runs in this window as before`);
  t.deepEqual(starts(system), [], `${why}, nothing is started in the background`);
}
result = await command([], { system: fakeSystem(), env: { HYPRLAND_INSTANCE_SIGNATURE: "abc_1_2" } });
t.equal(result.code, null, "without a runtime directory the host runs in this window");
result = await command(["--foreground"], { system: fakeSystem() });
t.ok(result.code === null && result.foreground === "", "--foreground runs the host in this window");

result = await command([], { system: fakeSystem(), env: { ...baseEnv, HYPRLAND_INSTANCE_SIGNATURE: "" } });
t.ok(result.code === 1 && /Hyprland desktop session/.test(result.stderr), "outside Hyprland the command explains what it needs");
result = await command(["stop"], { system: fakeSystem({ manager: false }), env: { ...baseEnv, HYPRLAND_INSTANCE_SIGNATURE: "" } });
t.equal(result.code, 0, "stop works outside a Hyprland session");
for (const argv of [["start"], ["stop", "now"], ["--stop"]]) {
  result = await command(argv, { system: fakeSystem() });
  t.ok(result.code === 2 && result.stderr.startsWith("Usage: windock"), `${argv.join(" ")} prints usage`);
}
result = await command(["--help"], { system: fakeSystem() });
t.ok(result.code === 0 && result.stdout.includes("windock stop"), "--help lists the commands");

await rm(tmp, { recursive: true, force: true });
t.done("linux-cli verification passed");
