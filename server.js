/**
 * WinDock host.
 *
 * Serves the PWA, exposes the authenticated API, answers LAN discovery, and
 * broadcasts dock state over WebSocket. Platform work is delegated entirely to
 * the provider, so this file contains no OS-specific code.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createProvider } from "./src/platform/index.js";
import { validateControl, isDestructiveVerb, CONTROL_VERBS } from "./src/platform/contract.js";
import { createConfigStore } from "./src/config.js";
import { createSyncHub } from "./src/sync.js";
import { startDiscovery, primaryAddress, DISCOVERY_PORT } from "./src/discovery.js";
import {
  newPin,
  isValidPinShape,
  safeEqual,
  createLockout,
  createSessionStore,
  sessionCookie,
  authorize,
} from "./src/auth.js";

export const DEFAULT_PORT = 8620;
export const BODY_MAX_BYTES = 64 * 1024;
const PUBLIC_DIR = resolve(import.meta.dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

/** Read a bounded JSON body. Oversized or malformed input is rejected. */
async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX_BYTES) {
      const err = new Error("body too large");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    const err = new Error("invalid JSON body");
    err.status = 400;
    throw err;
  }
}

/** Same-origin guard for state-changing requests (CSRF defence). */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // native client
  const host = req.headers.host;
  if (!host) return false;
  try {
    const scheme = req.socket.encrypted ? "https:" : "http:";
    return new URL(origin).origin === new URL(`${scheme}//${host}`).origin;
  } catch {
    return false;
  }
}

