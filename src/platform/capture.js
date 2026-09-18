import { spawn as spawnProcess } from "node:child_process";
import { createInterface } from "node:readline";

const failure = (message) => Object.assign(new Error(message), { status: 503 });
const CAPTURE_ERROR = "Screen capture failed. Check that your PC is unlocked and your Pictures and Videos folders are writable.";

/** One owned recording process per host. Only fixed actions reach the helper. */
export function createWindowsCapture({ helperPath, spawn = spawnProcess, startupMs = 20_000, stopMs = 30_000 } = {}) {
  let worker = null, phase = "idle", startedAt = null, lastCapture = null, error = null;
  let pendingScreenshot = null, closed = false;
  const status = () => ({ available: true, phase, startedAt, elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0, lastCapture, error });

  function run(action) {
    const child = spawn(helperPath, ["capture", action], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    let saved = null, readyDone = false, settleReady, rejectReady, settleDone, rejectDone;
    const ready = new Promise((resolve, reject) => { settleReady = resolve; rejectReady = reject; });
    const done = new Promise((resolve, reject) => { settleDone = resolve; rejectDone = reject; });
    // A process may exit before a caller awaits either promise.
    ready.catch(() => {}); done.catch(() => {});
    const timer = setTimeout(() => child.kill(), startupMs);
    let stopTimer;
    const handle = { ready, done, stop() {
      if (stopTimer) return;
      child.stdin.end("stop\n");
      stopTimer = setTimeout(() => child.kill(), stopMs);
    } };
    child.stdin.on("error", () => {});
    child.stderr.resume(); // Never return native paths/diagnostics as HTTP errors.
    lines.on("line", (line) => {
      if (line.length > 16_384) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type === "recording" && action === "record" && !readyDone) {
        clearTimeout(timer); readyDone = true;
        startedAt = Number.isFinite(message.startedAt) ? message.startedAt : Date.now();
        if (phase !== "stopping") phase = "recording";
        settleReady(status());
      } else if (message.type === "saved" && typeof message.path === "string" && typeof message.name === "string") {
        saved = { kind: action === "record" ? "recording" : "screenshot", path: message.path, name: message.name, savedAt: Date.now() };
      }
    });
    let finished = false;
    function finish(code) {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(stopTimer); lines.close();
      const succeeded = code === 0 && saved;
      if (action === "record" && worker === handle) { worker = null; phase = succeeded ? "idle" : "error"; startedAt = null; }
      if (succeeded) {
        lastCapture = saved; error = null;
        if (!readyDone) settleReady(status());
        settleDone(status());
      } else {
        error = CAPTURE_ERROR;
        if (!readyDone) rejectReady(failure(error));
        rejectDone(failure(error));
      }
    }
    child.once("error", () => finish(-1));
    child.once("close", finish);
    return handle;
  }
  return {
    status,
    async screenshot() {
      if (closed) throw failure("WinDock is shutting down.");
      if (!pendingScreenshot) {
        pendingScreenshot = run("screenshot").done.finally(() => { pendingScreenshot = null; });
      }
      return pendingScreenshot;
    },
    async start() {
      if (closed) throw failure("WinDock is shutting down.");
      if (worker) {
        if (phase === "stopping") throw Object.assign(new Error("The previous recording is still saving."), { status: 409 });
        return worker.ready;
      }
      phase = "starting"; error = null; startedAt = null;
      try { worker = run("record"); }
      catch { phase = "error"; error = CAPTURE_ERROR; throw failure(error); }
      return worker.ready;
    },
    async stop() {
      if (!worker) return status();
      phase = "stopping";
      const current = worker;
      current.stop();
      return current.done;
    },
    async dispose() { closed = true; await Promise.allSettled([this.stop(), pendingScreenshot]); },
  };
}
