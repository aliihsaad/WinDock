/**
 * macOS screen capture with the Windows helper's lifecycle and limits: PNG
 * screenshots of the main display and silent MP4 recordings that fit within
 * 1920x1080 and stop themselves after 60 minutes.
 *
 * Both come from screencapture, which ships with macOS. A recording is a
 * QuickTime movie while it runs; stopping finalizes it, and avconvert turns it
 * into H.264 MP4. When the conversion fails the movie is kept and reported
 * instead, so a long recording is never lost. The first capture asks macOS for
 * the Screen Recording permission on behalf of the app that runs WinDock.
 */

import { spawn as spawnProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const RECORDING_LIMIT_MS = 60 * 60_000;
export const CONVERT_PRESET = "Preset1920x1080";
const CAPTURE_ERROR = "Screen capture failed. Check that your Mac is unlocked, that Screen Recording is allowed for the app running WinDock, and that your Pictures and Movies folders are writable.";
const failure = (message, status = 503) => Object.assign(new Error(message), { status });

/** Same shape as the other hosts' names: sortable and collision-free. */
export function captureName(kind, date = new Date(), suffix = randomBytes(3).toString("hex"), extension = kind === "recording" ? "mp4" : "png") {
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  return `WinDock-${stamp}-${suffix}.${extension}`;
}

/** Captures live beside the other hosts' folders; macOS calls Videos "Movies". */
export function captureFolder(kind, home = homedir()) {
  return join(home, kind === "recording" ? "Movies" : "Pictures", "WinDock");
}

export function screenshotArgv(path) {
  return ["screencapture", ["-x", "-t", "png", path]];
}

/**
 * -x keeps it silent. The host enforces the time limit itself: with -V,
 * screencapture dies on SIGINT without finalizing the movie.
 */
export function recorderArgv(path) {
  return ["screencapture", ["-x", "-v", path]];
}

export function convertArgv(source, output) {
  return ["avconvert", ["--source", source, "--preset", CONVERT_PRESET, "--output", output]];
}

/** Run a bounded conversion without a shell; output is discarded. */
export function createConverter({ spawn = spawnProcess, timeoutMs = 600_000 } = {}) {
  return (source, output) => new Promise((resolve, reject) => {
    const [command, args] = convertArgv(source, output);
    let child;
    try {
      child = spawn(command, args, { shell: false, stdio: ["ignore", "ignore", "ignore"] });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`avconvert exited with code ${code}`));
    });
  });
}

export function createMacCapture({
  exec,
  spawn = spawnProcess,
  folder = captureFolder,
  convert = createConverter({ spawn }),
  startupMs = 1500,
  stopMs = 30_000,
  limitMs = RECORDING_LIMIT_MS,
} = {}) {
  if (typeof exec !== "function") throw new Error("macos capture requires exec");
  let worker = null, starting = null, stopRequested = false;
  let phase = "idle", startedAt = null, lastCapture = null, error = null;
  let pendingScreenshot = null, closed = false;
  const status = () => ({ available: true, phase, startedAt, elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0, lastCapture, error });

  async function target(kind, extension) {
    const dir = await folder(kind);
    await mkdir(dir, { recursive: true });
    const name = captureName(kind, undefined, undefined, extension);
    return { name, path: join(dir, name) };
  }

  async function saved(kind, file) {
    const info = await stat(file.path).catch(() => null);
    if (!info?.isFile() || info.size === 0) return null;
    return { kind, path: file.path, name: file.name, savedAt: Date.now() };
  }

  async function takeScreenshot() {
    const file = await target("screenshot").catch(() => null);
    if (file) {
      const [command, args] = screenshotArgv(file.path);
      const capture = await exec(command, args).then(() => saved("screenshot", file), () => null);
      if (capture) {
        lastCapture = capture;
        error = null;
        return status();
      }
      await unlink(file.path).catch(() => {}); // a refused capture may leave an empty PNG
    }
    error = CAPTURE_ERROR;
    throw failure(CAPTURE_ERROR);
  }

  /** Resolves to a running recorder, or null when screencapture exits at once. */
  function spawnRecorder(file) {
    return new Promise((resolve) => {
      const [command, args] = recorderArgv(file.path);
      let child;
      try {
        child = spawn(command, args, { shell: false, stdio: ["ignore", "ignore", "ignore"] });
      } catch {
        resolve(null);
        return;
      }
      const began = Date.now();
      let settled = false;
      const exited = new Promise((done) => {
        child.once("close", done);
        child.once("error", () => done(-1));
      });
      const timer = setTimeout(() => {
        settled = true;
        resolve({ child, exited, file, startedAt: began });
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
    current.child.kill("SIGINT"); // screencapture finalizes the movie on SIGINT
    current.force = setTimeout(() => current.child.kill("SIGKILL"), stopMs);
  }

  async function finish(current) {
    const code = await current.exited;
    clearTimeout(current.limit);
    clearTimeout(current.force);
    if (worker === current) worker = null;
    startedAt = null;
    let capture = code === 0 ? await saved("recording", current.file) : null;
    if (capture) {
      // The MP4 sits next to the movie with the same stamp; the movie goes once it exists.
      const output = { name: current.file.name.replace(/\.mov$/, ".mp4"), path: current.file.path.replace(/\.mov$/, ".mp4") };
      const converted = await convert(current.file.path, output.path).then(() => saved("recording", output), () => null);
      if (converted) {
        await unlink(current.file.path).catch(() => {});
        capture = converted;
      } else {
        await unlink(output.path).catch(() => {}); // a failed conversion may leave a partial MP4
      }
      lastCapture = capture;
      error = null;
      phase = "idle";
      return status();
    }
    await unlink(current.file.path).catch(() => {}); // a failed recording may leave an empty movie
    error = CAPTURE_ERROR;
    phase = "error";
    throw failure(CAPTURE_ERROR);
  }

  async function startRecording() {
    const file = await target("recording", "mov").catch(() => null);
    const current = file ? await spawnRecorder(file) : null;
    if (!current) {
      if (file) await unlink(file.path).catch(() => {});
      phase = "error";
      error = CAPTURE_ERROR;
      throw failure(CAPTURE_ERROR);
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
