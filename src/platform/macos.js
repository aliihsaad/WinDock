/**
 * macOS provider (phase 1: apps, windows, volume, media and power).
 *
 * Inventory reads the .app bundles in the standard Applications folders and
 * their Info.plist through plutil. Running apps come from System Events,
 * launch and focus go through `open`, and media through the scripting
 * interfaces of Spotify and Music. Every action is an argv array exactly like
 * the Windows and Linux providers. Scripts are constant text and receive
 * their input as osascript arguments, so no caller value is ever spliced into
 * a script. Touchpad, keyboard, signatures, capture and brightness need a
 * native helper and are not part of this phase.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { validateControl } from "./contract.js";

export const APP_DIRS = Object.freeze([
  "/Applications",
  "/Applications/Utilities",
  join(homedir(), "Applications"),
  "/System/Applications",
  "/System/Applications/Utilities",
]);

export const OSASCRIPT = "osascript";
/** JXA keeps caller values out of the script: they arrive in `run(argv)`. */
export const JXA_FLAGS = Object.freeze(["-l", "JavaScript", "-e"]);

/** A bundle identifier is one argv entry, so it may never look like an option. */
export const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
export const ICON_MAX_BYTES = 512 * 1024;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Constant JXA: application processes that own a user interface, as JSON. */
export const RUNNING_JXA = [
  'const se = Application("System Events");',
  "const ps = se.applicationProcesses.whose({ backgroundOnly: false });",
  "const names = ps.name(), ids = ps.bundleIdentifier(), pids = ps.unixId();",
  "JSON.stringify(names.map((name, i) => ({ name, bundleId: ids[i], pid: pids[i] })));",
].join(" ");

/** Constant JXA: quit the application named by argv[0] (a bundle identifier). */
export const QUIT_JXA = "function run(argv) { Application(argv[0]).quit(); return 'ok'; }";

/** Constant JXA: output volume. argv = [verb] or [verb, level]. */
export const VOLUME_JXA = [
  "function run(argv) {",
  "  const app = Application.currentApplication(); app.includeStandardAdditions = true;",
  "  const current = app.getVolumeSettings();",
  "  const verb = argv[0];",
  "  if (verb === 'mute-toggle') { app.setVolume(null, { outputMuted: !current.outputMuted }); return 'ok'; }",
  "  let level = verb === 'volume-set' ? Number(argv[1]) : current.outputVolume + (verb === 'volume-up' ? 5 : -5);",
  "  level = Math.max(0, Math.min(100, Math.round(level)));",
  "  app.setVolume(null, { outputVolume: level });",
  "  return 'ok';",
  "}",
].join(" ");

/** Players with a scripting interface, in the order a tie is broken. */
export const MEDIA_PLAYERS = Object.freeze(["Spotify", "Music"]);

/**
 * Constant JXA: media control and now playing over the running players.
 * argv = [verb]. A player that is not installed throws inside Application()
 * and simply does not take part; one that is stopped has no current track.
 */
export const MEDIA_JXA = [
  "function player(name) {",
  "  try {",
  "    const app = Application(name);",
  "    if (!app.running()) return null;",
  "    const state = String(app.playerState());",
  "    let title = '', artist = '';",
  "    try { title = String(app.currentTrack.name() || ''); artist = String(app.currentTrack.artist() || ''); } catch (e) {}",
  "    return { name, app, state, title, artist };",
  "  } catch (e) { return null; }",
  "}",
  "function run(argv) {",
  "  const rank = (p) => (p.state === 'playing' ? 0 : p.state === 'paused' ? 1 : 2);",
  `  const p = ${JSON.stringify(MEDIA_PLAYERS)}.map(player).filter(Boolean).sort((a, b) => rank(a) - rank(b))[0] || null;`,
  "  const verb = argv[0];",
  "  if (verb === 'now-playing') return JSON.stringify(p && p.title ? { title: p.title, artist: p.artist, playing: p.state === 'playing' } : null);",
  "  if (!p) return 'no-player';",
  "  if (verb === 'media-play-pause') p.app.playpause();",
  "  else if (verb === 'media-next') p.app.nextTrack();",
  "  else if (verb === 'media-previous') p.app.previousTrack();",
  "  else if (verb === 'media-stop') { if (p.name === 'Music') p.app.stop(); else p.app.pause(); }",
  "  else return 'unknown';",
  "  return 'ok';",
  "}",
].join(" ");

const jxa = (script, ...args) => [OSASCRIPT, [...JXA_FLAGS, script, ...args]];
const media = (verb) => () => jxa(MEDIA_JXA, verb);

/**
 * Control verbs mapped to concrete macOS argv. Brightness has no stock
 * command line on macOS and waits for the native helper.
 */
