/** "PC control on phone Tara": share text both ways between this phone and the PC clipboard. */
export function createPhoneControl({ api, notify, get = (id) => document.getElementById(id) }) {
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
  return { open() { say(""); if (!dialog.open) dialog.showModal(); } };
}
