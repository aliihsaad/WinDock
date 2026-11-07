/**
 * Backgrounds oracle.
 *
 * A scene lives in six places: the list, its art, a style rule, a picker button,
 * the Android save filter and the website copy. Any one missing breaks quietly
 * (a blank background, a choice that never saves), so they are checked together.
 */
import { readFileSync, statSync } from "node:fs";
import { createChecker } from "./lib/assert.mjs";
import { buildWebsiteDemo } from "./build-website-demo.mjs";
import { SCENES, showScene } from "../public/scenes.js";
import { normalizeLayout } from "../public/launcher.js";

const t = createChecker("scenes");
const path = (file) => new URL("../" + file, import.meta.url);
const read = (file) => readFileSync(path(file), "utf8");
const css = read("public/style.css");
const html = read("public/index.html");

// ---- The list ----
for (const id of ["aurora", "dusk", "ember", "midnight"]) t.ok(SCENES.includes(id), `${id} stays valid, since saved layouts use it`);
t.equal(new Set(SCENES).size, SCENES.length, "scene ids are unique");
t.ok(SCENES.every((id) => /^[a-z]+$/.test(id)), "scene ids are plain words, safe in paths and selectors");
for (const id of SCENES) t.equal(normalizeLayout({ background: id }).background, id, `layouts keep ${id}`);
t.equal(normalizeLayout({ background: "url(wallpapers/x.webp)" }).background, "aurora", "unknown backgrounds fall back to Aurora");

// ---- Art ----
/** Width and height of a lossy WebP, read from its VP8 frame header. */
function webpSize(file) {
  const bytes = readFileSync(path(file));
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 16) !== "WEBPVP8 ") return null;
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}
for (const id of SCENES) {
  const full = webpSize(`public/wallpapers/${id}.webp`);
  const thumb = webpSize(`public/wallpapers/${id}-thumb.webp`);
  t.ok(full && full[0] >= 2400 && full[0] / full[1] >= 2, `${id} art is a wide WebP that covers large phones (${full})`);
  t.ok(thumb && thumb[0] === 480, `${id} thumbnail is 480px wide, matching its img size (${thumb})`);
  t.ok(statSync(path(`public/wallpapers/${id}.webp`)).size <= 256 * 1024, `${id} art stays under 256 KB`);
  t.ok(statSync(path(`public/wallpapers/${id}-thumb.webp`)).size <= 32 * 1024, `${id} thumbnail stays under 32 KB`);
}
t.ok(statSync(path("public/wallpapers/grain.png")).size <= 8 * 1024, "the grain tile is tiny");

