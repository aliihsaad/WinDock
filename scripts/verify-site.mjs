import { readFileSync } from "node:fs";
import { createChecker } from "./lib/assert.mjs";
import { usable, pick } from "../site/app.js";
const t = createChecker("site");
const A = (name) => ({ name, size: 5e6, browser_download_url: "https://github.com/yeshwanthkumardomala/WinDock/releases/download/x/" + name });
const releases = [
  { tag_name: "voicepack-v1", published_at: "2026-11-20T00:00:00Z", assets: [A("pack.zip")] },
  { tag_name: "old", published_at: "2026-11-01T00:00:00Z", assets: [A("WinDock-android-debug.apk")] },
  { tag_name: "upgrades-latest", name: "WinDock 0.4.20", published_at: "2026-11-19T00:00:00Z", assets: [A("WinDock-android-debug.apk"), A("WinDockSetup.exe")] },
  { tag_name: "draft", draft: true, published_at: "2026-11-25T00:00:00Z", assets: [A("x.apk")] },
];
const list = usable(releases);
t.deepEqual(list.map((r) => r.tag_name), ["upgrades-latest", "old"], "only app builds, newest first, no drafts");
t.equal(pick(list[0], ".apk").name, "WinDock-android-debug.apk", "finds the phone file");
t.equal(pick(list[0], ".exe").name, "WinDockSetup.exe", "finds the PC installer");
t.equal(pick(list[1], ".exe"), undefined, "missing installer is not invented");
t.equal(pick({ assets: [{ name: "a.apk", browser_download_url: "https://evil.com/a.apk" }] }, ".apk"), undefined, "links off GitHub are ignored");
t.deepEqual(usable(null), [], "bad data is safe");
const manifest = JSON.parse(readFileSync(new URL("../site/manifest.webmanifest", import.meta.url)));
t.ok(manifest.start_url === "./" && manifest.scope === "./" && manifest.icons.length === 2, "manifest uses relative paths for GitHub Pages");
t.done("site verification passed");
