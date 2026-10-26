/**
 * The `windock` command on Linux.
 *
 * The host runs as the systemd user service windock.service, so closing the
 * window that opened it no longer disconnects the phone. This command starts
 * that service with the desktop session's environment, then shows the address
 * and pairing PIN the host publishes in the user's private runtime directory.
 * Without a systemd user manager, the host runs in this window as before.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_PORT, readyMessage, start } from "../../server.js";
import { isValidPinShape } from "../auth.js";

export const UNIT = "windock.service";

/**
 * What the background host takes from the session that opened it: the
 * compositor to talk to, the search path of the apps it launches, and
 * WinDock's own settings. Hyprland and uwsm usually export most of these to
 * the user manager already; the file makes sure the host joins this session.
 */
export const SESSION_VARS = Object.freeze([
  "WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DISPLAY", "XAUTHORITY",
  "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XDG_SESSION_DESKTOP", "XDG_DATA_DIRS",
  "PATH", "DBUS_SESSION_BUS_ADDRESS",
  "PORT", "WINDOCK_HOST", "WINDOCK_ALLOWED_HOSTS", "WINDOCK_CONFIG",
]);

/** A host started for another compositor instance belongs to an old session. */
export const SESSION_KEYS = Object.freeze(["HYPRLAND_INSTANCE_SIGNATURE", "WAYLAND_DISPLAY"]);

export const USAGE = `Usage: windock [--foreground | status | stop | --version]

  windock               Start WinDock in the background and show its PIN
  windock --foreground  Run WinDock in this window until the window closes
  windock status        Show the address and PIN of the running WinDock
  windock stop          Stop WinDock running in the background
`;

/** The service unit reads and writes these as %t/windock-session.env and %t/windock/host.json. */
export function runtimePaths(env) {
  const dir = env.XDG_RUNTIME_DIR;
  if (!dir || !isAbsolute(dir)) return null;
  return { session: join(dir, "windock-session.env"), status: join(dir, "windock", "host.json") };
}

/**
 * systemd EnvironmentFile syntax. Single quotes keep every other character
 * literally; the rare value that needs a quote or line break is left out.
 */
export function renderSessionEnv(env) {
  return SESSION_VARS
    .filter((name) => typeof env[name] === "string" && env[name] !== "" && !/['\r\n\0]/.test(env[name]))
    .map((name) => `${name}='${env[name]}'\n`)
    .join("");
}

export function sessionOf(env) {
  return Object.fromEntries(SESSION_KEYS.map((name) => [name, env[name] || ""]));
}

/** Owner-only, since the PIN pairs a phone, and replaced whole so a reader never sees half a file. */
async function writePrivate(file, text) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, file);
}

