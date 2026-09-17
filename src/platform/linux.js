/**
 * Linux provider — a real, working provider used for development on this
 * machine, not a stub. It implements the same contract as the Windows provider
 * so the server, PWA, sync and auth layers can be exercised end to end here.
 *
 * Inventory reads freedesktop .desktop entries. Actions shell out through argv
 * arrays exactly like the Windows provider, so the no-shell guarantee is
 * identical on both platforms.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateControl } from "./contract.js";

const APP_DIRS = [
  "/usr/share/applications",
  "/usr/local/share/applications",
  join(homedir(), ".local/share/applications"),
];

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

/** Parse one .desktop file body into an app record, or null if not launchable. */
export function parseDesktop(body, id) {
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
  };
}

export function parsePs(raw) {
  const out = [];
  const seen = new Set();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    out.push({ id: `proc:${m[2].trim().toLowerCase()}`, name: m[2].trim(), title: "", pid, handle: 0, path: "" });
  }
  return out.sort((a, b) => a.pid - b.pid);
}

/** Control verbs mapped to concrete Linux argv. */
export const LINUX_CONTROL = Object.freeze({
  "volume-up": () => ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", "+5%"]],
  "volume-down": () => ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", "-5%"]],
  "volume-set": (v) => ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${v}%`]],
  "mute-toggle": () => ["pactl", ["set-sink-mute", "@DEFAULT_SINK@", "toggle"]],
  "media-play-pause": () => ["playerctl", ["play-pause"]],
  "media-next": () => ["playerctl", ["next"]],
  "media-previous": () => ["playerctl", ["previous"]],
  "media-stop": () => ["playerctl", ["stop"]],
  "brightness-set": (v) => ["brightnessctl", ["set", `${v}%`]],
  lock: () => ["loginctl", ["lock-session"]],
  sleep: () => ["systemctl", ["suspend"]],
  shutdown: () => ["systemctl", ["poweroff"]],
  restart: () => ["systemctl", ["reboot"]],
});

export function createLinuxProvider({ exec, appDirs = APP_DIRS } = {}) {
  if (typeof exec !== "function") throw new Error("linux provider requires exec");

  return {
    id: "linux",
    displayName: "Linux (development)",

    async listInstalledApps() {
      const byId = new Map();
      for (const dir of appDirs) {
        let entries;
        try {
          entries = await readdir(dir);
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.endsWith(".desktop")) continue;
          const id = entry.replace(/\.desktop$/, "").toLowerCase();
          if (byId.has(id)) continue;
          try {
            const app = parseDesktop(await readFile(join(dir, entry), "utf8"), id);
            if (app) byId.set(id, app);
          } catch {
            /* unreadable entry is simply not an app */
          }
        }
      }
      return [...byId.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      );
    },

    async listRunningApps() {
      const { stdout } = await exec("ps", ["-eo", "pid=,comm="]);
      return parsePs(stdout);
    },

    async launchApp(app) {
      const argv = Array.isArray(app?.argv) && app.argv.length ? app.argv : null;
      const target = argv ? argv[0] : typeof app === "string" ? app : app?.target;
      if (typeof target !== "string" || !target.trim()) {
        throw new Error("launchApp requires a target path");
      }
      await exec(target, argv ? argv.slice(1) : []);
    },

    async focusApp(running) {
      const pid = Number(running?.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("focusApp requires a positive integer pid");
      }
      await exec("wmctrl", ["-i", "-a", String(pid)]);
    },

    async closeApp(running) {
      const pid = Number(running?.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("closeApp requires a positive integer pid");
      }
      await exec("kill", [String(pid)]);
    },

    async control(verb, value) {
      const checked = validateControl(verb, value);
      if (!checked.ok) throw new Error(checked.error);
      const build = LINUX_CONTROL[checked.verb];
      if (!build) throw new Error(`unmapped control verb: ${checked.verb}`);
      const [file, args] = build(checked.value);
      await exec(file, args);
      return { ok: true, verb: checked.verb };
    },

    async nowPlaying() {
      try {
        const { stdout } = await exec("playerctl", [
          "metadata",
          "--format",
          "{{status}}\t{{artist}}\t{{title}}",
        ]);
        const [status, artist, title] = String(stdout).trim().split("\t");
        if (!title) return null;
        return { title, artist: artist || "", playing: status === "Playing" };
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
