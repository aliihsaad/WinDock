// Temporary loopback-only fixture. No real desktop input, clipboard, apps, updates or capture.
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.js";
import { createConfigStore } from "../src/config.js";
import { managedTls } from "../src/managed-tls.js";
import { createTransfers } from "../src/transfers.js";
const directory = await mkdtemp(join(tmpdir(), "windock-secure-android-"));
const id = "44444444-4444-4444-8444-444444444444";
const configStore = createConfigStore({ path: join(directory, "config.json") });
const fixture = { id: "secure-fixture", name: "Fixture Editor", kind: "app", label: "Fixture Editor", target: "fixture.exe", args: "", icon: "" };
await configStore.save({ tiles: [fixture] });
let running = [], clock = Date.now() - 61 * 86400000, app, tlsPort = 18626;
let stateGate = null, releaseState = null;
let mediaDelay = 0;
let dropRead = false, dropWrite = false, readAttempts = 0, writeAttempts = 0;
const manager = await managedTls(configStore.path, id, { now: () => clock });
const provider = { id: "secure-fixture", displayName: "Secure fixture", listRunningApps: async () => { await stateGate; return running; },
  listInstalledApps: async () => [fixture], launchApp: async () => { running = [{ ...fixture, pid: 2345 }]; },
  focusApp: async () => {}, closeApp: async () => { running = []; }, control: async () => ({ok:true}),
  nowPlaying: async () => { const delay=mediaDelay; if(delay) await new Promise(resolve=>setTimeout(resolve,delay)); return delay ? {title:"Slow fixture media",artist:"Fixture",playing:true} : null; }, systemStats: async () => ({}),
  clipboard: { history: async () => ({ status: "ready", items: [{ text: "Fixture clipboard" }] }) },
  input: { open: () => ({ ready: Promise.resolve(), send() {}, close() {} }), dispose() {} } };
async function boot() {
  const transfers=await createTransfers({destination:join(directory,"received"),stateFile:join(directory,"transfers","state.json")});
  app = await createApp({ provider, configStore, identity: id, managed: manager, trustLoopback: false,
    transfers,
    updates: { state: () => ({ status: "unchecked" }), check: async () => ({ status: "current" }) } });
  const handler=app.managedServer.listeners("request")[0];
  app.managedServer.removeListener("request",handler);
  app.managedServer.on("request",(req,res)=>{
    if(req.url==="/api/capture" && dropRead) { readAttempts++; if(readAttempts===1) { res.destroy(); return; } }
    if(req.url==="/api/control" && dropWrite) { writeAttempts++; if(writeAttempts===1) { res.destroy(); return; } }
    handler(req,res);
  });
  await new Promise(resolve => app.server.listen(18624, "127.0.0.1", resolve));
  await new Promise(resolve => app.managedServer.listen(tlsPort, "127.0.0.1", resolve)); app.state.managedPort = tlsPort;
}
async function stop() {
  await Promise.all([app.hub.close(), app.inputHub.close()]);
  await Promise.all([app.server, app.managedServer].map(s => new Promise(resolve => s.close(resolve))));
}
await boot();
// A second independent identity exercises switching without touching either real PC.
const otherId = "55555555-5555-4555-8555-555555555555";
const otherStore = createConfigStore({ path: join(directory, "other", "config.json") });
await otherStore.save({ tiles: [{ ...fixture, id: "linux-fixture", name: "Linux Editor", label: "Linux Editor" }] });
const otherManager = await managedTls(otherStore.path, otherId);
const other = await createApp({ provider: { ...provider, id: "linux" }, configStore: otherStore,
  identity: otherId, managed: otherManager, trustLoopback: false });
await new Promise(resolve => other.server.listen(18631, "127.0.0.1", resolve));
await new Promise(resolve => other.managedServer.listen(18632, "127.0.0.1", resolve)); other.state.managedPort = 18632;
const control = createServer(async (req, res) => {
  try {
    let result = { ok: true };
    if (req.url === "/invitation" || req.url === "/other-invitation") {
      const port = req.url === "/other-invitation" ? 18631 : 18624;
      const response = await fetch(`http://127.0.0.1:${port}/api/pairing/invite`, { method: "POST", headers: { "x-windock-pair": "local", "content-type": "application/json" }, body: "{}" });
      const value = await response.json();
      const parsed = JSON.parse(Buffer.from(value.invitation.slice(13), "base64url"));
      parsed.address = "10.0.2.2";
      result = { invitation: "windock-pair:" + Buffer.from(JSON.stringify(parsed)).toString("base64url") };
    } else if (req.url === "/hold-state") { stateGate ??= new Promise(resolve => { releaseState = resolve; }); }
    else if (req.url === "/release-state") { releaseState?.(); stateGate = null; releaseState = null; }
    else if (req.url === "/media-slow") { mediaDelay=20000; }
    else if (req.url === "/media-stalled") { mediaDelay=35000; }
    else if (req.url === "/media-normal") { mediaDelay=0; }
    else if (req.url === "/drop-next-read") { dropRead=true; readAttempts=0; }
    else if (req.url === "/drop-next-write") { dropWrite=true; writeAttempts=0; }
    else if (req.url === "/fault-status") { result={readAttempts,writeAttempts}; }
    else if (req.url === "/clear-faults") { dropRead=false; dropWrite=false; }
    else if (req.url === "/renew") { clock = Date.now(); await manager.refresh(app.managedServer); }
    else if (req.url === "/restart") { await stop(); await boot(); }
    else if (req.url === "/move") { await stop(); tlsPort = tlsPort === 18626 ? 18627 : 18626; await boot(); result = { port: tlsPort }; }
    else if (req.url === "/revoke") { app.secureSessions.revokeAll(); }
    else if (req.url === "/files") {
      const response=await fetch("http://127.0.0.1:18624/api/transfers/local",{headers:{"x-windock-files":"local"}}); result=await response.json();
    }
    else { res.writeHead(404); res.end(); return; }
    const body = JSON.stringify(result);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store" }); res.end(body);
  } catch { res.writeHead(500); res.end("fixture failed"); }
});
await new Promise(resolve => control.listen(18625, "127.0.0.1", resolve));
console.log("Managed Android fixture ready on loopback ports 18624–18626 (temporary identity; no real desktop controls).");
let closing = false;
async function close() { if (closing) return; closing = true; releaseState?.(); control.close(); await stop();
  await Promise.all([other.hub.close(), other.inputHub.close()]);
  await Promise.all([other.server, other.managedServer].map(s => new Promise(resolve => s.close(resolve))));
  await rm(directory, { recursive: true, force: true }); process.exit(); }
process.on("SIGINT", close); process.on("SIGTERM", close); setTimeout(close, 30 * 60000).unref();
