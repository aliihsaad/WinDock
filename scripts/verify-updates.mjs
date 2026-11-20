import { readFileSync } from "node:fs";
import { createChecker } from "./lib/assert.mjs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, parseUpdateManifest, createUpdateService, allowedAssetUrl, fetchAsset, FEED_BASE, DOWNLOADS_PAGE_URL, MANIFEST_URL, INSTALLED_VERSION } from "../src/updates.js";
import { updateStatusText, phoneStatusText, createUpdates } from "../public/updates.js";
import { createApp } from "../server.js";
const t = createChecker("updates");
const traySource=readFileSync(new URL("../native/tray/TaraTray.csproj",import.meta.url),"utf8");
t.equal(INSTALLED_VERSION,traySource.match(/<InformationalVersion>([^<]+)<\/InformationalVersion>/)?.[1],"host and native Windows versions agree");
const INSTALLER = Buffer.from("pretend installer bytes");
const SHA = createHash("sha256").update(INSTALLER).digest("hex");
const manifest = (version = "0.2.4-preview.1") => ({ available: true, version, windows: { url: FEED_BASE + "TaraSetup.exe", sha256: SHA } });
for (const [a,b,expected] of [["0.2.4-preview.1","0.2.4-preview.1",0], ["0.2.4-preview.10","0.2.4-preview.2",1],
  ["0.2.4","0.2.4-preview.99",1], ["0.2.5-preview.1","0.2.4",1], ["0.2.4-alpha","0.2.4-beta",-1],
  ["0.2.4-preview.1","0.2.4-preview.1.1",-1], ["0.2.4-preview.1","0.2.4-preview.a",-1]])
  t.equal(Math.sign(compareVersions(a,b)),expected,"semantic order: " + a + " vs " + b);
for (const bad of ["1.2.3\n","01.2.3","1.2","1.2.3-preview.01","1.2.3/evil",null])
  t.throws(() => compareVersions(bad,INSTALLED_VERSION),"reject invalid version");
