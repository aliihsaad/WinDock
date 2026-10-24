/** Linux provider: Hyprland windows, MPRIS media, theme icons, detached launch and capture. */
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createChecker } from "./lib/assert.mjs";
import {
  createAppMatcher,
  createLauncher,
  createLinuxProvider,
  hyprWindowLua,
  parseBusNames,
  parseDesktop,
  parseHyprClients,
  parsePlayerState,
  pickPlayer,
  webAppHost,
} from "../src/platform/linux.js";
import { createIconLookup, parseIndexTheme, pickIcon } from "../src/platform/linux-icons.js";
import { captureName, createLinuxCapture, recorderArgv } from "../src/platform/linux-capture.js";
import { iconType } from "../src/icons.js";

const t = createChecker("linux");
const tmp = await mkdtemp(join(tmpdir(), "windock-linux-"));

// ---- inventory records keep what launch and window matching need ----
const claude = parseDesktop("[Desktop Entry]\nName=Claude\nExec=claude-desktop %U\nIcon=claude-desktop\nStartupWMClass=com.anthropic.Claude\n", "com.anthropic.claude", "com.anthropic.Claude");
t.equal(claude.desktopId, "com.anthropic.Claude", "desktop id keeps its case for gtk-launch");
t.equal(claude.wmClass, "com.anthropic.Claude", "StartupWMClass is kept for window matching");
const chromium = parseDesktop("[Desktop Entry]\nName=Chromium\nExec=/usr/bin/chromium %U\n", "chromium");
const whatsapp = parseDesktop("[Desktop Entry]\nName=WhatsApp\nExec=omarchy-launch-webapp https://web.whatsapp.com/\n", "whatsapp");
const apps = [claude, chromium, whatsapp];

// A user entry overrides the system one with the same id, including to hide it.
const userApps = join(tmp, "user-apps"), systemApps = join(tmp, "system-apps");
await mkdir(userApps, { recursive: true });
await mkdir(systemApps, { recursive: true });
const entry = (name, extra = "") => `[Desktop Entry]\nType=Application\nName=${name}\nExec=/usr/bin/${name.toLowerCase()}\n${extra}`;
await writeFile(join(userApps, "hidden.desktop"), entry("Hidden", "Hidden=true\n"));
await writeFile(join(userApps, "nodisplay.desktop"), entry("NoDisplay", "NoDisplay=true\n"));
await writeFile(join(userApps, "renamed.desktop"), entry("Renamed by user"));
for (const name of ["Hidden", "NoDisplay", "Renamed", "Visible"]) await writeFile(join(systemApps, `${name.toLowerCase()}.desktop`), entry(name));
const overridden = await createLinuxProvider({ exec: async () => ({ stdout: "" }), appDirs: [userApps, systemApps], icons: async () => null, capture: {}, input: null }).listInstalledApps();
t.deepEqual(overridden.map((app) => app.name), ["Renamed by user", "Visible"],
  "user Hidden=true and NoDisplay=true entries hide the system app; other user entries replace it");

// ---- Hyprland window list ----
t.equal(webAppHost("chrome-web.whatsapp.com__-Default"), "web.whatsapp.com", "Chromium app window classes yield their host");
t.equal(webAppHost("chromium"), "", "an ordinary class has no web host");
const match = createAppMatcher(apps);
t.equal(match({ class: "com.anthropic.Claude" })?.id, "com.anthropic.claude", "StartupWMClass matches a window");
t.equal(match({ class: "chrome-web.whatsapp.com__-Default" })?.id, "whatsapp", "a browser web app maps to its own desktop entry");
t.equal(match({ class: "chromium" })?.id, "chromium", "the browser window maps to the browser");
t.equal(match({ class: "unknown" }), null, "unknown classes stay unmatched");

