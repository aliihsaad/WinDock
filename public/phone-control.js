/** "PC control on phone Tara": share text both ways between this phone and the PC clipboard. */
export function createPhoneControl({ api, notify, get = (id) => document.getElementById(id), android = globalThis.TaraAndroid }) {
  const dialog = get("phone-control"), box = get("share-text"), status = get("share-status");
  const say = (text) => { status.textContent = text; };
  const MAX = 32768;
  async function toPc() {
    const text = box.value;
    if (!text) return say("Type or paste some text first.");
    if (text.length > MAX) return say("That is too long. Keep it under 32,000 characters.");
    say("Sending…");
    try { await api("/api/share", { method: "POST", body: JSON.stringify({ text }) }); say("On your PC clipboard. Press Ctrl+V there."); notify("Copied to your PC"); }
    catch (error) { say(error.message); }
  }
  async function fromPc() {
    say("Reading your PC clipboard…");
    try {
      const { text } = await api("/api/share", { cache: "no-store" });
      if (!text) return say("The PC clipboard has no text right now.");
      box.value = text; say("Got it. Tap “Copy on phone” to use it here.");
    } catch (error) { say(error.message); }
  }
  async function copyHere() {
    if (!box.value) return say("Nothing to copy yet.");
    try { await navigator.clipboard.writeText(box.value); say("Copied on this phone."); }
    catch { box.focus(); box.select(); say("Long-press the selected text and choose Copy."); }
  }
  get("share-to-pc").addEventListener("click", toPc);
  get("share-from-pc").addEventListener("click", fromPc);
  get("share-copy-here").addEventListener("click", copyHere);
  get("share-clear").addEventListener("click", () => { box.value = ""; say(""); box.focus(); });

  // Receiving PC control commands (Android app only).
  const canBeControlled = typeof android?.phoneControl === "function";
  const card = get("phone-allow-card"), allow = get("phone-allow"), note = get("phone-a11y-note");
  function paintControl() {
    card.hidden = !canBeControlled; if (!canBeControlled) return;
    let st = { enabled: false, allowed: false };
    try { st = JSON.parse(android.phoneControlState()); } catch { /* older shell */ }
    allow.checked = st.allowed;
    note.textContent = st.enabled ? "Accessibility is on for Tara." : "Turn on Tara in Android Accessibility settings, then come back here.";
    get("phone-url").textContent = "On your PC, open http://localhost:" + (globalThis.location?.port || "<port>") + "/phone";
  }
  allow?.addEventListener("change", () => { try { android.setPhoneControlAllowed(allow.checked); } catch { /* older shell */ } paintControl(); });
  get("phone-a11y")?.addEventListener("click", () => { try { android.openAccessibilitySettings(); } catch { /* older shell */ } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && dialog.open) paintControl(); });
  let lastId = null;
  /** Called with each dock snapshot. The first one only records the id so an old command never replays. */
  function onSnapshot(cmd) {
    const id = cmd?.id ?? 0;
    if (lastId === null) { lastId = id; return; }
    if (!id || id === lastId) return;
    lastId = id;
    if (!canBeControlled || !cmd.cmd || cmd.ageMs > 4000) return;
    try { android.phoneControl(JSON.stringify(cmd.cmd)); } catch { /* not allowed or older shell */ }
  }
  return { open() { say(""); paintControl(); if (!dialog.open) dialog.showModal(); }, onSnapshot };
}
