/** Top-bar glance at the PC (battery, CPU, Wi-Fi, GPU) and the render watcher that rides on the same poll. */
const KEY = "tara-statusbar";
export function statusBarEnabled(storage = globalThis.localStorage) { try { return storage?.getItem(KEY) !== "0"; } catch { return true; } }
export function setStatusBar(on, storage = globalThis.localStorage) { try { storage?.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ } }

const pct = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null);
/** Turns a raw /api/stats reply into the chips to draw. Missing readings are simply left out. */
export function statChips(stats = {}) {
  const chips = [];
  const battery = pct(stats.battery);
  if (battery !== null) chips.push({ key: "battery", text: (stats.charging ? "⚡ " : "") + battery + "%", level: stats.charging ? "ok" : battery <= 15 ? "bad" : battery <= 30 ? "warn" : "ok", label: "PC battery " + battery + "%" + (stats.charging ? ", charging" : "") });
  const cpu = pct(stats.cpu);
  if (cpu !== null) chips.push({ key: "cpu", text: "CPU " + cpu + "%", level: cpu >= 90 ? "bad" : cpu >= 70 ? "warn" : "ok", label: "PC processor use " + cpu + "%" });
  const gpu = pct(stats.gpu?.util);
  if (gpu !== null) chips.push({ key: "gpu", text: "GPU " + gpu + "%", level: gpu >= 95 ? "bad" : gpu >= 80 ? "warn" : "ok", label: "PC graphics use " + gpu + "%" });
  const wifi = pct(stats.wifi);
  if (wifi !== null) { const bars = wifi >= 75 ? 4 : wifi >= 50 ? 3 : wifi >= 25 ? 2 : 1; chips.push({ key: "wifi", text: "Wi-Fi " + "▂▄▆█".slice(0, bars), level: bars <= 1 ? "warn" : "ok", label: "PC Wi-Fi signal " + wifi + "%" }); }
  return chips;
}

export function watchText(watch = {}) {
  const what = { notify: "tell this phone", sleep: "put the PC to sleep", shutdown: "shut the PC down" }[watch.action] || "";
  switch (watch.phase) {
    case "waiting": return "Waiting for the PC to start working, then I’ll " + what + " when it finishes.";
    case "busy": return "Rendering… I’ll " + what + " once the PC has been quiet for a minute.";
    case "done": return watch.error || "Finished. " + (watch.action === "notify" ? "Your render is done." : "The PC was asked to " + (watch.action === "sleep" ? "sleep." : "shut down."));
    case "expired": return "Nothing started in ten minutes, so the watcher turned itself off.";
    default: return "Off. Start a render, then choose what should happen when it ends.";
  }
}

export function createStatusBar({ gate = () => true, api, get = (id) => document.getElementById(id), isReady, notify, buzz = () => {}, storage, intervalMs = 8000, setTimer = setInterval, clearTimer = clearInterval }) {
  let timer = null, last = { phase: "off" }, busy = false;
  const strip = get("status-strip");
  const enabled = () => statusBarEnabled(storage);
  function paint(stats) {
    strip.hidden = !enabled();
    strip.textContent = "";
    for (const chip of statChips(stats)) {
      const el = document.createElement("span");
      el.className = "stat-chip"; el.dataset.level = chip.level; el.dataset.stat = chip.key; el.textContent = chip.text; el.title = chip.label;
      strip.append(el);
    }
    if (last.phase !== "off") { const el = document.createElement("span"); el.className = "stat-chip"; el.dataset.level = last.phase === "done" ? "ok" : "warn"; el.textContent = last.phase === "busy" ? "Rendering" : last.phase === "waiting" ? "Watching" : last.phase === "done" ? "Done" : ""; if (el.textContent) strip.append(el); }
    get("bench-watch-status")?.replaceChildren(watchText(last));
    for (const b of document.querySelectorAll("[data-watch]")) b.setAttribute("aria-pressed", String((last.phase !== "off" && last.phase !== "expired" ? last.action : "off") === b.dataset.watch));
  }
  async function poll() {
    if (!gate()) return;
    if (busy || !isReady() || !enabled()) { if (!enabled()) strip.hidden = true; return; }
    busy = true;
    try {
      const [stats, watch] = await Promise.all([api("/api/stats").catch(() => ({})), api("/api/render-watch").catch(() => last)]);
      if (watch.phase === "done" && last.phase !== "done") {
        buzz([60, 80, 60, 80, 200]);
        notify(watch.error ? watch.error : watch.action === "notify" ? "Your render is finished." : "Render finished — PC asked to " + watch.action + ".", Boolean(watch.error));
      }
      last = watch; paint(stats);
    } finally { busy = false; }
  }
  return {
    start() { if (timer === null) { timer = setTimer(poll, intervalMs); poll(); } },
    stop() { if (timer !== null) clearTimer(timer); timer = null; strip.hidden = true; },
    refresh: poll,
    async arm(action) { last = await api("/api/render-watch", { method: "POST", body: JSON.stringify({ action }) }); paint({}); poll(); },
    enabled, setEnabled(on) { setStatusBar(on, storage); on ? poll() : (strip.hidden = true); },
    state: () => last,
  };
}
