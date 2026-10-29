import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createChecker } from "./lib/assert.mjs";
import { buildWebsiteDemo } from "./build-website-demo.mjs";

const t = createChecker("appearance");
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const source = read("public/appearance.js");
const performance = read("public/performance.js");
const modeKey = "windock-performance", layoutKey = "windock-layout";
function boot({ saved = {}, native, blocked = false, memoryOnly = false } = {}) {
  const data = new Map(Object.entries(saved)), classes = new Set();
  let accesses = 0;
  const window = { WinDockAndroid: native, matchMedia: () => ({ matches: false }) };
  const context = {
    window, URLSearchParams, location: { origin: "http://10.0.2.2:18622", search: "?perf=1" },
    document: { currentScript: { hasAttribute: () => memoryOnly }, documentElement: {
      classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    } },
    get localStorage() {
      accesses++;
      if (blocked) throw new Error("Storage denied");
      return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
    },
  };
  runInNewContext(source, context);
  runInNewContext(performance, context);
  return { prefs: window.WinDockPreferences, mode: window.WinDockPerformance, data, classes, get accesses() { return accesses; } };
}

const layout = JSON.stringify({ perPage: 8, showLabels: true, theme: "frost" });
const disk = { [modeKey]: "off", [layoutKey]: layout };
let imports, calls = 0;
const bridge = {
  getAppearance(origin, legacy) {
    t.equal(origin, "http://10.0.2.2:18622", "snapshot uses current origin");
    imports = JSON.parse(legacy); calls++;
    return JSON.stringify({ scope: "pc-a", values: disk });
  },
  saveAppearance(origin, scope, key, value) {
    t.equal(scope, "pc-a", "save uses the snapshot's PC identity");
    disk[key] = value; calls++; return true;
  },
};
const restored = boot({ saved: { [modeKey]: "on" }, native: bridge });
t.equal(imports[modeKey], "on", "legacy web preference is offered for migration");
t.equal(restored.mode.enabled, false, "native manual Off wins over stale web On and Auto hint before paint");
t.equal(restored.prefs.getItem(layoutKey), layout, "layout restored alongside mode");
t.equal(restored.data.get(modeKey), "off", "legacy web copy is repaired");
restored.mode.setPreference("on");
t.equal(disk[modeKey], "on", "UI mode changes persist through native bridge");
t.equal(boot({ native: bridge }).mode.preference, "on", "native restore needs no local web data");
const denied = boot({ native: bridge, blocked: true });
denied.mode.setPreference("off");
t.equal(disk[modeKey], "off", "native saving works when web storage is denied");
const browser = boot({ saved: { [modeKey]: "off", [layoutKey]: layout } });
browser.mode.setPreference("on");
t.equal(browser.data.get(modeKey), "on", "ordinary browsers retain local persistence");
t.equal(browser.prefs.getItem(layoutKey), layout, "ordinary browser layouts preserved");
const oldAndroid = boot({ saved: { [modeKey]: "off" }, native: { getAppVersion: () => "old" } });
t.equal(oldAndroid.mode.enabled, false, "older Android bridge retains local preference");
const failed = boot({ saved: { [modeKey]: "off" }, native: { getAppearance() { throw Error("Unavailable"); } } });
t.equal(failed.mode.enabled, false, "unavailable bridge falls back to web storage");
const switched = boot({ saved: { [modeKey]: "on", [layoutKey]: layout }, native: {
  getAppearance: () => JSON.stringify({ scope: "pc-b", values: {} }),
} });
t.equal(switched.mode.preference, "auto", "new PC uses defaults instead of previous PC's web values");
t.equal(switched.data.has(layoutKey), false, "reassigned origin no longer holds old PC layout");
const beforePreview = calls;
const demo = boot({ native: bridge, saved: { [modeKey]: "on" }, memoryOnly: true });
demo.prefs.setItem(layoutKey, layout); demo.mode.setPreference("on");
t.equal(demo.accesses, 0, "demo never touches browser storage");
t.equal(calls, beforePreview, "demo never touches native storage");
t.equal(demo.prefs.getItem(layoutKey), layout, "demo layout works in memory");
const unavailable = boot({ blocked: true });
unavailable.mode.setPreference("off");
t.equal(unavailable.mode.enabled, false, "no storage still supports session choices");
const beforeUnknown = calls;
restored.prefs.setItem("session-token", "not-an-appearance-value");
t.equal(calls, beforeUnknown, "unrelated keys never cross the bridge");

const html = read("public/index.html");
t.ok(html.indexOf('src="/appearance.js"') < html.indexOf('src="/performance.js"'), "appearance restores before performance first paint");
t.ok(read("public/sw.js").includes('"/appearance.js"'), "offline shell includes appearance adapter");
await buildWebsiteDemo();
t.ok(read("website/demo/index.html").includes('src="./appearance.js" data-memory-only'), "preview uses memory-only adapter");
t.equal(read("website/demo/appearance.js"), source, "preview uses shipping adapter");
t.done("appearance verification passed");