const clients = [
  { address: "0x5cc35e4b5230", mapped: true, class: "chromium", title: "Docs", pid: 2157700, focusHistoryID: 3 },
  { address: "0x5cc35e4b9999", mapped: true, class: "chromium", title: "Mail", pid: 2157700, focusHistoryID: 1 },
  { address: "0x5cc35e94b110", mapped: true, class: "chrome-web.whatsapp.com__-Default", title: "WhatsApp", pid: 2157700, focusHistoryID: 0 },
  { address: "0x5cc35e79cd00", mapped: true, class: "com.anthropic.Claude", title: "Claude", pid: 2770788, focusHistoryID: 2 },
  { address: "0xabc", mapped: true, class: "Alacritty", title: "zsh", pid: 3100, focusHistoryID: 4 },
  { address: "0xdef", mapped: false, class: "ghost", title: "", pid: 3200, focusHistoryID: 5 },
  { address: "0x123 & reboot", mapped: true, class: "evil", title: "", pid: 3300, focusHistoryID: 6 },
  { address: "0x456", mapped: true, class: "nopid", title: "", pid: 0, focusHistoryID: 7 },
];
const running = parseHyprClients(JSON.stringify(clients), match);
t.deepEqual(running.map((r) => r.id).sort(), ["chromium", "com.anthropic.claude", "proc:alacritty", "whatsapp"].sort(),
  "one record per app; unmapped, malformed and pid-less windows are dropped");
t.equal(running.find((r) => r.id === "chromium").address, "0x5cc35e4b9999", "an app's most recently focused window is the one a tap brings forward");
t.equal(running.find((r) => r.id === "whatsapp").pid, running.find((r) => r.id === "chromium").pid, "web apps legitimately share the browser pid");
t.equal(running.find((r) => r.id === "whatsapp").name, "WhatsApp", "records use the app's display name");
t.deepEqual(parseHyprClients("not json"), [], "garbage IPC output is an empty list");

// ---- focus / close: atomic guard on Lua configs, checked fallback on hyprlang ----
const lua = hyprWindowLua("close", "0x5cc35e79cd00");
t.ok(lua.startsWith('local w = hl.get_window("address:0x5cc35e79cd00") if not w or w.address ~= "0x5cc35e79cd00" then error('),
  "close first proves the exact window exists inside the compositor");
t.ok(lua.endsWith('hl.dispatch(hl.dsp.window.close({ window = "address:0x5cc35e79cd00" }))'), "close dispatches only that window");
for (const bad of ['0x1") os.execute("reboot', "0X1", "0x", "address:0x1", "0x" + "f".repeat(17), ""]) {
  t.throws(() => hyprWindowLua("focus", bad), `window address ${JSON.stringify(bad)} cannot reach Lua`);
}
t.throws(() => hyprWindowLua("kill", "0x1"), "only focus and close exist");

function hyprFake({ evalReply = "ok", clientsReply = JSON.stringify(clients), dispatchReply = "ok" } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file !== "hyprctl") return { stdout: "" };
    if (args[0] === "eval") {
      if (evalReply.startsWith("error")) throw Object.assign(new Error("exit 7"), { stdout: evalReply });
      return { stdout: evalReply };
    }
    if (args[0] === "clients") return { stdout: clientsReply };
    if (args[0] === "dispatch") return { stdout: dispatchReply };
    return { stdout: "" };
  };
  return { calls, provider: createLinuxProvider({ exec, appDirs: [], icons: async () => null, capture: {} }) };
}

let hypr = hyprFake();
await hypr.provider.focusApp({ pid: 2770788, address: "0x5cc35e79cd00" });
t.deepEqual(hypr.calls, [["hyprctl", "eval", hyprWindowLua("focus", "0x5cc35e79cd00")]], "focus is one guarded Lua call");
hypr = hyprFake({ evalReply: "error: [string]:1: windock: window not found" });
const gone = await hypr.provider.closeApp({ pid: 2770788, address: "0x5cc35e79cd00" }).catch((error) => error);
t.equal(gone.status, 404, "a window that closed since the last refresh is reported, not substituted");
t.equal(hypr.calls.length, 1, "nothing is dispatched after the guard fails");
await t.rejects(() => hypr.provider.closeApp({ pid: 1, address: "0x1 & 0x2" }), "close requires a valid address");
await t.rejects(() => hypr.provider.focusApp({ pid: 1 }), "focus requires an address");

