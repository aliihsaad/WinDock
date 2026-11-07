/**
 * WinDock host.
 *
 * Serves the PWA, exposes the authenticated API, answers LAN discovery, and
 * broadcasts dock state over WebSocket. Platform work is delegated entirely to
 * the provider, so this file contains no OS-specific code.
 */

import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createProvider } from "./src/platform/index.js";
import { validateControl, isDestructiveVerb, CONTROL_VERBS } from "./src/platform/contract.js";
import { createConfigStore } from "./src/config.js";
import { folderApp, folderFromTile, FOLDER_ICON } from "./src/folders.js";
import { linkApp, linkFromTile, LINK_ICON } from "./src/links.js";
import { hostIdentity } from "./src/host-identity.js";
import { managedTls, tlsName } from "./src/managed-tls.js";
import { secureSessionStore } from "./src/secure-sessions.js";
import { pairingInvites } from "./src/pairing-invites.js";
import { networkSetup } from "./src/network-setup.js";
import { createUpdateService } from "./src/updates.js";
import { createSyncHub } from "./src/sync.js";
import { createInputHub } from "./src/input-hub.js";
import { createTransfers, transferError } from "./src/transfers.js";
import { openReceiveDirectory, notifyTransfer } from "./src/transfer-desktop.js";
import { createHash } from "node:crypto";
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
  isLoopback, isLoopbackHost,
  tokenFromRequest,
} from "./src/auth.js";

