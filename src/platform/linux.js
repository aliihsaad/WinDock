/**
 * Linux provider, built for Hyprland first.
 *
 * Inventory reads freedesktop .desktop entries, windows come from Hyprland's
 * IPC and media from MPRIS over the session D-Bus. Every action is an argv
 * array exactly like the Windows provider, so the no-shell guarantee is
 * identical on both platforms. On another compositor the window list is empty
 * and focus/close fail cleanly instead of guessing.
 */

import { spawn as spawnProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { validateControl } from "./contract.js";
import { createIconLookup } from "./linux-icons.js";
import { createLinuxCapture } from "./linux-capture.js";
import { createLinuxInput } from "./linux-input.js";
import { dataDirs } from "./xdg.js";

const APP_DIRS = dataDirs().map((dir) => join(dir, "applications"));

/** Strip freedesktop field codes (%f %U %i ...) from an Exec line. */
export function cleanExec(exec) {
  return String(exec || "")
    .replace(/%[fFuUdDnNickvm]/g, "")
    .trim();
}

/**
 * Split an Exec line into argv, honouring the quoting rules we actually need.
 * Returns [] for an empty line.
 */
export function splitExec(exec) {
  const line = cleanExec(exec);
  const argv = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && i + 1 < line.length && line[i + 1] === quote) {
        cur += quote;
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) argv.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += ch;
  }
  if (cur || has) argv.push(cur);
  return argv;
}

/**
 * Parse one .desktop file body into an app record, or null if not launchable.
 * `id` is the stable, lowercased dock id; `desktopId` keeps the file's real
 * case because gtk-launch resolves it case-sensitively.
 */
export function parseDesktop(body, id, desktopId = id) {
  const lines = String(body || "").split(/\r?\n/);
  let inEntry = false;
  const field = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inEntry = trimmed === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (field[key] === undefined) field[key] = trimmed.slice(eq + 1).trim();
  }
  if (field.Type && field.Type !== "Application") return null;
  if (field.NoDisplay === "true" || field.Hidden === "true") return null;
  const name = field.Name;
  const argv = splitExec(field.Exec);
  if (!name || argv.length === 0) return null;
  return {
    id,
    name,
    target: argv[0],
    args: argv.slice(1).join(" "),
    icon: field.Icon || "",
    source: "desktop",
    argv,
    desktopId,
    wmClass: field.StartupWMClass || "",
  };
}

async function readInventory(appDirs) {
  const byId = new Map();
  // The first readable file claims its id even when it is not launchable: a
  // user entry with Hidden=true or NoDisplay=true hides the system app.
  const claimed = new Set();
  for (const dir of appDirs) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".desktop")) continue;
      const desktopId = entry.replace(/\.desktop$/, "");
      const id = desktopId.toLowerCase();
      if (claimed.has(id)) continue;
      let body;
      try {
        body = await readFile(join(dir, entry), "utf8");
      } catch {
        continue; // unreadable entry is simply not an app
      }
      claimed.add(id);
      const app = parseDesktop(body, id, desktopId);
      if (app) byId.set(id, app);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

/** A desktop id becomes one gtk-launch argument, so it may never look like an option. */
const DESKTOP_ID = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/;

/**
 * Start a GUI app without owning it. `exec` waits for the child to exit and
 * kills it at its timeout, which closed every launched app after 20 seconds.
 * A detached child with no inherited pipes outlives the request and the host.
 * With `wait`, the launcher's own exit code is reported: gtk-launch exits as
 * soon as the app has been spawned.
 */
export function createLauncher({ spawn = spawnProcess, waitMs = 10_000 } = {}) {
  return function launch(file, args = [], { wait = false } = {}) {
    if (typeof file !== "string" || !file) {
      return Promise.reject(new Error("launch requires a file"));
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
      return Promise.reject(new Error("launch requires string arguments"));
    }
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(file, args, { detached: true, stdio: "ignore", shell: false });
      } catch (error) {
        reject(error);
        return;
      }
      child.once("error", reject);
      if (!wait) {
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
        return;
      }
      // A launcher that lingers has already started the app; stop waiting, not the app.
      const timer = setTimeout(() => {
        child.unref();
        resolve();
      }, waitMs);
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`${file} exited with code ${code}`));
      });
    });
  };
}

