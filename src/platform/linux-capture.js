/**
 * Linux screen capture with the Windows helper's lifecycle and limits:
 * PNG screenshots of the focused monitor, and silent MP4 recordings that fit
 * within 1920x1080 at 15 fps and stop themselves after 60 minutes.
 *
 * Screenshots use grim. Recording prefers wf-recorder (wlroots screencopy, no
 * permission prompt) and falls back to gpu-screen-recorder, whose KMS capture
 * some GPU/compositor combinations cannot read: it keeps running and writes an
 * empty video, so a "gsr error:" line during startup counts as a failed start.
 */

import { spawn as spawnProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { userDir } from "./xdg.js";

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const FPS = 15;
export const RECORDING_LIMIT_MS = 60 * 60_000;
const MONITOR = /^[A-Za-z0-9._-]{1,64}$/;
const CAPTURE_ERROR = "Screen capture failed. Check that your PC is unlocked and your Pictures and Videos folders are writable.";
const SCREEN_OFF = "Your PC's screen is asleep. Wake it, then try again.";
const failure = (message, status = 503) => Object.assign(new Error(message), { status });

/** Same shape as the Windows helper's names: sortable and collision-free. */
export function captureName(kind, date = new Date(), suffix = randomBytes(3).toString("hex")) {
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  return `WinDock-${stamp}-${suffix}.${kind === "recording" ? "mp4" : "png"}`;
}

export function screenshotArgv(monitor, path) {
  return ["grim", monitor ? ["-o", monitor, path] : [path]];
}

export function recorderArgv(backend, monitor, path) {
  if (backend === "wf-recorder") {
    // Quotes are for ffmpeg's filter parser (the commas sit inside min()), not a shell.
    const fit = `scale=w='min(${MAX_WIDTH},iw)':h='min(${MAX_HEIGHT},ih)'` +
      ":force_original_aspect_ratio=decrease:force_divisible_by=2";
    return ["wf-recorder", [...(monitor ? ["-o", monitor] : []), "-r", String(FPS), "-F", fit, "-f", path]];
  }
  if (backend === "gpu-screen-recorder") {
    return ["gpu-screen-recorder", [
      "-w", monitor || "screen", "-s", `${MAX_WIDTH}x${MAX_HEIGHT}`, "-f", String(FPS),
      "-k", "h264", "-cursor", "no", "-v", "no", "-fallback-cpu-encoding", "yes", "-o", path,
    ]];
  }
  throw new Error("unknown recorder");
}

export function createLinuxCapture({
  exec,
  spawn = spawnProcess,
  folder = userDir,
  backends = ["wf-recorder", "gpu-screen-recorder"],
  startupMs = 1500,
  stopMs = 30_000,
  limitMs = RECORDING_LIMIT_MS,
} = {}) {
  let worker = null, starting = null, stopRequested = false;
  let phase = "idle", startedAt = null, lastCapture = null, error = null;
  let pendingScreenshot = null, closed = false;
  const status = () => ({ available: true, phase, startedAt, elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0, lastCapture, error });

  async function target(kind) {
    const dir = join(await folder(kind === "recording" ? "VIDEOS" : "PICTURES"), "WinDock");
    await mkdir(dir, { recursive: true });
    const name = captureName(kind);
    return { name, path: join(dir, name) };
  }

  /**
   * The focused monitor, so a capture shows what the user is looking at.
   * Screencopy delivers no frames while a display sleeps, which would leave
   * grim waiting until its timeout, so a sleeping display fails fast.
   */
  async function monitor() {
    let pick;
    try {
      const { stdout } = await exec("hyprctl", ["monitors", "-j"]);
      const monitors = JSON.parse(stdout);
      pick = monitors.find((m) => m?.focused) || monitors[0];
    } catch {
      return null; // not Hyprland: let the tool pick its default output
    }
    if (pick?.dpmsStatus === false) throw failure(SCREEN_OFF, 409);
    return MONITOR.test(pick?.name || "") ? pick.name : null;
  }

  async function saved(kind, file) {
    const info = await stat(file.path).catch(() => null);
    if (!info?.isFile() || info.size === 0) return null;
    return { kind, path: file.path, name: file.name, savedAt: Date.now() };
  }

  async function takeScreenshot() {
    const screen = await monitor();
    const file = await target("screenshot").catch(() => null);
    if (file) {
      const [command, args] = screenshotArgv(screen, file.path);
      const capture = await exec(command, args).then(() => saved("screenshot", file), () => null);
      if (capture) {
        lastCapture = capture;
        error = null;
        return status();
      }
      await unlink(file.path).catch(() => {}); // grim may leave an empty or partial PNG
    }
    error = CAPTURE_ERROR;
    throw failure(CAPTURE_ERROR);
  }

  /** Resolves to a running worker, or null when this backend cannot record here. */
  function spawnRecorder(backend, screen, file) {
    return new Promise((resolve) => {
      const [command, args] = recorderArgv(backend, screen, file.path);
      let child;
      try {
        child = spawn(command, args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
      } catch {
        resolve(null);
        return;
      }
      const began = Date.now();
      let diagnostics = "", settled = false;
      const exited = new Promise((done) => {
        child.once("close", done);
        child.once("error", () => done(-1));
      });
      // Keep draining stderr for the whole recording; only the start is inspected,
      // and native diagnostics never reach an HTTP response.
      child.stderr?.on("data", (chunk) => {
        if (diagnostics.length < 16_384) diagnostics += chunk;
      });
      const timer = setTimeout(() => {
        settled = true;
        if (/^gsr error:/m.test(diagnostics)) {
          child.kill("SIGKILL");
          exited.then(() => resolve(null));
        } else {
          resolve({ child, exited, file, startedAt: began });
        }
      }, startupMs);
      exited.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  function requestStop(current) {
    if (current.stopping) return;
    current.stopping = true;
    phase = "stopping";
    current.child.kill("SIGINT"); // both recorders finalize the MP4 on SIGINT
    current.force = setTimeout(() => current.child.kill("SIGKILL"), stopMs);
  }

  async function finish(current) {
    const code = await current.exited;
    clearTimeout(current.limit);
    clearTimeout(current.force);
    if (worker === current) worker = null;
    startedAt = null;
    const capture = code === 0 ? await saved("recording", current.file) : null;
    if (capture) {
      lastCapture = capture;
      error = null;
      phase = "idle";
      return status();
    }
    error = CAPTURE_ERROR;
    phase = "error";
    throw failure(CAPTURE_ERROR);
  }

  async function startRecording() {
    let screen;
    try {
      screen = await monitor();
    } catch (sleeping) {
      phase = "idle";
      throw sleeping;
    }
    const file = await target("recording").catch(() => null);
    for (const backend of file ? backends : []) {
      const current = await spawnRecorder(backend, screen, file);
      if (!current) {
        await unlink(file.path).catch(() => {}); // a failed start may leave an empty file
        continue;
      }
      worker = current;
      startedAt = current.startedAt;
      current.done = finish(current);
      current.done.catch(() => {}); // an unexpected exit is reported through status
      current.limit = setTimeout(() => requestStop(current), limitMs);
      if (stopRequested) requestStop(current);
      else phase = "recording";
      return status();
    }
    phase = "error";
    error = CAPTURE_ERROR;
    throw failure(CAPTURE_ERROR);
  }

  const api = {
    status,
    async screenshot() {
      if (closed) throw failure("WinDock is shutting down.");
      if (!pendingScreenshot) {
        pendingScreenshot = takeScreenshot().finally(() => { pendingScreenshot = null; });
      }
      return pendingScreenshot;
    },
    async start() {
      if (closed) throw failure("WinDock is shutting down.");
      if (starting) return starting;
      if (worker) {
        if (phase === "stopping") throw failure("The previous recording is still saving.", 409);
        return status();
      }
      phase = "starting";
      error = null;
      startedAt = null;
      stopRequested = false;
      starting = startRecording().finally(() => { starting = null; });
      return starting;
    },
    async stop() {
      if (starting) {
        stopRequested = true;
        phase = "stopping";
        await starting.catch(() => {});
      }
      if (!worker) return status();
      const current = worker;
      requestStop(current);
      return current.done;
    },
    async dispose() {
      closed = true;
      await Promise.allSettled([api.stop(), pendingScreenshot]);
    },
  };
  return api;
}
