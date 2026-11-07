import { renderNowPlaying, renderControlPicker, renderAppIcon, renderControls, escapeHtml } from "./dock.js";
import { icon, controlIcon } from "./icons.js";
import { addAppTile, addControlTile, removeTile, moveTile, toWireTiles, availableControls, tileKey } from "./tiles.js";
import { normalizeLayout, renderPages, pageCount, moveToTile } from "./launcher.js";
import { createInputPad } from "./input-pad.js";
import { pairingError } from "./pairing.js";
import { createUpdates } from "./updates.js";
import { createNowPlayingPoller } from "./now-playing.js";
import { dockFetch, DockWebSocket, nativeTransport } from "./native-transport.js";

const $ = (id) => document.getElementById(id);
if (location.protocol === 'https:') {
  document.querySelector('.pair__hint').textContent = 'Enter the secure pairing PIN from your PC’s WinDock tray → Show connection info.';
}
const performanceMode = window.WinDockPerformance;
let state = { tiles: [], running: [], verbs: [] };
let editing = false, paired = false, online = false, saving = false;
let socket = null, reconnectTimer = null, installedApps = [], appsLoaded = false;
let currentPage = 0, toastTimer, selectedKey = "", suppressClickUntil = 0;
let pageHintTimer;
let captureState = { available: false, phase: "idle" }, captureBusy = false, capturePoll = false, captureReceivedAt = Date.now();
let nowPlayingHtml = "";
const nowPlaying = createNowPlayingPoller({
  load: async (signal) => (await api("/api/nowplaying", { signal })).nowPlaying,
  isActive: () => paired && online && !document.hidden,
  onChange: (media) => {
    const html = renderNowPlaying(media);
    // Keep the playback button (and its focus) when nothing has changed.
    if (nowPlayingHtml !== html) { $("nowplaying").innerHTML = html; nowPlayingHtml = html; }
  },
});
let layout;
try { layout = normalizeLayout(JSON.parse((window.WinDockPreferences || localStorage).getItem("windock-layout"))); } catch { layout = normalizeLayout(); }
document.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
if (typeof window.WinDockAndroid?.showConnectionSettings === "function") {
  $("connection-open").hidden = false;
  $("connection-open").addEventListener("click", () => {
    $("drawer").close();
    window.WinDockAndroid.showConnectionSettings();
  });
}
if (typeof window.WinDockAndroid?.showPcPicker === "function") {
  $("drawer-switch-pc").hidden = false;
  $("drawer-switch-pc").addEventListener("click", () => {
    $("drawer").close();
    window.WinDockAndroid.showPcPicker();
  });
}
// Native Android already runs fullscreen, including older keyboard-capable clients.
$("fullscreen").hidden = nativeTransport || typeof window.WinDockAndroid?.showKeyboard === "function";
if (typeof window.WinDockAndroid?.showPhoneSettings === "function") {
  $("phone-options-row").hidden = false;
  $("phone-options").addEventListener("click", () => window.WinDockAndroid.showPhoneSettings());
}
document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.closest(".app-icon")) event.target.parentElement.classList.add("icon-failed");
}, true);

