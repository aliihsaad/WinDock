/**
 * PWA shell. All rendering and list logic delegate to the pure modules in
 * dock.js and tiles.js; this file owns only network, DOM wiring and the socket.
 */

import { renderTiles, renderNowPlaying, renderControlPicker, escapeHtml } from "./dock.js";
import {
  addAppTile,
  addControlTile,
  removeTile,
  moveTile,
  toWireTiles,
  availableControls,
} from "./tiles.js";

const $ = (id) => document.getElementById(id);
let state = { tiles: [], running: [], verbs: [] };
let editing = false;
let socket = null;
let installedApps = [];

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : {},
    ...options,
  });
  if (res.status === 401) {
    showPair();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

function showPair(message = "") {
  $("pair").hidden = false;
  $("app").hidden = true;
  $("pair-error").textContent = message;
}

function showApp() {
  $("pair").hidden = true;
  $("app").hidden = false;
}

function paint() {
  $("dock").innerHTML = renderTiles(state, { editing });
  $("host-name").textContent = state.platformName || "WinDock";
  $("edit").setAttribute("aria-pressed", String(editing));
  $("edit").textContent = editing ? "Done" : "Edit";
}

function setConn(on) {
  const el = $("conn");
  el.dataset.state = on ? "on" : "off";
  el.textContent = on ? "live" : "offline";
}

/**
 * Persist a new tile list, repainting optimistically and rolling back if the
 * host rejects it. The pure helpers never mutate, so the previous list is
 * always intact to restore.
 */
async function commitTiles(tiles) {
  const previous = state.tiles;
  state = { ...state, tiles };
  paint();
  try {
    await api("/api/tiles", { method: "PUT", body: JSON.stringify({ tiles: toWireTiles(tiles) }) });
  } catch (err) {
    state = { ...state, tiles: previous };
    paint();
    throw err;
  }
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${scheme}//${location.host}`);
  socket.addEventListener("open", () => setConn(true));
  socket.addEventListener("close", () => {
    setConn(false);
    setTimeout(connect, 2000);
  });
  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== "snapshot") return;
      // A broadcast must not yank the list out from under an active edit.
      if (editing) {
        state = { ...msg, tiles: state.tiles };
        return;
      }
      state = msg;
      paint();
    } catch {
      /* ignore malformed frame */
    }
  });
}

async function refresh() {
  state = await api("/api/state");
  paint();
  const { nowPlaying } = await api("/api/nowplaying").catch(() => ({ nowPlaying: null }));
  $("nowplaying").innerHTML = renderNowPlaying(nowPlaying);
}

async function onDockClick(event) {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const { action, key } = btn.dataset;

  if (action === "remove") return commitTiles(removeTile(state.tiles, key)).catch(console.warn);
  if (action === "move-up") return commitTiles(moveTile(state.tiles, key, -1)).catch(console.warn);
  if (action === "move-down") return commitTiles(moveTile(state.tiles, key, 1)).catch(console.warn);

  btn.disabled = true;
  try {
    if (action === "control") {
      const raw = btn.dataset.value;
      const payload = raw === undefined ? { verb: key } : { verb: key, value: Number(raw) };
      await api("/api/control", { method: "POST", body: JSON.stringify(payload) });
    } else if (action === "launch") {
      const running = (state.running || []).find((r) => r.id === key);
      if (running) {
        await api("/api/apps/focus", { method: "POST", body: JSON.stringify({ pid: running.pid }) });
      } else {
        await api("/api/apps/launch", { method: "POST", body: JSON.stringify({ id: key }) });
      }
    }
  } catch (err) {
    console.warn(err);
  } finally {
    btn.disabled = false;
  }
}

// ---- picker ----

function drawApps(term = "") {
  const needle = term.trim().toLowerCase();
  $("picker-list").innerHTML = installedApps
    .filter((a) => !needle || a.name.toLowerCase().includes(needle))
    .slice(0, 300)
    .map(
      (a) => `<li><button type="button" data-id="${escapeHtml(a.id)}">${escapeHtml(a.name)}</button></li>`,
    )
    .join("");
}

function drawControls() {
  $("control-list").innerHTML = renderControlPicker(availableControls(state.verbs, state.tiles));
}

function selectTab(which) {
  const apps = which === "apps";
  $("tab-apps").classList.toggle("is-active", apps);
  $("tab-controls").classList.toggle("is-active", !apps);
  $("tab-apps").setAttribute("aria-selected", String(apps));
  $("tab-controls").setAttribute("aria-selected", String(!apps));
  $("picker-list").hidden = !apps;
  $("control-list").hidden = apps;
  $("filter").hidden = !apps;
  if (!apps) drawControls();
}

async function openPicker() {
  const { apps } = await api("/api/apps/installed");
  installedApps = apps;
  drawApps($("filter").value);
  selectTab("apps");
  $("picker").showModal();
}

$("picker-list").addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-id]");
  if (!btn) return;
  const app = installedApps.find((a) => a.id === btn.dataset.id);
  if (!app) return;
  btn.disabled = true;
  try {
    await commitTiles(addAppTile(state.tiles, app));
    $("picker").close();
  } catch (err) {
    console.warn(err);
    btn.disabled = false;
  }
});

$("control-list").addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-verb]");
  if (!btn || btn.disabled) return;
  const { verb, value } = btn.dataset;
  const parsed = value === undefined ? null : Number(value);
  const item = availableControls(state.verbs, state.tiles)
    .flatMap((g) => g.items)
    .find((i) => i.verb === verb && (i.value ?? null) === parsed);
  btn.disabled = true;
  try {
    await commitTiles(addControlTile(state.tiles, verb, item?.label || verb, parsed));
    $("picker").close();
  } catch (err) {
    console.warn(err);
    btn.disabled = false;
  }
});

$("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
    showApp();
    await refresh();
    connect();
  } catch (err) {
    showPair(err.message === "unauthorized" ? "Wrong PIN." : err.message);
  }
});

$("dock").addEventListener("click", onDockClick);
$("add").addEventListener("click", () => openPicker().catch(console.warn));
$("refresh").addEventListener("click", () => refresh().catch(console.warn));
$("edit").addEventListener("click", () => {
  editing = !editing;
  paint();
});
$("tab-apps").addEventListener("click", () => selectTab("apps"));
$("tab-controls").addEventListener("click", () => selectTab("controls"));
$("picker-close").addEventListener("click", () => $("picker").close());
$("filter").addEventListener("input", (e) => drawApps(e.target.value));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* offline shell is an enhancement, never a boot requirement */
  });
}

(async function boot() {
  try {
    await refresh();
    showApp();
    connect();
  } catch {
    showPair();
  }
})();
