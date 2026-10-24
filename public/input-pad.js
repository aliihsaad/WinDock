import { TouchpadGestures } from "./touchpad-gestures.js";
import { createRemoteKeyboard } from "./remote-keyboard.js";

export function createInputPad({ api, notify, WebSocketClass = WebSocket, storage = localStorage }) {
  const $ = (id) => document.getElementById(id), dialog = $("input-pad"), canvas = $("signature-canvas");
  const context = canvas.getContext("2d");
  // Preserve the PNG's 8:3 aspect ratio even on a wide desktop or short phone.
  const paper = canvas.parentElement, space = paper.parentElement;
  new ResizeObserver(() => {
    const width = Math.min(space.clientWidth, space.clientHeight * 8 / 3);
    if (width > 0) { paper.style.width = width + "px"; paper.style.height = width * 3 / 8 + "px"; }
  }).observe(space);
  let mode = "touchpad", socket = null, ready = false, connecting = false, heartbeat = null, startup = null, generation = 0;
  let dragging = false, available = false, demo = false, saving = false, strokes = [], activeStroke = null, signaturePointer = null;
  let color = "black", frame = null, pending = { move: [0, 0], scroll: [0, 0] }, speed = 1.5;
  let canInsertSignature = false;
  // The PC answered and has no touchpad support: retrying cannot change that.
  let unsupported = false;
  const keyboard = createRemoteKeyboard({ send: raw, isReady: () => ready && mode === "touchpad", onSignature: () => select("signature"), notify });
  try { const saved = Number(storage.getItem("windock-pointer-speed")); if (saved >= .5 && saved <= 3) speed = saved; } catch { /* optional preference */ }
  $("pointer-speed").value = speed;
  $("pointer-speed-value").value = speed + "×";
  const setStatus = (text) => { $("input-status").textContent = text; };
  const glowNodes = Array.from($("touchpad-feedback").children), contacts = new Map();
  function showContact(event) {
    let contact = contacts.get(event.pointerId);
    if (!contact) {
      const node = glowNodes.find((candidate) => !Array.from(contacts.values()).some((value) => value.node === candidate));
      if (!node) return;
      contact = { node, rect: $("touchpad-surface").getBoundingClientRect() }; contacts.set(event.pointerId, contact);
    }
    const x = event.clientX - contact.rect.left, y = event.clientY - contact.rect.top;
    contact.node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    contact.node.style.setProperty("--contact-x", x + "px");
    contact.node.style.setProperty("--contact-y", y + "px");
    contact.node.classList.add("is-touching");
  }
  function hideContact(id) { contacts.get(id)?.node.classList.remove("is-touching"); contacts.delete(id); }
  function clearContacts() { for (const node of glowNodes) node.classList.remove("is-touching"); contacts.clear(); }
  function showOptions(open) {
    $("pointer-options").hidden = !open;
    $("pointer-options-toggle").setAttribute("aria-expanded", String(open));
  }

  function paint() {
    dialog.dataset.mode = mode; dialog.dataset.ready = String(ready); dialog.dataset.demo = String(demo);
    $("touchpad-pane").hidden = mode !== "touchpad";
    $("signature-pane").hidden = mode !== "signature";
    $("input-touchpad-tab").setAttribute("aria-pressed", String(mode === "touchpad"));
    $("input-signature-tab").setAttribute("aria-pressed", String(mode === "signature"));
    $("touchpad-surface").dataset.ready = String(ready);
    $("input-reconnect").hidden = mode !== "touchpad" || ready || connecting || unsupported;
    for (const id of ["mouse-left", "mouse-right", "mouse-drag"]) $(id).disabled = !ready;
    $("mouse-drag").setAttribute("aria-pressed", String(dragging));
    $("mouse-drag").textContent = dragging ? "Release" : "Drag";
    $("mouse-drag").setAttribute("aria-label", dragging ? "Release drag" : "Drag");
    $("signature-save").disabled = !available || !strokes.length || saving || signaturePointer !== null;
    $("signature-save").textContent = saving ? "Saving…" : "Save to PC";
    $("signature-insert").disabled = !canInsertSignature || $("signature-save").disabled;
    keyboard.paint();
    $("signature-undo").disabled = !strokes.length || saving;
    $("signature-clear").disabled = !strokes.length || saving;
    $("signature-color").disabled = saving;
    $("signature-placeholder").hidden = strokes.length > 0;
  }
  function raw(message) {
    if (!ready || !socket || socket.readyState !== WebSocketClass.OPEN) return false;
    if (socket.bufferedAmount > 8192) { disconnect(); setStatus("Connection is slow. Reopen the touchpad to reconnect."); return false; }
    try { socket.send(JSON.stringify(message)); return true; }
    catch { disconnect(); setStatus("PC disconnected. Reopen the touchpad to reconnect."); return false; }
  }
  function flush() {
    if (frame !== null) cancelAnimationFrame(frame); frame = null;
    const waiting = gestures.flush();
    for (const type of ["move", "scroll"]) {
      const values = pending[type], dx = Math.max(-2048, Math.min(2048, Math.trunc(values[0]))), dy = Math.max(-2048, Math.min(2048, Math.trunc(values[1])));
      values[0] -= dx; values[1] -= dy;
      if (dx || dy) raw({ type, dx, dy });
    }
    if (waiting && frame === null) frame = requestAnimationFrame(flush);
  }
  function motion(type, dx, dy) {
    if (!ready) return;
    pending[type][0] += dx; pending[type][1] += dy;
    if (frame === null) frame = requestAnimationFrame(flush);
  }
  function click(button) { flush(); if (raw({ type: "button", button, down: true })) raw({ type: "button", button, down: false }); }
  const gestures = new TouchpadGestures({ move: (x, y) => motion("move", x * speed, y * speed), scroll: (x, y) => motion("scroll", x * 4, y * 4), zoom: (steps) => raw({ type: "zoom", steps }), click, dragging: () => dragging });
  function release() { clearContacts(); gestures.reset(); flush(); raw({ type: "release" }); dragging = false; paint(); }
  function disconnect() {
    clearInterval(heartbeat); clearTimeout(startup); heartbeat = startup = null;
    if (frame !== null) cancelAnimationFrame(frame); frame = null;
    pending = { move: [0, 0], scroll: [0, 0] };
    const previous = socket; socket = null; ready = false; connecting = false; dragging = false; gestures.reset(); clearContacts(); showOptions(false); keyboard.reset();
    if (previous) { previous.onclose = previous.onmessage = previous.onerror = null; try { if (previous.readyState === WebSocketClass.OPEN) previous.send('{"type":"release"}'); previous.close(); } catch { /* host lease handles disconnect */ } }
    paint();
  }
  async function select(next) {
    const ticket = ++generation;
    disconnect(); mode = next; available = false; unsupported = false; connecting = true; demo = false; paint();
    $("touchpad-surface").dataset.used = "false";
    setStatus(next === "touchpad" ? "Connecting to your PC…" : "Draw here. Save a transparent PNG to Pictures / WinDock / Signatures.");
    try {
      const status = await api("/api/input");
      if (ticket !== generation || !dialog.open) return;
      available = status.available;
      canInsertSignature = Boolean(status.signatureInsert);
      keyboard.configure(status.keyboard);
      demo = Boolean(status.demo);
      if (demo) setStatus("Demo only · No cursor control or files saved.");
      if (!available) { connecting = false; unsupported = true; setStatus("Touchpad and signature saving need an updated WinDock on your PC."); paint(); return; }
      if (mode !== "touchpad") connecting = false;
      paint();
      if (mode !== "touchpad") return;
      const ws = new WebSocketClass((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/input");
      socket = ws;
      startup = setTimeout(() => { if (socket === ws) { disconnect(); setStatus("PC did not respond. Reopen the touchpad to retry."); } }, 8000);
      ws.onmessage = (event) => {
        if (socket !== ws) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "error") { disconnect(); setStatus(message.error); return; }
        if (message.type === "focus" || message.type === "input-error") { keyboard.message(message); return; }
        if (message.type === "ready") {
          clearTimeout(startup); ready = true; connecting = false;
          heartbeat = setInterval(() => raw({ type: "ping" }), 500);
          raw({ type: "ping" }); paint(); setStatus(demo ? "Demo only · No cursor control or files saved." : "Tap to click · Two fingers: slide to scroll, tap for right-click · Pinch to zoom");
        }
      };
      ws.onclose = ws.onerror = () => { if (socket === ws) { disconnect(); setStatus("Touchpad disconnected. Tap Reconnect to continue."); } };
    } catch (error) { if (ticket === generation) { connecting = false; setStatus(error.message); paint(); } }
  }
  const pad = $("touchpad-surface");
  pad.addEventListener("pointerdown", (event) => {
    if (!ready || event.button !== 0) return;
    showOptions(false); pad.dataset.used = "true";
    event.preventDefault(); pad.setPointerCapture(event.pointerId); gestures.down(event.pointerId, event.clientX, event.clientY); showContact(event);
  });
  pad.addEventListener("pointermove", (event) => {
    if (!ready) return;
    if (contacts.has(event.pointerId)) showContact(event);
    gestures.update(event.pointerId, event.clientX, event.clientY);
    if (gestures.points.size === 2 && frame === null) frame = requestAnimationFrame(flush);
  });
  pad.addEventListener("pointerup", (event) => { hideContact(event.pointerId); if (ready) { gestures.update(event.pointerId, event.clientX, event.clientY); gestures.up(event.pointerId); } });
  pad.addEventListener("pointercancel", release);
  pad.addEventListener("lostpointercapture", (event) => { if (gestures.points.has(event.pointerId)) release(); });
  pad.addEventListener("contextmenu", (event) => event.preventDefault());
  $("mouse-left").addEventListener("click", () => { if (dragging) release(); else click("left"); });
  $("mouse-right").addEventListener("click", () => { if (dragging) release(); click("right"); });
  $("mouse-drag").addEventListener("click", () => {
    flush(); if (raw({ type: "button", button: "left", down: !dragging })) { dragging = !dragging; paint(); }
  });
  $("pointer-speed").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < .5 || value > 3) return;
    speed = value; $("pointer-speed-value").value = speed + "×";
    try { storage.setItem("windock-pointer-speed", String(speed)); } catch { /* optional preference */ }
  });
  $("pointer-options-toggle").addEventListener("click", () => { if (dragging) release(); showOptions($("pointer-options").hidden); });
  dialog.addEventListener("cancel", (event) => { if (!$("pointer-options").hidden) { event.preventDefault(); showOptions(false); $("pointer-options-toggle").focus(); } });
  $("touchpad-signature").addEventListener("click", () => select("signature"));
  $("input-reconnect").addEventListener("click", () => select("touchpad"));

  function redraw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = context.fillStyle = color === "blue" ? "#1e40af" : "#18181b";
    context.lineWidth = 4; context.lineCap = context.lineJoin = "round";
    for (const stroke of strokes) {
      context.beginPath(); context.moveTo(stroke[0][0] * 1599, stroke[0][1] * 599);
      if (stroke.length === 1) { context.arc(stroke[0][0] * 1599, stroke[0][1] * 599, 2, 0, Math.PI * 2); context.fill(); }
      else { for (const point of stroke.slice(1)) context.lineTo(point[0] * 1599, point[1] * 599); context.stroke(); }
    }
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))].map((v) => Math.round(v * 10000) / 10000);
  }
  function addPoint(event) {
    if (!activeStroke) return;
    const next = point(event), last = activeStroke.at(-1);
    if (Math.hypot((next[0] - last[0]) * 1600, (next[1] - last[1]) * 600) < 2) return;
    if (strokes.reduce((n, stroke) => n + stroke.length, 0) >= 2048) { finishStroke(); notify("Canvas is full. Save your signature, or undo a stroke."); return; }
    activeStroke.push(next); redraw();
  }
  function finishStroke() { activeStroke = null; signaturePointer = null; paint(); }
  canvas.addEventListener("pointerdown", (event) => {
    if (signaturePointer !== null || saving || event.button !== 0) return;
    if (strokes.length >= 64 || strokes.reduce((n, stroke) => n + stroke.length, 0) >= 2048) { notify("Canvas is full. Save or clear your signature."); return; }
    event.preventDefault(); signaturePointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
    activeStroke = [point(event)]; strokes.push(activeStroke); redraw(); paint();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (signaturePointer !== event.pointerId) return;
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) addPoint(sample);
  });
  canvas.addEventListener("pointerup", (event) => { if (signaturePointer === event.pointerId) { addPoint(event); finishStroke(); } });
  for (const name of ["pointercancel", "lostpointercapture"]) canvas.addEventListener(name, (event) => { if (signaturePointer === event.pointerId) finishStroke(); });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  $("signature-undo").addEventListener("click", () => { finishStroke(); strokes.pop(); redraw(); paint(); });
  $("signature-clear").addEventListener("click", () => { finishStroke(); strokes = []; redraw(); paint(); });
  $("signature-color").addEventListener("change", (event) => { color = event.target.value; redraw(); });
  async function saveSignature(insert = false) {
    if (!strokes.length || saving || !available || signaturePointer !== null) return;
    saving = true; paint();
    try {
      const result = await api(insert ? "/api/signature/insert" : "/api/signature", { method: "POST", body: JSON.stringify({ strokes, color }) });
      setStatus(result.demo ? result.path : "Saved: " + result.path);
      notify(result.demo ? "Demo only. No image saved or pasted." : insert ? (result.pasteRequested ? "Paste sent to the PC app · Signature also saved" : "Signature copied · Paste into your PC app") : "Signature saved to your PC as a transparent PNG.");
    } catch (error) { setStatus(error.message); }
    finally { saving = false; paint(); }
  }
  $("signature-save").addEventListener("click", () => saveSignature());
  $("signature-insert").addEventListener("click", () => saveSignature(true));
  $("input-touchpad-tab").addEventListener("click", () => select("touchpad"));
  $("input-signature-tab").addEventListener("click", () => select("signature"));
  dialog.addEventListener("close", () => { generation++; disconnect(); finishStroke(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { generation++; disconnect(); finishStroke(); if (dialog.open && mode === "touchpad") setStatus("Touchpad paused. Tap Reconnect to continue."); } });
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("blur", () => { if (ready) release(); });
  window.addEventListener("resize", () => { release(); finishStroke(); if (matchMedia("(orientation: portrait)").matches) { generation++; disconnect(); setStatus("Touchpad paused. Turn sideways and tap Reconnect."); } });
  return { open(initialMode = mode) { $("drawer").close(); if (!dialog.open) dialog.showModal(); select(initialMode === "signature" ? "signature" : "touchpad"); }, disconnect };
}
