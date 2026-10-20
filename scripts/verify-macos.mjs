/** macOS provider: bundle inventory, System Events processes, open/quit, volume, media, power and stats. */
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { contractViolations } from "../src/platform/contract.js";
import { createProvider } from "../src/platform/index.js";
import {
  BUNDLE_ID,
  JXA_FLAGS,
  MAC_CONTROL,
  MEDIA_JXA,
  OSASCRIPT,
  QUIT_JXA,
  RUNNING_JXA,
  VOLUME_JXA,
  createMacProvider,
  parseBattery,
  parseCpu,
  parseInfoPlist,
  parseMemory,
  parseNowPlaying,
  parseProcesses,
} from "../src/platform/macos.js";
import { CONVERT_PRESET, captureFolder, captureName, convertArgv, createMacCapture, recorderArgv, screenshotArgv } from "../src/platform/macos-capture.js";

const t = createChecker("macos");
const tmp = await mkdtemp(join(tmpdir(), "windock-macos-"));
const PNG = (size) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(size)]);

// ---- provider selection ----
t.deepEqual(contractViolations(createProvider({ os: "darwin", exec: async () => ({ stdout: "" }) })), [], "darwin is a registered, conformant provider");
t.throws(() => createMacProvider({}), "the provider needs an injected exec");

// ---- Info.plist records ----
const plist = (extra = {}) => JSON.stringify({ CFBundleIdentifier: "com.apple.Safari", CFBundleName: "Safari", CFBundleIconFile: "AppIconUpdated", CFBundlePackageType: "APPL", ...extra });
const safari = parseInfoPlist(plist(), "/Applications/Safari.app");
t.deepEqual(safari, {
  id: "com.apple.safari", name: "Safari", target: "/Applications/Safari.app", args: "",
  icon: "/Applications/Safari.app/Contents/Resources/AppIconUpdated.icns", source: "bundle", bundleId: "com.apple.Safari",
}, "a bundle becomes a dock app keyed by its lowercased bundle id");
t.equal(parseInfoPlist(plist({ CFBundleDisplayName: "Safari Browser" }), "/a/Safari.app").name, "Safari Browser", "the display name wins over the bundle name");
t.equal(parseInfoPlist(JSON.stringify({ CFBundleIdentifier: "x.y" }), "/a/Nameless.app").name, "Nameless", "a bundle without a name is named after its folder");
t.equal(parseInfoPlist(plist({ CFBundleIconFile: "AppIcon.icns" }), "/a/S.app").icon, "/a/S.app/Contents/Resources/AppIcon.icns", "an icon file keeps its extension");
t.equal(parseInfoPlist(plist({ CFBundleIconFile: "../../../etc/passwd" }), "/a/S.app").icon, "", "an icon file cannot walk out of the bundle");
t.equal(parseInfoPlist(plist({ CFBundleIconFile: undefined }), "/a/S.app").icon, "", "a bundle without an icon file has no icon");
t.equal(parseInfoPlist(plist({ LSUIElement: true }), "/a/S.app"), null, "menu bar agents are not dock apps");
t.equal(parseInfoPlist(plist({ LSBackgroundOnly: "1" }), "/a/S.app"), null, "background-only bundles are not dock apps");
t.equal(parseInfoPlist(plist({ CFBundlePackageType: "BNDL" }), "/a/S.app"), null, "non-application packages are skipped");
t.equal(parseInfoPlist(plist({ CFBundleIdentifier: "com.x y" }), "/a/S.app"), null, "a bundle id with spaces is rejected");
t.equal(parseInfoPlist(plist({ CFBundleIdentifier: "-rf" }), "/a/S.app"), null, "a bundle id that looks like an option is rejected");
t.equal(parseInfoPlist("not json", "/a/S.app"), null, "an unreadable plist is not an app");
for (const bad of ["", "com.x y", "-b", "a".repeat(256), "com.x;rm", 'com.x"'] ) t.ok(!BUNDLE_ID.test(bad), `bundle id ${JSON.stringify(bad)} is rejected`);
t.ok(BUNDLE_ID.test("com.apple.Safari") && BUNDLE_ID.test("org.mozilla.firefox") && BUNDLE_ID.test("com.example.my_app-2"), "real-looking bundle ids pass");

