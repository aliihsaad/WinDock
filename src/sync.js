/**
 * WebSocket state sync.
 *
 * The host owns dock state; every paired client receives a full snapshot on
 * connect and a broadcast on each change. Clients never mutate state over the
 * socket — mutations go through the authenticated HTTP API, and the resulting
 * broadcast is what updates every device. That keeps one authorization path
 * instead of two.
 */

import { WebSocketServer } from "ws";

export const HEARTBEAT_MS = 30_000;

export function snapshotMessage(state) {
  return JSON.stringify({ type: "snapshot", ...state });
}

/**
 * Only same-origin browsers, or native clients that send no Origin at all.
 * A browser on a hostile page always sends Origin, so this blocks cross-site
 * WebSocket hijacking of a paired session cookie.
 */
export function originAllowed(req) {
  const origin = req?.headers?.origin;
  if (!origin) return true;
  const host = req?.headers?.host;
  if (!host) return false;
  try {
    const scheme = req.socket?.encrypted ? "https:" : "http:";
    return new URL(origin).origin === new URL(`${scheme}//${host}`).origin;
  } catch {
    return false;
  }
}

/**
 * Attach a sync hub to an HTTP server.
 * @param {object} opts
 * @param {import('node:http').Server} opts.server
 * @param {(req:import('node:http').IncomingMessage)=>boolean} opts.isAuthorized
 * @param {()=>Promise<object>} opts.getState
 */
export function createSyncHub({ server, isAuthorized, getState, heartbeatMs = HEARTBEAT_MS }) {
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakMap();

  server.on("upgrade", (req, socket, head) => {
    if (!originAllowed(req) || !isAuthorized(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", async (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("error", () => {});
    try {
      ws.send(snapshotMessage(await getState()));
    } catch {
      /* a client that vanished mid-handshake needs no snapshot */
    }
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, heartbeatMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    wss,
    get clientCount() {
      return wss.clients.size;
    },
    async broadcast() {
      if (wss.clients.size === 0) return 0;
      const payload = snapshotMessage(await getState());
      let sent = 0;
      for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue;
        try {
          ws.send(payload);
          sent += 1;
        } catch {
          /* drop; heartbeat will reap it */
        }
      }
      return sent;
    },
    close() {
      clearInterval(timer);
      return new Promise((resolve) => wss.close(resolve));
    },
  };
}
