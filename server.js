/**
 * WinDock host.
 *
 * Serves the PWA, exposes the authenticated API, answers LAN discovery, and
 * broadcasts dock state over WebSocket. Platform work is delegated entirely to
 * the provider, so this file contains no OS-specific code.
 */

import { createServer } from "node:http";
import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createProvider } from "./src/platform/index.js";
import { validateControl, isDestructiveVerb, CONTROL_VERBS } from "./src/platform/contract.js";
import { createConfigStore } from "./src/config.js";
import { createUpdateService } from "./src/updates.js";
import { createSyncHub } from "./src/sync.js";
import { createInputHub } from "./src/input-hub.js";
import { validateSignature } from "./src/input.js";
import { createIconCache, iconType, FALLBACK_ICON } from "./src/icons.js";
import { startDiscovery, primaryAddress, DISCOVERY_PORT } from "./src/discovery.js";
import {
  newPin,
  isValidPinShape,
  safeEqual,
  createLockout,
  createSessionStore,
  sessionCookie,
  authorize,
  createHostCheck,
  isLocalPairingRecovery,
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
  // Reject immediately at the cap, but keep draining without retaining bytes.
  // Throwing inside an async iterator destroys/pauses the request socket and
  // can reset the response or the next request on a keep-alive connection.
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      if (size > BODY_MAX_BYTES) return;
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        chunks.length = 0;
        const err = new Error("body too large");
        err.status = 413;
        reject(err);
      } else {
        chunks.push(chunk);
      }
    });
    req.once("end", resolve);
    req.once("error", reject);
  });
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
  hostAllowed = createHostCheck(),
  updates = createUpdateService({ platform: provider.id }),
} = {}) {
  if (!isValidPinShape(pin)) throw new Error("Pairing PIN must contain exactly six ASCII digits.");
  const state = { pin };
  const appIcon = createIconCache(provider);
  let inventoryPromise;
  let inventoryTime = 0;
  function installedApps() {
    if (!inventoryPromise || Date.now() - inventoryTime > 60_000) {
      inventoryTime = Date.now();
      inventoryPromise = provider.listInstalledApps().catch((error) => {
        inventoryPromise = null;
        throw error;
      });
    }
    return inventoryPromise;
  }

  async function dockState() {
    const [config, running] = await Promise.all([
      configStore.load(),
      provider.listRunningApps().catch(() => []),
    ]);
    const runningIds = new Set(running.map((r) => r.id));
    return {
      platform: provider.id,
      platformName: provider.displayName,
      hostName: hostname(),
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
    // Refuse unknown Host names before anything else. This is what blocks DNS
    // rebinding, where a page on some other domain points it at this machine.
    if (!hostAllowed(req.headers.host)) {
      return sendJson(res, 421, { error: "unknown host; add your custom DNS name to WINDOCK_ALLOWED_HOSTS on the PC" });
    }
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); }
    catch { return sendJson(res, 400, { error: "invalid request target" }); }
    const path = url.pathname;

    try {
      if (path === "/health") {
        sendJson(res, 200, { ok: true, app: "windock", platform: provider.id });
        return;
      }

      if (path === "/api/pairing/reset" && req.method === "POST") {
        // Native PC-only action: browsers cannot supply this custom header cross-origin.
        // Reject even same-origin browser requests; this must not be exposed to phones.
        if (!isLocalPairingRecovery(req, remote)) {
          return sendJson(res, 403, { error: "pairing recovery is available only on the PC" });
        }
        const body = await readJsonBody(req);
        if (Object.keys(body).length) return sendJson(res, 400, { error: "pairing recovery takes no options" });
        lockout.resetGlobal();
        return sendJson(res, 200, { ok: true });
      }

      if (path === "/api/auth" && req.method === "POST") {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "bad origin" });
        const status = lockout.status(remote);
        if (status.locked) {
          return sendJson(res, 429, { error: "locked", ...status });
        }
        const body = await readJsonBody(req);
        // Check again now that the body is in. Requests that were already
        // uploading when the pause started must not get to try their PIN.
        const after = lockout.status(remote);
        if (after.locked) {
          return sendJson(res, 429, { error: "locked", ...after });
        }
        if (!isValidPinShape(body.pin)) {
          const legacy = typeof body.pin === "string" && /^\d{4}$/.test(body.pin);
          return sendJson(res, 400, { error: legacy
            ? "WinDock on your PC was updated. Close and reopen this app, then enter the new 6-digit PIN."
            : "invalid pin" });
        }
        if (!safeEqual(body.pin, state.pin)) {
          lockout.recordFailure(remote);
          return sendJson(res, 401, { error: "wrong pin", ...lockout.status(remote) });
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

      if (path === "/api/updates" && req.method === "GET") return sendJson(res, 200, updates.state());
      if (path === "/api/updates/check" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (Object.keys(body).length) return sendJson(res, 400, { error: "update check takes no options" });
        return sendJson(res, 200, await updates.check());
      }

      if (path === "/api/state" && req.method === "GET") {
        return sendJson(res, 200, await dockState());
      }

      if (path === "/api/apps/installed" && req.method === "GET") {
        return sendJson(res, 200, { apps: await installedApps() });
      }

      if (path === "/api/apps/icon" && req.method === "GET") {
        const app = (await installedApps()).find((item) => item.id === url.searchParams.get("id"));
        if (!app) return sendJson(res, 404, { error: "unknown app" });
        const icon = await appIcon(app);
        const type = iconType(icon);
        const body = type ? icon : FALLBACK_ICON;
        res.writeHead(200, {
          "content-type": type || "image/svg+xml",
          "content-length": body.length,
          "cache-control": type ? "private, max-age=3600" : "private, no-store",
          "x-content-type-options": "nosniff",
          // Theme SVGs are third-party files; opened directly they must not run script.
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        });
        return res.end(body);
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
        const apps = await installedApps();
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
        // Browser web apps share the browser's pid, so the app id picks the window.
        const id = typeof body.id === "string" ? body.id : null;
        const match = running.find((r) => r.pid === pid && (id === null || r.id === id));
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

      if (path === "/api/capture" && req.method === "GET") {
        return sendJson(res, 200, provider.capture?.status() || { available: false, phase: "idle" });
      }
      const captureActions = { "/api/capture/screenshot": "screenshot", "/api/capture/start": "start", "/api/capture/stop": "stop" };
      if (Object.hasOwn(captureActions, path) && req.method === "POST") {
        const body = await readJsonBody(req);
        if (Object.keys(body).length) return sendJson(res, 400, { error: "capture actions take no options" });
        if (!provider.capture) return sendJson(res, 501, { error: "Screen capture needs an updated WinDock on your PC." });
        return sendJson(res, 200, await provider.capture[captureActions[path]]());
      }

      if (path === "/api/stats" && req.method === "GET") {
        return sendJson(res, 200, await provider.systemStats().catch(() => ({})));
      }

      if (path === "/api/input" && req.method === "GET") {
        return sendJson(res, 200, { available: Boolean(provider.input), keyboard: Boolean(provider.input), signatureInsert: Boolean(provider.input) });
      }
      if (["/api/signature", "/api/signature/insert"].includes(path) && req.method === "POST") {
        const signature = validateSignature(await readJsonBody(req));
        if (!provider.input) return sendJson(res, 501, { error: "Saving signatures needs an updated WinDock on your PC." });
        return sendJson(res, 200, await provider.input.saveSignature(signature, path.endsWith("/insert")));
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
      hostAllowed(req.headers.host) &&
      authorize({
        req,
        sessions,
        lockout,
        remote: req.socket.remoteAddress || "",
        trustLoopback,
      }).ok,
    getState: dockState,
  });

  const inputHub = createInputHub({ server, input: provider.input, isAuthorized: (req) =>
    hostAllowed(req.headers.host) &&
    authorize({ req, sessions, lockout, remote: req.socket.remoteAddress || "", trustLoopback }).ok,
  });
  server.on("close", () => { provider.capture?.dispose().catch(() => {}); provider.input?.dispose(); });
  return { server, hub, inputHub, provider, configStore, dockState, state, sessions, lockout };
}

export async function start({ port = Number(process.env.PORT) || DEFAULT_PORT, host = process.env.WINDOCK_HOST || "" } = {}) {
  const address = primaryAddress(undefined, host);
  const app = await createApp();
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, () => { app.server.off("error", reject); resolve(); });
  });

  port = app.server.address().port;
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
