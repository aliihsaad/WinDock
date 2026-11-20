import { execFile as runFile } from "node:child_process";

export const MAX_SHARE_TEXT = 32768;
export const validShareText = (text) => typeof text === "string" && text.length > 0 && text.length <= MAX_SHARE_TEXT && text.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);

/** Read or replace the PC's current clipboard text, on request only. Nothing is stored. */
export function createClipboardText({ platform = process.platform, execFile = runFile, timeout = 4000 } = {}) {
  const run = (file, args, input) => new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true, shell: false, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(Object.assign(new Error("The PC clipboard could not be reached."), { status: 503 })); else resolve(stdout);
    });
    if (input !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(input); }
  });
  const windows = platform === "win32" || platform === "windows";
  const read = windows
    ? () => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"])
    : () => run("sh", ["-c", "wl-paste -n 2>/dev/null || xclip -selection clipboard -o"]);
  const write = windows
    ? (text) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"], text)
    : (text) => run("sh", ["-c", "wl-copy 2>/dev/null || xclip -selection clipboard"], text);
  return {
    async get() { const text = String(await read()).replace(/\r\n$/, "").slice(0, MAX_SHARE_TEXT); return { text: validShareText(text) ? text : "" }; },
    async set(text) { if (!validShareText(text)) throw Object.assign(new Error("That text can't be shared."), { status: 400 }); await write(text); return { ok: true }; },
  };
}
