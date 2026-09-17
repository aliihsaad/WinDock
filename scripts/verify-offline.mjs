/** G16: the PWA registers a service worker and serves an installable offline shell. */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { createApp } from "../server.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createConfigStore } from "../src/config.js";

const t = createChecker("offline");
const PUBLIC = join(import.meta.dirname, "..", "public");
const read = (f) => readFileSync(join(PUBLIC, f), "utf8");

// ---- the worker exists and is registered by the shell ----
t.ok(existsSync(join(PUBLIC, "sw.js")), "a service worker ships in public/");
const sw = read("sw.js");
const appJs = read("app.js");
t.ok(appJs.includes('navigator.serviceWorker.register("/sw.js")'), "the shell registers the worker");
t.ok(appJs.includes("serviceWorker" + '" in navigator') || appJs.includes('"serviceWorker" in navigator'),
  "registration is feature-detected");
t.ok(/\.catch\(/.test(appJs.slice(appJs.indexOf("serviceWorker.register"))),
  "a failed registration cannot break boot");

// ---- lifecycle ----
for (const event of ["install", "activate", "fetch"]) {
  t.ok(sw.includes(`addEventListener("${event}"`), `the worker handles ${event}`);
}
t.ok(sw.includes("skipWaiting"), "the worker activates promptly with skipWaiting");
t.ok(sw.includes("clients.claim"), "the worker claims open clients");
t.ok(sw.includes("caches.delete"), "the worker deletes superseded caches on activate");
t.ok(/const VERSION\s*=/.test(sw), "the cache is versioned so a redeploy invalidates it");

// ---- the precache list must match reality ----
const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\];/);
t.ok(shellMatch !== null, "the worker declares a SHELL precache list");
const shell = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
t.ok(shell.length >= 6, `the shell list is populated (${shell.length} entries)`);

// Every precached asset must exist on disk. A missing one makes cache.addAll
// reject and leaves the app with NO working offline shell at all.
for (const path of shell) {
  if (path === "/") continue;
  const file = join(PUBLIC, path.replace(/^\//, ""));
  t.ok(existsSync(file), `precached asset exists: ${path}`);
}

// Every module the shell actually imports must be precached, or the cached
// page would load and then fail on a missing import.
const imports = [...read("index.html").matchAll(/src="\/([^"]+\.js)"/g)].map((m) => `/${m[1]}`);
for (const src of imports) t.ok(shell.includes(src), `shell script is precached: ${src}`);
for (const mod of ["/dock.js", "/tiles.js", "/app.js", "/style.css"]) {
  t.ok(shell.includes(mod), `module is precached: ${mod}`);
}
t.ok(shell.includes("/manifest.webmanifest"), "the manifest is precached");

// ---- live state must never be cached ----
t.ok(sw.includes('url.pathname.startsWith("/api/")'), "API requests bypass the cache");
t.ok(/return;/.test(sw.slice(sw.indexOf('startsWith("/api/")'))), "API requests fall through to the network");
t.ok(sw.includes('request.method !== "GET"'), "non-GET requests are never cached");
t.ok(sw.includes("url.origin !== self.location.origin"), "cross-origin requests are not cached");
t.ok(!shell.some((p) => p.startsWith("/api")), "no API path is precached");

// ---- installability criteria ----
const manifest = JSON.parse(read("manifest.webmanifest"));
t.ok(["standalone", "fullscreen", "minimal-ui"].includes(manifest.display), "display mode is app-like");
t.ok(typeof manifest.start_url === "string" && manifest.start_url.length > 0, "a start_url is declared");
t.ok(manifest.icons.some((i) => i.sizes === "192x192"), "a 192px icon is declared");
t.ok(manifest.icons.some((i) => i.sizes === "512x512"), "a 512px icon is declared");
t.ok(
  manifest.icons.some((i) => String(i.purpose || "").includes("maskable")),
  "a maskable icon is declared for Android home screens",
);

// ---- the host actually serves it ----
const provider = createWindowsProvider({
  helperPath: "H.exe",
  exec: async (file, args) => {
    if (file === "H.exe") return { stdout: "" };
    const script = args[args.length - 1];
    if (script.includes("MainWindowHandle") || script.includes("WScript.Shell")) return { stdout: "[]" };
    return { stdout: "{}" };
  },
});
const dir = await mkdtemp(join(tmpdir(), "windock-offline-"));
const app = await createApp({
  provider,
  configStore: createConfigStore({ path: join(dir, "config.json") }),
  pin: "5555",
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;

const swRes = await fetch(`${base}/sw.js`);
t.equal(swRes.status, 200, "the host serves /sw.js");
t.ok(swRes.headers.get("content-type").includes("javascript"), "/sw.js is served as JavaScript");
await swRes.arrayBuffer();

// Every precached asset must be fetchable from the running host, not just
// present on disk — a 404 here would break the install.
for (const path of shell) {
  const res = await fetch(`${base}${path}`);
  t.equal(res.status, 200, `host serves precached asset: ${path}`);
  await res.arrayBuffer();
}

app.server.closeAllConnections?.();
await app.hub.close();
await new Promise((r) => app.server.close(r));
await rm(dir, { recursive: true, force: true });

t.done("offline verification passed");