t.equal(parseUpdateManifest(manifest(),INSTALLED_VERSION,"windows").status,"current","windows current");
{
  const nextMajor = Number(INSTALLED_VERSION.split(".")[0]) + 1;
  const newer = parseUpdateManifest(manifest(`${nextMajor}.0.0`),INSTALLED_VERSION,"windows");
  t.equal(newer.status,"available","windows newer");
  t.equal(newer.canInstall,true,"newer release can be installed in one tap");
  t.equal(newer.releasePage,DOWNLOADS_PAGE_URL,"release page is this fork's release");
}
t.throws(() => parseUpdateManifest({...manifest(),available:false},INSTALLED_VERSION,"windows"),"unpublished feed rejected");
t.throws(() => parseUpdateManifest({...manifest(),windows:{url:"https://evil.example/a.exe",sha256:SHA}},INSTALLED_VERSION,"windows"),"arbitrary executable URL rejected");
t.throws(() => parseUpdateManifest({...manifest(),windows:{url:FEED_BASE+"TaraSetup.exe"}},INSTALLED_VERSION,"windows"),"missing checksum rejected");
t.throws(() => parseUpdateManifest(manifest(),INSTALLED_VERSION,"linux"),"other platforms are not offered an installer");
for (const ok of ["https://github.com/x/y","https://objects.githubusercontent.com/a","https://release-assets.githubusercontent.com/a"]) t.equal(allowedAssetUrl(ok),true,"allowed host "+ok);
for (const bad of ["http://github.com/x","https://github.com.evil.example/x","https://evil.example/github.com","https://user:pw@github.com/x","https://github.com:8443/x","file:///etc/passwd"]) t.equal(allowedAssetUrl(bad),false,"refused "+bad);
{
  const hops=[];
  const response=await fetchAsset(FEED_BASE+"latest.json",{fetchImpl:async(url)=>{hops.push(url);return hops.length===1?new Response(null,{status:302,headers:{location:"https://objects.githubusercontent.com/blob"}}):new Response("ok");}});
  t.equal(await response.text(),"ok","redirect to GitHub storage is followed");
  await fetchAsset(FEED_BASE+"x",{fetchImpl:async()=>new Response(null,{status:302,headers:{location:"https://evil.example/x"}})}).then(()=>t.ok(false,"foreign redirect refused"),()=>t.ok(true,"foreign redirect refused"));
}
let clock = 0, count = 0, requested;
const service = createUpdateService({ now:()=>clock, fetchImpl:async(url,options)=> {
  count++; requested={url,options}; return Response.json(manifest());
}});
t.equal(service.state().status,"unchecked","no network before manual check");
await Promise.all([service.check(),service.check(),service.check()]);
t.equal(count,1,"concurrent checks share one request");
t.equal(requested.url,MANIFEST_URL,"fixed HTTPS destination");
t.equal(requested.options.redirect,"manual","redirects are checked by hand against GitHub hosts");
t.equal(requested.options.headers.cookie,undefined,"no pairing cookies forwarded");
await service.check();t.equal(count,1,"short successful-check cache bounds requests");
clock=30001;await service.check();t.equal(count,2,"later manual check refreshes");
let tries=0;
const recovery=createUpdateService({fetchImpl:()=>{if(tries++===0)throw Error("Offline");return Response.json(manifest());}});
t.equal((await recovery.check()).status,"failed","offline is not up to date");
t.equal((await recovery.check()).status,"current","a failed request can be retried");
for(const response of [new Response("invalid json"),new Response("x".repeat(65537)),new Response("no",{status:503})]) {
  t.equal((await createUpdateService({fetchImpl:async()=>response}).check()).status,"failed","invalid or oversized feed fails safely");
}
const timed=createUpdateService({timeoutMs:10,fetchImpl:(_,options)=>new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(Error("timeout"))))});
t.equal((await timed.check()).status,"failed","network timeout terminates the check");
// One-tap install: download, verify checksum, run silently.
{
  const dir = await mkdtemp(join(tmpdir(), "tara-upd-"));
  const nextMajor = Number(INSTALLED_VERSION.split(".")[0]) + 1;
  const feed = manifest(`${nextMajor}.0.0`);
  const launches = [];
  const make = (installer = INSTALLER, extra = {}) => createUpdateService({ tempDir: dir, spawnImpl: (file, args, opts) => { launches.push({ file, args, opts }); return { unref() {} }; },
    fetchImpl: async (url) => url.endsWith("latest.json") ? Response.json(feed) : new Response(installer), ...extra });
  try {
    const early = make();
    await early.install().then(() => t.ok(false, "install needs a check first"), (e) => t.equal(e.status, 409, "install needs a check first"));
    const ok = make();
    t.equal((await ok.check()).status, "available", "newer feed found");
    t.equal(JSON.stringify(ok.state()).includes(SHA), false, "checksum is not sent to clients");
    t.equal((await ok.install()).status, "installing", "install starts");
    t.equal(launches.length, 1, "installer launched once");
    t.ok(launches[0].args.includes("/VERYSILENT") && launches[0].args.includes("/CLOSEAPPLICATIONS"), "installer runs silently and closes the running app");
    t.equal(launches[0].opts.detached, true, "installer outlives this process");
    t.equal((await readFile(launches[0].file)).equals(INSTALLER), true, "the verified file is what runs");
    await ok.install().then(() => t.ok(false, "no double install"), (e) => t.equal(e.status, 409, "no double install"));
    launches.length = 0;
    const tampered = make(Buffer.from("something else"));
    await tampered.check();
    await tampered.install().then(() => t.ok(false, "tampered installer refused"), (e) => t.ok(/checksum/.test(e.message), "tampered installer refused"));
    t.equal(launches.length, 0, "a mismatched installer is never run");
    const linux = createUpdateService({ platform: "linux" });
    await linux.install().then(() => t.ok(false, "only windows installs"), (e) => t.equal(e.status, 501, "only windows installs"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
// Real HTTP boundaries: authentication, CSRF, no caller-supplied feed URL.
const app=await createApp({provider:{id:"windows",displayName:"Windows",listRunningApps:async()=>[]},configStore:{load:async()=>({tiles:[]})},trustLoopback:false,pin:"864213",updates:service});
await new Promise(r=>app.server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+app.server.address().port;
try {
 t.equal((await fetch(base+"/api/updates")).status,401,"metadata requires pairing");
 t.equal((await fetch(base+"/api/updates/check",{method:"POST"})).status,401,"check requires pairing");
 t.equal((await fetch(base+"/api/updates/install",{method:"POST",body:"{}"})).status,401,"install requires pairing");
 const auth=await fetch(base+"/api/auth",{method:"POST",body:JSON.stringify({pin:"864213"})});
 const cookie=auth.headers.get("set-cookie").split(";")[0];
 t.equal((await fetch(base+"/api/updates/check",{method:"POST",headers:{cookie,origin:"https://evil.example"},body:"{}"})).status,403,"cross-origin check blocked");
 t.equal((await fetch(base+"/api/updates/check",{method:"POST",headers:{cookie},body:JSON.stringify({url:"http://127.0.0.1/private"})})).status,400,"custom feed inputs refused");
 t.equal((await fetch(base+"/api/updates/install",{method:"POST",headers:{cookie,origin:"https://evil.example"},body:"{}"})).status,403,"cross-origin install blocked");
 t.equal((await fetch(base+"/api/updates/install",{method:"POST",headers:{cookie},body:JSON.stringify({url:"https://evil.example/a.exe"})})).status,400,"install takes no caller-supplied URL");
 t.equal((await fetch(base+"/api/updates/install",{method:"POST",headers:{cookie},body:"{}"})).status,409,"install refused before a successful check");
 const result=await fetch(base+"/api/updates",{headers:{cookie}});
 t.equal(result.headers.get("cache-control"),"no-store","status not cached by clients");
 t.equal((await result.json()).installedVersion,INSTALLED_VERSION,"paired client reads installed version");
 t.equal((await (await fetch(base+"/api/updates/check",{method:"POST",headers:{cookie},body:"{}"})).json()).status,"current","paired manual check works");
} finally { await app.hub.close(); app.server.closeAllConnections?.(); await new Promise(r=>app.server.close(r)); }
// Drive actual UI controller state transitions without a browser or network.
const elements=new Map();
const get=id=>{if(!elements.has(id)) elements.set(id,{handlers:{},hidden:true,addEventListener(k,v){this.handlers[k]=v;},close(){this.open=false;},showModal(){this.open=true;}});return elements.get(id);};
let answer={status:"unchecked",installedVersion:INSTALLED_VERSION}, fail=false;
const screen=createUpdates({get,android:null,api:async()=>{if(fail)throw Error("offline");return answer;}});
const flush=()=>new Promise(r=>setImmediate(r));
screen.open();await flush();t.equal(get("updates").open,true,"update screen opens");
t.ok(get("updates-version").textContent.includes(INSTALLED_VERSION),"installed version shown");
answer={status:"available",installedVersion:INSTALLED_VERSION,latestVersion:"0.3.0-preview.1",canInstall:true};
await get("updates-check").handlers.click();await flush();
t.equal(get("updates-install").hidden,false,"newer release reveals one-tap update");
t.equal(get("updates-download").hidden,true,"release page link is only a fallback");
answer={...answer,canInstall:false};await get("updates-check").handlers.click();await flush();
t.equal(get("updates-download").hidden,false,"host that cannot install offers the release page");
t.equal(get("updates-download").href,"https://github.com/yeshwanthkumardomala/tara/releases/tag/upgrades-latest","UI opens this fork's release despite response-provided URLs");
fail=true;await get("updates-check").handlers.click();await flush();
t.equal(get("updates-download").hidden && get("updates-install").hidden,true,"failed recheck clears stale download state");
t.ok(get("updates-status").textContent.includes("Couldn’t check"),"failure is visible");
t.equal(get("updates-check").disabled,false,"retry stays available");
fail=false;answer={status:"current",installedVersion:INSTALLED_VERSION};await get("updates-check").handlers.click();await flush();
t.equal(get("updates-status").textContent,updateStatusText(answer),"retry displays current result");
// One-tap PC install and the phone updater bridge.
{
  const els=new Map();
  const g=id=>{if(!els.has(id)) els.set(id,{handlers:{},hidden:true,addEventListener(k,v){this.handlers[k]=v;},close(){this.open=false;},showModal(){this.open=true;}});return els.get(id);};
  const calls=[]; let failInstall="";
  const phoneCalls=[];
  const android={getAppVersion:()=>"0.4.1",checkAppUpdate:()=>phoneCalls.push("check"),installAppUpdate:()=>phoneCalls.push("install")};
  globalThis.window=globalThis.window||{};
  const ui=createUpdates({get:g,android,api:async(path)=>{calls.push(path);if(path==="/api/updates/install"&&failInstall)throw Error(failInstall);return path==="/api/updates/install"?{status:"installing"}:{status:"available",installedVersion:"0.4.1",latestVersion:"0.4.2",canInstall:true};}});
  ui.open();await flush();
  t.equal(g("updates-android").hidden,false,"phone card appears when the app can self-update");
  await g("updates-check").handlers.click();await flush();
  t.ok(phoneCalls.includes("check"),"one Check button also asks the phone app");
  window.taraAppUpdate(JSON.stringify({status:"available",version:"0.4.2"}));
  t.equal(g("updates-phone-install").hidden,false,"phone update offered");
  t.equal(g("updates-phone-status").textContent,phoneStatusText({status:"available",version:"0.4.2"}),"phone status text");
  await g("updates-phone-install").handlers.click();
  t.ok(phoneCalls.includes("install"),"Update phone now starts the download");
  window.taraAppUpdate(JSON.stringify({status:"downloading",percent:42}));
  t.ok(g("updates-phone-status").textContent.includes("42%"),"download progress shown");
  window.taraAppUpdate("not json");
  t.ok(g("updates-phone-status").textContent.includes("42%"),"malformed native message ignored");
  await g("updates-install").handlers.click();await flush();
  t.ok(calls.includes("/api/updates/install"),"Update PC now calls the host");
  t.ok(g("updates-status").textContent.includes("Installing"),"PC install progress shown");
  failInstall="The downloaded installer did not match its checksum, so it was not run.";
  const again=createUpdates({get:g,android:null,api:async(path)=>{if(path==="/api/updates/install")throw Error(failInstall);return{status:"available",installedVersion:"0.4.1",latestVersion:"0.4.2",canInstall:true};}});
  again.open();await flush();await g("updates-install").handlers.click();await flush();
  t.ok(g("updates-status").textContent.includes("checksum"),"install failure is shown to the person");
}
t.done("updates verification passed");