// ---- Style ----
for (const id of SCENES) {
  t.ok(css.includes(`:root[data-background="${id}"] { --scene-image: url("wallpapers/${id}.webp");`), `${id} has a style rule pointing at its art`);
}
t.ok(/^\s*--scene-image: none;/m.test(css), "no art loads before a scene is chosen");
t.ok(/\.wallpaper \{[^}]*background: var\(--scene-base\) var\(--scene-image\) center \/ cover no-repeat;/.test(css), "the art covers the screen over its base colour");
t.ok(/\.wallpaper::after \{[^}]*url\("wallpapers\/grain\.png"\)/.test(css), "grain sits over the art to stop banding");
t.ok(css.includes("html.perf .wallpaper::after { display: none; }"), "Performance mode drops the grain");
t.ok(!/html\.perf \.wallpaper \{/.test(css), "Performance mode keeps the art, which costs nothing per frame");

// ---- Picker ----
const buttons = [...html.matchAll(/<button type="button" data-background="([a-z]+)" aria-pressed="(true|false)"><img src="wallpapers\/([a-z]+)-thumb\.webp" alt="" width="480" height="224" loading="lazy" decoding="async"><span>([^<]+)<\/span><\/button>/g)];
t.deepEqual(buttons.map((match) => match[1]), SCENES, "the picker lists every scene, in order");
t.ok(buttons.every((match) => match[1] === match[3]), "each button shows its own thumbnail");
t.equal(buttons.filter((match) => match[2] === "true").length, 1, "exactly one scene starts selected");
t.ok(/\.scene-choices button[^{]*\{[^}]*\}/.test(css) && /\.scene-choices button\[aria-pressed="true"\]::after/.test(css), "the selected scene has a check, not only a colour");
t.ok(/\.scene-choices \{[^}]*grid-auto-columns: minmax\((\d+)px/.test(css) && Number(css.match(/\.scene-choices \{[^}]*grid-auto-columns: minmax\((\d+)px/)[1]) >= 44, "scenes stay large tap targets");
t.ok(/scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/.test(read("public/app.js")), "Settings brings the chosen scene into view");

// ---- Everywhere else a scene must be known ----
const android = read("android/app/src/main/java/com/windock/app/AppearancePreferences.kt");
const saved = android.match(/"background" -> layout\.getString\(field\) in listOf\(([^)]*)\)/)?.[1];
t.deepEqual(saved && [...saved.matchAll(/"([a-z]+)"/g)].map((match) => match[1]), SCENES, "the Android app saves every scene");
const sw = read("public/sw.js");
t.ok(sw.includes('"/scenes.js"'), "the offline shell includes the scene module");
t.ok(!sw.includes("/wallpapers/"), "the shell does not precache every scene; each is cached once shown");
t.ok(/"\.webp": "image\/webp"/.test(read("server.js")), "the host serves WebP with its type, since responses are nosniff");
t.ok(read("scripts/website-server.mjs").includes("'.webp': 'image/webp'"), "the website preview serves WebP");
await buildWebsiteDemo();
t.equal(read("website/demo/scenes.js"), read("public/scenes.js"), "the website demo uses the shipping scene module");
t.ok(SCENES.every((id) => statSync(path(`website/demo/wallpapers/${id}-thumb.webp`)).isFile()), "the website demo carries the art");

// ---- Switching ----
// A tiny stand-in for the page, enough to drive showScene's fade and its races.
function page({ perf = false, reduced = false } = {}) {
  const fades = [], images = [], timers = [];
  const wallpaper = { append: (node) => fades.push(node) };
  globalThis.document = {
    documentElement: { dataset: {}, classList: { contains: (name) => perf && name === "perf" } },
    getElementById: () => wallpaper,
    createElement: () => ({ style: {}, removed: false, remove() { this.removed = true; } }),
  };
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.getComputedStyle = () => ({ backgroundImage: `url("wallpapers/${document.documentElement.dataset.background}.webp")` });
  globalThis.Image = class {
    constructor() { images.push(this); this.ready = new Promise((resolve, reject) => { this.load = resolve; this.fail = reject; }); }
    decode() { return this.ready; }
  };
  globalThis.setTimeout = (callback) => timers.push(callback);
  return { root: document.documentElement, fades, images, flush: () => timers.splice(0).forEach((callback) => callback()) };
}
const realTimeout = globalThis.setTimeout;
const tick = () => new Promise((resolve) => setImmediate(resolve));

let view = page();
await showScene("aurora");
t.equal(view.root.dataset.background, "aurora", "the first scene applies at once");
t.equal(view.images.length, 0, "the first scene has nothing to fade from");
const change = showScene("silk");
await tick();
t.equal(view.root.dataset.background, "aurora", "the old scene stays until the new art can paint");
t.equal(view.images[0]?.src, "wallpapers/silk.webp", "the new art is decoded first");
view.images[0].load();
await change;
t.equal(view.root.dataset.background, "silk", "the new scene applies once decoded");
t.equal(view.fades.length, 1, "one fade layer covers the switch");
t.ok(view.fades[0].style.backgroundImage.includes("aurora.webp"), "the fade shows the old scene");
view.flush();
t.ok(view.fades[0].removed, "the fade layer is removed afterwards");

const toPrism = showScene("prism");
const back = showScene("silk");
view.images.at(-1).load();
await Promise.all([toPrism, back]);
t.equal(view.root.dataset.background, "silk", "changing back before the art loads keeps the current scene");
t.equal(view.fades.length, 1, "a cancelled change leaves no fade behind");

const missing = showScene("dusk");
view.images.at(-1).fail(new Error("not found"));
await missing;
t.equal(view.root.dataset.background, "dusk", "art that fails to load still changes the colours");

for (const [name, options] of [["Performance mode", { perf: true }], ["Reduced motion", { reduced: true }]]) {
  view = page(options);
  await showScene("aurora");
  await showScene("ember");
  t.ok(view.root.dataset.background === "ember" && view.images.length === 0 && view.fades.length === 0, `${name} switches instantly, with no fade`);
}
globalThis.setTimeout = realTimeout;

t.done("scenes verification passed");