import { serverPortChoice, listenWithPortFallback } from "./src/server-port.js";
export { DEFAULT_PORT } from "./src/server-port.js";
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
  req.setTimeout(15000, () => req.destroy());
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
  hostName = hostname(),
  updates = createUpdateService({ platform: provider.id }),
  tls = null,
  securePin = newPin(),
  managed = null,
  identity = null,
  transfers: suppliedTransfers = null,
} = {}) {
  if (!isValidPinShape(pin)) throw new Error("Pairing PIN must contain exactly six ASCII digits.");
  if (!isValidPinShape(securePin)) throw new Error("Secure pairing PIN must contain exactly six ASCII digits.");
  while (securePin === pin) securePin = newPin();
  const hostId = identity || await hostIdentity(configStore.path);
  const state = { pin, securePin };
  const secureSessions = managed ? await secureSessionStore(managed.directory) : createSessionStore();
  const invitations = pairingInvites();
  const permittedHost = (header) => Boolean(hostAllowed(header) || (managed && header?.split(":")[0] === tlsName(hostId)));
  // One host-wide failure budget and recovery action; independent transport credentials.
  const requestAuth = (req) => permittedHost(req.headers.host) && authorize({ req,
    sessions: req.socket.encrypted ? secureSessions : sessions,
    lockout, remote: req.socket.remoteAddress || "",
    trustLoopback: trustLoopback && !req.socket.encrypted,
  });
  const appIcon = createIconCache(provider);
  // Lazy initialization avoids creating receive folders or state until the feature is used.
  let transferPromise;
  const transfers = () => transferPromise ||= suppliedTransfers ? Promise.resolve(suppliedTransfers) : createTransfers({
    stateFile: configStore.path ? `${configStore.path}.transfers/state.json` : null, notify: notifyTransfer,
  }).catch(error => { transferPromise = null; throw error; });
  let inventoryPromise;
  let inventoryTime = 0;
  async function installedApps() {
    if (!inventoryPromise || Date.now() - inventoryTime > 60_000) {
      inventoryTime = Date.now();
      inventoryPromise = provider.listInstalledApps().catch((error) => {
        inventoryPromise = null;
        throw error;
      });
    }
    const apps = await inventoryPromise;
    const folders = typeof provider.openFolder === "function"
      ? (await configStore.load()).tiles.map(folderFromTile).filter(Boolean) : [];
    const links = typeof provider.openLink === "function"
      ? (await configStore.load()).tiles.map(linkFromTile).filter(Boolean) : [];
    return [...apps, ...folders, ...links];
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
      hostName,
      tiles: config.tiles.map((tile) =>
        tile.kind === "app" ? { ...tile, running: runningIds.has(tile.id) } : tile,
      ),
      running,
      verbs: CONTROL_VERBS,
      allowDestructive,
      canPickFolders: typeof provider.pickFolder === "function" && typeof provider.openFolder === "function",
      canAddLinks: typeof provider.openLink === "function",
    };
  }

  const handler = async (req, res) => {
    const remote = req.socket.remoteAddress || "";
    // Refuse unknown Host names before anything else. This is what blocks DNS
    // rebinding, where a page on some other domain points it at this machine.
    if (!permittedHost(req.headers.host)) {
      return sendJson(res, 421, { error: "unknown host; add your custom DNS name to WINDOCK_ALLOWED_HOSTS on the PC" });
    }
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); }
    catch { return sendJson(res, 400, { error: "invalid request target" }); }
    const path = url.pathname;
    const local = isLoopback(remote) && isLoopbackHost(req.headers.host);

    try {
      if (path === "/files" || path === "/files.html") {
        if (!local) return sendJson(res,403,{ error:"Open Files & Media on the computer itself." });
        const body=await readFile(join(PUBLIC_DIR,"files.html"));
        res.writeHead(200,{"content-type":MIME[".html"],"cache-control":"no-store","x-frame-options":"DENY",
          "content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
        return res.end(body);
      }
      if (path.startsWith("/api/transfers/local")) {
        if (!local || !sameOrigin(req) || req.headers["x-windock-files"] !== "local") return sendJson(res,403,{error:"Change receive settings on the computer."});
        const receiver=await transfers();
        if (path === "/api/transfers/local" && req.method === "GET") return sendJson(res,200,receiver.local());
        if (req.method !== "POST") return sendJson(res,405,{error:"Unsupported action."});
        const body=await readJsonBody(req);
        if (path === "/api/transfers/local/settings") return sendJson(res,200,await receiver.configure(body));
        if (path === "/api/transfers/local/cancel" && Object.keys(body).length===1 && typeof body.id==="string") return sendJson(res,200,await receiver.cancelLocal(body.id));
        if (path === "/api/transfers/local/open" && Object.keys(body).length===0) { await openReceiveDirectory(await receiver.openDirectory()); return sendJson(res,200,{ok:true}); }
        return sendJson(res,400,{error:"Invalid receive action."});
      }
      if (path === "/health") {
        sendJson(res, 200, { ok: true, app: "windock", platform: provider.id, hostName, hostId,
          ...(managed ? { securePairing: 1, ca: managed.publicCa } : {}) });
        return;
      }

      // The invitation is created only by an explicit action on the local PC.
      if (path === "/pair" || path === "/pair.html") {
        if (!local) return sendJson(res, 403, { error: "Open Pair a phone on the computer itself." });
        const body = await readFile(join(PUBLIC_DIR, "pair.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
          "x-frame-options": "DENY", "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
        return res.end(body);
      }
      if (path === "/api/pairing/invite" && req.method === "POST") {
        if (!local || !sameOrigin(req) || req.headers["x-windock-pair"] !== "local") return sendJson(res, 403, { error: "Pairing starts on the computer." });
        if (!managed || !state.managedPort) return sendJson(res, 503, { error: "Secure pairing is not available. Check the desktop connection diagnostics." });
        const body = await readJsonBody(req);
        if (Object.keys(body).some(key => key !== "format") || (body.format !== undefined && body.format !== "gif"))
          return sendJson(res, 400, { error: "Unsupported pairing image format." });
        return sendJson(res, 200, invitations.issue({ hostId, name: hostName, ca: managed.publicCa,
          port: state.managedPort, address: primaryAddress() }, body.format));
      }
      if (path === "/api/pairing/diagnostics" && req.method === "GET") {
        if (!local || !sameOrigin(req)) return sendJson(res, 403, { error: "Diagnostics are available on the computer." });
        return sendJson(res, 200, managed ? { ...managed.diagnostics, managedPort: state.managedPort } : { state: "manual HTTPS only" });
      }
      if (path === "/api/pairing/network" && req.method === "GET") {
        if (!local || !sameOrigin(req)) return sendJson(res, 403, { error: "Open connection checks on the computer itself." });
        const ports = [
          { port: managedServer?.address()?.port, protocol: "tcp", label: "Secure phone connection" },
          { port: server.address()?.port, protocol: "tcp", label: "Browser and older clients (optional)" },
          { port: secureServer?.address()?.port, protocol: "tcp", label: "Externally configured HTTPS (optional)" },
          { port: state.discoveryPort || DISCOVERY_PORT, protocol: "udp", label: "Nearby PC discovery" },
        ].filter(item => Number.isInteger(item.port));
        return sendJson(res, 200, await networkSetup({ ports }), { "cache-control": "no-store" });
      }
      if (path === "/api/pairing/claim" && req.method === "POST") {
        if (!managed || req.socket.server !== managedListener || !req.socket.encrypted || !sameOrigin(req))
          return sendJson(res, 403, { error: "Use secure pairing." });
        const before = lockout.status(remote);
        if (before.locked) return sendJson(res, 429, { error: "locked", ...before });
        const body = await readJsonBody(req);
        const after = lockout.status(remote);
        if (after.locked) return sendJson(res, 429, { error: "locked", ...after });
        if (body.hostId !== hostId || !invitations.consume(body.secret)) {
          lockout.recordFailure(remote);
          return sendJson(res, 401, { error: "invitation expired or invalid" });
        }
        lockout.recordSuccess(remote);
        const token = secureSessions.issue();
        return sendJson(res, 200, { ok: true, hostId, token }, { "set-cookie": sessionCookie(token, { secure: true }) });
      }
      if (path === "/api/pairing/revoke" && req.method === "POST") {
        if (!local || !sameOrigin(req) || req.headers["x-windock-pair"] !== "local") return sendJson(res, 403, { error: "Unpair phones on the computer." });
        const body = await readJsonBody(req);
        if (body.confirm !== "forget-all") return sendJson(res, 400, { error: "Confirm forgetting paired phones." });
        secureSessions.revokeAll();
        invitations.clear();
        hub.revalidate();
        return sendJson(res, 200, { ok: true });
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
        const pairingSessions = req.socket.encrypted ? secureSessions : sessions;
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
        if (!safeEqual(body.pin, req.socket.encrypted ? state.securePin : state.pin)) {
          lockout.recordFailure(remote);
          return sendJson(res, 401, { error: "wrong pin", ...lockout.status(remote) });
        }
        lockout.recordSuccess(remote);
        const token = pairingSessions.issue();
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
            "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${req.socket.encrypted ? 'wss:' : 'ws:'}//${url.host}; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
            "referrer-policy": "no-referrer",
          });
          return res.end(body);
        } catch {
          return sendJson(res, 404, { error: "not found" });
        }
      }

      const auth = requestAuth(req);
      if (!auth.ok) {
        return sendJson(res, auth.code, { error: auth.via, retryInMs: auth.retryInMs });
      }

      const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
      if (mutating && !sameOrigin(req)) return sendJson(res, 403, { error: "bad origin" });

      if (path === "/api/transfers" || path.startsWith("/api/transfers/")) {
        if (!req.socket.encrypted || auth.via !== "session") return sendJson(res,403,{error:"Files & Media requires a securely paired HTTPS connection."});
        const receiver=await transfers();
        const owner=createHash("sha256").update(tokenFromRequest(req)).digest("hex");
        try {
          if (path === "/api/transfers/info" && req.method === "GET") return sendJson(res,200,receiver.info());
          if (path === "/api/transfers" && req.method === "POST") return sendJson(res,200,await receiver.begin(owner,await readJsonBody(req)));
          const route=path.match(/^\/api\/transfers\/([a-f0-9]{32})(?:\/([a-f0-9]{32})\/(content|complete)|\/(cancel))?$/);
          if (!route) return sendJson(res,404,{error:"Unknown transfer action."});
          const [,batch,file,action,cancel]=route;
          if (!file && !cancel && req.method === "GET") return sendJson(res,200,receiver.status(owner,batch));
          if (cancel && req.method === "POST") { const body=await readJsonBody(req); if(Object.keys(body).length) return sendJson(res,400,{error:"Cancel takes no options."}); return sendJson(res,200,await receiver.cancel(owner,batch)); }
          const authorized=()=>requestAuth(req).ok;
          if (action === "content" && req.method === "PUT") return sendJson(res,200,await receiver.upload(owner,batch,file,req,authorized));
          if (action === "complete" && req.method === "POST") return sendJson(res,200,await receiver.complete(owner,batch,file,await readJsonBody(req),authorized));
          return sendJson(res,405,{error:"Unsupported transfer action."});
        } catch(error) { const safe=transferError(error); if (!res.destroyed) return sendJson(res,safe.status,{error:safe.message}); return; }
      }

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

      if (path === "/api/folders/pick" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (Object.keys(body).length) return sendJson(res, 400, { error: "folder selection takes no options" });
        if (typeof provider.pickFolder !== "function" || typeof provider.openFolder !== "function")
          return sendJson(res, 404, { error: "folder selection is unavailable on this PC" });
        const selected = await provider.pickFolder();
        const folder = selected === null ? null : folderApp(selected?.target);
        if (selected !== null && !folder) return sendJson(res, 422, { error: "invalid folder selection" });
        return sendJson(res, 200, { app: folder });
      }

      if (path === "/api/links" && req.method === "POST") {
        if (typeof provider.openLink !== "function") return sendJson(res, 404, { error: "Links are unavailable on this companion. Update WinDock on your computer." });
        const body = await readJsonBody(req);
        const app = Object.keys(body).every(key => ["url", "name"].includes(key)) && linkApp(body.url, body.name);
        if (!app) return sendJson(res, 422, { error: "Enter an http:// or https:// website address (up to 2048 characters), without passwords, and a name up to 80 characters." });
        return sendJson(res, 200, { app });
      }

      if (path === "/api/apps/icon" && req.method === "GET") {
        const app = (await installedApps()).find((item) => item.id === url.searchParams.get("id"));
        if (!app) return sendJson(res, 404, { error: "unknown app" });
        const icon = app.source === "link" ? LINK_ICON : app.source === "folder" ? FOLDER_ICON : await appIcon(app);
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
        if (app.source === "link") await provider.openLink(app);
        else if (app.source === "folder") await provider.openFolder(app);
        else await provider.launchApp(app);
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
        const result = await provider.control(checked.verb, checked.value);
        const warning = checked.verb === "brightness-set" && result?.warning === "hdr-active" ? { warning: "hdr-active" } : {};
        return sendJson(res, 200, { ok: true, verb: checked.verb, ...warning });
      }

      if (path === "/api/levels" && req.method === "GET") {
        // Optional: without it the sliders start empty and still set a level.
        const levels = typeof provider.levels === "function" ? await provider.levels().catch(() => null) : null;
        return sendJson(res, 200, { volume: levels?.volume ?? null, brightness: levels?.brightness ?? null });
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
        return sendJson(res, 200, { available: Boolean(provider.input), keyboard: Boolean(provider.input), signatureInsert: Boolean(provider.input), clipboard: Boolean(provider.clipboard) });
      }
      if (path === "/api/clipboard/history" && req.method === "GET") {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "bad origin" });
        if (!provider.clipboard) return sendJson(res, 501, { error: "PC clipboard history needs an updated WinDock host." });
        return sendJson(res, 200, await provider.clipboard.history(), { "cache-control": "no-store", "pragma": "no-cache" });
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
  };
  const server = createServer(handler);
  server.requestTimeout = 3600000;
  const secureServer = tls ? createHttpsServer({ ...tls, minVersion: "TLSv1.2" }, handler) : null;
  if (secureServer) secureServer.requestTimeout = 3600000;
  // Explicit external TLS remains intact; managed pairing gets its own listener in that case.
  const managedServer = managed ? createHttpsServer({ ...managed.options, minVersion: "TLSv1.2" }, handler) : null;
  if (managedServer) managedServer.requestTimeout = 3600000;
  const managedListener = managedServer;
  const servers = [server, secureServer, managedServer].filter(Boolean);

  const hub = createSyncHub({
    server, servers,
    isAuthorized: (req) => requestAuth(req).ok,
    getState: dockState,
  });

  const inputHub = createInputHub({ server, servers, input: provider.input, isAuthorized: (req) => requestAuth(req).ok,
  });
  let renewalTimer;
  if (managedServer) {
    renewalTimer = setInterval(() => managed.refresh(managedServer).catch(() => {
      // No file contents, PINs, tokens or certificates in diagnostic logs.
      process.stderr.write("WinDock: secure certificate renewal needs attention. See secure connection diagnostics.\n");
    }), 6 * 60 * 60000);
    renewalTimer.unref();
  }
  server.on("close", () => { transferPromise?.then(t=>t.close()).catch(()=>{}); clearInterval(renewalTimer); managedServer?.close(); provider.capture?.dispose().catch(() => {}); provider.input?.dispose(); });
  return { server, secureServer, managedServer, managed, hub, inputHub, provider, configStore, dockState, state, sessions, secureSessions, lockout };
}