// ---- inventory over real folders with a simulated plutil ----
const apps = join(tmp, "Applications"), userApps = join(tmp, "UserApplications");
const bundle = async (dir, name, info) => {
  await mkdir(join(dir, `${name}.app`, "Contents"), { recursive: true });
  await writeFile(join(dir, `${name}.app`, "Contents", "Info.plist"), info === null ? "" : JSON.stringify(info));
};
await bundle(apps, "Zeta", { CFBundleIdentifier: "com.example.Zeta", CFBundleName: "Zeta", CFBundleIconFile: "AppIcon" });
await bundle(apps, "Alpha", { CFBundleIdentifier: "com.example.alpha", CFBundleName: "Alpha" });
await bundle(apps, "Agent", { CFBundleIdentifier: "com.example.agent", CFBundleName: "Agent", LSUIElement: 1 });
await bundle(apps, "Broken", null);
await bundle(userApps, "Alpha Copy", { CFBundleIdentifier: "com.example.alpha", CFBundleName: "Alpha (user copy)" });
await bundle(userApps, "Beta", { CFBundleIdentifier: "com.example.beta", CFBundleName: "Beta" });
await writeFile(join(apps, "notes.txt"), "not a bundle");
const execCalls = [];
const fakeExec = async (file, args) => {
  execCalls.push([file, ...args]);
  if (file === "plutil") {
    const body = await import("node:fs/promises").then((fs) => fs.readFile(args.at(-1), "utf8"));
    if (!body) throw new Error("plist is empty");
    return { stdout: body };
  }
  if (file === "sips") {
    await writeFile(args.at(-1), PNG(16));
    return { stdout: "" };
  }
  return { stdout: "" };
};
let clock = 0;
const provider = createMacProvider({ exec: fakeExec, appDirs: [apps, userApps, join(tmp, "missing")], tmp, now: () => clock, capture: {}, input: null });
const inventory = await provider.listInstalledApps();
t.deepEqual(inventory.map((app) => app.name), ["Alpha", "Beta", "Zeta"], "bundles are listed by name; agents, broken plists and other files are skipped");
t.equal(inventory.find((app) => app.id === "com.example.alpha").target, join(apps, "Alpha.app"), "the first folder claims a duplicated bundle id");
t.ok(execCalls.every((call) => call[0] !== "plutil" || call.slice(1, 4).join(" ") === "-convert json -o"), "plutil is asked for JSON on stdout");
t.ok(execCalls.some((call) => call[0] === "plutil" && call.at(-1) === join(apps, "Broken.app", "Contents", "Info.plist")), "every bundle's Info.plist is read");
const before = execCalls.length;
await provider.listInstalledApps();
t.equal(execCalls.length, before, "the inventory is cached");
clock += 31_000;
await provider.listInstalledApps();
t.ok(execCalls.length > before, "the inventory is refreshed after 30 seconds");

// ---- icons ----
const zed = inventory.find((app) => app.id === "com.example.zeta");
const icon = await provider.appIcon(zed);
t.ok(icon?.equals(PNG(16)), "an .icns is converted to PNG through sips");
const sips = execCalls.find((call) => call[0] === "sips");
t.deepEqual(sips.slice(1, 7), ["-s", "format", "png", "-Z", "256", zed.icon], "sips converts the bundle's own icon at 256px");
t.ok(sips.at(-1).startsWith(tmp), "the PNG is written to a private temporary folder");
t.equal(await provider.appIcon(inventory.find((app) => app.id === "com.example.alpha")), null, "a bundle without an icon file has no icon");
t.equal(await provider.appIcon({ icon: "/etc/passwd" }), null, "only .icns files are converted");
t.equal(await provider.appIcon({ icon: "relative.icns" }), null, "only absolute icon paths are converted");
const huge = createMacProvider({ exec: async (file, args) => { if (file === "sips") await writeFile(args.at(-1), PNG(600 * 1024)); return { stdout: "" }; }, tmp });
t.equal(await huge.appIcon({ icon: "/a/b.icns" }), null, "oversized icons are rejected");
const notPng = createMacProvider({ exec: async (file, args) => { if (file === "sips") await writeFile(args.at(-1), "<svg/>"); return { stdout: "" }; }, tmp });
t.equal(await notPng.appIcon({ icon: "/a/b.icns" }), null, "a conversion that is not PNG is rejected");