hypr = hyprFake({ evalReply: "eval is only supported with the lua config manager" });
await hypr.provider.focusApp({ pid: 2770788, address: "0x5cc35e79cd00" });
t.deepEqual(hypr.calls.slice(1), [
  ["hyprctl", "clients", "-j"],
  ["hyprctl", "dispatch", "focuswindow", "address:0x5cc35e79cd00"],
], "hyprlang configs re-check the window, then dispatch by address");
const legacyGone = await hypr.provider.closeApp({ pid: 1, address: "0x999999" }).catch((error) => error);
t.equal(legacyGone.status, 404, "hyprlang close of a vanished window is refused");
t.ok(!hypr.calls.some((call) => call.includes("closewindow")), "no closewindow is sent for a vanished window");
t.equal(hypr.calls.filter((call) => call[1] === "eval").length, 1, "the config type is detected once");

const notHyprland = createLinuxProvider({ exec: async () => { throw new Error("hyprctl: not found"); }, appDirs: [], capture: {} });
t.deepEqual(await notHyprland.listRunningApps(), [], "another compositor yields no windows instead of every process");

// ---- MPRIS ----
t.deepEqual(parseBusNames(JSON.stringify({ type: "as", data: [[":1.4", "org.mpris.MediaPlayer2.spotify", "org.mpris.MediaPlayer2", "org.mpris.MediaPlayer2.x;rm", "org.freedesktop.DBus"]] })),
  ["org.mpris.MediaPlayer2.spotify"], "only well-formed MPRIS player names are kept");
const state = parsePlayerState(`${JSON.stringify({ type: "s", data: "Playing" })}\n${JSON.stringify({ type: "a{sv}", data: { "xesam:title": { type: "s", data: " Song " }, "xesam:artist": { type: "as", data: ["A", "B"] } } })}\n`);
t.deepEqual(state, { status: "Playing", title: "Song", artist: "A, B" }, "title and artists come from MPRIS metadata");
t.deepEqual(parsePlayerState("broken"), { status: "", title: "", artist: "" }, "broken replies are empty");
t.equal(pickPlayer([{ name: "a", status: "Stopped" }, { name: "b", status: "Paused" }, { name: "c", status: "Playing" }]).name, "c", "a playing player wins");
t.equal(pickPlayer([]), null, "no players, no target");
const media = createLinuxProvider({
  appDirs: [], capture: {},
  exec: async (file, args) => {
    if (args.includes("ListNames")) return { stdout: JSON.stringify({ type: "as", data: [["org.mpris.MediaPlayer2.mpv"]] }) };
    return { stdout: `${JSON.stringify({ type: "s", data: "Paused" })}\n${JSON.stringify({ type: "a{sv}", data: { "xesam:title": { type: "s", data: "Track" } } })}\n` };
  },
});
t.deepEqual(await media.nowPlaying(), { title: "Track", artist: "", playing: false }, "now playing reports the chosen player");

