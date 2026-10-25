/** Live regressions for DNS rebinding, PIN migration and PC-only recovery. */
import assert from "node:assert/strict";
import { request } from "node:http";
import { WebSocket } from "ws";
import { createApp } from "../server.js";
import { createLockout, createSessionStore, authorize, isLocalPairingRecovery } from "../src/auth.js";
import { pairingError } from "../public/pairing.js";

const provider = { id: "test", displayName: "Test", listRunningApps: async () => [] };
const configStore = { load: async () => ({ tiles: [] }) };
const PIN = "123456";
await assert.rejects(createApp({ provider, configStore, pin: "1234" }), /six ASCII digits/);

let now = 1000;
const budget = createLockout({ now: () => now, maxFails: 2, lockMs: 100, globalMaxFails: 3, globalWindowMs: 1000, globalLockMs: 2000 });
budget.recordFailure("old-a");
now += 1001;
budget.recordFailure("new-a");
budget.recordFailure("new-b");
assert.equal(budget.status("fresh").locked, false, "aged failures must leave the rolling window");
budget.recordFailure("new-c");
assert.equal(budget.status("fresh").global, true);
const sessions = createSessionStore();
const req = { headers: { host: "192.168.1.1", cookie: "windock_session=" + sessions.issue() } };
assert.equal(authorize({ req, sessions, lockout: budget, remote: "paired" }).ok, true);
budget.recordFailure("new-a");
assert.equal(budget.status("new-a").global, false, "client penalty takes precedence over global pause");
assert.equal(authorize({ req, sessions, lockout: budget, remote: "new-a" }).code, 429);
budget.resetGlobal();
assert.equal(budget.status("fresh").locked, false);
assert.equal(budget.status("new-a").locked, true, "recovery cannot clear client penalties");
budget.recordFailure("another");
assert.equal(budget.status("fresh").locked, false, "recovery also clears recent failures");
now += 101;
assert.equal(budget.status("new-a").locked, false);

const localHeaders = { host: "127.0.0.1:8620", "x-windock-local-action": "allow-pairing" };
assert.equal(isLocalPairingRecovery({ headers: localHeaders }, "192.168.1.9"), false, "LAN cannot spoof a local Host");
assert.equal(isLocalPairingRecovery({ headers: localHeaders }, "::ffff:127.0.0.1"), true);
for (const headers of [
  { ...localHeaders, host: "app.localhost" },
  { ...localHeaders, origin: "http://127.0.0.1:8620" },
  { ...localHeaders, "sec-fetch-site": "same-origin" },
  { ...localHeaders, "x-windock-local-action": undefined },
]) assert.equal(isLocalPairingRecovery({ headers }, "127.0.0.1"), false);

assert.match(pairingError({ error: "locked", global: true, retryInMs: 600000 }), /all devices.*10 minute.*Allow pairing now/);
assert.match(pairingError({ error: "wrong pin", locked: true, global: false, retryInMs: 60000 }), /this device.*1 minute/);
assert.match(pairingError({ error: "locked", retryInMs: 1001 }), /2 second/);

const lockout = createLockout({ maxFails: 100, globalMaxFails: 3 });
const app = await createApp({ provider, configStore, pin: PIN, lockout, trustLoopback: true });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const port = app.server.address().port;
const base = "http://127.0.0.1:" + port;
function call(path, { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(text) });
      });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const pair = (pin) => call("/api/auth", { method: "POST", body: { pin } });
function websocketStatus(path, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port + path, { headers, handshakeTimeout: 2000 });
    ws.once("unexpected-response", (_req, res) => { res.resume(); ws.terminate(); resolve(res.statusCode); });
    ws.once("open", () => { ws.terminate(); resolve(101); });
    ws.on("error", reject);
  });
}
try {
  assert.equal((await call("/api/state")).status, 200, "trusted loopback still works");
  const foreign = { host: "evil.example:" + port, origin: "http://evil.example:" + port };
  const denied = await call("/api/state", { headers: foreign });
  assert.equal(denied.status, 421, "rebinding is blocked with loopback trust enabled");
  assert.match(denied.json.error, /WINDOCK_ALLOWED_HOSTS/);
  assert.equal((await call("/api/state", { headers: { host: "app.localhost:" + port } })).status, 421);
  for (let i = 0; i < 35; i++) {
    const legacy = await pair("1234");
    assert.equal(legacy.status, 400);
    assert.match(legacy.json.error, /Close and reopen.*6-digit/);
    assert.equal((await pair("nonsense")).status, 400);
  }
  assert.equal(lockout.size, 0, "malformed and old clients consume neither budget");
  const paired = await pair(PIN);
  assert.equal(paired.status, 200);
  const cookie = paired.headers["set-cookie"][0].split(";")[0];
  for (const path of ["/", "/input"]) {
    assert.equal(await websocketStatus(path, foreign), 401, path + " rejects foreign Host without a session");
    assert.equal(await websocketStatus(path, { ...foreign, cookie }), 401, path + " rejects foreign Host even with a session");
    assert.equal(await websocketStatus(path, { cookie, origin: base }), 101, path + " accepts a legitimate paired upgrade");
  }
  assert.equal((await call("//[")).status, 400, "malformed request targets do not crash the host");
  assert.equal((await call("/api/state", { headers: { cookie } })).status, 200, "session still works after malformed request");

  for (let i = 0; i < 3; i++) assert.equal((await pair("000000")).status, 401);
  const paused = await pair(PIN);
  assert.equal(paused.status, 429);
  assert.equal(paused.json.global, true);
  assert.ok(paused.json.retryInMs > 0);
  assert.equal((await call("/api/state", { headers: { host: "192.168.1.1", cookie } })).status, 200);
  const reset = (headers = {}, body = {}) => call("/api/pairing/reset", { method: "POST", body, headers });
  for (const headers of [
    {},
    { ...localHeaders, origin: base },
    { ...localHeaders, origin: "http://evil.example" },
    { ...localHeaders, "sec-fetch-site": "same-origin" },
    { ...localHeaders, host: "192.168.1.1", cookie },
  ]) {
    assert.equal((await reset(headers)).status, 403);
    assert.equal((await pair(PIN)).status, 429, "rejected recovery cannot change pause");
  }
  assert.equal((await reset(localHeaders, { pin: PIN })).status, 400);
  assert.equal((await pair(PIN)).status, 429);
  assert.equal((await reset(localHeaders)).status, 200);
  assert.equal((await pair(PIN)).status, 200, "local recovery immediately allows new pairing");
} finally {
  await app.inputHub.close();
  await app.hub.close();
  app.server.closeAllConnections();
  await new Promise(resolve => app.server.close(resolve));
}
console.log("pairing-security verification passed");