// ---- running apps ----
const processes = JSON.stringify([
  { name: "Finder", bundleId: "com.apple.finder", pid: 625 },
  { name: "Zeta", bundleId: "com.example.Zeta", pid: 4000 },
  { name: "Zeta", bundleId: "com.example.Zeta", pid: 4000 },
  { name: "Evil", bundleId: "com.x; rm -rf /", pid: 4100 },
  { name: "NoPid", bundleId: "com.example.nopid", pid: 0 },
  { name: "", bundleId: "com.example.unnamed", pid: 4200 },
]);
const running = parseProcesses(processes, inventory);
t.deepEqual(running.map((r) => r.id), ["proc:com.apple.finder", "com.example.zeta", "proc:com.example.unnamed"], "inventory apps keep their dock id; others get a process id; malformed rows are dropped");
t.equal(running[1].path, zed.target, "a running inventory app reports its bundle path");
t.equal(running[2].name, "com.example.unnamed", "an unnamed process is shown by its bundle id");
t.deepEqual(parseProcesses("not json"), [], "garbage output is an empty list");
t.deepEqual(parseProcesses(JSON.stringify({ a: 1 })), [], "a non-list is an empty list");
execCalls.length = 0;
const live = createMacProvider({ exec: async (file, args) => { execCalls.push([file, ...args]); return { stdout: args.includes(RUNNING_JXA) ? processes : "" }; }, appDirs: [], tmp });
t.equal((await live.listRunningApps()).length, 3, "the provider lists processes through System Events");
t.deepEqual(execCalls[0], [OSASCRIPT, ...JXA_FLAGS, RUNNING_JXA], "the process list is one constant JXA script");
const refused = createMacProvider({ exec: async () => { throw new Error("Not authorized to send Apple events"); }, appDirs: [], tmp });
t.deepEqual(await refused.listRunningApps(), [], "a refused Automation permission yields no windows instead of an error");

// ---- launch / focus / close ----
execCalls.length = 0;
await live.launchApp(zed);
t.deepEqual(execCalls.at(-1), ["open", zed.target], "launch opens the bundle by path, as one argument");
await t.rejects(() => live.launchApp({ target: "Zed.app" }), "launch requires an absolute bundle path");
await t.rejects(() => live.launchApp({ target: "/Applications/evil" }), "launch requires an application bundle");
await t.rejects(() => live.launchApp("-b"), "launch cannot be turned into an option");
await live.focusApp(running[1]);
t.deepEqual(execCalls.at(-1), ["open", "-b", "com.example.Zeta"], "focus activates the app by bundle id");
await live.closeApp(running[1]);
t.deepEqual(execCalls.at(-1), [OSASCRIPT, ...JXA_FLAGS, QUIT_JXA, "com.example.Zeta"], "close asks the app to quit, with the bundle id as an argument");
await t.rejects(() => live.focusApp({ pid: 4000 }), "focus needs a bundle id");
await t.rejects(() => live.closeApp({ pid: 4000, bundleId: "com.x; rm" }), "close rejects a malformed bundle id");
t.ok(!QUIT_JXA.includes("${") && !VOLUME_JXA.includes("${") && !MEDIA_JXA.includes("${"), "scripts are constant text without interpolation markers");

