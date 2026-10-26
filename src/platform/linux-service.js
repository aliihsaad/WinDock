/**
 * Entry point of the windock.service systemd user unit.
 *
 * Runs the ordinary host, then publishes its address and pairing PIN in the
 * user's private runtime directory, where the `windock` command shows them.
 * The PIN stays out of stdout, which systemd keeps in the journal.
 */

import { spawn } from "node:child_process";
import { start } from "../../server.js";
import { runtimePaths, sessionOf, writeStatus } from "./linux-cli.js";

/** A transient notification is shown, not kept in the notification history. */
function notifyReady({ endpoint, state }) {
  try {
    spawn("notify-send", [
      "--app-name=WinDock", "--icon=windock", "--hint=boolean:transient:true",
      "WinDock is running in the background",
      `PIN ${state.pin} · ${endpoint}\nOpen WinDock from your application menu to see it again or stop it.`,
    ], { stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // Notifications are optional; the windock command always shows the PIN.
  }
}

try {
  const file = process.env.WINDOCK_STATUS_FILE || runtimePaths(process.env)?.status;
  if (!file) throw new Error("XDG_RUNTIME_DIR is not set, so the PIN could not be published");
  const host = await start();
  await writeStatus(file, {
    pid: process.pid,
    endpoint: host.endpoint,
    pin: host.state.pin,
    session: sessionOf(process.env),
    startedAt: new Date().toISOString(),
  });
  process.stdout.write(`WinDock host ready in the background\n  provider: ${host.provider.displayName}\n  open:     ${host.endpoint}\n`);
  notifyReady(host);
} catch (error) {
  process.stderr.write(`WinDock failed to start: ${error.message}\n`);
  process.exit(1);
}