function notify(message, error = false, warning = false) {
  clearTimeout(toastTimer);
  const el = $("toast");
  el.textContent = message;
  el.dataset.error = String(error);
  el.dataset.warning = String(warning && !error);
  // Native dialogs occupy the top layer; feedback belongs inside the active one.
  (Array.from(document.querySelectorAll("dialog[open]")).at(-1) || document.body).append(el);
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, warning ? 6500 : error ? 5500 : 2700);
}
function report(error) {
  if (error.message === "unauthorized") return;
  notify(error.message === "Failed to fetch" ? "Connection lost. Check that WinDock is running on your PC." : error.message, true);
}
function captureActive() { return ["starting", "recording", "stopping"].includes(captureState.phase); }
function captureTime() {
  const seconds = Math.floor(((captureState.elapsedMs || 0) + (captureState.phase === "recording" ? Date.now() - captureReceivedAt : 0)) / 1000);
  return Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
}
function paintCapture() {
  const active = captureActive();
  const waiting = ["starting", "stopping"].includes(captureState.phase);
  $("recording-stop").hidden = !paired || !active;
  $("recording-stop").disabled = !online || captureBusy || waiting;
  $("recording-time").textContent = !online ? "Reconnecting…" : waiting ? (captureState.phase === "starting" ? "Starting…" : "Saving…") : captureTime();
  $("capture-screenshot").disabled = !online || !captureState.available || captureBusy || waiting;
  $("capture-record").disabled = !online || !captureState.available || captureBusy || waiting;
  $("capture-record").classList.toggle("is-recording", active);
  $("capture-record-icon").innerHTML = icon(active ? "stop" : "record");
  $("capture-record-label").textContent = active ? (waiting ? (captureState.phase === "starting" ? "Starting…" : "Saving recording…") : "Stop recording") : "Start recording";
  $("capture-record-detail").textContent = active ? captureTime() + " · Video only" : "MP4 · Video only";
  // Only the Windows host has a tray to stop a recording from.
  const tray = state.platform === "windows";
  $("capture-tray-tip").hidden = !tray;
  $("capture-status").textContent = !online ? "PC disconnected. Any recording continues on the PC. " + (tray ? "Reconnect or stop from its tray menu." : "Reconnect to stop it, or it stops after 60 minutes.") : captureState.error || (!captureState.available ? "Screen capture needs an updated WinDock on your PC." : active ? "Recording your main monitor. Stop to save the video." : "Screenshots → Pictures / WinDock. Recordings → Videos / WinDock.");
  const last = captureState.lastCapture;
  $("capture-file").hidden = !last;
  $("capture-file").textContent = last ? "Last saved: " + last.path : "";
}
async function refreshCapture() {
  if (captureBusy || capturePoll) return;
  capturePoll = true;
  try {
    const fresh = await api("/api/capture");
    if (!captureBusy) { captureState = fresh; captureReceivedAt = Date.now(); paintCapture(); }
  } finally { capturePoll = false; }
}
async function captureAction(action) {
  if (captureBusy || !online) return;
  captureBusy = true; paintCapture();
  try {
    captureState = await api("/api/capture/" + action, { method: "POST", body: "{}" });
    captureReceivedAt = Date.now();
    if (action === "start") { $("capture").close(); notify("Recording started · Tap Stop to save"); }
    else notify(action === "screenshot" ? "Screenshot saved in Pictures / WinDock" : "Recording saved in Videos / WinDock");
  } catch (error) { report(error); }
  finally { captureBusy = false; paintCapture(); }
}
function openCapture() {
  $("drawer").close(); paintCapture();
  if (!$("capture").open) $("capture").showModal();
  refreshCapture().catch(report);
}
async function api(path, options = {}) {
  const res = await dockFetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : {},
    ...options,
  });
  if (res.status === 401 && path !== "/api/auth") { showPair("Enter the current PIN to reconnect."); throw new Error("unauthorized"); }
  if (!res.ok) {
    throw new Error(pairingError(await res.json().catch(() => ({}))));
  }
  return res.json();
}
function showPair(message = "") {
  paired = false;
  paintCapture();
  syncLayout();
  clearTimeout(reconnectTimer);
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  $("pair").hidden = false;
  $("app").hidden = true;
  $("pair-error").textContent = message;
}
function showApp() { paired = true; $("pair").hidden = true; $("app").hidden = false; syncLayout(); paintCapture(); }
function setConn(on) {
  online = on;
  if (!on) inputPad.disconnect();
  $("conn").dataset.state = on ? "on" : "off";
  $("conn").textContent = on ? "Connected" : paired ? "Reconnecting" : "Connecting";
  $("drawer-conn").dataset.state = $("conn").dataset.state;
  $("drawer-conn").textContent = $("conn").textContent;
  paintCapture();
}
function syncLayout() {
  const root = document.documentElement.style;
  root.setProperty("--columns", layout.columns);
  root.setProperty("--rows", layout.rows);
  root.setProperty("--icon-size", (layout.immersive ? layout.iconSize : 72) + "px");
  root.setProperty("--icon-scale", { 4: .44, 6: .38, 8: .32 }[layout.perPage]);
  document.documentElement.dataset.background = layout.background;
  document.documentElement.dataset.theme = layout.theme;
  document.body.classList.toggle("is-immersive", layout.immersive);
  document.body.classList.toggle("show-labels", layout.showLabels);
  $("drawer-open").hidden = !layout.immersive || !paired;
  $("quick-controls-open").hidden = !layout.immersive || !paired || editing;
  $("edit-done").hidden = !layout.immersive || !editing || !paired;
  $("immersive").checked = layout.immersive;
  $("show-labels").checked = layout.showLabels;
  $("show-labels").disabled = !layout.immersive;
  $("glass-theme").value = layout.theme;
  syncPerformance();
  $("layout-summary").textContent = layout.perPage + " icons · " + layout.columns + " × 2";
  document.querySelectorAll("[data-per-page]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.perPage) === layout.perPage)));
  document.querySelectorAll("[data-background]").forEach((button) => { if (button.tagName === "BUTTON") button.setAttribute("aria-pressed", String(button.dataset.background === layout.background)); });
}
function syncPerformance() {
  $("performance-mode").value = performanceMode.preference;
  $("glass-theme").disabled = performanceMode.enabled;
  $("glass-hint").hidden = !performanceMode.enabled;
  $("performance-status").textContent = performanceMode.preference === "auto"
    ? (performanceMode.enabled ? "Auto · On for this device. Fewer effects, instant page changes." : "Auto · Off. Turn on for fewer effects and instant page changes on older phones.")
    : (performanceMode.enabled ? "On · Fewer effects and instant page changes on this device." : "Off · Your usual appearance is restored.");
}
function saveLayout(changes) {
  layout = normalizeLayout({ ...layout, ...changes });
  try { (window.WinDockPreferences || localStorage).setItem("windock-layout", JSON.stringify(layout)); } catch { /* Device preferences are optional. */ }
  currentPage = 0; syncLayout(); paint();
}
function showPageHint() {
  clearTimeout(pageHintTimer);
  $("page-dots").classList.add("is-awake");
  pageHintTimer = setTimeout(() => $("page-dots").classList.remove("is-awake"), 1300);
}
function paint() {
  const running = new Set(state.running.map((app) => app.id));
  const view = { ...state, tiles: state.tiles.map((tile) => tile.kind === "app" ? { ...tile, running: running.has(tile.id) } : tile) };
  const pages = pageCount(state.tiles, layout);
  currentPage = Math.min(currentPage, pages - 1);
  $("dock").innerHTML = renderPages(view, layout, editing);
  $("dock").classList.toggle("is-editing", editing);
  $("dock").scrollTo({ left: currentPage * $("dock").clientWidth, behavior: "instant" });
  $("host-name").textContent = state.hostName || state.platformName || "Your PC";
  $("drawer-host").textContent = $("host-name").textContent;
  document.body.classList.toggle("is-arranging", editing);
  $("quick-controls-open").hidden = !layout.immersive || !paired || editing;
  $("edit-done").hidden = !layout.immersive || !editing || !paired;
  $("drawer-edit").innerHTML = icon(editing ? "check" : "edit") + "<span>" + (editing ? "Done" : "Edit dock") + "</span>";
  $("dock-title").textContent = editing ? "A place for everything." : "Make yourself at home.";
  $("edit-hint").textContent = editing ? "Drag to move · Tap an icon for options · Done to finish" : "Hold an icon to arrange your space";
  $("edit").setAttribute("aria-pressed", String(editing));
  $("edit").setAttribute("aria-label", editing ? "Done editing" : "Edit dock");
  $("edit").innerHTML = icon(editing ? "check" : "edit") + "<span>" + (editing ? "Done" : "Edit") + "</span>";
  $("page-dots").innerHTML = Array.from({ length: pages }, (_, i) => '<button class="page-dot" type="button" data-page="' + i + '" aria-label="Go to page ' + (i + 1) + '"' + (i === currentPage ? ' aria-current="page"' : "") + '></button>').join("");
}
function pageTo(page, smooth = true) {
  currentPage = Math.max(0, Math.min(pageCount(state.tiles, layout) - 1, page));
  $("dock").scrollTo({ left: currentPage * $("dock").clientWidth, behavior: performanceMode.scrollBehavior(smooth) });
  if (smooth) showPageHint();
}
function enterEditing() { if (saving) return; editing = true; paint(); }
async function commitTiles(tiles, previous = state.tiles) {
  if (saving) throw new Error("Wait for your last change to finish.");
  saving = true;
  state = { ...state, tiles };
  paint();
  try {
    const saved = await api("/api/tiles", { method: "PUT", body: JSON.stringify({ tiles: toWireTiles(tiles) }) });
    state = { ...state, tiles: saved.tiles };
    paint();
  } catch (err) { state = { ...state, tiles: previous }; paint(); throw err; }
  finally { saving = false; }
}
function connect() {
  if (!paired || socket && [DockWebSocket.OPEN, DockWebSocket.CONNECTING].includes(socket.readyState)) return;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new DockWebSocket(scheme + "//" + location.host);
  socket = ws;
  ws.onopen = () => setConn(true);
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    setConn(false);
    // Managed Android owns bounded rediscovery; do not start a second retry loop.
    if (nativeTransport) return;
    if (paired) reconnectTimer = setTimeout(async () => {
      try { await refresh(); connect(); } catch (error) { if (paired) reconnectTimer = setTimeout(connect, 2000); }
    }, 2000);
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== "snapshot") return;
      state = { ...msg, tiles: editing || saving || gesture?.dragging ? state.tiles : msg.tiles };
      if (!gesture?.dragging) paint();
    } catch { /* Ignore malformed frames. */ }
  };
}
async function refresh() {
  const fresh = await api("/api/state");
  state = { ...fresh, tiles: editing || saving || gesture?.dragging ? state.tiles : fresh.tiles };
  if (!gesture?.dragging) paint();
  // Optional telemetry must not delay showing the dock or opening its main socket.
  // A native media provider may legitimately take up to 20 seconds to return.
  nowPlaying.refresh().catch(() => {});
  refreshCapture().catch(() => {});
}
const powerActions = {
  lock: ["Lock your PC?", "Your computer will return to its lock screen.", "Lock PC"],
  sleep: ["Put your PC to sleep?", "WinDock will disconnect until you wake your computer.", "Sleep"],
  restart: ["Restart your PC?", "Save your work first. WinDock will disconnect while your computer restarts.", "Restart"],
  shutdown: ["Shut down your PC?", "Save your work first. You’ll need to turn your computer back on to reconnect.", "Shut down"],
};
function confirmPower(verb) {
  return new Promise((resolve) => {
    const [title, description, label] = powerActions[verb];
    $("confirm-title").textContent = title;
    $("confirm-description").textContent = description;
    $("confirm-go").textContent = label;
    const dialog = $("confirm");
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "yes"), { once: true });
    dialog.showModal();
  });
}
async function activate(button) {
  if (editing && button.dataset.tileKey) return openTileOptions(button.dataset.tileKey);
  if (!online) return notify("Your PC is disconnected. Wait for it to reconnect.", true);
  const { action, key } = button.dataset;
  if (action === "control" && powerActions[key] && !await confirmPower(key)) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    if (action === "control") {
      const raw = button.dataset.value;
      const result = await api("/api/control", { method: "POST", body: JSON.stringify(raw === undefined ? { verb: key } : { verb: key, value: Number(raw) }) });
      if (key.startsWith("media-")) nowPlaying.refresh().catch(() => {});
      if (key === "brightness-set" && result.warning === "hdr-active") {
        notify("Command sent. HDR may prevent the brightness from changing.", false, true);
      } else notify(powerActions[key] ? "Command sent to your PC" : "Control sent");
    } else if (action === "launch") {
      const running = state.running.find((item) => item.id === key);
      const title = state.tiles.find((item) => item.id === key)?.label || "App";
      await api(running ? "/api/apps/focus" : "/api/apps/launch", { method: "POST", body: JSON.stringify(running ? { pid: running.pid, id: running.id } : { id: key }) });
      notify((running ? "Brought forward: " : "Opened: ") + title);
    }
  } catch (error) { report(error); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); }
}
function openTileOptions(key) {
  selectedKey = key;
  const index = state.tiles.findIndex((tile) => tileKey(tile) === key);
  const tile = state.tiles[index];
  if (!tile) return;
  $("tile-options-title").textContent = tile.label;
  $("tile-options-icon").innerHTML = tile.kind === "app" ? renderAppIcon(tile) : controlIcon(tile.verb);
  $("tile-earlier").disabled = index === 0;
  $("tile-later").disabled = index === state.tiles.length - 1;
  $("tile-options").showModal();
}
function drawApps() {
  const term = $("filter").value.trim().toLowerCase();
  const matches = installedApps.filter((app) => !["folder", "link"].includes(app.source) && app.name.toLowerCase().includes(term));
  const pinned = new Set(state.tiles.filter((tile) => tile.kind === "app").map((tile) => tile.id));
  $("picker-status").textContent = matches.length + " apps" + (term ? " found" : " on your PC") + " · " + pinned.size + " pinned";
  $("picker-list").innerHTML = matches.length ? matches.map((app) => '<li><button type="button" data-id="' + escapeHtml(app.id) + '"' + (pinned.has(app.id) ? " disabled" : "") + ' aria-label="' + escapeHtml((pinned.has(app.id) ? "Pinned: " : "Add ") + app.name) + '">' + renderAppIcon(app, true) + '<span class="picker__name">' + escapeHtml(app.name) + '<small>' + (pinned.has(app.id) ? "On your dock" : escapeHtml((state.platformName || "Desktop") + " app")) + '</small></span><span class="picker__add">' + icon(pinned.has(app.id) ? "check" : "plus") + "</span></button></li>").join("") : '<li class="picker__empty">No apps found. Try a different name.</li>';
}
function drawControls() {
  const groups = availableControls(state.verbs, state.tiles);
  $("control-list").innerHTML = renderControlPicker(groups);
  $("picker-status").textContent = "Pin the controls you reach for most";
}
function selectTab(which) {
  const apps = which === "apps";
  const folders = which === "folders";
  for (const [id, active] of [["tab-apps", apps], ["tab-folders", folders], ["tab-controls", which === "controls"], ["tab-links", which === "links"]]) {
    $(id).classList.toggle("is-active", active);
    $(id).setAttribute("aria-selected", String(active));
    $(id).tabIndex = active ? 0 : -1;
  }
  $("picker-list").hidden = !apps;
  $("control-list").hidden = which !== "controls";
  $("folder-panel").hidden = !folders;
  $("link-panel").hidden = which !== "links";
  $("picker-search").hidden = !apps;
  if (apps && appsLoaded) drawApps();
  else if (folders) $("picker-status").textContent = "Pin a folder from your PC";
  else if (which === "links") $("picker-status").textContent = "Pin a website to open on your PC";
  else if (!apps) drawControls();
}
async function openPicker() {
  $("tab-folders").hidden = state.canPickFolders !== true;
  $("tab-links").hidden = state.canAddLinks !== true;
  selectTab("apps");
  if (!$("picker").open) $("picker").showModal();
  if (appsLoaded) drawApps();
  else { $("picker-status").textContent = "Loading your apps…"; $("picker-list").innerHTML = '<li class="picker__empty">Finding your favorites on this PC…</li>'; }
  try {
    const { apps } = await api("/api/apps/installed");
    installedApps = apps; appsLoaded = true;
    if ($("tab-apps").getAttribute("aria-selected") === "true") drawApps();
  } catch (error) { $("picker-status").textContent = "Couldn’t load apps. Close the library and try again."; report(error); }
}
function openSettings() { $("drawer").close(); syncLayout(); if (!$("settings").open) $("settings").showModal(); }
function openDrawer() { if (paired && !$("drawer").open) $("drawer").showModal(); }
function openControls() {
  if (!paired || $("controls").open) return;
  $("drawer").close();
  $("controls-grid").innerHTML = renderControls(state.verbs, state.allowDestructive);
  $("power-controls-grid").innerHTML = renderControls(state.verbs, state.allowDestructive, true);
  $("quick-power").hidden = !$("power-controls-grid").childElementCount;
  $("controls-grid").scrollTop = 0;
  $("controls").showModal();
  $("quick-controls-open").setAttribute("aria-expanded", "true");
}

