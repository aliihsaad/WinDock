/** On-demand PC history. Text exists only in this panel's live session. */
export function createPcClipboard({ api, send, isReady, keyboard }) {
  const $ = id => document.getElementById(id);
  const toggle = $("pc-clipboard-toggle"), panel = $("pc-clipboard-panel"), list = $("pc-clipboard-list");
  const editor = $("pc-clipboard-text"), paste = $("pc-clipboard-paste"), status = $("pc-clipboard-status");
  let supported = false, opened = false, pending = false, request = null, generation = 0, timer = null;
  function fitEditor() {
    if (!opened || panel.dataset.editing !== "true") return;
    const viewport = window.visualViewport;
    panel.style.setProperty("--clipboard-top", `${(viewport?.offsetTop || 0) + 8}px`);
    panel.style.setProperty("--clipboard-height", `${Math.max(0, (viewport?.height || innerHeight) - 16)}px`);
  }
  function setEditing(value) {
    panel.dataset.editing = String(value);
    $("pc-clipboard-editor").hidden = !value;
    $("pc-clipboard-back").hidden = !value;
    $("pc-clipboard-refresh").hidden = value;
    $("pc-clipboard-title").textContent = value ? "Text to paste" : "Recent clipboard";
    if (!value) editor.blur();
    panel.scrollTop = 0; fitEditor();
  }
  window.visualViewport?.addEventListener("resize", fitEditor);
  window.visualViewport?.addEventListener("scroll", fitEditor);
  window.addEventListener("resize", fitEditor);
  const setStatus = text => { status.textContent = text; };
  function paint() {
    toggle.hidden = !supported;
    toggle.disabled = !isReady();
    $("pc-clipboard-refresh").disabled = pending;
    paste.disabled = pending || !isReady() || !keyboard.target() || !editor.value || editor.value.length > 32768;
    paste.textContent = pending ? "Pasting…" : "Paste to PC";
  }
  function close() {
    opened = false; generation++; request?.abort(); request = null;
    panel.hidden = true; toggle.setAttribute("aria-expanded", "false");
    list.replaceChildren(); editor.value = ""; editor.blur();
    setEditing(false); setStatus("");
    keyboard.suspend(false); paint();
  }
  async function refresh() {
    request?.abort(); request = new AbortController();
    const ticket = ++generation;
    list.replaceChildren(); editor.value = ""; setEditing(false);
    setStatus("Loading PC clipboard…"); paint();
    try {
      const result = await api("/api/clipboard/history", { signal: request.signal, cache: "no-store" });
      if (!opened || ticket !== generation || !isReady()) return;
      if (result.status === "disabled") { setStatus("Turn on clipboard history on your PC with Windows + V, then refresh."); return; }
      if (result.status === "unavailable") { setStatus("Your PC could not share its clipboard history. Try refreshing."); return; }
      const items = (Array.isArray(result.items) ? result.items : []).slice(0, 20).filter(item => typeof item?.text === "string" && item.text.length > 0 && item.text.length <= 32768);
      for (const [index, item] of items.entries()) {
        const button = document.createElement("button"); button.type = "button";
        button.className = "pc-clipboard__item";
        button.textContent = Array.from(item.text.replace(/\s+/g, " ")).slice(0, 140).join("");
        button.setAttribute("aria-label", `Clipboard item ${index + 1}: ${button.textContent}`);
        button.addEventListener("click", () => {
          if (!opened || ticket !== generation || pending) return;
          for (const child of list.children) child.setAttribute("aria-pressed", String(child === button));
          editor.value = item.text; setEditing(true);
          setStatus("Review your text before pasting."); paint();
        });
        button.setAttribute("aria-pressed", "false"); list.append(button);
      }
      setStatus(items.length ? (result.skipped ? "Recent text · Some items exceed the text limit." : "Choose a text item. Images and files are not shown.") : "No recent text in the PC clipboard history.");
    } catch (error) {
      if (opened && ticket === generation && error.name !== "AbortError") setStatus(error.message || "Could not load PC clipboard.");
    }
  }
  toggle.addEventListener("click", () => {
    if (opened) { close(); return; }
    if (!supported || !isReady()) return;
    opened = true; keyboard.suspend(true); panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true"); refresh();
  });
  $("pc-clipboard-close").addEventListener("click", () => { close(); toggle.focus(); });
  $("pc-clipboard-back").addEventListener("click", () => { setEditing(false); setStatus("Choose a text item."); });
  $("pc-clipboard-refresh").addEventListener("click", refresh);
  editor.addEventListener("input", paint);
  panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); toggle.focus(); } });
  // Keep the editor/keyboard stable until the explicit click is dispatched.
  paste.addEventListener("pointerdown", event => event.preventDefault());
  paste.addEventListener("click", () => {
    const target = keyboard.target();
    if (!opened || pending || !target || !isReady() || !editor.value || editor.value.length > 32768) return;
    if (!send({ type: "paste", target, text: editor.value })) { setStatus("Touchpad disconnected. Reconnect before pasting."); return; }
    pending = true; paint();
    timer = setTimeout(() => { if (pending) setStatus("Paste has not been confirmed. Reconnect the touchpad before trying again."); }, 8000);
  });
  return {
    configure(value) { supported = Boolean(value); paint(); },
    paint,
    message(event) {
      if (event.type === "focus") { paint(); return; }
      if (!pending || !["paste-result", "input-error"].includes(event.type)) return;
      clearTimeout(timer); pending = false;
      if (event.type === "paste-result") { editor.value = ""; setEditing(false); setStatus("Paste sent to the PC."); }
      else { setStatus("Paste was blocked or PC focus changed. Select the PC field and try again."); }
      paint();
    },
    reset() { clearTimeout(timer); pending = false; close(); },
  };
}
