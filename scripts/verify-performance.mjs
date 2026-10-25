import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createChecker } from "./lib/assert.mjs";
import { buildWebsiteDemo } from "./build-website-demo.mjs";

const t = createChecker("performance");
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const source = read("public/performance.js");
function boot({ search = "", saved, blocked = false, memoryOnly = false, reducedMotion = false } = {}) {
  const values = new Map(saved === undefined ? [] : [["windock-performance", saved]]);
  const classes = new Set();
  let reads = 0, writes = 0;
  const window = { matchMedia: () => ({ matches: reducedMotion }) };
  const context = {
    window, URLSearchParams, location: { search },
    document: {
      currentScript: { hasAttribute: () => memoryOnly },
      documentElement: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
    },
    get localStorage() {
      if (blocked) throw new Error("Storage denied");
      return { getItem: (key) => { reads++; return values.get(key); }, setItem: (key, value) => { writes++; values.set(key, value); } };
    },
  };
  runInNewContext(source, context);
  return { mode: window.WinDockPerformance, classes, values, get reads() { return reads; }, get writes() { return writes; } };
}

for (const hint of ["", "?perf=0", "?perf=false", "?perf", "?perf=1"]) {
  for (const saved of [undefined, "auto", "on", "off", "broken"]) {
    const app = boot({ search: hint, saved });
    const expected = saved === "on" || (saved !== "off" && hint === "?perf=1");
    t.equal(app.mode.enabled, expected, `saved=${saved}, hint=${hint}: explicit choice wins`);
    t.equal(app.classes.has("perf"), expected, "class is ready before the app or DOM body exists");
    t.equal(app.mode.scrollBehavior(), expected ? "instant" : "smooth", "page movement matches effective mode");
    t.equal(app.mode.scrollBehavior(false), "instant", "layout changes never animate");
  }
}
const selected = boot({ search: "?perf=1" });
selected.mode.setPreference("off");
t.equal(selected.classes.has("perf"), false, "turning off restores normal rendering immediately");
t.equal(boot({ search: "?perf=1", saved: selected.values.get("windock-performance") }).mode.enabled, false, "off survives reload on a low-RAM device");
selected.mode.setPreference("auto");
t.equal(selected.mode.enabled, true, "returning to Auto follows the device again");
const noStorage = boot({ blocked: true, search: "?perf=1" });
noStorage.mode.setPreference("off");
t.equal(noStorage.mode.enabled, false, "storage denial never prevents a session override");
t.equal(boot({ blocked: true }).mode.enabled, false, "storage denial never breaks ordinary startup");
const preview = boot({ saved: "on", memoryOnly: true });
t.equal(preview.mode.enabled, false, "preview does not inherit a real device preference");
preview.mode.setPreference("on");
t.equal(preview.mode.enabled, true, "preview can demonstrate the mode");
t.equal(preview.reads + preview.writes, 0, "preview never accesses persistent storage");
const accessible = boot({ reducedMotion: true, saved: "off" });
t.equal(accessible.mode.enabled, false, "reduced motion does not force performance rendering");
t.equal(accessible.mode.scrollBehavior(), "instant", "explicit smooth paging respects reduced motion too");

const html = read("public/index.html");
t.ok(html.indexOf('src="/performance.js"') < html.indexOf('href="/style.css"'), "bootstrap runs before the stylesheet");
t.ok(!html.match(/<script[^>]*(async|defer|type="module")[^>]*src="\/performance.js"/), "bootstrap cannot be deferred past first paint");
t.ok(read("public/sw.js").includes('"/performance.js"'), "offline shell includes the bootstrap");
await buildWebsiteDemo();
t.ok(read("website/demo/index.html").includes('src="./performance.js" data-memory-only'), "demo wires the same bootstrap without persistence");
t.equal(read("website/demo/performance.js"), source, "demo uses the shipping performance policy");
t.done("performance verification passed");
