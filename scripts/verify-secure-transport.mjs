// Real TLS and WebSocket handshakes against a mock PC; never touches Windows input/capture.
import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { createApp, start, readyMessage } from '../server.js';
import { createLockout } from '../src/auth.js';
import { createSocket } from 'node:dgram';
import { replyFor, PROBE, SECURE_PROBE, SECURE_REPLY_PREFIX, startDiscovery } from '../src/discovery.js';

const dir = await mkdtemp(join(tmpdir(), 'windock-tls-test-'));
const openssl = process.env.OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe')
  ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
let app;
try {
  const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=WinDock test only', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:rebind.invalid',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { encoding: 'utf8' });
  assert.equal(generated.status, 0, 'OpenSSL must generate an ephemeral test-only certificate');
  const cert = await readFile(join(dir, 'cert.pem'));
  const key = await readFile(join(dir, 'key.pem'));
  const inputEvents = [];
  const provider = { id: 'test', displayName: 'Test', listRunningApps: async () => [],
    clipboard: { history: async () => ({ status: 'ready', items: [{ text: 'Fixture clipboard only' }] }) },
    input: { open: (_fail, emit) => ({ ready: Promise.resolve(), close() {},
      send(message) { inputEvents.push(message); if (message.type === 'paste') emit({ type: 'paste-result' }); } }), dispose() {} },
  };
  const updates = { state: () => ({ status: 'unchecked' }), check: async () => ({ status: 'current' }) };
  const lockout = createLockout({ maxFails: 100, globalMaxFails: 3 });
  app = await createApp({ provider, configStore: { load: async () => ({ tiles: [] }) },
    pin: '123456', securePin: '567890', lockout, updates, trustLoopback: false, tls: { cert, key } });
  for (const server of [app.server, app.secureServer]) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const plain = `http://127.0.0.1:${app.server.address().port}`;
  const secure = `https://127.0.0.1:${app.secureServer.address().port}`;
  function call(origin, path, { body, cookie, ca = cert, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const request = (origin.startsWith('https:') ? httpsRequest : httpRequest)(origin + path,
        { ca, method: body ? 'POST' : 'GET', headers: { origin, ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, response => {
          let data = ''; response.on('data', chunk => data += chunk);
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data }));
        });
      request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
    });
  }
  await assert.rejects(call(secure, '/health', { ca: [] }), /self.signed|certificate/i);
  await assert.rejects(call(secure, '/health', { headers: { host: 'wrong-address.invalid' } }), /altnames|Hostname/i);
  assert.equal((await call(secure, '/api/state')).status, 401);
  assert.equal((await call(secure, '/api/auth', { body: { pin: '123456' } })).status, 401);
  const legacy = await call(plain, '/api/auth', { body: { pin: '123456' } });
  const encrypted = await call(secure, '/api/auth', { body: { pin: '567890' } });
  const legacyCookie = legacy.headers['set-cookie'][0].split(';')[0];
  const secureCookie = encrypted.headers['set-cookie'][0].split(';')[0];
  assert.match(secureCookie, /^__Host-windock_session=/);
  assert.match(encrypted.headers['set-cookie'][0], /; Secure/);
  assert.equal((await call(plain, '/api/state', { cookie: legacyCookie })).status, 200);
  assert.equal((await call(secure, '/api/state', { cookie: secureCookie })).status, 200);
  assert.equal((await call(secure, '/api/state', { cookie: legacyCookie })).status, 401);
  assert.equal((await call(plain, '/api/state', { cookie: secureCookie })).status, 401);
  // Renaming cookies cannot bypass the separate token stores.
  assert.equal((await call(plain, '/api/state', { cookie: secureCookie.replace('__Host-', '') })).status, 401);
  assert.equal((await call(secure, '/api/state', { cookie: '__Host-' + legacyCookie })).status, 401);
  for (const [origin, cookie] of [[plain, legacyCookie], [secure, secureCookie]]) {
    assert.equal((await call(origin, '/health', { headers: { host: 'rebind.invalid' } })).status, 421);
    const health = JSON.parse((await call(origin, '/health')).data);
    assert.equal(health.app, 'windock'); assert.ok(health.hostId); assert.ok(health.hostName);
    assert.equal((await call(origin, '/api/clipboard/history')).status, 401);
    const clipboard = await call(origin, '/api/clipboard/history', { cookie });
    assert.equal(clipboard.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(clipboard.data).items[0].text, 'Fixture clipboard only');
    assert.equal((await call(origin, '/api/clipboard/history', { cookie, headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await call(origin, '/api/updates', { cookie })).status, 200);
    assert.equal(JSON.parse((await call(origin, '/api/updates/check', { cookie, body: {} })).data).status, 'current');
    assert.equal((await call(origin, '/api/pairing/reset', { body: {} })).status, 403);
  }
  assert.equal(JSON.parse((await call(plain, '/health')).data).hostId, JSON.parse((await call(secure, '/health')).data).hostId);
  const page = await call(secure, '/');
  assert.match(page.headers['content-security-policy'], /frame-src 'none'/);
  assert.match(page.headers['content-security-policy'], /connect-src 'self' wss:/);
  assert.equal(replyFor(PROBE, plain, secure), `windock:here:v1:${plain}`);
  assert.equal(replyFor(SECURE_PROBE, plain), null);
  assert.equal(replyFor(SECURE_PROBE, plain, secure), SECURE_REPLY_PREFIX + secure);
  for (const [origin, cookie] of [[plain, legacyCookie], [secure, secureCookie]]) {
    const ws = new WebSocket(origin.replace('http', 'ws'), { ca: cert, headers: { origin, cookie } });
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket timed out')); }, 5000);
      ws.once('message', data => { clearTimeout(timer); resolve(JSON.parse(data)); });
      ws.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(message.type, 'snapshot');
    await new Promise(resolve => { ws.once('close', resolve); ws.close(); });
  }
  // Real WSS input retains paste and the single-owner lease across both transports.
  const messages = [];
  const input = new WebSocket(secure.replace('http', 'ws') + '/input', { ca: cert, headers: { origin: secure, cookie: secureCookie } });
  input.on('message', data => messages.push(JSON.parse(data)));
  const until = async predicate => {
    const deadline = Date.now() + 5000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'bounded WebSocket wait'); await new Promise(r => setTimeout(r, 10)); }
  };
  await until(() => messages.some(m => m.type === 'ready'));
  input.send(JSON.stringify({ type: 'paste', target: '1', text: 'Fixture paste' }));
  await until(() => messages.some(m => m.type === 'paste-result'));
  assert.equal(inputEvents[0].text, 'Fixture paste');
  const competing = new WebSocket(plain.replace('http', 'ws') + '/input', { headers: { origin: plain, cookie: legacyCookie } });
  const busy = await new Promise((resolve, reject) => { competing.once('message', d => resolve(JSON.parse(d))); competing.once('error', reject); });
  assert.equal(busy.type, 'error'); assert.match(busy.error, /Another device/);
  competing.terminate(); input.close(); await new Promise(resolve => input.once('close', resolve));
  // One failure budget covers both listeners; existing paired sessions survive the global pause.
  for (const origin of [plain, secure]) await call(origin, '/api/auth', { body: { pin: '000000' } });
  assert.equal(lockout.status('unseen-address').global, true);
  assert.equal((await call(plain, '/api/auth', { body: { pin: '123456' } })).status, 429);
  assert.equal((await call(secure, '/api/state', { cookie: secureCookie })).status, 200);
  assert.equal((await call(plain, '/api/pairing/reset', { body: {}, headers: { origin: '', 'x-windock-local-action': 'allow-pairing' } })).status, 200);
  assert.equal((await call(secure, '/api/auth', { body: { pin: '567890' } })).status, 200);
  // Actual UDP responder answers legacy and secure discovery on the same socket.
  const responder = createSocket('udp4');
  const discovery = startDiscovery({ endpoint: plain, secureEndpoint: secure, port: 0, socket: responder });
  const udp = createSocket('udp4');
  try {
    await discovery.ready;
    for (const [probe, expected] of [[PROBE, `windock:here:v1:${plain}`], [SECURE_PROBE, SECURE_REPLY_PREFIX + secure]]) {
      const reply = new Promise(resolve => udp.once('message', data => resolve(data.toString())));
      udp.send(probe, responder.address().port, '127.0.0.1');
      assert.equal(await reply, expected);
    }
  } finally { udp.close(); await discovery.close(); }
  // Occupy the default HTTPS port without requiring a running companion to stop.
  // An existing listener already supplies the collision this test needs.
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', error => error.code === 'EADDRINUSE' ? resolve() : reject(error));
    blocker.listen(8621, resolve);
  });
  let started;
  try {
    started = await start({ port: 0, host: '', discoveryPort: 0, tls: { cert, key }, provider,
      configStore: { load: async () => ({ tiles: [] }) }, updates });
    assert.notEqual(started.securePort, 8621);
    assert.match(started.portNotice, /HTTPS:/);
    assert.match(readyMessage(started), /secure-code: \d{6}/);
    assert.equal(new URL(started.secureEndpoint).port, String(started.securePort));
    assert.equal((await call(`https://127.0.0.1:${started.securePort}`, '/health')).status, 200);
  } finally {
    if (blocker.listening) await new Promise(resolve => blocker.close(resolve));
    if (started) {
      await started.discovery.close(); await started.inputHub.close(); await started.hub.close();
      for (const listener of [started.server, started.secureServer]) await new Promise(resolve => listener.close(resolve));
    }
  }
  console.log('secure-transport verification passed');
} finally {
  if (app) {
    await app.inputHub.close(); await app.hub.close();
    for (const server of [app.server, app.secureServer]) await new Promise(resolve => server.close(resolve));
  }
  await rm(dir, { recursive: true, force: true });
}