/** Resolve a static path, refusing anything that escapes the public dir. */
export function resolveStatic(urlPath, root = PUBLIC_DIR) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, "");
  if (rel.split(/[/\\]/).includes("..")) return null;
  const full = resolve(root, rel === "" ? "index.html" : rel);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export async function createApp({
  provider = createProvider(),
  configStore = createConfigStore(),
  pin = newPin(),
  sessions = createSessionStore(),
  lockout = createLockout(),
  allowDestructive = true,
  trustLoopback = true,
} = {}) {
  const state = { pin };

  async function dockState() {
    const [config, running] = await Promise.all([
      configStore.load(),
      provider.listRunningApps().catch(() => []),
    ]);
    const runningIds = new Set(running.map((r) => r.id));
    return {
      platform: provider.id,
      platformName: provider.displayName,
      tiles: config.tiles.map((tile) =>
        tile.kind === "app" ? { ...tile, running: runningIds.has(tile.id) } : tile,
      ),
      running,
      verbs: CONTROL_VERBS,
      allowDestructive,
    };
  }

  const server = createServer(async (req, res) => {
    const remote = req.socket.remoteAddress || "";
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    try {
      if (path === "/health") {
        sendJson(res, 200, { ok: true, app: "windock", platform: provider.id });
        return;
      }

      if (path === "/api/auth" && req.method === "POST") {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "bad origin" });
        const status = lockout.status(remote);
        if (status.locked) {
          return sendJson(res, 429, { error: "locked", retryInMs: status.retryInMs });
        }
        const body = await readJsonBody(req);
        if (!isValidPinShape(body.pin)) {
          lockout.recordFailure(remote);
          return sendJson(res, 400, { error: "invalid pin" });
        }
        if (!safeEqual(body.pin, state.pin)) {
          const fail = lockout.recordFailure(remote);
          return sendJson(res, 401, { error: "wrong pin", locked: fail.locked });
        }
        lockout.recordSuccess(remote);
        const token = sessions.issue();
        return sendJson(res, 200, { ok: true }, {
          "set-cookie": sessionCookie(token, { secure: Boolean(req.socket.encrypted) }),
        });
      }

      if (!path.startsWith("/api/")) {
        const file = resolveStatic(path);
        if (!file) return sendJson(res, 403, { error: "forbidden" });
        try {
          const body = await readFile(file);
          res.writeHead(200, {
            "content-type": MIME[extname(file)] || "application/octet-stream",
            "content-length": body.length,
            "x-content-type-options": "nosniff",
          });
          return res.end(body);
        } catch {
          return sendJson(res, 404, { error: "not found" });
        }
      }

      const auth = authorize({ req, sessions, lockout, remote, trustLoopback });
      if (!auth.ok) {
        return sendJson(res, auth.code, { error: auth.via, retryInMs: auth.retryInMs });
      }

      const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
      if (mutating && !sameOrigin(req)) return sendJson(res, 403, { error: "bad origin" });

      if (path === "/api/state" && req.method === "GET") {
        return sendJson(res, 200, await dockState());
      }

      if (path === "/api/apps/installed" && req.method === "GET") {
        return sendJson(res, 200, { apps: await provider.listInstalledApps() });
      }

      if (path === "/api/tiles" && req.method === "GET") {
        return sendJson(res, 200, await configStore.load());
      }

      if (path === "/api/tiles" && req.method === "PUT") {
        const body = await readJsonBody(req);
        const saved = await configStore.save({ tiles: body.tiles });
        await hub.broadcast();
        return sendJson(res, 200, saved);
      }

      if (path === "/api/apps/launch" && req.method === "POST") {
        const body = await readJsonBody(req);
        const apps = await provider.listInstalledApps();
        const app = apps.find((a) => a.id === body.id);
        if (!app) return sendJson(res, 404, { error: "unknown app" });
        await provider.launchApp(app);
        await hub.broadcast();
        return sendJson(res, 200, { ok: true, id: app.id });
      }

      if ((path === "/api/apps/focus" || path === "/api/apps/close") && req.method === "POST") {
        const body = await readJsonBody(req);
        const pid = Number(body.pid);
        if (!Number.isInteger(pid) || pid <= 0) {
          return sendJson(res, 400, { error: "pid must be a positive integer" });
        }
        const running = await provider.listRunningApps();
        const match = running.find((r) => r.pid === pid);
        if (!match) return sendJson(res, 404, { error: "process not running" });
        if (path.endsWith("focus")) await provider.focusApp(match);
        else await provider.closeApp(match);
        await hub.broadcast();
        return sendJson(res, 200, { ok: true, pid });
      }

      if (path === "/api/control" && req.method === "POST") {
        const body = await readJsonBody(req);
        const checked = validateControl(body.verb, body.value ?? null);
        if (!checked.ok) return sendJson(res, 400, { error: checked.error });
        if (isDestructiveVerb(checked.verb) && !allowDestructive) {
          return sendJson(res, 403, { error: "power actions disabled" });
        }
        await provider.control(checked.verb, checked.value);
        return sendJson(res, 200, { ok: true, verb: checked.verb });
      }

      if (path === "/api/nowplaying" && req.method === "GET") {
        return sendJson(res, 200, { nowPlaying: await provider.nowPlaying().catch(() => null) });
      }

      if (path === "/api/stats" && req.method === "GET") {
        return sendJson(res, 200, await provider.systemStats().catch(() => ({})));
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const status = err?.status || 500;
      sendJson(res, status, { error: status === 500 ? "internal error" : err.message });
    }
  });

  const hub = createSyncHub({
    server,
    isAuthorized: (req) =>
      authorize({
        req,
        sessions,
        lockout,
        remote: req.socket.remoteAddress || "",
        trustLoopback,
      }).ok,
    getState: dockState,
  });

  return { server, hub, provider, configStore, dockState, state, sessions, lockout };
}

export async function start({ port = Number(process.env.PORT) || DEFAULT_PORT } = {}) {
  const app = await createApp();
  await new Promise((r) => app.server.listen(port, r));
  const address = primaryAddress();
  const endpoint = address ? `http://${address}:${port}` : `http://localhost:${port}`;
  const discovery = startDiscovery({ endpoint, port: DISCOVERY_PORT });
  return { ...app, endpoint, discovery, port };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  start()
    .then(({ endpoint, state, provider }) => {
      process.stdout.write(
        `WinDock host ready\n  provider: ${provider.displayName}\n  open:     ${endpoint}\n  PIN:      ${state.pin}\n`,
      );
    })
    .catch((err) => {
      process.stderr.write(`WinDock failed to start: ${err.message}\n`);
      process.exit(1);
    });
}