// ---- controls ----
const argv = (verb, value) => MAC_CONTROL[verb](value);
t.deepEqual(argv("volume-set", 40), [OSASCRIPT, [...JXA_FLAGS, VOLUME_JXA, "volume-set", "40"]], "volume-set passes the level as an argument");
t.deepEqual(argv("volume-up")[1].slice(-1), ["volume-up"], "volume-up is a verb argument");
t.deepEqual(argv("mute-toggle")[1].slice(-1), ["mute-toggle"], "mute-toggle is a verb argument");
t.deepEqual(argv("media-next"), [OSASCRIPT, [...JXA_FLAGS, MEDIA_JXA, "media-next"]], "media verbs run the media script");
t.deepEqual(argv("lock"), ["pmset", ["displaysleepnow"]], "lock sleeps the display");
t.deepEqual(argv("sleep"), ["pmset", ["sleepnow"]], "sleep uses pmset");
t.deepEqual(argv("shutdown"), [OSASCRIPT, ["-e", 'tell application "System Events" to shut down']], "shutdown goes through System Events");
t.deepEqual(argv("restart"), [OSASCRIPT, ["-e", 'tell application "System Events" to restart']], "restart goes through System Events");
t.ok(!("brightness-set" in MAC_CONTROL), "brightness has no command in phase 1");
execCalls.length = 0;
let mediaReply = "ok";
const controls = createMacProvider({ exec: async (file, args) => { execCalls.push([file, ...args]); return { stdout: args.includes(MEDIA_JXA) ? mediaReply : "" }; }, appDirs: [], tmp });
t.deepEqual(await controls.control("volume-set", 40), { ok: true, verb: "volume-set" }, "a control reports its verb");
t.deepEqual(execCalls.at(-1), [OSASCRIPT, ...JXA_FLAGS, VOLUME_JXA, "volume-set", "40"], "the control runs its argv");
await t.rejects(() => controls.control("volume-set", 101), "out-of-range values are refused before anything runs");
await t.rejects(() => controls.control("volume-set", "40"), "non-numeric values are refused");
await t.rejects(() => controls.control("rm", null), "unknown verbs are refused");
const brightness = await controls.control("brightness-set", 50).catch((error) => error);
t.equal(brightness.status, 501, "brightness is reported as not available");
t.deepEqual(await controls.control("media-play-pause", null), { ok: true, verb: "media-play-pause" }, "media verbs succeed with a player");
mediaReply = "no-player";
const noPlayer = await controls.control("media-next", null).catch((error) => error);
t.equal(noPlayer.status, 409, "media verbs without a player are a conflict, not a crash");

// ---- now playing ----
t.deepEqual(parseNowPlaying('{"title":" Song ","artist":"Band","playing":true}\n'), { title: "Song", artist: "Band", playing: true }, "now playing is trimmed");
t.equal(parseNowPlaying("null\n"), null, "no player means nothing playing");
t.equal(parseNowPlaying('{"artist":"x"}'), null, "a track without a title is nothing");
t.equal(parseNowPlaying("garbage"), null, "garbage is nothing");
mediaReply = '{"title":"Track","artist":"A","playing":false}';
t.deepEqual(await controls.nowPlaying(), { title: "Track", artist: "A", playing: false }, "the provider reads now playing from the media script");
t.deepEqual(execCalls.at(-1), [OSASCRIPT, ...JXA_FLAGS, MEDIA_JXA, "now-playing"], "now playing is the media script's query verb");
t.equal(await refused.nowPlaying(), null, "a failing script is nothing playing");