// ---- icon theme lookup ----
const PNG = (size) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(size)]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
const share = join(tmp, "share");
const put = async (path, body) => { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, body); };
await put(join(share, "icons/Mine/index.theme"), "[Icon Theme]\nInherits=Missing,hicolor\nDirectories=48x48/apps,scalable/apps,256x256/actions\n[48x48/apps]\nSize=48\nContext=Applications\n[scalable/apps]\nSize=128\nType=Scalable\nContext=Applications\n[256x256/actions]\nSize=256\nContext=Actions\n");
await put(join(share, "icons/hicolor/index.theme"), "[Icon Theme]\nDirectories=48x48/apps,256x256/apps\n[48x48/apps]\nSize=48\nContext=Applications\n[256x256/apps]\nSize=256\nContext=Applications\n");
await put(join(share, "icons/Mine/48x48/apps/foo.png"), PNG(10));
await put(join(share, "icons/Mine/scalable/apps/foo.svg"), SVG);
await put(join(share, "icons/hicolor/256x256/apps/foo.png"), PNG(30));
await put(join(share, "icons/hicolor/48x48/apps/bar.png"), PNG(11));
await put(join(share, "icons/hicolor/256x256/apps/bar.png"), PNG(12));
await put(join(share, "icons/Mine/256x256/actions/qux.png"), PNG(13));
await put(join(share, "icons/hicolor/48x48/apps/fake.png"), Buffer.from("not an image"));
await put(join(share, "icons/hicolor/256x256/apps/huge.png"), PNG(600 * 1024));
await put(join(share, "pixmaps/baz.png"), PNG(14));
await put(join(tmp, "absolute.svg"), SVG);
const parsed = parseIndexTheme("[Icon Theme]\nInherits=A, B\nDirectories=16x16/apps\nScaledDirectories=16x16@2/apps\n[16x16/apps]\nSize=16\n[16x16@2/apps]\nSize=16\nScale=2\n");
t.deepEqual(parsed.inherits, ["A", "B"], "inherited themes are listed in order");
t.deepEqual(parsed.dirs.map((d) => d.px), [16, 32], "scaled directories count their real pixels");
t.equal(pickIcon([{ path: "a.png", px: 48 }, { path: "b.svg", px: Infinity }, { path: "c.png", px: 256 }]).path, "c.png", "a large PNG beats SVG");
t.equal(pickIcon([{ path: "a.png", px: 48 }, { path: "b.svg", px: Infinity }]).path, "b.svg", "SVG beats a blurry small PNG");
const themeCalls = [];
const lookup = createIconLookup({
  dataDirs: [share], home: join(tmp, "home"),
  exec: async (file, args) => { themeCalls.push([file, ...args]); return { stdout: "'Mine'\n" }; },
});
t.ok((await lookup("foo")).equals(SVG), "the user's theme wins over hicolor, at the best size it has");
t.deepEqual(themeCalls[0], ["gsettings", "get", "org.gnome.desktop.interface", "icon-theme"], "the theme comes from the desktop settings");
t.ok((await lookup("bar")).equals(PNG(12)), "inherited hicolor supplies the largest suitable PNG");
t.ok((await lookup("baz.png")).equals(PNG(14)), "pixmaps are the last resort, and a stray extension is tolerated");
t.equal(await lookup("qux"), null, "non-application icons are not app icons");
t.equal(await lookup("fake"), null, "a file that is not PNG or SVG is rejected");
t.equal(await lookup("huge"), null, "oversized icons are rejected");
t.equal(await lookup("../../etc/passwd"), null, "icon names cannot walk the filesystem");
t.ok((await lookup(join(tmp, "absolute.svg"))).equals(SVG), "absolute Icon= paths are honoured");
t.equal(await lookup("/etc/passwd"), null, "absolute paths must be PNG or SVG files");
t.equal(themeCalls.length, 1, "the theme chain is resolved once");
t.equal(iconType(PNG(1)), "image/png", "PNG icons are served as PNG");
t.equal(iconType(SVG), "image/svg+xml", "SVG icons are served as SVG");
t.equal(iconType(Buffer.from("<html><script>")), null, "anything else is not an icon");

// ---- detached launcher (real processes) ----
const node = process.execPath;
const launch = createLauncher({ waitMs: 5000 });
await launch(node, ["-e", "process.exit(0)"], { wait: true });
t.ok(true, "a launcher that exits cleanly resolves");
await t.rejects(() => launch(node, ["-e", "process.exit(3)"], { wait: true }), "a launcher's failure exit is reported");
const missing = await launch(join(tmp, "no-such-binary"), []).catch((error) => error);
t.equal(missing.code, "ENOENT", "a missing binary is reported as ENOENT");
const startedAt = Date.now();
await launch(node, ["-e", "setTimeout(() => {}, 1500)"]);
t.ok(Date.now() - startedAt < 1000, "an app launch returns once spawned, without waiting for the app to exit");
const spawned = [];
await createLauncher({ spawn: (file, args, options) => {
  spawned.push(options);
  const child = new EventEmitter();
  child.unref = () => { child.unrefed = true; };
  queueMicrotask(() => child.emit("spawn"));
  return child;
} })("app", []);
t.deepEqual(spawned[0], { detached: true, stdio: "ignore", shell: false }, "apps are detached, inherit no pipes, and never use a shell");

