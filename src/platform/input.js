import { spawn as spawnProcess } from "node:child_process";
import { validateInput, validateSignature } from "../input.js";

/**
 * Bridge to a native input helper speaking the newline-delimited JSON touchpad
 * protocol: `touchpad` streams validated input and reports focus metadata, and
 * the signature verbs rasterize validated strokes. Windows and Linux helpers
 * implement the same protocol, so only the argv and messages differ.
 */
export function createHelperInput({
  helperPath,
  spawn = spawnProcess,
  startupMs = 5000,
  stopMs = 1800,
  signatureArgs = (insert) => [insert ? "signature-insert" : "signature"],
  unavailableMessage,
  diagnostic = null,
  missingHint = "",
  startupError = "Your PC could not start the touchpad. Update WinDock there and try again.",
}) {
  const unavailable = () => Object.assign(new Error(unavailableMessage), { status: 503 });
  const workers = new Set();
  let disposed = false, saving = false;
  function start(args) {
    if (disposed) throw new Error("Input service closed");
    const child = spawn(helperPath, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    workers.add(child);
    if (diagnostic) {
      // Helpers never print typed text or signature strokes, only startup and device errors.
      let report = "";
      child.stderr.on("data", (data) => { if (report.length < 1024) report += data.toString(); });
      child.once("close", () => { const text = report.trim().slice(0, 1024); if (text) diagnostic(text); });
      child.once("error", (error) => diagnostic(error?.code === "ENOENT" ? `helper not found at ${helperPath}. ${missingHint}`.trim() : String(error?.message || error)));
    } else child.stderr.resume(); // Native diagnostics never contain signature strokes in responses.
    child.stdin.on("error", () => {});
    child.once("close", () => workers.delete(child));
    return child;
  }
  return {
    /** What the phone shows when the helper exits before `ready`; the cause differs per platform. */
    startupError,
    open(onFailure = () => {}, onEvent = () => {}) {
      const child = start(["touchpad"]);
      let closed = false, ended = false, buffer = "", closing;
      let resolveReady, rejectReady, resolveExit;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const exited = new Promise((resolve) => { resolveExit = resolve; });
      const startup = setTimeout(() => { rejectReady(new Error("Input startup timeout")); close(); }, startupMs);
      function close() {
        if (closing) return closing;
        closed = true; clearTimeout(startup);
        rejectReady(new Error("Input closed"));
        if (!ended) child.stdin.end('{"type":"release"}\n');
        const kill = setTimeout(() => { if (!ended) child.kill(); }, stopMs);
        closing = exited.finally(() => clearTimeout(kill));
        return closing;
      }
      child.on("error", () => { rejectReady(new Error("Input worker unavailable")); if (!closed) onFailure(); close(); });
      child.on("close", () => {
        ended = true; clearTimeout(startup); resolveExit(); rejectReady(new Error("Input worker exited"));
        if (!closed) onFailure(); closed = true;
      });
      child.stdout.on("data", (data) => {
        buffer += data.toString();
        if (buffer.length > 4096) { onFailure(); close(); return; }
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === "ready") { clearTimeout(startup); resolveReady(); }
            else if (event.type === "focus" && /^[1-9][0-9]{0,15}$/.test(event.target) && typeof event.editable === "boolean" && typeof event.password === "boolean") onEvent({ type: "focus", target: event.target, editable: event.editable, password: event.password });
            else if (event.type === "input-error") onEvent({ type: "input-error", error: "PC focus changed or input was blocked. Select the PC field and reopen the keyboard." });
          }
          catch { onFailure(); close(); }
        }
      });
      return { ready, close, send(message) {
        const checked = validateInput(message);
        if (!checked || closed || child.stdin.writableLength > 8192) throw new Error("Input unavailable");
        if (!child.stdin.write(JSON.stringify(checked) + "\n")) throw new Error("Input is falling behind");
      } };
    },
    async saveSignature(body, insert = false) {
      const checked = validateSignature(body);
      if (saving) throw Object.assign(new Error("A signature is already being saved."), { status: 409 });
      saving = true;
      try {
        // Fixed argv spawns synchronously; a folder lookup is awaited first.
        let args = signatureArgs(insert);
        if (args instanceof Promise) args = await args;
        return await new Promise((resolve, reject) => {
          const child = start(args);
          let output = "", failed = false;
          const timer = setTimeout(() => { failed = true; child.kill(); reject(unavailable()); }, 10000);
          child.on("error", () => { clearTimeout(timer); failed = true; reject(unavailable()); });
          child.stdout.on("data", (data) => { output += data.toString(); if (output.length > 8192) { failed = true; child.kill(); reject(unavailable()); } });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (failed) return;
            try {
              const result = JSON.parse(output);
              if (code !== 0 || result.type !== "saved" || typeof result.path !== "string") throw unavailable();
              resolve(result);
            } catch { reject(unavailable()); }
          });
          child.stdin.end(JSON.stringify(checked));
        });
      } finally { saving = false; }
    },
    dispose() { disposed = true; for (const worker of workers) worker.stdin.end(); },
  };
}

export function createWindowsInput({ helperPath, spawn = spawnProcess, startupMs = 5000, stopMs = 1800 } = {}) {
  return createHelperInput({
    helperPath, spawn, startupMs, stopMs,
    unavailableMessage: "Windows could not save the signature. Check the Pictures folder and try again.",
  });
}