// ---- stats ----
const top = "Processes: 600 total\n\nCPU usage: 50.0% user, 40.0% sys, 10.0% idle \n\nProcesses: 600 total\n\nCPU usage: 17.43% user, 21.63% sys, 60.92% idle \nSharedLibs: 1G\n";
t.equal(parseCpu(top), 39, "cpu comes from the second top sample");
t.equal(parseCpu(""), null, "no sample, no cpu");
t.equal(parseMemory("The system has 2147 Mb of memory\nSystem-wide memory free percentage: 56%\n"), 44, "memory used is the complement of the free share");
t.equal(parseMemory("garbage"), null, "no memory line, no value");
t.deepEqual(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=22478947)\t87%; discharging; 11:23 remaining present: true\n"), { battery: 87, charging: false }, "a discharging battery");
t.deepEqual(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n"), { battery: 100, charging: true }, "a full battery on power");
t.deepEqual(parseBattery("Now drawing from 'AC Power'\n"), { battery: null, charging: null }, "a desktop has no battery");
const stats = createMacProvider({
  exec: async (file) => ({ stdout: { top, memory_pressure: "System-wide memory free percentage: 56%\n", pmset: " -InternalBattery-0 (id=1)\t50%; charging; 1:00 remaining present: true\n" }[file] || "" }),
  appDirs: [], tmp,
});
t.deepEqual(await stats.systemStats(), { cpu: 39, memory: 44, battery: 50, charging: true }, "stats combine top, memory_pressure and pmset");
t.deepEqual(await refused.systemStats(), { cpu: null, memory: null, battery: null, charging: null }, "stats degrade to nulls when commands fail");

// ---- capture ----
t.ok(/^WinDock-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-[0-9a-f]{6}\.png$/.test(captureName("screenshot")), "capture names match the Windows helper");
t.ok(captureName("recording").endsWith(".mp4") && captureName("recording", undefined, undefined, "mov").endsWith(".mov"), "recordings are MP4, with a movie while they run");
t.equal(captureFolder("screenshot", "/Users/x"), "/Users/x/Pictures/WinDock", "screenshots go to Pictures/WinDock");
t.equal(captureFolder("recording", "/Users/x"), "/Users/x/Movies/WinDock", "recordings go to Movies/WinDock");
t.deepEqual(screenshotArgv("/p/x.png"), ["screencapture", ["-x", "-t", "png", "/p/x.png"]], "screenshots are silent PNGs");
t.deepEqual(recorderArgv("/m/x.mov"), ["screencapture", ["-x", "-v", "/m/x.mov"]], "recordings are silent movies without -V, which would break SIGINT finalization");
t.deepEqual(convertArgv("/m/x.mov", "/m/x.mp4"), ["avconvert", ["--source", "/m/x.mov", "--preset", CONVERT_PRESET, "--output", "/m/x.mp4"]], "the movie is converted within 1920x1080");
t.throws(() => createMacCapture({}), "capture needs an injected exec");

const PNGB = (size) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(size)]);
const children = [];
function fakeChild(command, args) {
  const child = Object.assign(new EventEmitter(), { command, args, signals: [] });
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGKILL") queueMicrotask(() => child.exit(null));
    return true;
  };
  child.exit = (code) => child.emit("close", code);
  children.push(child);
  return child;
}
const captureCalls = [];
let screenshotWorks = true, conversionWorks = true;
const capture = createMacCapture({
  folder: async (kind) => join(tmp, kind),
  startupMs: 20,
  stopMs: 200,
  exec: async (file, args) => {
    captureCalls.push([file, ...args]);
    if (file === "screencapture") {
      if (!screenshotWorks) {
        await writeFile(args.at(-1), ""); // a refused capture can leave an empty file
        throw Object.assign(new Error("could not create image from display"), { stderr: "private" });
      }
      await writeFile(args.at(-1), PNGB(2));
    }
    return { stdout: "" };
  },
  spawn: (command, args, options) => {
    t.equal(options.shell, false, `${command} never runs through a shell`);
    return fakeChild(command, args);
  },
  convert: async (source, output) => {
    captureCalls.push(["convert", source, output]);
    if (!conversionWorks) throw new Error("avconvert exited with code 1");
    await writeFile(output, PNGB(9));
  },
});
const shot = await capture.screenshot();
t.equal(shot.lastCapture.kind, "screenshot", "a screenshot is reported");
t.ok(shot.lastCapture.path.startsWith(join(tmp, "screenshot")), "screenshots use the host folder");
t.deepEqual(captureCalls.find((call) => call[0] === "screencapture").slice(1, 4), ["-x", "-t", "png"], "screenshots run screencapture");
screenshotWorks = false;
const shotError = await capture.screenshot().catch((error) => error);
t.equal(shotError.status, 503, "a failed screenshot is a service error");
t.ok(!shotError.message.includes("private") && !capture.status().error.includes("private"), "native diagnostics stay private");
t.ok(shotError.message.includes("Screen Recording"), "the error names the permission to check");
t.equal((await readdir(join(tmp, "screenshot"))).length, 1, "a failed screenshot leaves no empty file behind");