$("picker-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || button.disabled || saving) return;
  const app = installedApps.find((item) => item.id === button.dataset.id);
  if (!app) return;
  if (state.tiles.length >= 64) return notify("Your dock is full. Remove a tile before adding another.", true);
  button.disabled = true;
  try {
    await commitTiles(addAppTile(state.tiles, app));
    drawApps();
    notify(app.name + " added to your dock");
  } catch (error) { report(error); button.disabled = false; }
});
$("control-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-verb]");
  if (!button || button.disabled || saving) return;
  if (state.tiles.length >= 64) return notify("Your dock is full. Remove a tile before adding another.", true);
  const value = button.dataset.value === undefined ? null : Number(button.dataset.value);
  const item = availableControls(state.verbs, state.tiles).flatMap((group) => group.items).find((item) => item.verb === button.dataset.verb && (item.value ?? null) === value);
  button.disabled = true;
  try { await commitTiles(addControlTile(state.tiles, item.verb, item.label, value)); drawControls(); notify(item.label + " added to your dock"); }
  catch (error) { report(error); button.disabled = false; }
});

// Pointer gestures share stable tile keys. Only the final drop is persisted;
// canceled gestures restore their original order and send no mutation.
let gesture = null, dragGhost = null, edgeTimer = null;
function cleanupGesture(cancel = false) {
  if (!gesture) return;
  clearTimeout(gesture.holdTimer); clearTimeout(edgeTimer); edgeTimer = null;
  if (cancel && gesture.dragging) { state = { ...state, tiles: gesture.previous }; paint(); }
  dragGhost?.remove(); dragGhost = null;
  $("dock").querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
  gesture = null;
}
$("dock").addEventListener("contextmenu", (event) => event.preventDefault());
$("dock").addEventListener("pointerdown", (event) => {
  if (gesture && !event.isPrimary) { gesture.multitouch = true; clearTimeout(gesture.holdTimer); }
  if (event.button !== 0 || saving || !event.isPrimary) return;
  const tile = event.target.closest("[data-tile-key]");
  gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, key: tile?.dataset.tileKey, previous: state.tiles, page: currentPage, dragging: false, held: false, wasEditing: editing };
  if (state.tiles.length && !editing) gesture.holdTimer = setTimeout(() => {
    if (!gesture) return;
    gesture.held = true; suppressClickUntil = Date.now() + 600;
    enterEditing(); navigator.vibrate?.(18);
  }, 450);
});
$("dock").addEventListener("touchmove", (event) => {
  if (editing && gesture?.key) event.preventDefault();
}, { passive: false });
document.addEventListener("pointermove", (event) => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (!editing) {
    if (Math.hypot(dx, dy) > 10) clearTimeout(gesture.holdTimer);
    return;
  }
  if (!gesture.key || Math.hypot(dx, dy) < 9 && !gesture.dragging) return;
  event.preventDefault();
  if (!gesture.dragging) {
    gesture.dragging = true;
    const original = Array.from($("dock").querySelectorAll("[data-tile-key]")).find((el) => el.dataset.tileKey === gesture.key);
    if (!original) return cleanupGesture(true);
    const bounds = original.getBoundingClientRect();
    dragGhost = original.cloneNode(true);
    dragGhost.classList.add("drag-ghost"); dragGhost.classList.remove("is-editing");
    dragGhost.style.width = bounds.width + "px"; dragGhost.style.height = bounds.height + "px";
    dragGhost.setAttribute("aria-hidden", "true");
    document.body.append(dragGhost);
  }
  dragGhost.style.left = event.clientX + "px"; dragGhost.style.top = event.clientY + "px";
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-tile-key]");
  if (target && target.dataset.tileKey !== gesture.key) {
    state = { ...state, tiles: moveToTile(state.tiles, gesture.key, target.dataset.tileKey) };
    paint();
  }
  $("dock").querySelectorAll("[data-tile-key]").forEach((el) => el.classList.toggle("is-dragging", el.dataset.tileKey === gesture.key));
  const bounds = $("dock").getBoundingClientRect();
  const direction = event.clientX < bounds.left + 40 ? -1 : event.clientX > bounds.right - 40 ? 1 : 0;
  if (!direction) { clearTimeout(edgeTimer); edgeTimer = null; }
  else if (!edgeTimer) edgeTimer = setTimeout(() => {
    edgeTimer = null;
    if (!gesture?.dragging) return;
    const page = Math.max(0, Math.min(pageCount(state.tiles, layout) - 1, currentPage + direction));
    if (page === currentPage) return;
    const capacity = layout.columns * layout.rows;
    const targetIndex = Math.min(state.tiles.length - 1, page * capacity + (direction < 0 ? capacity - 1 : 0));
    state = { ...state, tiles: moveToTile(state.tiles, gesture.key, tileKey(state.tiles[targetIndex])) };
    currentPage = page; paint();
  }, 550);
}, { passive: false });
document.addEventListener("pointerup", (event) => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const previous = gesture.previous, dragged = gesture.dragging;
  const startPage = gesture.page;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  const swipeUp = !dragged && !gesture.held && dy < -55 && Math.abs(dy) > Math.abs(dx) * 1.3;
  const swipeDown = !dragged && !gesture.held && !gesture.multitouch && !editing && !gesture.wasEditing && dy > 55 && Math.abs(dy) > Math.abs(dx) * 1.3;
  const swipeAcross = !dragged && !gesture.held && !editing && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3;
  if (dragged || gesture.held || Math.hypot(dx, dy) > 15) suppressClickUntil = Date.now() + 500;
  cleanupGesture();
  if (dragged) commitTiles(state.tiles, previous).catch(report);
  else if (swipeUp) openDrawer();
  else if (swipeDown) openControls();
  else if (swipeAcross) pageTo(startPage + (dx < 0 ? 1 : -1));
});
document.addEventListener("pointercancel", () => cleanupGesture(true));
window.addEventListener("blur", () => cleanupGesture(true));
let footerGesture;
$("gesture-area").addEventListener("pointerdown", (event) => { footerGesture = { x: event.clientX, y: event.clientY }; });
$("gesture-area").addEventListener("pointerup", (event) => {
  if (footerGesture && footerGesture.y - event.clientY > 35 && Math.abs(event.clientX - footerGesture.x) < 70) { suppressClickUntil = Date.now() + 500; openDrawer(); }
  footerGesture = null;
});
$("dock").addEventListener("scroll", () => {
  if (!$("dock").clientWidth) return;
  currentPage = Math.round($("dock").scrollLeft / $("dock").clientWidth);
  showPageHint();
  $("page-dots").querySelectorAll("[data-page]").forEach((button) => {
    if (Number(button.dataset.page) === currentPage) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}, { passive: true });
$("page-dots").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (button) pageTo(Number(button.dataset.page));
});
window.addEventListener("resize", () => { syncLayout(); requestAnimationFrame(() => pageTo(currentPage, false)); });
document.addEventListener("click", (event) => {
  // A gesture can open a dialog before the browser emits its follow-up click.
  // Suppress that click globally, even when it is retargeted to the new dialog.
  if (Date.now() < suppressClickUntil && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  const close = event.target.closest("[data-close]");
  if (close) $(close.dataset.close).close();
  if (event.target.closest("[data-open-picker]")) openPicker();
  const button = event.target.closest("button[data-action]");
  if (button) activate(button).catch(report);
}, true);
function toggleEditing() { if (!saving) { editing = !editing; paint(); } }
$("edit").addEventListener("click", toggleEditing);
$("edit-done").addEventListener("click", toggleEditing);
$("drawer-edit").addEventListener("click", () => { $("drawer").close(); toggleEditing(); });
for (const [id, delta] of [["tile-earlier", -1], ["tile-later", 1], ["tile-remove", 0]]) {
  $(id).addEventListener("click", async () => {
    $("tile-options").close();
    try { await commitTiles(delta ? moveTile(state.tiles, selectedKey, delta) : removeTile(state.tiles, selectedKey)); notify(delta ? "Position updated" : "Removed from your dock"); }
    catch (error) { report(error); }
  });
}
$("add").addEventListener("click", openPicker);
$("picker-close").addEventListener("click", () => $("picker").close());
$("tab-apps").addEventListener("click", () => selectTab("apps"));
$("tab-folders").addEventListener("click", () => selectTab("folders"));
$("tab-controls").addEventListener("click", () => selectTab("controls"));
$("folder-pick").addEventListener("click", async () => {
  if (!online || saving) return notify("Wait for your PC to reconnect or your last change to finish.", true);
  if (state.tiles.length >= 64) return notify("Your dock is full. Remove a tile before adding another.", true);
  const button = $("folder-pick"), status = $("folder-status");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  status.textContent = "Choose a folder in the Windows dialog on your PC, then select it. Cancel there to go back.";
  try {
    const { app } = await api("/api/folders/pick", { method: "POST", body: "{}" });
    if (!paired || !$("picker").open) return;
    if (!app) { status.textContent = "Selection cancelled. No folder was added."; return; }
    if (state.tiles.some(tile => tile.kind === "app" && tile.id === app.id)) {
      status.textContent = app.name + " is already on your dock."; return;
    }
    if (state.tiles.length >= 64) throw new Error("Your dock is full. Remove a tile before adding another.");
    await commitTiles(addAppTile(state.tiles, app));
    appsLoaded = false;
    status.textContent = app.name + " added. Tap its folder tile to open it on your PC.";
    notify(app.name + " added to your dock");
  } catch (error) { status.textContent = error.message; report(error); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); }
});
$("tab-links").addEventListener("click", () => selectTab("links"));
$("link-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("link-add"), status = $("link-status");
  if (button.disabled) return;
  button.disabled = true; button.setAttribute("aria-busy", "true");
  status.textContent = "Adding link…";
  try {
    if (state.tiles.length >= 64) throw new Error("Your dock is full. Remove a tile before adding another.");
    const { app } = await api("/api/links", { method: "POST", body: JSON.stringify({ name: $("link-name").value.trim(), url: $("link-url").value.trim() }) });
    if (state.tiles.some(tile => tile.kind === "app" && tile.id === app.id)) {
      status.textContent = app.name + " is already on your dock."; return;
    }
    await commitTiles(addAppTile(state.tiles, app));
    appsLoaded = false;
    $("link-form").reset();
    status.textContent = app.name + " added. Tap its tile to open it on your PC.";
    notify(app.name + " added to your dock");
  } catch (error) { status.textContent = error.message; report(error); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); }
});