export function writeStatus(file, status) {
  return writePrivate(file, `${JSON.stringify(status)}\n`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The running host's details, or null when there is no live host behind the file. */
export async function readStatus(file, { alive = isAlive } = {}) {
  if (!file) return null;
  let status;
  try {
    status = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  if (!Number.isInteger(status?.pid) || status.pid <= 0 || !alive(status.pid)) return null;
  if (typeof status.endpoint !== "string" || !isValidPinShape(status.pin)) return null;
  return status;
}

export function details(status) {
  return `  Address:  ${status.endpoint}\n  PIN:      ${status.pin}\n`;
}

/** Keys in the connection window: S stops the host; Q, Enter, Esc, Ctrl+C or Ctrl+D close the window. */
export function viewerKey(key) {
  if (key === "s" || key === "S") return "stop";
  if (["q", "Q", "\r", "\n", "\x1b", "\x03", "\x04"].includes(key)) return "close";
  return null;
}

export function screen(note, status, interactive) {
  return `WinDock — Linux preview\n\n${note}\n${details(status)}\n` +
    "On your phone, open WinDock, choose this PC and enter the PIN.\n" +
    "WinDock keeps running after you close this window.\n" +
    (interactive ? "Press S to stop WinDock, or Q to close this window.\n" : "Run `windock stop` to stop it.\n");
}

function runCommand(file, args) {
  return new Promise((done) => {
    execFile(file, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Whether a WinDock host, perhaps one in another terminal window, already answers on the port. */
async function windockOnPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return (await response.json())?.app === "windock";
  } catch {
    return false;
  }
}

async function runForeground(out, note) {
  out("WinDock — Linux preview\n" + (note ? `${note}\n` : "") +
    "Keep this window open while using your phone. Press Ctrl+C to quit.\n" +
    "Your connection address and pairing PIN appear below.\n\n");
  out(readyMessage(await start()));
  return null; // the host keeps this process running
}

/** Shows the details until a key closes the window, and follows a restart or stop of the host. */
function interact({ status, note, out, stdin, statusFile, unitState, stop, alive, pollMs = 2000 }) {
  const clear = "\x1b[2J\x1b[H";
  out(clear + screen(note, status, true));
  return new Promise((exit) => {
    let shown = status;
    let polling = false;
    let stopping = false;
    let misses = 0;
    let done = false;
    const timer = setInterval(async () => {
      if (polling || stopping) return;
      polling = true;
      const current = await readStatus(statusFile, { alive });
      if (current) {
        misses = 0;
        if (current.pid !== shown.pid || current.pin !== shown.pin) {
          shown = current;
          out(clear + screen("WinDock restarted, so it has a new PIN.", current, true));
        }
      } else {
        // A restart briefly removes the details; only a stopped unit ends the window.
        const unit = await unitState();
        const restarting = ["active", "activating", "deactivating", "reloading"].includes(unit?.ActiveState);
        misses = restarting ? 0 : misses + 1;
        if (misses >= 2) return finish("\nWinDock has stopped.\n");
      }
      polling = false;
    }, pollMs);
    const onKey = async (chunk) => {
      const action = viewerKey(String(chunk));
      if (action === "close") return finish("");
      if (action !== "stop" || stopping) return;
      stopping = true;
      out(await stop() ? "\nWinDock stopped.\n" : "\nWinDock could not be stopped. Try `windock stop`.\n");
      setTimeout(() => finish(""), 1500);
    };
    function finish(message) {
      if (done) return;
      done = true;
      clearInterval(timer);
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      out(message);
      exit(0);
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onKey);
  });
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  out = (text) => process.stdout.write(text),
  err = (text) => process.stderr.write(text),
  run = runCommand,
  probe = windockOnPort,
  foreground = runForeground,
  stdin = process.stdin,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  alive = isAlive,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  waitMs = 15_000,
  pollMs = 250,
} = {}) {
  const port = Number(env.PORT) || DEFAULT_PORT;
  const paths = runtimePaths(env);
  const systemctl = (...args) => run("systemctl", ["--user", ...args]);

  /** LoadState and ActiveState of the unit, or null without a reachable user manager. */
  async function unitState() {
    if (!paths) return null;
    const result = await systemctl("show", UNIT, "--property=LoadState,ActiveState");
    if (result.code !== 0) return null;
    return Object.fromEntries(result.stdout.trim().split("\n").map((line) => line.split("=", 2)));
  }

  async function stopService() {
    const unit = await unitState();
    if (!unit || unit.ActiveState === "inactive" || unit.ActiveState === "failed") return false;
    return (await systemctl("stop", UNIT)).code === 0;
  }

  /** Waits for a host other than `previous` to publish its details. */
  async function published(previous) {
    for (let waited = 0; waited < waitMs; waited += pollMs) {
      const status = await readStatus(paths.status, { alive });
      if (status && status.pid !== previous?.pid) return status;
      const unit = await unitState();
      if (waited > 0 && (!unit || unit.ActiveState === "failed" || unit.ActiveState === "inactive")) break;
      await sleep(pollMs);
    }
    return null;
  }

  /** A window opened from the menu closes when the command exits, so keep an error readable. */
  async function failed() {
    if (interactive) {
      err("\nPress any key to close this window.\n");
      stdin.setRawMode(true);
      stdin.resume();
      await new Promise((done) => stdin.once("data", done));
      stdin.setRawMode(false);
      stdin.pause();
    }
    return 1;
  }

  async function startFailed() {
    err("WinDock could not start in the background.\n");
    const log = await run("journalctl", ["--user", "--unit", UNIT, "--lines=10", "--no-pager", "--output=cat"]);
    if (log.code === 0 && log.stdout.trim()) err(`${log.stdout.trimEnd()}\n`);
    err("For details, run: journalctl --user --unit windock\n");
    return failed();
  }

  async function open(inWindow) {
    if (!env.HYPRLAND_INSTANCE_SIGNATURE) {
      err("WinDock's Linux preview needs a Hyprland desktop session.\nOpen it from your Hyprland application menu.\n");
      return 1;
    }
    if (inWindow) return foreground(out, "");
    const unit = await unitState();
    if (unit?.LoadState !== "loaded") {
      return foreground(out, "Background mode needs a systemd user session, so WinDock runs in this window.");
    }
    await writePrivate(paths.session, renderSessionEnv(env));
    let status = await readStatus(paths.status, { alive });
    let note;
    if (status && unit.ActiveState === "active") {
      const session = sessionOf(env);
      if (SESSION_KEYS.every((name) => status.session?.[name] === session[name])) {
        note = "WinDock is running in the background.";
      } else {
        // The host still talks to an earlier compositor; join this one.
        if ((await systemctl("restart", UNIT)).code !== 0) return startFailed();
        status = await published(status);
        note = "WinDock restarted for this desktop session.";
      }
    } else {
      if (unit.ActiveState !== "active" && unit.ActiveState !== "activating" && await probe(port)) {
        err(`WinDock is already open in another window, which uses port ${port}.\n` +
          "Close that window (or press Ctrl+C in it), then open WinDock again.\n");
        return failed();
      }
      if (unit.ActiveState !== "activating" && (await systemctl("start", UNIT)).code !== 0) return startFailed();
      status = await published(null);
      note = "Started WinDock in the background.";
    }
    if (!status) return startFailed();
    if (!interactive) {
      out(screen(note, status, false));
      return 0;
    }
    return interact({ status, note, out, stdin, statusFile: paths.status, unitState, stop: stopService, alive });
  }

  async function showStatus() {
    const status = await readStatus(paths?.status, { alive });
    if (status) {
      out(`WinDock is running in the background.\n${details(status)}`);
      return 0;
    }
    if (await probe(port)) {
      out("WinDock is running in a terminal window, which shows its address and PIN.\n");
      return 0;
    }
    out("WinDock is not running. Open it from your application menu, or run `windock`.\n");
    return 3;
  }

  async function stop() {
    const unit = await unitState();
    if (unit && unit.ActiveState !== "inactive" && unit.ActiveState !== "failed") {
      const result = await systemctl("stop", UNIT);
      if (result.code !== 0) {
        err(`WinDock could not be stopped: ${result.stderr.trim() || `systemctl exited with code ${result.code}`}\n`);
        return 1;
      }
      out("WinDock stopped.\n");
    } else {
      out("WinDock is not running in the background.\n");
    }
    if (await probe(port)) out("Another WinDock is still open in a terminal window. Close that window to stop it.\n");
    return 0;
  }

  const [command, ...extra] = argv;
  if (extra.length) {
    err(USAGE);
    return 2;
  }
  switch (command) {
    case undefined: return open(false);
    case "--foreground": return open(true);
    case "status": return showStatus();
    case "stop": return stop();
    case "help": case "--help": case "-h": out(USAGE); return 0;
    default: err(USAGE); return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main()
    .then((code) => {
      if (code !== null) process.exit(code);
    })
    .catch((error) => {
      process.stderr.write(`WinDock failed to start: ${error.message}\n`);
      process.exit(1);
    });
}
