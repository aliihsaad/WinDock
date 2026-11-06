/** Same UI and wire protocols; native Android handles per-computer TLS and session storage. */
const bridge = window.WinDockSecure;
export const nativeTransport = Boolean(bridge);
let nextId = 1;
const pending = new Map(), sockets = new Map();
if (bridge) window.addEventListener("windock-transport", ({ detail: event }) => {
  if (event.kind === "response") {
    const waiting = pending.get(event.id); if (!waiting) return;
    pending.delete(event.id); clearTimeout(waiting.timer);
    if (event.error) waiting.reject(new TypeError(event.error));
    else waiting.resolve(new Response(event.body, { status: event.status, headers: { "content-type": "application/json" } }));
    return;
  }
  const socket = sockets.get(event.id); if (!socket) return;
  if (event.kind === "open") { socket.readyState = 1; socket.onopen?.({ target: socket }); }
  else if (event.kind === "message") socket.onmessage?.({ data: event.body, target: socket });
  else if (event.kind === "close") { sockets.delete(event.id); socket.readyState = 3; socket.onclose?.({ code: 1006, target: socket }); }
});
export function dockFetch(path, options = {}) {
  if (!bridge) return fetch(path, options);
  return new Promise((resolve, reject) => {
    if (pending.size >= 8) { reject(new TypeError("Connection busy. Retry shortly.")); return; }
    const id = nextId++;
    // Leave room for the PC's bounded 20s media query and Android's 25s deadline.
    const timeout = path === "/api/nowplaying" && (!options.method || options.method === "GET") ? 30000 : 15000;
    const timer = setTimeout(() => { pending.delete(id); reject(new TypeError("Connection interrupted")); }, timeout);
    pending.set(id, { resolve, reject, timer });
    bridge.request(id, path, options.method || "GET", options.body || "");
  });
}
class NativeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0; onopen = null; onmessage = null; onclose = null; onerror = null;
  get bufferedAmount() { return bridge.queuedBytes(this.id); }
  constructor(url) {
    const target = new URL(url);
    if (target.host !== location.host || !["/", "/input"].includes(target.pathname)) throw new Error("Invalid socket origin");
    this.id = nextId++; sockets.set(this.id, this); bridge.openSocket(this.id, target.pathname);
  }
  send(text) { if (this.readyState !== 1 || !bridge.send(this.id, String(text))) throw new Error("Connection interrupted or too slow"); }
  close() { if (this.readyState >= 2) return; this.readyState = 3; bridge.closeSocket(this.id); sockets.delete(this.id); }
}
export const DockWebSocket = bridge ? NativeSocket : WebSocket;