export async function start({ port, securePort, managedPort, managedHttps = true, host = process.env.WINDOCK_HOST || "", discoveryPort = DISCOVERY_PORT, ...appOptions } = {}) {
  const choice = serverPortChoice(port, process.env.PORT);
  const address = primaryAddress(undefined, host);
  const certFile = process.env.WINDOCK_TLS_CERT, keyFile = process.env.WINDOCK_TLS_KEY;
  if (Boolean(certFile) !== Boolean(keyFile)) throw new Error("Set both WINDOCK_TLS_CERT and WINDOCK_TLS_KEY; HTTPS configuration is incomplete.");
  const tls = appOptions.tls ?? (certFile ? { cert: await readFile(certFile), key: await readFile(keyFile) } : null);
  const configStore = appOptions.configStore || createConfigStore();
  const identity = await hostIdentity(configStore.path);
  if (managedHttps && configStore.path && (await readFile(`${configStore.path}.host-id`, "utf8").catch(() => "")).trim() !== identity)
    throw new Error("WinDock's saved computer identifier is unavailable. Restore the existing identity before enabling managed pairing.");
  const managed = managedHttps && configStore.path ? await managedTls(configStore.path, identity) : null;
  const tlsChoice = serverPortChoice(securePort, process.env.WINDOCK_TLS_PORT);
  if (tlsChoice.automatic) tlsChoice.port = 8621;
  if (tls && !choice.automatic && !tlsChoice.automatic && choice.port !== 0 && choice.port === tlsChoice.port)
    throw new Error("HTTP and HTTPS require different ports. Change PORT or WINDOCK_TLS_PORT.");
  const app = await createApp({ ...appOptions, configStore, identity, tls, managed });
  let binding;
  let secureBinding;
  let managedBinding;
  try {
    binding = await listenWithPortFallback(app.server, choice);
    if (app.secureServer) secureBinding = await listenWithPortFallback(app.secureServer, tlsChoice);
    if (app.managedServer) {
      const managedChoice = serverPortChoice(managedPort, process.env.WINDOCK_MANAGED_TLS_PORT);
      if (managedChoice.automatic) managedChoice.port = tls ? 8622 : 8621;
      managedBinding = await listenWithPortFallback(app.managedServer, managedChoice);
      app.state.managedPort = managedBinding.port;
    }
  }
  catch (error) {
    await Promise.all([app.hub.close(), app.inputHub.close()]);
    app.server.close();
    app.secureServer?.close();
    app.managedServer?.close();
    throw error;
  }

  port = binding.port;
  const endpoint = address ? `http://${address}:${port}` : `http://localhost:${port}`;
  const secureEndpoint = secureBinding ? `https://${address || "localhost"}:${secureBinding.port}` : null;
  const managedEndpoint = managedBinding ? `https://${address || "127.0.0.1"}:${managedBinding.port}` : null;
  const discovery = startDiscovery({ endpoint, secureEndpoint, managedEndpoint, hostId: identity, port: discoveryPort });
  app.state.discoveryPort = discoveryPort;
  const portNotice = [binding.portNotice, secureBinding?.portNotice ? `HTTPS: ${secureBinding.portNotice}` : ""].filter(Boolean).join(" ");
  return { ...app, endpoint, secureEndpoint, managedEndpoint, pairUrl: managed ? `http://127.0.0.1:${port}/pair` : null,
    discovery, port, securePort: secureBinding?.port, managedPort: managedBinding?.port, portNotice };
}

/** Printed once the host is listening. The Windows tray reads the address and PIN from it. */
export function readyMessage({ endpoint, secureEndpoint, pairUrl, state, provider, portNotice = "" }) {
  return `WinDock host ready\n${portNotice ? `  note:     ${portNotice}\n` : ""}  provider: ${provider.displayName}\n  open:     ${endpoint}\n  PIN:      ${state.pin}\n` +
    (secureEndpoint ? `  secure:   ${secureEndpoint}\n  secure-code: ${state.securePin}\n` : "") +
    (pairUrl ? `  pair:     ${pairUrl}\n` : "");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  start()
    .then((host) => {
      process.stdout.write(readyMessage(host));
    })
    .catch((err) => {
      process.stderr.write(`WinDock failed to start: ${err.message}\n`);
      process.exit(1);
    });
}