// ---- capture ----
t.ok(/^WinDock-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-[0-9a-f]{6}\.png$/.test(captureName("screenshot")), "capture names match the Windows helper");
const [wfCommand, wfArgs] = recorderArgv("wf-recorder", "DP-2", "/v/x.mp4");
t.equal(wfCommand, "wf-recorder", "wf-recorder is a supported recorder");
t.ok(wfArgs.join(" ").includes("-o DP-2 -r 15"), "recordings are the chosen monitor at 15 fps");
t.ok(wfArgs.some((arg) => arg.includes("min(1920,iw)") && arg.includes("min(1080,ih)")), "recordings fit within 1920x1080");
t.ok(!wfArgs.includes("-a") && !wfArgs.some((arg) => arg.startsWith("--audio")), "recordings are silent");
const gsrArgs = recorderArgv("gpu-screen-recorder", null, "/v/x.mp4")[1];
t.deepEqual(gsrArgs.slice(0, 6), ["-w", "screen", "-s", "1920x1080", "-f", "15"], "gpu-screen-recorder has the same limits");
t.ok(gsrArgs.includes("-cursor") && !gsrArgs.includes("-a"), "gpu-screen-recorder records no audio or cursor");

const children = [];
function fakeChild(command, args) {
  const child = Object.assign(new EventEmitter(), { command, args, stderr: new PassThrough(), signals: [] });
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGKILL") queueMicrotask(() => child.exit(null)); // like a real process
    return true;
  };
  child.exit = (code) => { child.stderr.end(); child.emit("close", code); };
  children.push(child);
  return child;
}
const execCalls = [];
let grimWorks = true;
const capture = createLinuxCapture({
  folder: async (kind) => join(tmp, kind),
  startupMs: 20,
  stopMs: 200,
  exec: async (file, args) => {
    execCalls.push([file, ...args]);
    if (file === "hyprctl") return { stdout: JSON.stringify([{ name: "HDMI-A-1", focused: false }, { name: "DP-2", focused: true }]) };
    if (file === "grim") {
      if (!grimWorks) {
        await writeFile(args.at(-1), PNG(0).subarray(0, 3)); // a partial PNG, as a failing grim can leave
        throw Object.assign(new Error("private compositor diagnostics"), { stderr: "secret" });
      }
      await writeFile(args.at(-1), PNG(2));
    }
    return { stdout: "" };
  },
  spawn: (command, args, options) => {
    t.equal(options.shell, false, `${command} never runs through a shell`);
    const child = fakeChild(command, args);
    if (command === "wf-recorder" && capture.missingWf) queueMicrotask(() => { child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" })); child.emit("close", -2); });
    return child;
  },
});
const shot = await capture.screenshot();
t.equal(shot.lastCapture.kind, "screenshot", "a screenshot is reported");
t.ok(shot.lastCapture.path.startsWith(join(tmp, "PICTURES", "WinDock")), "screenshots go to Pictures/WinDock");
t.deepEqual(execCalls.find((call) => call[0] === "grim").slice(1, 3), ["-o", "DP-2"], "the focused monitor is captured");
grimWorks = false;
const shotError = await capture.screenshot().catch((error) => error);
t.equal(shotError.status, 503, "a failed screenshot is a service error");
t.ok(!shotError.message.includes("private") && !capture.status().error.includes("secret"), "compositor diagnostics stay private");
t.equal((await readdir(join(tmp, "PICTURES", "WinDock"))).length, 1, "a failed screenshot leaves no partial file behind");

const first = capture.start(), duplicate = capture.start();
t.equal(capture.status().phase, "starting", "starting is visible");
const recording = await first;
t.equal((await duplicate).startedAt, recording.startedAt, "duplicate start shares one recording");
t.equal(recording.phase, "recording", "a recorder that survives startup is recording");
const wf = children[0];
t.equal(wf.command, "wf-recorder", "wf-recorder is preferred");
t.ok(wf.args.includes("DP-2"), "the focused monitor is recorded");
const stopping = capture.stop();
t.deepEqual(wf.signals, ["SIGINT"], "stop asks the recorder to finalize");
await t.rejects(() => capture.start(), "cannot start while the old recording saves");
await writeFile(wf.args.at(-1), PNG(3));
wf.exit(0);
const stopped = await stopping;
t.equal(stopped.phase, "idle", "a finalized recording returns to idle");
t.equal(stopped.lastCapture.kind, "recording", "the recording is reported");
t.ok(stopped.lastCapture.path.startsWith(join(tmp, "VIDEOS", "WinDock")), "recordings go to Videos/WinDock");

capture.missingWf = true;
const fallback = capture.start();
for (let i = 0; i < 100 && children.at(-1).command !== "gpu-screen-recorder"; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const gsr = children.at(-1);
await writeFile(gsr.args.at(-1), ""); // gpu-screen-recorder creates the file before failing
t.equal(gsr.command, "gpu-screen-recorder", "a missing wf-recorder falls back to gpu-screen-recorder");
gsr.stderr.write("gsr info: starting\ngsr error: gsr_capture_kms_pre_capture: no drm found, capture will fail\n");
await t.rejects(() => fallback, "a recorder that reports a capture error has not started");
t.equal(capture.status().phase, "error", "the failed start is visible");
t.deepEqual(gsr.signals, ["SIGKILL"], "the broken recorder is terminated");
t.equal((await readdir(join(tmp, "VIDEOS", "WinDock"))).length, 1, "a failed start leaves no empty video behind");

capture.missingWf = false;
const asleep = createLinuxCapture({
  folder: async (kind) => join(tmp, kind), startupMs: 10,
  exec: async (file) => {
    if (file === "hyprctl") return { stdout: JSON.stringify([{ name: "DP-2", focused: true, dpmsStatus: false }]) };
    throw new Error("grim would wait for a frame forever");
  },
  spawn: (command, args) => fakeChild(command, args),
});
const spawnedBefore = children.length;
const sleepingShot = await asleep.screenshot().catch((error) => error);
t.equal(sleepingShot.status, 409, "a sleeping display fails fast instead of hanging until the timeout");
t.ok(sleepingShot.message.includes("asleep"), "the user is told to wake the screen");
const sleepingRecord = await asleep.start().catch((error) => error);
t.equal(sleepingRecord.status, 409, "recording also refuses a sleeping display");
t.equal(asleep.status().phase, "idle", "a refused recording leaves capture idle");
t.equal(children.length, spawnedBefore, "no recorder is started for a sleeping display");

const limited = createLinuxCapture({
  folder: async (kind) => join(tmp, kind), startupMs: 10, limitMs: 30, stopMs: 500,
  exec: async () => ({ stdout: "[]" }),
  spawn: (command, args) => fakeChild(command, args),
});
await limited.start();
const auto = children.at(-1);
await new Promise((resolve) => setTimeout(resolve, 60));
t.deepEqual(auto.signals, ["SIGINT"], "recordings stop themselves at the time limit");
t.equal(limited.status().phase, "stopping", "the automatic stop is visible");
await writeFile(auto.args.at(-1), PNG(4));
auto.exit(0);
await new Promise((resolve) => setTimeout(resolve, 10));
t.equal(limited.status().lastCapture?.kind, "recording", "an automatically stopped recording is kept");
await limited.start();
const crashed = children.at(-1);
crashed.exit(1);
await new Promise((resolve) => setTimeout(resolve, 10));
t.equal(limited.status().phase, "error", "a recorder that dies mid-recording is reported");
await limited.start();
const disposing = limited.dispose();
const last = children.at(-1);
t.deepEqual(last.signals, ["SIGINT"], "host shutdown finalizes the recording");
await writeFile(last.args.at(-1), PNG(5));
last.exit(0);
await disposing;
await t.rejects(() => limited.start(), "a disposed capture refuses new recordings");

await rm(tmp, { recursive: true, force: true });
t.done("linux verification passed");
