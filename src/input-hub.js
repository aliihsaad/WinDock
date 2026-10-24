import { WebSocketServer } from "ws";
import { originAllowed } from "./sync.js";
import { validateInput } from "./input.js";

/** Only one paired phone can own mouse buttons. Dock sync remains read-only. */
export function createInputHub({ server, isAuthorized, input, leaseMs = 2000 }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  let owner = null;
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== "/input") return;
    if (!originAllowed(req) || !isAuthorized(req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws, req) => {
    ws.on("error", () => {});
    const reply = (value) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value)); };
    if (!input || owner) {
      reply({ type: "error", error: owner ? "Another device is using the touchpad." : "Touchpad needs an updated WinDock on your PC." });
      ws.close(1008); return;
    }
    owner = ws;
    let worker = null, closed = false, started = false, pendingFocus = null, lastSeen = Date.now(), count = 0, windowStart = lastSeen;
    const cleanup = () => {
      if (closed) return;
      closed = true; clearInterval(timer);
      // Keep the lease until the helper has released its buttons and exited.
      Promise.resolve(worker?.close()).catch(() => {}).finally(() => { if (owner === ws) owner = null; });
    };
    const fail = (error) => { reply({ type: "error", error }); cleanup(); ws.close(1008); };
    const timer = setInterval(() => {
      if (Date.now() - lastSeen > (started ? leaseMs : 8000) || !isAuthorized(req)) { cleanup(); ws.terminate(); }
    }, Math.min(500, leaseMs));
    timer.unref?.();
    ws.on("close", cleanup);
    ws.on("error", cleanup);
    ws.on("message", (data, binary) => {
      if (closed) return;
      if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
      if (++count > 240 || binary || !isAuthorized(req)) return fail("Touchpad session ended. Open it again to reconnect.");
      let message;
      try { message = validateInput(JSON.parse(data.toString())); } catch { /* rejected below */ }
      if (!message) return fail("Invalid touchpad input.");
      lastSeen = Date.now();
      if (!worker) return fail("Touchpad is still connecting.");
      try { worker.send(message); } catch { fail("Touchpad connection lost. Open it again to reconnect."); }
    });
    // open() returns the owned worker immediately; ready resolves after native startup.
    try {
      worker = input.open(() => fail("Your PC could not continue the touchpad session."), (event) => {
        if (closed) return;
        if (started) reply(event);
        else if (event.type === "focus") pendingFocus = event;
      });
      worker.ready.then(() => { if (!closed) { started = true; lastSeen = Date.now(); reply({ type: "ready" }); if (pendingFocus) reply(pendingFocus); } }).catch(() => fail(input.startupError || "Your PC could not start the touchpad. Update WinDock there and try again."));
    } catch { fail("Your PC could not start the touchpad."); }
  });
  return { wss, async close() { for (const ws of wss.clients) ws.terminate(); await new Promise((resolve) => wss.close(resolve)); } };
}
