import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { X509Certificate } from "node:crypto";
import { WebSocket } from "ws";
import { managedTls, certificatePin } from "../src/managed-tls.js";
import { createApp } from "../server.js";
import { pairingInvites } from "../src/pairing-invites.js";
import { secureSessionStore } from "../src/secure-sessions.js";

const directory = await mkdtemp(join(tmpdir(), "windock-managed-test-"));
const path = join(directory, "config.json"), id = "11111111-1111-4111-8111-111111111111";
const DAY = 86400000;
let checks = 0, app;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function reject(promise, message) { await assert.rejects(promise, message); checks++; }
const provider = { id: "test", displayName: "Test", listRunningApps: async () => [],
  listInstalledApps: async () => [], input: { dispose() {} } };
const configStore = { path, load: async () => ({ tiles: [] }) };
async function boot(manager) {
  const host = await createApp({ provider, configStore, identity: id, managed: manager, pin: "123456", securePin: "654321", trustLoopback: false });
  for (const server of [host.server, host.managedServer]) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  host.state.managedPort = host.managedServer.address().port;
  return host;
}
async function stop(host) {
  if (!host) return;
  await Promise.all([host.hub.close(), host.inputHub.close()]);
  await Promise.all([host.server, host.managedServer].filter(Boolean).map((s) => new Promise((resolve) => s.close(resolve))));
}
function call(host, path, { body, cookie, plain = false, ca = host.managed.ca, servername = host.managed.name, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const port = (plain ? host.server : host.managedServer).address().port;
    const origin = `${plain ? "http://127.0.0.1" : `https://${servername}`}:${port}`;
    const req = (plain ? httpRequest : httpsRequest)({ hostname: "127.0.0.1", port, path, ca, servername, agent: false,
      method: body ? "POST" : "GET", headers: { host: `${plain ? "127.0.0.1" : servername}:${port}`, origin,
        ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers } }, (res) => {
      let data = ""; res.on("data", (chunk) => data += chunk); res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
    }); req.on("error", reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
try {
  let clock = Date.now() - 61 * DAY;
  const manager = await managedTls(path, id, { now: () => clock });
  const firstCa = manager.ca, firstLeaf = manager.options.cert, firstKey = manager.options.key;
  const repeated = await managedTls(path, id, { now: () => clock });
  check(repeated.ca === firstCa && repeated.options.cert === firstLeaf && repeated.options.key === firstKey, "restart preserves certificate and key without needless regeneration");
  app = await boot(manager);
  check((await call(app, "/health")).status === 200, "normal TLS chain and hostname validation passes");
  await reject(call(app, "/health", { ca: [] }), /certificate|self.signed/i);
  await reject(call(app, "/health", { servername: "wrong.windock.invalid" }), /Hostname|altnames/i);
  check((await call(app, "/api/state")).status === 401, "TLS does not bypass pairing");
  check((await call(app, "/pair", { plain: true })).status === 200, "local pairing page is available");
  const network = await call(app, "/api/pairing/network", { plain: true });
  check(network.status === 200 && JSON.parse(network.data).ports.some(p => p.port === app.managedServer.address().port), "network guidance uses the actual listener, not a default port");
  check(!network.data.includes(manager.publicCa) && !network.data.includes('PRIVATE KEY'), "network guidance contains no trust material");
  check((await call(app, "/api/pairing/network", { plain: true, headers: { origin: "https://attacker.invalid" } })).status === 403, "network guidance blocks cross-origin access");
  check((await call(app, "/api/pairing/network")).status === 403, "network guidance is not exposed over paired phone HTTPS");
  check((await call(app, "/api/pairing/invite", { plain: true, body: {}, headers: { origin: "https://attacker.invalid", "x-windock-pair": "local" } })).status === 403, "cross-origin invitation creation blocked");
  check((await call(app, "/api/pairing/invite", { plain: true, body: {} })).status === 403, "invitation requires deliberate local action");
  const invite = JSON.parse((await call(app, "/api/pairing/invite", { plain: true, body: {}, headers: { "x-windock-pair": "local" } })).data);
  check(invite.svg.startsWith("<svg") && !invite.image, "existing browser invitation keeps its SVG response");
  const payload = JSON.parse(Buffer.from(invite.invitation.slice("windock-pair:".length), "base64url"));
  check(payload.ca === manager.publicCa && payload.hostId === id && !invite.invitation.includes("PRIVATE"), "invitation carries public identity only");
  check((await call(app, "/api/pairing/claim", { plain: true, body: { hostId: id, secret: payload.secret } })).status === 403, "invitation cannot be claimed over HTTP");
  const claimed = await call(app, "/api/pairing/claim", { body: { hostId: id, secret: payload.secret } });
  check(claimed.status === 200, "invitation claims an authenticated HTTPS session");
  const token = JSON.parse(claimed.data).token, cookie = `__Host-windock_session=${token}`;
  check((await call(app, "/api/pairing/claim", { body: { hostId: id, secret: payload.secret } })).status === 401, "invitation cannot be replayed");
  check((await call(app, "/api/state", { cookie })).status === 200, "paired client reaches unchanged dock API");
  check((await call(app, "/api/pairing/invite", { plain: true, body: { format: "html" }, headers: { "x-windock-pair": "local" } })).status === 400, "unsupported native image formats are rejected");
  check((await call(app, "/api/pairing/invite", { plain: true, body: { format: "gif", address: "attacker.invalid" }, headers: { "x-windock-pair": "local" } })).status === 400, "native image request cannot override pairing identity or address");
  const nativeInvite = JSON.parse((await call(app, "/api/pairing/invite", { plain: true, body: { format: "gif" }, headers: { "x-windock-pair": "local" } })).data);
  const gif = Buffer.from(nativeInvite.image.slice("data:image/gif;base64,".length), "base64");
  check(gif.subarray(0, 6).toString() === "GIF87a" && gif.readUInt16LE(6) === gif.readUInt16LE(8) && gif.readUInt16LE(6) <= 185 && !nativeInvite.svg,
    "native invitation provides a bounded QR bitmap with a quiet zone");
  const nativePayload = JSON.parse(Buffer.from(nativeInvite.invitation.slice(13), "base64url"));
  check((await call(app, "/api/pairing/claim", { body: { hostId: id, secret: nativePayload.secret } })).status === 200, "native-window code uses the unchanged secure Android claim protocol");
  check((await call(app, "/api/pairing/claim", { body: { hostId: id, secret: nativePayload.secret } })).status === 401, "native-window code remains single-use");
  check((await call(app, "/api/state", { cookie })).status === 200, "showing a new code preserves existing paired sessions");
  check((await call(app, "/api/state", { cookie: `windock_session=${token}`, plain: true })).status === 401, "HTTPS token cannot authorize legacy HTTP");
  check(!(await readFile(join(manager.directory, "sessions.json"), "utf8")).includes(token), "desktop persists token hashes, not bearer tokens");
  const ws = new WebSocket(`wss://${manager.name}:${app.state.managedPort}`, { ca: manager.ca, headers: { cookie }, lookup: (_name, _options, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]) });
  await new Promise((resolve, reject) => { ws.once("message", resolve); ws.once("error", reject); });
  check(ws.readyState === WebSocket.OPEN, "existing authenticated WebSocket protocol works"); ws.terminate();
  clock = Date.now();
  check(await manager.refresh(app.managedServer), "near-expiry leaf renews while listener stays up");
  check(manager.ca === firstCa && manager.options.cert !== firstLeaf, "leaf renewal preserves CA identity");
  check(!(await manager.refresh(app.managedServer)), "valid certificate is not repeatedly regenerated");
  check((await call(app, "/api/state", { cookie, ca: firstCa })).status === 200, "old trust and session survive live renewal");
  await stop(app); app = null;
  const restarted = await managedTls(path, id); app = await boot(restarted);
  check((await call(app, "/api/state", { cookie, ca: firstCa })).status === 200, "desktop restart preserves paired authorization");
  const legacy = await call(app, "/api/auth", { plain: true, body: { pin: "123456" } });
  check(legacy.status === 200 && (await call(app, "/api/state", { plain: true, cookie: legacy.headers["set-cookie"][0].split(";")[0] })).status === 200, "legacy PIN clients remain compatible");
  const unrelated = await managedTls(join(directory, "other.json"), "22222222-2222-4222-8222-222222222222");
  await reject(call(app, "/health", { ca: unrelated.ca }), /certificate|issuer|self.signed/i);
  await reject(managedTls(path, "33333333-3333-4333-8333-333333333333"), /identity/i);
  check((await call(app, "/api/pairing/revoke", { body: { confirm: "forget-all" }, headers: { "x-windock-pair": "local" } })).status === 403, "remote native clients cannot revoke other devices");
  check((await call(app, "/api/pairing/revoke", { plain: true, body: { confirm: "forget-all" }, headers: { "x-windock-pair": "local" } })).status === 200, "local owner can revoke secure sessions");
  check((await call(app, "/api/state", { cookie })).status === 401, "revoked session immediately loses API access");
  await stop(app); app = null;
  const expiredPath = join(directory, "expired.json"); let expiredClock = Date.now() - 200 * DAY;
  const expired = await managedTls(expiredPath, id, { now: () => expiredClock }); app = await boot(expired);
  await reject(call(app, "/health"), /expired/i);
  expiredClock = Date.now(); await expired.refresh(app.managedServer);
  check((await call(app, "/health")).status === 200, "expired leaf safely recovers under original CA");
  const originalPin = certificatePin(expired.ca);
  expiredClock += 10 * 365 * DAY;
  await expired.refresh();
  check(certificatePin(expired.ca) === originalPin && Date.parse(new X509Certificate(expired.ca).validTo) > expiredClock, "CA certificate renews with the same trusted private key");
  await stop(app); app = null;
  const sessions = await secureSessionStore(unrelated.directory, { now: () => 100, ttlMs: 10 }); const short = sessions.issue();
  check(!(await secureSessionStore(unrelated.directory, { now: () => 111 })).verify(short), "expired sessions never survive restart");
  let now = 100; const invitations = pairingInvites({ now: () => now });
  const p = JSON.parse(Buffer.from(invitations.issue({}).invitation.slice(13), "base64url")); now += 120001;
  check(!invitations.consume(p.secret), "expired invitations cannot authorize a device");
  await rm(join(unrelated.directory, "identity.json"));
  await reject(managedTls(join(directory, "other.json"), "22222222-2222-4222-8222-222222222222"), /missing|unreadable/i);
  const identityFile = join(restarted.directory, "identity.json"), original = await readFile(identityFile);
  await writeFile(identityFile, "broken"); await reject(managedTls(path, id), /unreadable/i); await writeFile(identityFile, original);
  console.log(`managed-connections verification passed (${checks} checks)`);
} finally { await stop(app); await rm(directory, { recursive: true, force: true }); }
