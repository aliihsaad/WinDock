import { readFileSync } from "node:fs";
import { createChecker } from "./lib/assert.mjs";
import { compareVersions, parseUpdateManifest, createUpdateService, RELEASES_URL, MANIFEST_URL, INSTALLED_VERSION } from "../src/updates.js";
import { updateStatusText, createUpdates } from "../public/updates.js";
import { createApp } from "../server.js";
const t = createChecker("updates");
const traySource=readFileSync(new URL("../native/tray/WinDockTray.csproj",import.meta.url),"utf8");
t.equal(INSTALLED_VERSION,traySource.match(/<InformationalVersion>([^<]+)<\/InformationalVersion>/)?.[1],"host and native Windows versions agree");
const manifest = (version = "0.2.4-preview.1") => ({ available: true, version,
  windows: { url: RELEASES_URL + "/download/v" + version + "/WinDockSetup.exe" },
  linux: { arch: { url: RELEASES_URL + "/download/v" + version + "/WinDock-linux-x64.pkg.tar.zst" },
    debian: { url: RELEASES_URL + "/download/v" + version + "/WinDock-linux-amd64.deb" } } });
for (const [a,b,expected] of [["0.2.4-preview.1","0.2.4-preview.1",0], ["0.2.4-preview.10","0.2.4-preview.2",1],
  ["0.2.4","0.2.4-preview.99",1], ["0.2.5-preview.1","0.2.4",1], ["0.2.4-alpha","0.2.4-beta",-1],
  ["0.2.4-preview.1","0.2.4-preview.1.1",-1], ["0.2.4-preview.1","0.2.4-preview.a",-1]])
  t.equal(Math.sign(compareVersions(a,b)),expected,"semantic order: " + a + " vs " + b);
for (const bad of ["1.2.3\n","01.2.3","1.2","1.2.3-preview.01","1.2.3/evil",null])
  t.throws(() => compareVersions(bad,INSTALLED_VERSION),"reject invalid version");
for (const platform of ["windows","linux"]) {
  t.equal(parseUpdateManifest(manifest(),INSTALLED_VERSION,platform).status,"current",platform + " current");
  t.equal(parseUpdateManifest(manifest("0.3.0-preview.1"),INSTALLED_VERSION,platform).status,"available",platform + " newer");
  t.equal(parseUpdateManifest(manifest("0.3.0-preview.1"),INSTALLED_VERSION,platform).releasePage,"https://windock.vercel.app/#download",platform + " offers the website download section");
}
t.throws(() => parseUpdateManifest({...manifest(),available:false},INSTALLED_VERSION,"windows"),"unpublished feed rejected");
t.throws(() => parseUpdateManifest({...manifest(),windows:{url:"https://evil.example/a.exe"}},INSTALLED_VERSION,"windows"),"arbitrary executable URL rejected");
t.throws(() => parseUpdateManifest({...manifest(),linux:{}},INSTALLED_VERSION,"linux"),"missing Linux packages rejected");
let clock = 0, count = 0, requested;
const service = createUpdateService({ now:()=>clock, fetchImpl:async(url,options)=> {
  count++; requested={url,options}; return Response.json(manifest());
}});
t.equal(service.state().status,"unchecked","no network before manual check");
await Promise.all([service.check(),service.check(),service.check()]);
t.equal(count,1,"concurrent checks share one request");
t.equal(requested.url,MANIFEST_URL,"fixed HTTPS destination");
t.equal(requested.options.redirect,"error","redirects refused");
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
// Real HTTP boundaries: authentication, CSRF, no caller-supplied feed URL.
const app=await createApp({provider:{id:"windows",displayName:"Windows",listRunningApps:async()=>[]},configStore:{load:async()=>({tiles:[]})},trustLoopback:false,pin:"864213",updates:service});
await new Promise(r=>app.server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+app.server.address().port;
try {
 t.equal((await fetch(base+"/api/updates")).status,401,"metadata requires pairing");
 t.equal((await fetch(base+"/api/updates/check",{method:"POST"})).status,401,"check requires pairing");
 const auth=await fetch(base+"/api/auth",{method:"POST",body:JSON.stringify({pin:"864213"})});
 const cookie=auth.headers.get("set-cookie").split(";")[0];
 t.equal((await fetch(base+"/api/updates/check",{method:"POST",headers:{cookie,origin:"https://evil.example"},body:"{}"})).status,403,"cross-origin check blocked");
 t.equal((await fetch(base+"/api/updates/check",{method:"POST",headers:{cookie},body:JSON.stringify({url:"http://127.0.0.1/private"})})).status,400,"custom feed inputs refused");
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
answer={status:"available",installedVersion:INSTALLED_VERSION,latestVersion:"0.3.0-preview.1",releasePage:"https://evil.example"};
await get("updates-check").handlers.click();await flush();
t.equal(get("updates-download").hidden,false,"newer release reveals download action");
t.equal(get("updates-download").href,"https://windock.vercel.app/#download","UI opens official website despite response-provided URL");
fail=true;await get("updates-check").handlers.click();await flush();
t.equal(get("updates-download").hidden,true,"failed recheck clears stale download state");
t.ok(get("updates-status").textContent.includes("Couldn’t check"),"failure is visible");
t.equal(get("updates-check").disabled,false,"retry stays available");
fail=false;answer={status:"current",installedVersion:INSTALLED_VERSION};await get("updates-check").handlers.click();await flush();
t.equal(get("updates-status").textContent,updateStatusText(answer),"retry displays current result");
t.done("updates verification passed");
