import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { bezelFor, canBend, drawLens } from "../public/glass.js";
import { menuPosition, nextIndex } from "../public/glass-select.js";

const t = createChecker("glass");
const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const css = read("public/style.css");
const glass = read("public/glass.js");
const app = read("public/app.js");

// Only engines that really draw backdrop-filter: url() may get a lens.
const agents = {
  bends: {
    "Android WebView": "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
    "Android Chrome": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    "Windows Edge": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  },
  blurs: {
    "iPhone Safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "iPhone app": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Chrome on iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
    "Mac Safari": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    "Firefox": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
  },
};
for (const [name, agent] of Object.entries(agents.bends)) t.ok(canBend(agent), `${name} gets a lens`);
for (const [name, agent] of Object.entries(agents.blurs)) t.ok(!canBend(agent), `${name} keeps its blur`);

// The lens: what each pixel samples, read the way feDisplacementMap reads it.
const width = 120, height = 80, radius = 24, bezel = bezelFor(radius), scale = bezel * 1.7;
const { map, mask } = drawLens(width, height, radius, bezel);
const pixel = (x, y) => (y * width + x) * 4;
const red = (x, y) => map[pixel(x, y)], green = (x, y) => map[pixel(x, y) + 1], alpha = (x, y) => mask[pixel(x, y) + 3];
const middleX = width / 2, middleY = height / 2;
t.ok(bezelFor(29) === 29 && bezelFor(90) === 34 && bezelFor(4) === 10, "the bezel follows the corner and stays bounded");
t.ok(red(middleX, middleY) === 128 && green(middleX, middleY) === 128, "the centre of the glass bends nothing");
t.ok(alpha(middleX, middleY) === 0, "the centre shows frost, not the sharp rim layer");
t.ok(alpha(middleX, 0) > 240 && alpha(0, middleY) > 240, "the very edge shows the sharp rim layer");
t.ok(red(0, middleY) > 228 && Math.abs(green(0, middleY) - 128) < 2, "the left edge samples inward, to the right");
t.ok(red(width - 1, middleY) < 28 && Math.abs(green(width - 1, middleY) - 128) < 2, "the right edge samples inward, to the left");
t.ok(green(middleX, 0) > 228 && Math.abs(red(middleX, 0) - 128) < 2, "the top edge samples inward, downward");
t.ok(green(middleX, height - 1) < 28 && Math.abs(red(middleX, height - 1) - 128) < 2, "the bottom edge samples inward, upward");
t.ok(red(10, 10) > 128 && green(10, 10) > 128, "a corner samples diagonally inward");
t.ok(red(0, 0) === 128 && green(0, 0) === 128, "pixels beyond the rounded corner stay neutral");

// Pixels past a rounded corner are clipped away, so only visible steps count.
const visible = (x, y) => {
  const qx = Math.abs(x + .5 - width / 2) - (width / 2 - radius), qy = Math.abs(y + .5 - height / 2) - (height / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= radius;
};
let opaque = true, inside = true, sharpestStep = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    opaque &&= map[pixel(x, y) + 3] === 255;
    const sampleX = x + .5 + scale * (red(x, y) / 255 - .5), sampleY = y + .5 + scale * (green(x, y) / 255 - .5);
    inside &&= sampleX >= 0 && sampleX <= width && sampleY >= 0 && sampleY <= height;
    if (x && visible(x, y) && visible(x - 1, y)) sharpestStep = Math.max(sharpestStep, Math.abs(red(x, y) - red(x - 1, y)));
  }
}
t.ok(opaque, "the map stays opaque, so canvas premultiplying cannot change its values");
t.ok(inside, "no pixel samples outside the element, which backdrop-filter could not provide");
t.ok(sharpestStep < 24, "displacement fades smoothly, with no visible step inside the rim");
t.ok(/"color-interpolation-filters": "sRGB"/.test(glass), "the filter stays in sRGB, or neutral grey would become a shift");
t.ok(/scale: bezel \* 1\.7/.test(glass), "the tested displacement scale is the one the filter uses");
t.ok(/lenses\.get\(element\)\?\.filter\.remove\(\);/.test(glass), "a surface drops its old filter, so resizing cannot pile images up");

// Dropdown keyboard use and placement on short landscape screens.
t.equal(nextIndex("ArrowDown", 0, 3), 1, "down moves to the next option");
t.equal(nextIndex("ArrowDown", 2, 3), 2, "down stops at the last option");
t.equal(nextIndex("ArrowUp", 0, 3), 0, "up stops at the first option");
t.equal(nextIndex("Home", 2, 3), 0, "home reaches the first option");
t.equal(nextIndex("End", 0, 3), 2, "end reaches the last option");
t.equal(nextIndex("a", 1, 3), null, "other keys leave the highlight alone");
const phone = { width: 844, height: 390 }, menu = { width: 164, height: 150 };
const anchor = (top, right = 700) => ({ top, bottom: top + 40, right });
t.equal(menuPosition(anchor(40), menu, phone).top, 88, "the menu opens below its trigger when it fits");
t.equal(menuPosition(anchor(300), menu, phone).top, 142, "the menu flips above when the screen ends");
t.equal(menuPosition(anchor(150), { width: 164, height: 380 }, phone).top, 8, "a menu taller than either side stays on screen");
t.equal(menuPosition(anchor(40), menu, phone).left, 536, "the menu lines up with the trigger's right edge");
t.equal(menuPosition(anchor(40, 100), menu, phone).left, 8, "the menu never leaves the left of the screen");
t.equal(menuPosition(anchor(40, 840), { width: 164, height: 150 }, phone).left, 672, "the menu never leaves the right of the screen");