const first = capture.start(), duplicate = capture.start();
t.equal(capture.status().phase, "starting", "starting is visible");
const recording = await first;
t.equal((await duplicate).startedAt, recording.startedAt, "duplicate start shares one recording");
t.equal(recording.phase, "recording", "a recorder that survives startup is recording");
const rec = children[0];
t.equal(rec.command, "screencapture", "recordings run screencapture");
t.ok(rec.args.includes("-v") && rec.args.at(-1).endsWith(".mov"), "the recorder writes a movie");
const stopping = capture.stop();
t.deepEqual(rec.signals, ["SIGINT"], "stop asks screencapture to finalize");
await t.rejects(() => capture.start(), "cannot start while the old recording saves");
await writeFile(rec.args.at(-1), PNGB(3));
rec.exit(0);
const stopped = await stopping;
t.equal(stopped.phase, "idle", "a finalized recording returns to idle");
t.equal(stopped.lastCapture.kind, "recording", "the recording is reported");
t.ok(stopped.lastCapture.path.endsWith(".mp4") && stopped.lastCapture.path.startsWith(join(tmp, "recording")), "the MP4 is what the user gets");
t.deepEqual(captureCalls.at(-1), ["convert", rec.args.at(-1), stopped.lastCapture.path], "the movie is converted next to itself");
t.deepEqual(await readdir(join(tmp, "recording")), [stopped.lastCapture.name], "the movie is removed once the MP4 exists");

conversionWorks = false;
await capture.start();
const kept = children.at(-1);
const keptStop = capture.stop();
await writeFile(kept.args.at(-1), PNGB(4));
kept.exit(0);
const keptResult = await keptStop;
t.equal(keptResult.phase, "idle", "a recording whose conversion fails is still a success");
t.ok(keptResult.lastCapture.path.endsWith(".mov"), "the movie is kept when avconvert fails");
t.ok((await readdir(join(tmp, "recording"))).includes(keptResult.lastCapture.name), "the kept movie stays on disk");
conversionWorks = true;

const spawnedBefore = children.length;
const dead = capture.start();
for (let i = 0; i < 100 && children.length === spawnedBefore; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
const early = children.at(-1);
early.exit(1); // screencapture refused (permission, locked screen)
await t.rejects(() => dead, "a recorder that exits at once has not started");
t.equal(capture.status().phase, "error", "the failed start is visible");
t.ok(!(await readdir(join(tmp, "recording"))).includes(early.args.at(-1).split("/").pop()), "a failed start leaves no empty movie behind");

const limited = createMacCapture({
  folder: async (kind) => join(tmp, kind), startupMs: 10, limitMs: 30, stopMs: 500,
  exec: async () => ({ stdout: "" }),
  spawn: (command, args) => fakeChild(command, args),
  convert: async (source, output) => { await writeFile(output, PNGB(1)); },
});
await limited.start();
const auto = children.at(-1);
await new Promise((resolve) => setTimeout(resolve, 60));
t.deepEqual(auto.signals, ["SIGINT"], "recordings stop themselves at the time limit");
t.equal(limited.status().phase, "stopping", "the automatic stop is visible");
await writeFile(auto.args.at(-1), PNGB(4));
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
await writeFile(last.args.at(-1), PNGB(5));
last.exit(0);
await disposing;
await t.rejects(() => limited.start(), "a disposed capture refuses new recordings");
t.ok(createMacProvider({ exec: async () => ({ stdout: "" }), appDirs: [], tmp }).capture, "the provider exposes capture");

await rm(tmp, { recursive: true, force: true });
t.done("macos verification passed");