document.querySelector(".picker__tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = ["apps", "folders", "controls", "links"].filter(name => !$("tab-" + name).hidden);
  const current = tabs.findIndex(name => $("tab-" + name).getAttribute("aria-selected") === "true");
  const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  selectTab(tabs[index]); $("tab-" + tabs[index]).focus();
});
$("filter").addEventListener("input", drawApps);
$("settings-open").addEventListener("click", openSettings);
$("swipe-settings").addEventListener("click", openDrawer);
$("controls-open").addEventListener("click", openControls);
$("quick-controls-open").addEventListener("click", openControls);
$("controls").addEventListener("close", () => $("quick-controls-open").setAttribute("aria-expanded", "false"));
$("controls-grip").addEventListener("click", () => $("controls").close());
document.querySelectorAll("button[data-per-page]").forEach((button) => button.addEventListener("click", () => saveLayout({ perPage: Number(button.dataset.perPage) })));
document.querySelectorAll("button[data-background]").forEach((button) => button.addEventListener("click", () => saveLayout({ background: button.dataset.background })));
$("immersive").addEventListener("change", () => saveLayout({ immersive: $("immersive").checked }));
$("show-labels").addEventListener("change", () => saveLayout({ showLabels: $("show-labels").checked }));
$("glass-theme").addEventListener("change", () => saveLayout({ theme: $("glass-theme").value }));
$("performance-mode").addEventListener("change", () => {
  performanceMode.setPreference($("performance-mode").value);
  syncPerformance();
  pageTo(currentPage, false);
});
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    if (!document.documentElement.requestFullscreen) return notify("Use your browser’s fullscreen option, then turn your phone sideways.");
    await document.documentElement.requestFullscreen();
    await screen.orientation?.lock?.("landscape").catch(() => {});
    $("settings").close();
    $("drawer").close();
  } catch { notify("Fullscreen isn’t available here. Turn your phone sideways to continue."); }
}
$("fullscreen").addEventListener("click", toggleFullscreen);
$("drawer-open").addEventListener("click", openDrawer);
$("drawer-close").addEventListener("click", () => $("drawer").close());
const updatesScreen = createUpdates({ api });
$("drawer-updates").addEventListener("click", () => updatesScreen.open());
$("settings-updates").addEventListener("click", () => updatesScreen.open());
$("drawer-settings").addEventListener("click", openSettings);
$("drawer-apps").addEventListener("click", () => { $("drawer").close(); openPicker(); });
const inputPad = createInputPad({ api, notify, WebSocketClass: DockWebSocket, storage: localStorage });
$("quick-files").hidden = typeof window.WinDockAndroid?.openFiles !== "function";
$("quick-files").addEventListener("click", () => { $("controls").close(); window.WinDockAndroid?.openFiles?.(); });
$("quick-input").addEventListener("click", () => { $("controls").close(); inputPad.open(); });
$("quick-capture").addEventListener("click", () => { $("controls").close(); openCapture(); });
$("quick-power").addEventListener("click", () => $("power-controls").showModal());
$("capture-screenshot").addEventListener("click", () => captureAction("screenshot"));
$("capture-record").addEventListener("click", () => captureAction(captureActive() ? "stop" : "start"));
$("recording-stop").addEventListener("click", () => captureAction("stop"));
setInterval(() => { if (paired && !document.hidden) refreshCapture().catch(() => {}); }, 2000);
setInterval(() => { if (paired && captureActive() && !document.hidden) paintCapture(); }, 500);
// The invisible lower edge is also a keyboard-accessible button. Track swipes
// at document level so lifting above the original hit area still opens it.
let edgeGesture = null;
$("drawer-open").addEventListener("pointerdown", (event) => { edgeGesture = { id: event.pointerId, y: event.clientY }; });
document.addEventListener("pointerup", (event) => {
  if (edgeGesture?.id === event.pointerId && edgeGesture.y - event.clientY > 25) { suppressClickUntil = Date.now() + 500; openDrawer(); }
  edgeGesture = null;
});
document.addEventListener("pointercancel", () => { edgeGesture = null; });
// Limit curtain gestures to the dock and its own handles. Touchpad, keyboard,
// clipboard and scrollable panels keep their existing input behavior.
function curtainSwipe(handle, direction, action) {
  let start = null;
  const reset = () => { start = null; };
  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) { reset(); return; }
    if (event.button !== 0) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointerup", (event) => {
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = (event.clientY - start.y) * direction;
    reset();
    if (Math.hypot(dx, dy) > 15) suppressClickUntil = Date.now() + 500;
    if (dy > 30 && dy > Math.abs(dx) * 1.3) {
      action();
    }
  });
  handle.addEventListener("pointercancel", reset);
  handle.addEventListener("lostpointercapture", reset);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
}
curtainSwipe($("quick-controls-open"), 1, openControls);
curtainSwipe($("controls-grip"), -1, () => $("controls").close());
let drawerGesture = null;
$("drawer-close").addEventListener("pointerdown", (event) => { drawerGesture = { id: event.pointerId, y: event.clientY }; });
document.addEventListener("pointerup", (event) => {
  if (drawerGesture?.id === event.pointerId && event.clientY - drawerGesture.y > 30) { suppressClickUntil = Date.now() + 500; $("drawer").close(); }
  drawerGesture = null;
});
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try { appsLoaded = false; await refresh(); connect(); notify("Your dock is up to date"); } catch (error) { report(error); }
  finally { $("refresh").disabled = false; }
});
$("confirm-cancel").addEventListener("click", () => $("confirm").close("no"));
$("confirm-go").addEventListener("click", () => $("confirm").close("yes"));
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
$("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
    showApp(); await refresh(); connect();
  } catch (error) { showPair(error.message); } finally { button.disabled = false; }
});

if (!nativeTransport && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* The shell also works without a service worker. */ });
}
syncLayout();
(async function boot() {
  try { await refresh(); showApp(); connect(); }
  catch (error) { showPair(error.message === "unauthorized" ? "" : "Start WinDock on your PC, then connect with its PIN."); }
})();
// Refresh when returning to the dock. No background native polling while hidden.
document.addEventListener("visibilitychange", () => { if (!document.hidden && paired) refresh().then(connect).catch(report); });
