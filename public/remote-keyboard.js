/** The Android wrapper owns its IME; browsers use this small text composer. */
export function createRemoteKeyboard({ send, isReady, onSignature, notify }) {
  const $ = id => document.getElementById(id);
  const panel = $("remote-keyboard"), field = $("remote-keyboard-text"), button = $("touchpad-keyboard");
  let focus = null, supported = false, opened = false, requested = false, composing = false, suspended = false;
  const native = () => typeof window.WinDockAndroid?.showKeyboard === "function";
  function close() {
    opened = requested = composing = false;
    panel.hidden = true; field.value = ""; field.blur();
    $("input-pad").dataset.keyboard = "false";
    button.setAttribute("aria-pressed", "false");
    try { window.WinDockAndroid?.hideKeyboard(); } catch { /* browser fallback */ }
  }
  function transmit(message) {
    if (!opened || !focus || !isReady()) return false;
    return send({ ...message, target: focus.target });
  }
  function commit() {
    const text = field.value;
    if (text && !composing && transmit({ type: "text", text })) field.value = "";
  }
  function open() {
    if (suspended || !supported || !isReady()) return;
    if (!focus) { requested = true; send({ type: "focus" }); return; }
    opened = true; requested = false;
    $("input-pad").dataset.keyboard = "true";
    button.setAttribute("aria-pressed", "true");
    if (native()) {
      try { window.WinDockAndroid.showKeyboard(focus.target, focus.password); return; }
      catch { /* continue with browser keyboard */ }
    }
    panel.hidden = false;
    field.type = focus.password ? "password" : "text";
    field.focus();
  }
  button.addEventListener("click", () => {
    if (opened) { commit(); close(); }
    else { requested = true; send({ type: "focus" }); if (focus) { open(); requested = true; } }
  });
  $("remote-keyboard-close").addEventListener("click", () => { composing = false; commit(); close(); });
  $("remote-keyboard-signature").addEventListener("click", () => { composing = false; commit(); close(); onSignature(); });
  $("remote-keyboard-backspace").addEventListener("click", () => { if (field.value) field.value = Array.from(field.value).slice(0, -1).join(""); else transmit({ type: "key", key: "Backspace" }); field.focus(); });
  $("remote-keyboard-enter").addEventListener("click", () => { composing = false; commit(); transmit({ type: "key", key: "Enter" }); field.focus(); });
  field.addEventListener("compositionstart", () => { composing = true; });
  field.addEventListener("compositionend", () => { composing = false; commit(); });
  field.addEventListener("input", event => { if (!event.isComposing) commit(); });
  field.addEventListener("keydown", event => {
    if (event.isComposing || composing) return;
    if (event.key === "Enter" || (event.key === "Backspace" && !field.value) || event.key === "Tab") {
      event.preventDefault(); commit(); transmit({ type: "key", key: event.key });
    }
  });
  window.addEventListener("windock-keyboard-input", event => {
    const data = event.detail;
    if (!native() || !data || data.target !== focus?.target) return;
    if (data.type === "text" && typeof data.text === "string" && data.text.length <= 1024)
      transmit({ type: "text", text: data.text });
    else if (data.type === "key" && ["Backspace", "Delete", "Enter", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(data.key))
      transmit({ type: "key", key: data.key });
  });
  window.addEventListener("windock-keyboard-action", event => {
    if (!native() || !isReady()) return;
    close();
    if (event.detail?.action === "signature") onSignature();
  });
  return {
    target() { return focus?.target ?? null; },
    suspend(value) { suspended = Boolean(value); if (suspended) close(); },
    configure(value) { supported = Boolean(value); button.hidden = !supported; },
    paint() { button.disabled = !isReady(); },
    message(event) {
      if (event.type === "input-error") { close(); notify(event.error); return; }
      if (event.type !== "focus" || !supported || !/^[1-9][0-9]{0,15}$/.test(event.target)) return;
      const changed = focus?.target !== event.target, manual = requested;
      if (changed) { close(); focus = event; }
      else focus = event;
      button.classList.toggle("has-text-focus", event.editable);
      if (manual || (changed && event.editable && native())) open();
    },
    reset() { close(); focus = null; suspended = false; button.classList.remove("has-text-focus"); },
    close,
  };
}
