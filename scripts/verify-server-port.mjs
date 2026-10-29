/** Issue #41: reserved/default ports recover without changing explicit choices. */
import { EventEmitter } from "node:events";
import { createServer, Server } from "node:http";
import { createSocket } from "node:dgram";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { serverPortChoice, listenWithPortFallback } from "../src/server-port.js";
import { start, readyMessage } from "../server.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createConfigStore } from "../src/config.js";
import { PROBE, parseReply } from "../src/discovery.js";

const t = createChecker("server-port");
for (const value of [undefined, "", "  "]) {
  const choice = serverPortChoice(undefined, value);
  t.equal(choice.port, 8620, "automatic starts with the usual port");
  t.ok(choice.automatic, "no environment choice enables fallback");
}
for (const value of ["8620", "18720", "65535"]) {
  const choice = serverPortChoice(undefined, value);
  t.equal(choice.port, Number(value), "PORT is honored");
  t.ok(!choice.automatic, "even explicitly selecting 8620 disables fallback");
}
t.equal(serverPortChoice(18720, "1234").port, 18720, "explicit argument wins over environment");
t.equal(serverPortChoice(0, "1234").port, 0, "programmatic ephemeral port remains supported");
for (const value of ["0", "-1", "65536", "1.5", "NaN", "oops", "8620junk", "1e4", "0x21ac"]) {
  t.throws(() => serverPortChoice(undefined, value), `invalid PORT is rejected: ${value}`);
}

function simulated(errors, synchronous = false) {
  const server = new EventEmitter();
  server.ports = [];
  server.address = () => ({ port: 18720 });
  server.listen = (port) => {
    server.ports.push(port);
    const code = errors.shift();
    const error = Object.assign(new Error(code), { code });
    if (code && synchronous) throw error;
    queueMicrotask(() => code ? server.emit("error", error) : server.emit("listening"));
    return server;
  };
  return server;
}
for (const choice of [serverPortChoice(undefined, ""), serverPortChoice(undefined, "18720")]) {
  const server = simulated([]);
  const result = await listenWithPortFallback(server, choice);
  t.equal(server.ports.join(","), String(choice.port), "available ports bind once");
  t.equal(result.portNotice, "", "normal startup has no fallback warning");
}
for (const code of ["EACCES", "EADDRINUSE"]) {
  const server = simulated([code]);
  const result = await listenWithPortFallback(server, serverPortChoice(undefined, ""));
  t.equal(server.ports.join(","), "8620,0", `${code} retries once with an OS-selected port`);
  t.equal(result.port, 18720, "actual bound port is returned");
  t.ok(result.portNotice.includes(code) && result.portNotice.includes("18720"), "fallback explains the new port");
  t.equal(server.listenerCount("listening"), 0, "failed attempt leaves no listening callback behind");
  t.equal(server.listenerCount("error"), 0, "successful bind removes temporary error handlers");
  for (const choice of [serverPortChoice(8620, ""), serverPortChoice(undefined, "18720")]) {
    const fixed = simulated([code]);
    try { await listenWithPortFallback(fixed, choice); t.ok(false, "explicit blocked port must fail"); }
    catch (error) {
      t.equal(error.code, code, "original socket error code is retained");
      t.ok(error.message.includes(String(choice.port)) && error.message.includes("Server port"), "error gives the port and recovery instructions");
    }
    t.equal(fixed.ports.length, 1, "explicit ports never silently move");
  }
}
for (const errors of [["EACCES", "EACCES"], ["EIO"]]) {
  const server = simulated([...errors]);
  await t.rejects(() => listenWithPortFallback(server, serverPortChoice(undefined, "")), "unrecoverable errors reject");
  t.equal(server.ports.length, errors.length, "fallback is bounded and unrelated errors do not retry");
}
const synchronous = simulated(["ERR_INVALID_ARG_VALUE"], true);
await t.rejects(() => listenWithPortFallback(synchronous, serverPortChoice(undefined, "")), "synchronous listen failures reject");
t.equal(synchronous.listenerCount("listening") + synchronous.listenerCount("error"), 0, "synchronous failure removes both temporary listeners");

// A real occupied TCP port exercises Node's error/retry behavior without changing Windows reservations.
const occupied = createServer();
const recovered = createServer((req, res) => res.end("recovered"));
await new Promise((resolve) => occupied.listen(0, resolve));
try {
  const occupiedPort = occupied.address().port;
  const result = await listenWithPortFallback(recovered, { port: occupiedPort, automatic: true });
  t.ok(result.port !== occupiedPort && result.port > 0, "real occupied port falls back to a different live port");
  t.equal(await (await fetch(`http://127.0.0.1:${result.port}`)).text(), "recovered", "fallback socket serves HTTP");
} finally {
  recovered.closeAllConnections();
  await new Promise((resolve) => recovered.close(resolve));
  await new Promise((resolve) => occupied.close(resolve));
}

// Inject only the Windows denial; use the real host, TCP listener and UDP discovery afterwards.
const directory = await mkdtemp(join(tmpdir(), "windock-port-"));
const previousPort = process.env.PORT;
const previousListen = Server.prototype.listen;
let app;
let denied = false;
delete process.env.PORT;
Server.prototype.listen = function (port, ...rest) {
  if (!denied && port === 8620) {
    denied = true;
    queueMicrotask(() => this.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" })));
    return this;
  }
  return previousListen.call(this, port, ...rest);
};
try {
  app = await start({
    host: "", discoveryPort: 41998, trustLoopback: false, pin: "123456",
    provider: createWindowsProvider({ exec: async () => ({ stdout: "[]" }) }),
    configStore: createConfigStore({ path: join(directory, "config.json") }),
  });
  t.ok(denied, "integration exercised the default-port denial");
  t.equal(Number(new URL(app.endpoint).port), app.server.address().port, "advertised endpoint uses the real fallback socket");
  t.ok(readyMessage(app).includes(`open:     ${app.endpoint}`), "Windows tray receives the correct address");
  t.ok(readyMessage(app).includes("EACCES"), "tray banner includes the fallback explanation");
  const base = `http://127.0.0.1:${app.port}`;
  t.equal((await fetch(`${base}/health`)).status, 200, "fallback host passes the companion health probe");
  t.equal((await fetch(`${base}/api/state`)).status, 401, "fallback retains pairing protection");
  const paired = await fetch(`${base}/api/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "123456" }) });
  t.equal(paired.status, 200, "PIN pairing works on the fallback port");
  await app.discovery.ready;
  const client = createSocket("udp4");
  try {
    const reply = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("discovery timed out")), 2000);
      client.once("message", (message) => { clearTimeout(timeout); resolve(parseReply(message)); });
      client.once("error", (error) => { clearTimeout(timeout); reject(error); });
      client.send(PROBE, 41998, "127.0.0.1");
    });
    t.equal(reply, app.endpoint, "live discovery sends the fallback address to the companion");
  } finally { client.close(); }
} finally {
  Server.prototype.listen = previousListen;
  if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
  if (app) {
    await app.discovery.close();
    await app.hub.close();
    await app.inputHub.close();
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
t.done("server-port verification passed");