// Wiring that a browser would only reveal on a real device.
t.ok(/const syncSelects = enhanceSelects\(\);\nstartGlass\(\);/.test(app), "the app starts glass before its first paint of settings");
t.ok(/function syncPerformance\(\) \{[\s\S]*?syncSelects\(\);[\s\S]*?\n\}/.test(app), "pickers repaint after code assigns a select's value");
t.ok(read("public/glass-select.js").includes("select.hidden = true;"), "the native select is removed from view, so no state can reveal it");
for (const file of ["glass.js", "glass-select.js"]) {
  t.ok(read("public/sw.js").includes(`"/${file}"`), `the offline shell precaches ${file}`);
  t.ok(read("scripts/build-website-demo.mjs").includes(`'${file}'`), `the website demo copies ${file}`);
}
const dataImages = /img-src 'self' data:/;
t.ok(dataImages.test(read("server.js")) && dataImages.test(read("scripts/build-website-demo.mjs")), "the content policy allows the lens's generated images");

// Costs that must stay switched off where they were deliberately removed.
const lensRule = css.match(/:root\[data-bend\]:not\(\.perf\) :is\(([^)]*)\) \{ backdrop-filter: var\(--lens/);
t.ok(lensRule, "Performance mode excludes the lens");
t.ok(/const SURFACES = "\.glass-drawer, \.sheet, \.options, \.confirm, \.glass-menu";/.test(glass), "only floating surfaces are fitted with a lens");
for (const surface of [".pc-clipboard__panel", ".pointer-options", ".mouse-buttons", ".tile__glyph"]) {
  t.ok(!(lensRule?.[1] ?? "").includes(surface) && !glass.match(/const SURFACES = .*/)[0].includes(surface), `${surface} never gets a lens`);
}
t.ok(/html\.perf &::before, html\.perf &::after \{ display: none; \}/.test(css), "Performance mode removes the rim and reflection");
t.ok(/html\.perf body :is\([^)]*\.glass-menu/.test(css), "Performance mode gives dropdown menus a solid surface");
t.ok(/surface\.style\.setProperty\("--light-x"/.test(glass) && !/root\.style\.setProperty\("--light-x"/.test(glass), "the light is set per surface, so touchpad moves restyle nothing");
t.ok(css.includes("-webkit-mask-composite: xor") && css.includes("content-box exclude"), "the rim keeps both mask forms for WebKit and Chromium");
t.ok(/\.glass-drawer::backdrop \{ background: #050b1721; backdrop-filter: blur\(4px\)/.test(css), "engines without a lens keep the blur behind dialogs");

// Text has to stay readable over bright icons, so sheets frost more than small glass.
const themes = { clear: /:root \{[^}]*--glass-bg[^}]*\}/, frosted: /:root\[data-theme="frost"\] \{[^}]*\}/, smoked: /:root\[data-theme="smoke"\] \{[^}]*\}/ };
for (const [theme, rule] of Object.entries(themes)) {
  const tokens = css.match(rule)?.[0] ?? "";
  const small = Number(tokens.match(/--glass-lens-blur: (\d+)/)?.[1]), sheet = Number(tokens.match(/--glass-sheet-blur: (\d+)/)?.[1]);
  t.ok(sheet > small, `${theme} sheets frost more than small glass (${sheet} over ${small})`);
}
t.ok(css.includes(".sheet { --glass-lens-blur: var(--glass-sheet-blur); }") && /const style = getComputedStyle\(element\);[\s\S]*?style\.getPropertyValue\("--glass-lens-blur"\)/.test(glass), "each surface reads its own frost");

t.ok(/\.glass-menu \{[^}]*border: 0;/.test(css), "menus drop the browser's popover border, or the rim sits inset from the edge");
t.ok(/\.input-pad \.glass-menu \{ background: #[0-9a-f]{8}; \}/.test(css), "the signature menu stays dark over the bright paper");

// The notch: its rim is a separate image, so nothing but this keeps the two outlines together.
const clip = css.match(/clip-path: path\("([^"]+)Z"\)/)?.[1];
const rim = css.match(/%3Cpath d='([^']+)'/)?.[1];
t.ok(clip && clip === rim, "the notch's rim traces exactly the outline it is clipped to");
t.ok(/\.quick-controls-trigger \{[^}]*height: 44px/.test(css), "the notch keeps its 44px touch area");
t.ok(/html\.perf \.controls-island \{[^}]*backdrop-filter: none/.test(css), "Performance mode gives the notch a solid surface");

t.done("glass verification passed");
