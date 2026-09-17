/** G11: the PWA ships a valid manifest and its dock logic renders headlessly. */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { renderTiles, renderTile, renderNowPlaying, escapeHtml, glyphFor } from "../public/dock.js";

const t = createChecker("pwa");
const PUBLIC = join(import.meta.dirname, "..", "public");
const read = (f) => readFileSync(join(PUBLIC, f), "utf8");

// ---- manifest ----
const manifest = JSON.parse(read("manifest.webmanifest"));
t.equal(manifest.name, "WinDock", "manifest declares the app name");
t.ok(typeof manifest.short_name === "string" && manifest.short_name.length <= 12, "short_name is set and short");
t.equal(manifest.start_url, "/", "manifest declares a start_url");
t.equal(manifest.display, "standalone", "manifest requests standalone display");
t.ok(/^#[0-9a-f]{6}$/i.test(manifest.theme_color), "theme_color is a hex colour");
t.ok(/^#[0-9a-f]{6}$/i.test(manifest.background_color), "background_color is a hex colour");
t.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest declares at least two icons");

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
for (const icon of manifest.icons) {
  const rel = icon.src.replace(/^\//, "");
  const full = join(PUBLIC, rel);
  t.ok(existsSync(full), `declared icon exists on disk: ${icon.src}`);
  if (!existsSync(full)) continue;
  const bytes = readFileSync(full);
  t.ok(bytes.subarray(0, 8).equals(PNG_SIG), `${icon.src} is a real PNG`);
  const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  const [dw, dh] = icon.sizes.split("x").map(Number);
  t.equal(w, dw, `${icon.src} width matches its declared size`);
  t.equal(h, dh, `${icon.src} height matches its declared size`);
  t.ok(statSync(full).size > 0, `${icon.src} is not empty`);
}

// ---- shell wiring ----
const html = read("index.html");
for (const id of ["pair", "app", "dock", "pin", "picker", "nowplaying", "conn"]) {
  t.ok(html.includes(`id="${id}"`), `the shell defines #${id}`);
}
t.ok(html.includes('rel="manifest"'), "the shell links its manifest");
t.ok(html.includes('type="module" src="/app.js"'), "the shell loads app.js as a module");
t.ok(html.includes('name="viewport"'), "the shell declares a viewport for phones");

const appJs = read("app.js");
const ids = [...appJs.matchAll(/\$\("([a-z-]+)"\)/g)].map((m) => m[1]);
t.ok(ids.length > 0, "app.js references DOM ids");
for (const id of new Set(ids)) {
  t.ok(html.includes(`id="${id}"`), `app.js id #${id} exists in the shell`);
}
t.ok(appJs.includes('credentials: "same-origin"'), "api calls send the session cookie");

const css = read("style.css");
t.ok(css.includes("grid-template-columns"), "the dock uses a responsive grid");
t.ok(css.includes("100dvh"), "layout uses dynamic viewport height for mobile browsers");
t.ok(css.includes("safe-area-inset"), "layout respects device safe areas");

// ---- headless rendering ----
const empty = renderTiles({ tiles: [] });
t.ok(empty.includes("No tiles pinned"), "an empty dock renders its empty state");
t.deepEqual(renderTiles({}), empty, "a missing tiles array renders the empty state");
t.deepEqual(renderTiles({ tiles: "nope" }), empty, "a malformed tiles value renders the empty state");

const html2 = renderTiles({
  tiles: [
    { kind: "app", id: "c:/a.exe", label: "Alpha", running: true },
    { kind: "app", id: "c:/b.exe", label: "Beta", running: false },
    { kind: "control", verb: "mute-toggle", label: "Mute" },
  ],
});
t.equal((html2.match(/<button/g) || []).length, 3, "every tile renders one button");
t.ok(html2.includes('data-action="launch"'), "app tiles carry the launch action");
t.ok(html2.includes('data-action="control"'), "control tiles carry the control action");
t.ok(html2.includes('data-key="mute-toggle"'), "control tiles carry their verb as the key");
t.ok(html2.includes('data-key="c:/a.exe"'), "app tiles carry their id as the key");
t.equal((html2.match(/is-running/g) || []).length, 1, "only the running app is marked running");
t.equal((html2.match(/aria-pressed="true"/g) || []).length, 1, "the running tile is exposed to assistive tech");
t.ok(html2.includes('aria-label="Alpha"'), "tiles carry an accessible label");

// ---- escaping (the dock renders host-controlled app names) ----
const XSS = '<img src=x onerror="alert(1)">';
t.equal(
  escapeHtml(XSS),
  "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  "escapeHtml neutralises angle brackets and quotes",
);
const hostile = renderTile({ kind: "app", id: XSS, label: XSS, running: false });
t.ok(!hostile.includes("<img"), "a hostile app name cannot inject an element");
t.ok(!hostile.includes('onerror="'), "a hostile app name cannot inject an event handler");
t.ok(hostile.includes("&lt;img"), "the hostile name is present but escaped");
// Positive control: the escaper must be doing work, not returning a constant.
t.equal(escapeHtml("plain"), "plain", "positive control: safe text passes through unchanged");
t.ok(escapeHtml("a&b") === "a&amp;b", "positive control: ampersands are escaped");

t.equal(glyphFor({ kind: "control", verb: "lock" }), "🔒", "control tiles get their verb glyph");
t.equal(glyphFor({ kind: "app", label: "firefox" }), "F", "app tiles fall back to an initial");
t.equal(glyphFor({ kind: "app", label: "" }), "?", "an unnamed app still gets a glyph");

t.equal(renderNowPlaying(null), "", "no now-playing renders nothing");
t.equal(renderNowPlaying({ title: "" }), "", "an empty title renders nothing");
const np = renderNowPlaying({ title: XSS, artist: "A", playing: true });
t.ok(!np.includes("<img"), "now playing escapes a hostile title");
t.ok(np.includes("&lt;img"), "the hostile title is escaped rather than dropped");

t.done("pwa verification passed");
