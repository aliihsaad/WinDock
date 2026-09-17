/** G10: WebSocket clients receive dock state and live updates after pairing. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createChecker } from "./lib/assert.mjs";
import { createApp } from "../server.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createConfigStore } from "../src/config.js";
import { originAllowed, snapshotMessage } from "../src/sync.js";

const t = createChecker("sync");
const PIN = "8888";

// ---- pure origin guard ----
t.ok(originAllowed({ headers: {}, socket: {} }), "a native client with no Origin is allowed");
t.ok(
  originAllowed({ headers: { origin: "http://box:8620", host: "box:8620" }, socket: {} }),
  "a same-origin browser is allowed",
);
t.ok(
  !originAllowed({ headers: { origin: "http://evil.test", host: "box:8620" }, socket: {} }),
  "a cross-origin browser is refused",
);
t.ok(!originAllowed({ headers: { origin: "http://box:8620" }, socket: {} }), "a missing Host is refused");
t.ok(!originAllowed({ headers: { origin: "::::" }, socket: {} }), "a malformed Origin is refused");

const snap = JSON.parse(snapshotMessage({ tiles: [], running: [] }));
t.equal(snap.type, "snapshot", "a snapshot message is typed");
t.ok(Array.isArray(snap.tiles), "a snapshot carries tiles");

// ---- live socket ----
const RUNNING = JSON.stringify([
  { Id: 4812, ProcessName: "firefox", MainWindowTitle: "FF", Handle: 12, Path: "C:\\Apps\\firefox.exe" },
]);
const provider = createWindowsProvider({
  helperPath: "H.exe",
  exec: async (file, args) => {
    if (file === "H.exe") return { stdout: "" };
    const script = args[args.length - 1];
    if (script.includes("MainWindowHandle")) return { stdout: RUNNING };
    if (script.includes("WScript.Shell")) return { stdout: "[]" };
    return { stdout: "{}" };
  },
});

const dir = await mkdtemp(join(tmpdir(), "windock-sync-"));
const configStore = createConfigStore({ path: join(dir, "config.json") });
const app = await createApp({ provider, configStore, pin: PIN, trustLoopback: false });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const port = app.server.address().port;
const base = `http://127.0.0.1:${port}`;

/** Open a socket and resolve with its first message, or null on failure. */
function firstMessage(headers, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ws.on("message", (data) => finish(String(data)));
    ws.on("error", () => finish(null));
    ws.on("unexpected-response", () => finish(null));
  });
}

// An unpaired socket must be refused.
t.equal(await firstMessage({}), null, "an unpaired client receives no snapshot");
t.equal(await firstMessage({ cookie: "windock_session=bogus" }), null, "an invalid session is refused");

// Pair, then connect for real.
const auth = await fetch(`${base}/api/auth`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ pin: PIN }),
});
t.equal(auth.status, 200, "pairing succeeds");
const cookie = auth.headers.get("set-cookie").split(";")[0];

const raw = await firstMessage({ cookie, origin: base });
t.ok(raw !== null, "a paired client receives a snapshot on connect");
const message = JSON.parse(raw);
t.equal(message.type, "snapshot", "the first frame is a snapshot");
t.equal(message.platform, "windows", "the snapshot names the provider");
t.equal(message.running.length, 1, "the snapshot carries the running app");

// A cross-origin upgrade with a valid cookie must still be refused.
t.equal(
  await firstMessage({ cookie, origin: "http://evil.test" }),
  null,
  "a cross-origin upgrade is refused even with a valid session",
);

// ---- broadcast on change ----
const live = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie, origin: base } });
const frames = [];
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("socket did not open")), 3000);
  live.on("message", (d) => frames.push(JSON.parse(String(d))));
  live.on("open", () => {
    clearTimeout(timer);
    resolve();
  });
  live.on("error", (e) => {
    clearTimeout(timer);
    reject(e);
  });
});
await new Promise((r) => setTimeout(r, 120));
t.equal(frames.length, 1, "the client got exactly one snapshot on connect");
t.equal(app.hub.clientCount, 1, "the hub counts the connected client");

const put = await fetch(`${base}/api/tiles`, {
  method: "PUT",
  headers: { "content-type": "application/json", cookie, origin: base },
  body: JSON.stringify({ tiles: [{ kind: "control", verb: "mute-toggle", label: "Mute" }] }),
});
t.equal(put.status, 200, "a tile change is accepted");
await new Promise((r) => setTimeout(r, 250));

t.ok(frames.length >= 2, `a change broadcasts a new snapshot (frames: ${frames.length})`);
const latest = frames.at(-1);
t.equal(latest.tiles.length, 1, "the broadcast snapshot carries the new tile");
t.equal(latest.tiles[0].verb, "mute-toggle", "the broadcast snapshot carries the correct tile");

live.close();
await new Promise((r) => setTimeout(r, 100));

await app.hub.close();
app.server.closeAllConnections?.();
await new Promise((r) => app.server.close(r));
await rm(dir, { recursive: true, force: true });

t.done("sync verification passed");