export const WINDOW_ADDRESS = /^0x[0-9a-f]{1,16}$/;

/** Chromium-family app windows are classed `chrome-<host>__<path>-<profile>`. */
export function webAppHost(windowClass) {
  const match = String(windowClass || "").match(/^[a-z]+-([a-z0-9-]+(?:\.[a-z0-9-]+)+)__/i);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Index installed apps by the names a window may report. Lower rank wins: an
 * explicit StartupWMClass beats the desktop id, which beats a web app's URL
 * host, which beats the binary name.
 */
export function createAppMatcher(apps) {
  const keys = new Map();
  const add = (key, rank, app) => {
    if (!key) return;
    const existing = keys.get(key);
    if (!existing || rank < existing.rank) keys.set(key, { rank, app });
  };
  for (const app of apps) {
    add(String(app.wmClass || "").toLowerCase(), 0, app);
    add(String(app.desktopId || "").toLowerCase(), 1, app);
    for (const arg of app.argv || []) {
      if (!/^https?:\/\//i.test(arg)) continue;
      try {
        add(`web:${new URL(arg).hostname}`, 2, app);
      } catch {
        /* not a URL after all */
      }
    }
    add(basename(String(app.argv?.[0] || "")).toLowerCase(), 3, app);
  }
  return (client) => {
    const host = webAppHost(client?.class);
    const candidates = [client?.class, client?.initialClass]
      .map((value) => String(value || "").toLowerCase())
      .concat(host ? [`web:${host}`] : [])
      .map((key) => keys.get(key))
      .filter(Boolean);
    candidates.sort((a, b) => a.rank - b.rank);
    return candidates[0]?.app || null;
  };
}

/**
 * Parse `hyprctl clients -j` into one record per dock app. Several windows of
 * one app collapse to the most recently focused, which is the one a tap should
 * bring forward. Windows keep their own address because browser web apps share
 * the browser's pid.
 */
export function parseHyprClients(raw, match = () => null) {
  let clients;
  try {
    clients = JSON.parse(String(raw || ""));
  } catch {
    return [];
  }
  if (!Array.isArray(clients)) return [];
  const byId = new Map();
  for (const client of clients) {
    if (!client || client.mapped === false) continue;
    const pid = Number(client.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const address = typeof client.address === "string" ? client.address.toLowerCase() : "";
    if (!WINDOW_ADDRESS.test(address)) continue;
    const windowClass = typeof client.class === "string" ? client.class.trim() : "";
    const app = match(client);
    const id = app ? app.id : `proc:${(windowClass || "window").toLowerCase()}`;
    const recency = Number.isInteger(client.focusHistoryID) && client.focusHistoryID >= 0
      ? client.focusHistoryID
      : Number.MAX_SAFE_INTEGER;
    const existing = byId.get(id);
    if (existing && existing.recency <= recency) continue;
    byId.set(id, {
      recency,
      record: {
        id,
        name: app?.name || windowClass || "Window",
        title: typeof client.title === "string" ? client.title.trim() : "",
        pid,
        path: "",
        address,
        windowClass,
      },
    });
  }
  return [...byId.values()]
    .map((entry) => entry.record)
    .sort((a, b) => a.pid - b.pid || a.id.localeCompare(b.id));
}

/**
 * Hyprland applies focus and close to the ACTIVE window when a selector
 * matches nothing, so a window that closed after the phone's last refresh
 * would redirect the tap to whatever the user is working in. Lua runs inside
 * the compositor, so this existence check and the dispatch cannot be split.
 */
export function hyprWindowLua(action, address) {
  if (!WINDOW_ADDRESS.test(address)) throw new Error("invalid window address");
  const selector = `address:${address}`;
  const dispatcher = {
    focus: `hl.dsp.focus({ window = "${selector}" })`,
    close: `hl.dsp.window.close({ window = "${selector}" })`,
  }[action];
  if (!dispatcher) throw new Error("unknown window action");
  return `local w = hl.get_window("${selector}") if not w or w.address ~= "${address}" then error("windock: window not found") end hl.dispatch(${dispatcher})`;
}

/** Dispatchers for a hyprlang (pre-Lua) config, which has no atomic check. */
export const HYPR_LEGACY = Object.freeze({ focus: "focuswindow", close: "closewindow" });

export const MPRIS_PATH = "/org/mpris/MediaPlayer2";
export const MPRIS_PLAYER = "org.mpris.MediaPlayer2.Player";
const MPRIS_NAME = /^org\.mpris\.MediaPlayer2\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** MPRIS players from a `busctl --json=short call ... ListNames` reply. */
export function parseBusNames(raw) {
  let reply;
  try {
    reply = JSON.parse(String(raw || ""));
  } catch {
    return [];
  }
  const names = Array.isArray(reply?.data?.[0]) ? reply.data[0] : [];
  return names.filter((name) => typeof name === "string" && MPRIS_NAME.test(name));
}

/** busctl prints one JSON document per requested property, in request order. */
export function parsePlayerState(raw) {
  const [status, metadata] = String(raw || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    });
  const field = (key) => metadata?.data?.[key]?.data;
  const title = typeof field("xesam:title") === "string" ? field("xesam:title").trim() : "";
  const artists = field("xesam:artist");
  const artist = Array.isArray(artists)
    ? artists.filter((a) => typeof a === "string").join(", ").trim()
    : "";
  return { status: typeof status?.data === "string" ? status.data : "", title, artist };
}

/** The player a media key would reach: playing beats paused beats the rest. */
export function pickPlayer(players) {
  const rank = (player) => (player.status === "Playing" ? 0 : player.status === "Paused" ? 1 : 2);
  return [...players].sort((a, b) => rank(a) - rank(b))[0] || null;
}

const mpris = (method) => (_value, player) => [
  "busctl",
  ["--user", "call", player, MPRIS_PATH, MPRIS_PLAYER, method],
];

/** Control verbs mapped to concrete Linux argv. Media verbs also receive the player. */
export const LINUX_CONTROL = Object.freeze({
  "volume-up": () => ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", "+5%"]],
  "volume-down": () => ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", "-5%"]],
  "volume-set": (v) => ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${v}%`]],
  "mute-toggle": () => ["pactl", ["set-sink-mute", "@DEFAULT_SINK@", "toggle"]],
  "media-play-pause": mpris("PlayPause"),
  "media-next": mpris("Next"),
  "media-previous": mpris("Previous"),
  "media-stop": mpris("Stop"),
  "brightness-set": (v) => ["brightnessctl", ["set", `${v}%`]],
  lock: (_v, session) => ["loginctl", session ? ["lock-session", session] : ["lock-session"]],
  sleep: () => ["systemctl", ["suspend"]],
  shutdown: () => ["systemctl", ["poweroff"]],
  restart: () => ["systemctl", ["reboot"]],
});

const MEDIA_VERBS = new Set(["media-play-pause", "media-next", "media-previous", "media-stop"]);

/** External monitors have no backlight device; VCP 0x10 is DDC/CI brightness. */
export function ddcBrightnessArgv(value) {
  return ["ddcutil", ["setvcp", "10", String(value)]];
}

/**
 * Desktops whose shell ignores logind's Lock signal ship their own command.
 * Omarchy's shell draws its own lock screen and only answers this one.
 */
export const LOCK_COMMANDS = Object.freeze([["omarchy-system-lock", []]]);
const SESSION_ID = /^[A-Za-z0-9]{1,32}$/;

const failure = (message, status) => Object.assign(new Error(message), { status });

export function createLinuxProvider({
  exec,
  spawn = spawnProcess,
  launch = createLauncher({ spawn }),
  appDirs = APP_DIRS,
  backlightDir = "/sys/class/backlight",
  icons,
  capture,
  input,
  now = Date.now,
  uid = process.getuid?.() ?? 0,
} = {}) {
  if (typeof exec !== "function") throw new Error("linux provider requires exec");

  let inventory = null;
  let inventoryAt = 0;
  function installed() {
    if (!inventory || now() - inventoryAt > 30_000) {
      inventoryAt = now();
      inventory = readInventory(appDirs).catch((error) => {
        inventory = null;
        throw error;
      });
    }
    return inventory;
  }

  /** hyprctl prints "ok" on success; its errors can arrive with a non-zero exit. */
  async function hyprctl(args) {
    const { stdout } = await exec("hyprctl", args).catch((error) => ({ stdout: error?.stdout ?? "" }));
    return String(stdout).trim();
  }

  async function windowExists(address) {
    const { stdout } = await exec("hyprctl", ["clients", "-j"]);
    try {
      const clients = JSON.parse(stdout);
      return Array.isArray(clients) && clients.some((c) => String(c?.address).toLowerCase() === address);
    } catch {
      return false;
    }
  }

  let luaConfig = null;
  async function windowAction(action, running) {
    const address = typeof running?.address === "string" ? running.address.toLowerCase() : "";
    if (!WINDOW_ADDRESS.test(address)) throw new Error(`${action} requires a window address`);
    const gone = () => failure("That window is no longer open.", 404);
    if (luaConfig !== false) {
      const out = await hyprctl(["eval", hyprWindowLua(action, address)]);
      if (out === "ok") {
        luaConfig = true;
        return;
      }
      if (out.includes("windock: window not found")) throw gone();
      if (luaConfig === true || !/only supported with the lua|unknown request/i.test(out)) {
        throw failure("Hyprland could not switch windows.", 502);
      }
      luaConfig = false;
    }
    // Without Lua the check and the dispatch are two requests; keep them adjacent.
    if (!(await windowExists(address))) throw gone();
    const out = await hyprctl(["dispatch", HYPR_LEGACY[action], `address:${address}`]);
    if (out !== "ok") throw failure("Hyprland could not switch windows.", 502);
  }

  async function players() {
    const { stdout } = await exec("busctl", [
      "--user", "--json=short", "call",
      "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames",
    ]);
    const states = await Promise.all(parseBusNames(stdout).map(async (name) => {
      try {
        const reply = await exec("busctl", [
          "--user", "--json=short", "get-property", name, MPRIS_PATH, MPRIS_PLAYER,
          "PlaybackStatus", "Metadata",
        ]);
        return { name, ...parsePlayerState(reply.stdout) };
      } catch {
        return null; // a player that vanished mid-query is simply not playing
      }
    }));
    return states.filter(Boolean);
  }

  async function hasBacklight() {
    try {
      return (await readdir(backlightDir)).length > 0;
    } catch {
      return false;
    }
  }

  // DDC/CI monitor firmware can reject overlapping requests.
  let brightnessQueue = Promise.resolve();
  async function setBrightness(value) {
    const [file, args] = (await hasBacklight())
      ? LINUX_CONTROL["brightness-set"](value)
      : ddcBrightnessArgv(value);
    const pending = brightnessQueue.then(() => exec(file, args));
    brightnessQueue = pending.catch(() => {});
    try {
      await pending;
    } catch (cause) {
      const error = new Error("Could not adjust display brightness. Check that DDC/CI is enabled in your monitor's menu and that your user can access the I2C devices.", { cause });
      error.status = 503;
      throw error;
    }
  }

  /**
   * Lock the session on screen. logind's Lock reaches GNOME, KDE and hypridle,
   * but a bare `loginctl lock-session` locks the caller's own session, and a
   * host started from a terminal app or a service sits in the user manager's
   * session, which has no screen. Name the user's graphical session instead.
   */
  async function lockScreen() {
    for (const [file, args] of LOCK_COMMANDS) {
      try {
        await exec(file, args);
        return;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    let session = "";
    try {
      const { stdout } = await exec("loginctl", ["show-user", String(uid), "--property=Display", "--value"]);
      session = String(stdout).trim();
    } catch {
      /* no graphical session recorded: fall back to the caller's own */
    }
    const [file, args] = LINUX_CONTROL.lock(null, SESSION_ID.test(session) ? session : "");
    await exec(file, args);
  }

  const iconLookup = icons ?? createIconLookup({ exec });

  return {
    id: "linux",
    displayName: "Linux",
    capture: capture ?? createLinuxCapture({ exec, spawn }),
    input: input === undefined ? createLinuxInput({ spawn }) : input,

    async appIcon(app) {
      return iconLookup(app?.icon);
    },

    async listInstalledApps() {
      return installed();
    },

    async listRunningApps() {
      let stdout;
      try {
        ({ stdout } = await exec("hyprctl", ["clients", "-j"]));
      } catch {
        return []; // not Hyprland: no window list rather than a process dump
      }
      const apps = await installed().catch(() => []);
      return parseHyprClients(stdout, createAppMatcher(apps));
    },

    async launchApp(app) {
      const argv = Array.isArray(app?.argv) && app.argv.length ? app.argv : null;
      const target = argv ? argv[0] : typeof app === "string" ? app : app?.target;
      if (typeof target !== "string" || !target.trim()) {
        throw new Error("launchApp requires a target path");
      }
      const desktopId = typeof app?.desktopId === "string" ? app.desktopId : "";
      if (DESKTOP_ID.test(desktopId)) {
        // gtk-launch honours Terminal=, Path=, DBusActivatable and field codes.
        try {
          await launch("gtk-launch", [desktopId], { wait: true });
          return;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      await launch(target, argv ? argv.slice(1) : []);
    },

    async focusApp(running) {
      await windowAction("focus", running);
    },

    async closeApp(running) {
      await windowAction("close", running);
    },

    async control(verb, value) {
      const checked = validateControl(verb, value);
      if (!checked.ok) throw new Error(checked.error);
      const build = LINUX_CONTROL[checked.verb];
      if (!build) throw new Error(`unmapped control verb: ${checked.verb}`);
      if (checked.verb === "brightness-set") {
        await setBrightness(checked.value);
        return { ok: true, verb: checked.verb };
      }
      if (checked.verb === "lock") {
        await lockScreen();
        return { ok: true, verb: checked.verb };
      }
      let player = null;
      if (MEDIA_VERBS.has(checked.verb)) {
        player = pickPlayer(await players().catch(() => []));
        if (!player) throw failure("No media player is open on this PC.", 409);
      }
      const [file, args] = build(checked.value, player?.name);
      await exec(file, args);
      return { ok: true, verb: checked.verb };
    },

    async nowPlaying() {
      try {
        const player = pickPlayer(await players());
        if (!player?.title) return null;
        return { title: player.title, artist: player.artist, playing: player.status === "Playing" };
      } catch {
        return null;
      }
    },

    async systemStats() {
      let memory = null;
      try {
        const info = await readFile("/proc/meminfo", "utf8");
        const total = Number(info.match(/MemTotal:\s+(\d+)/)?.[1]);
        const avail = Number(info.match(/MemAvailable:\s+(\d+)/)?.[1]);
        if (Number.isFinite(total) && Number.isFinite(avail) && total > 0) {
          memory = Math.round(((total - avail) / total) * 100);
        }
      } catch {
        /* /proc unavailable */
      }
      return { cpu: null, memory, battery: null, charging: null };
    },
  };
}