export const MAC_CONTROL = Object.freeze({
  "volume-up": () => jxa(VOLUME_JXA, "volume-up"),
  "volume-down": () => jxa(VOLUME_JXA, "volume-down"),
  "volume-set": (v) => jxa(VOLUME_JXA, "volume-set", String(v)),
  "mute-toggle": () => jxa(VOLUME_JXA, "mute-toggle"),
  "media-play-pause": media("media-play-pause"),
  "media-next": media("media-next"),
  "media-previous": media("media-previous"),
  "media-stop": media("media-stop"),
  // The display sleeps and the login password is required to wake it, which is
  // the macOS default. CGSession no longer ships, and the lock-screen shortcut
  // would need the Accessibility permission a phase-1 host does not ask for.
  lock: () => ["pmset", ["displaysleepnow"]],
  sleep: () => ["pmset", ["sleepnow"]],
  shutdown: () => [OSASCRIPT, ["-e", 'tell application "System Events" to shut down']],
  restart: () => [OSASCRIPT, ["-e", 'tell application "System Events" to restart']],
});

const MEDIA_VERBS = new Set(["media-play-pause", "media-next", "media-previous", "media-stop"]);

const failure = (message, status) => Object.assign(new Error(message), { status });

const flag = (value) => value === true || value === 1 || value === "1" || value === "YES" || value === "true";

/**
 * Turn an Info.plist (as `plutil -convert json` prints it) into an app record,
 * or null when the bundle is not something a person launches from a dock.
 * `id` is the lowercased bundle identifier: stable across moves and updates.
 */
