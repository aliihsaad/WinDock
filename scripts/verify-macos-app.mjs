/** macOS menu bar app: bundle contract, build script, and the built app's smoke run when present. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createChecker } from "./lib/assert.mjs";

const t = createChecker("macos-app");
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(join(root, path), "utf8");

// ---- the bundle describes itself correctly ----
const plist = await read("native/macos-app/Info.plist");
t.ok(/<key>LSUIElement<\/key>\s*<true\/>/.test(plist), "the app is a menu bar extra, not a Dock app");
t.ok(plist.includes("dev.ali-saad.windock.macos"), "the bundle id lives under the project's identifier");
t.ok(plist.includes("NSAppleEventsUsageDescription"), "the Automation prompt has a reason, or macOS would silently refuse System Events");
t.equal((plist.match(/__VERSION__/g) || []).length, 2, "the build stamps the package version into both version keys");
t.ok(plist.includes("<key>LSMinimumSystemVersion</key><string>13.0</string>"), "login items need macOS 13 (SMAppService)");

const pkg = JSON.parse(await read("package.json"));
t.equal(pkg.scripts["build:macos-app"], "sh scripts/build-macos-app.sh", "build:macos-app builds the bundle");
t.equal(pkg.scripts["install:macos-app"], "sh scripts/install-macos-app.sh", "install:macos-app copies it to ~/Applications");
const build = await read("scripts/build-macos-app.sh");
t.ok(build.includes("swiftc") && build.includes("native/macos-app/*.swift"), "the build compiles the app sources");
t.ok(build.includes("host-root"), "the bundle records where server.js lives");
t.ok(build.includes("codesign --force --sign -"), "the bundle is ad hoc signed so permission grants survive rebuilds");
t.ok(build.includes("iconutil"), "the bundle gets an icon");

// ---- the sources keep the Windows tray's behaviour ----
const delegate = await read("native/macos-app/AppDelegate.swift");
const host = await read("native/macos-app/Host.swift");
for (const title of ["Show connection info", "Copy URL", "Open saved files", "Start at login", "Quit WinDock"]) {
  t.ok(delegate.includes(`"${title}"`), `menu offers ${title}`);
}
t.ok(delegate.includes("SMAppService.mainApp"), "start at login uses the system login item API");
t.ok(delegate.includes("TRAY OK: server started, URL and PIN received"), "smoke mode prints the same marker as the Windows tray");
t.ok(host.includes("/api/capture/stop") && host.includes("stopRecording()"), "quitting finalizes a recording before the host stops");
t.ok(/open:\\s\*\(http:\/\/\\S\+\)/.test(host) && /PIN:\\s\*\(\\d\{4\}\)/.test(host), "the banner is parsed like the Windows tray does");
t.ok(host.includes(".filter { $0.1 >= 20 }"), "only Node 20 or newer is accepted");
t.ok(!/\bsh -c\b|\/bin\/sh"/.test(host), "no shell runs the host");

// ---- the built app, when present: a real smoke run on a spare port ----
const app = join(root, "artifacts", "WinDock.app", "Contents", "MacOS", "WinDock");
if (process.platform === "darwin" && existsSync(app)) {
  const run = spawnSync(app, ["--smoke"], { encoding: "utf8", timeout: 40_000, env: { ...process.env, PORT: "18620" } });
  t.equal(run.status, 0, `smoke run exits cleanly ${run.stderr.trim()}`);
  t.ok(run.stdout.includes("TRAY OK: server started, URL and PIN received"), "the app started the host and read its address and PIN");
  t.ok(/^node: \/.*\/node$/m.test(run.stdout), "the app found a Node binary");
  t.ok(/^login item: (enabled|not enabled)$/m.test(run.stdout), "the app can read the login item state");
  const stale = spawnSync("pgrep", ["-f", "server.js"], { encoding: "utf8" });
  t.ok(!stale.stdout.split("\n").some((line) => line.includes("18620")), "the smoke host does not outlive the app");
} else {
  process.stdout.write(`menu bar app not built (${app}); run npm run build:macos-app to test it here\n`);
}

t.done("macos-app verification passed");
