import { spawn } from "node:child_process";

/** Arguments, never a shell command; the path comes only from local receive settings. */
export function openReceiveDirectory(path, platform = process.platform, launch = spawn) {
  return new Promise((resolve, reject) => {
    const failed = () => reject(Object.assign(new Error("Could not open the receive folder. Check that a file manager is available on the computer."), { status: 503 }));
    try {
      // This is the user's explicit request for a window, not a background helper.
      const child = launch(platform === "win32" ? "explorer.exe" : "xdg-open", [path], { windowsHide: false, stdio: "ignore", shell: false });
      child.once("error", failed);
      child.once("spawn", () => { child.unref(); resolve(); });
    } catch { failed(); }
  });
}
export function notifyTransfer(event) {
  if (process.platform !== "linux" || !["incoming","completed","failed"].includes(event.phase)) return;
  const label = { incoming: "Receiving files", completed: "Files received", failed: "Transfer interrupted" }[event.phase];
  const child = spawn("notify-send", ["--app-name=WinDock", "--expire-time=6000", label, `${event.count} selected file(s). Open WinDock Files & Media to view progress or open the folder.`], { stdio:"ignore", shell:false });
  child.on("error",()=>{}); child.unref();
}