export function parseInfoPlist(raw, bundlePath) {
  let info;
  try {
    info = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!info || typeof info !== "object") return null;
  const bundleId = typeof info.CFBundleIdentifier === "string" ? info.CFBundleIdentifier.trim() : "";
  if (!BUNDLE_ID.test(bundleId)) return null;
  if (flag(info.LSBackgroundOnly) || flag(info.LSUIElement)) return null;
  const packageType = info.CFBundlePackageType;
  if (typeof packageType === "string" && packageType !== "APPL") return null;
  const name = [info.CFBundleDisplayName, info.CFBundleName]
    .find((value) => typeof value === "string" && value.trim())?.trim() || basename(bundlePath, ".app");
  let icon = "";
  const iconFile = typeof info.CFBundleIconFile === "string" ? info.CFBundleIconFile.trim() : "";
  if (iconFile && !/[\\/]/.test(iconFile)) {
    icon = join(bundlePath, "Contents", "Resources", iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`);
  }
  return { id: bundleId.toLowerCase(), name, target: bundlePath, args: "", icon, source: "bundle", bundleId };
}

async function readInventory(appDirs, exec) {
  const byId = new Map();
  for (const dir of appDirs) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    const bundles = entries.filter((entry) => entry.endsWith(".app")).sort();
    // plutil is quick, but a folder of a hundred apps should not fan out into
    // a hundred processes at once.
    for (let i = 0; i < bundles.length; i += 8) {
      const records = await Promise.all(bundles.slice(i, i + 8).map(async (entry) => {
        const bundlePath = join(dir, entry);
        try {
          const { stdout } = await exec("plutil", ["-convert", "json", "-o", "-", join(bundlePath, "Contents", "Info.plist")]);
          return parseInfoPlist(stdout, bundlePath);
        } catch {
          return null; // not a readable bundle: simply not an app
        }
      }));
      for (const app of records) {
        if (app && !byId.has(app.id)) byId.set(app.id, app);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Parse the System Events process list into one record per app. An app from
 * the inventory keeps its dock id, so its tile lights up; anything else gets
 * a process id that no tile will ever match.
 */
export function parseProcesses(raw, apps = []) {
  let rows;
  try {
    rows = JSON.parse(String(raw || ""));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const byBundle = new Map(apps.map((app) => [String(app.bundleId || "").toLowerCase(), app]));
  const running = [];
  const seen = new Set();
  for (const row of rows) {
    const pid = Number(row?.pid);
    const bundleId = typeof row?.bundleId === "string" ? row.bundleId.trim() : "";
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid) || !BUNDLE_ID.test(bundleId)) continue;
    seen.add(pid);
    const app = byBundle.get(bundleId.toLowerCase());
    running.push({
      id: app ? app.id : `proc:${bundleId.toLowerCase()}`,
      name: app?.name || (typeof row.name === "string" && row.name.trim()) || bundleId,
      title: "",
      pid,
      path: app?.target || "",
      bundleId,
    });
  }
  return running.sort((a, b) => a.pid - b.pid);
}

/** The last "CPU usage" line of `top -l 2`; the first sample is since boot. */
export function parseCpu(raw) {
  const lines = String(raw || "").match(/CPU usage:[^\n]*/g);
  if (!lines) return null;
  const idle = Number(lines.at(-1).match(/([\d.]+)%\s*idle/)?.[1]);
  return Number.isFinite(idle) ? Math.max(0, Math.min(100, Math.round(100 - idle))) : null;
}

/** `memory_pressure` reports the free share; the dock shows what is used. */
export function parseMemory(raw) {
  const free = Number(String(raw || "").match(/free percentage:\s*(\d+)%/i)?.[1]);
  return Number.isFinite(free) ? Math.max(0, Math.min(100, 100 - free)) : null;
}

/** `pmset -g batt`; a desktop Mac has no battery line at all. */
export function parseBattery(raw) {
  const match = String(raw || "").match(/InternalBattery[^\n]*?\t(\d+)%;\s*([^;\n]*)/);
  if (!match) return { battery: null, charging: null };
  const status = match[2].trim().toLowerCase();
  return { battery: Number(match[1]), charging: status !== "discharging" };
}

/** The media script prints JSON or `null`. */
export function parseNowPlaying(raw) {
  let row;
  try {
    row = JSON.parse(String(raw || "").trim());
  } catch {
    return null;
  }
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  if (!title) return null;
  return { title, artist: typeof row.artist === "string" ? row.artist.trim() : "", playing: row.playing === true };
}

export function createMacProvider({
  exec,
  appDirs = APP_DIRS,
  tmp = tmpdir(),
  now = Date.now,
} = {}) {
  if (typeof exec !== "function") throw new Error("macos provider requires exec");

  let inventory = null;
  let inventoryAt = 0;
  function installed() {
    if (!inventory || now() - inventoryAt > 30_000) {
      inventoryAt = now();
      inventory = readInventory(appDirs, exec).catch((error) => {
        inventory = null;
        throw error;
      });
    }
    return inventory;
  }

  function bundleIdOf(running) {
    const bundleId = typeof running?.bundleId === "string" ? running.bundleId : "";
    if (!BUNDLE_ID.test(bundleId)) throw new Error("a running app needs a bundle identifier");
    return bundleId;
  }

  return {
    id: "darwin",
    displayName: "macOS",

    async appIcon(app) {
      const icns = typeof app?.icon === "string" ? app.icon : "";
      if (!icns.endsWith(".icns") || !icns.startsWith("/")) return null;
      const dir = await mkdtemp(join(tmp, "windock-icon-"));
      try {
        const out = join(dir, "icon.png");
        await exec("sips", ["-s", "format", "png", "-Z", "256", icns, "--out", out]);
        const bytes = await readFile(out);
        if (bytes.length > ICON_MAX_BYTES || !bytes.subarray(0, 8).equals(PNG_MAGIC)) return null;
        return bytes;
      } catch {
        return null;
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },

    async listInstalledApps() {
      return installed();
    },

    async listRunningApps() {
      let stdout;
      try {
        ({ stdout } = await exec(OSASCRIPT, [...JXA_FLAGS, RUNNING_JXA]));
      } catch {
        return []; // System Events refused (Automation permission): no windows, not a crash
      }
      const apps = await installed().catch(() => []);
      return parseProcesses(stdout, apps);
    },

    async launchApp(app) {
      const target = typeof app === "string" ? app : app?.target;
      if (typeof target !== "string" || !target.startsWith("/") || !target.endsWith(".app")) {
        throw new Error("launchApp requires an application bundle path");
      }
      await exec("open", [target]);
    },

    async focusApp(running) {
      await exec("open", ["-b", bundleIdOf(running)]);
    },

    async closeApp(running) {
      await exec(...jxa(QUIT_JXA, bundleIdOf(running)));
    },

    async control(verb, value) {
      const checked = validateControl(verb, value);
      if (!checked.ok) throw new Error(checked.error);
      if (checked.verb === "brightness-set") {
        throw failure("Brightness control is not available on macOS yet.", 501);
      }
      const build = MAC_CONTROL[checked.verb];
      if (!build) throw new Error(`unmapped control verb: ${checked.verb}`);
      const [file, args] = build(checked.value);
      const { stdout } = await exec(file, args);
      if (MEDIA_VERBS.has(checked.verb) && String(stdout).trim() === "no-player") {
        throw failure("No media player is open on this Mac.", 409);
      }
      return { ok: true, verb: checked.verb };
    },

    async nowPlaying() {
      try {
        const { stdout } = await exec(...jxa(MEDIA_JXA, "now-playing"));
        return parseNowPlaying(stdout);
      } catch {
        return null;
      }
    },

    async systemStats() {
      const read = (file, args) => exec(file, args).then((r) => r.stdout).catch(() => "");
      const [top, pressure, batt] = await Promise.all([
        read("top", ["-l", "2", "-n", "0", "-s", "1"]),
        read("memory_pressure", []),
        read("pmset", ["-g", "batt"]),
      ]);
      return { cpu: parseCpu(top), memory: parseMemory(pressure), ...parseBattery(batt) };
    },
  };
}
