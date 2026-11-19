/** Voice assistant: listen (phone), ask the PC, speak the reply. */
export function createVoice({ api, get = (id) => document.getElementById(id), notify, buzz = () => {}, android = globalThis.WinDockAndroid, SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, speech = globalThis.speechSynthesis }) {
  const dialog = get("voice"), heard = get("voice-heard"), said = get("voice-said"), mic = get("voice-mic"), confirmBar = get("voice-confirm");
  let listening = false, recognizer = null, confirmVerb = null;
  const nativeVoice = typeof android?.startListening === "function";
  const canListen = nativeVoice || Boolean(SpeechRecognition);
  const show = (h, s) => { if (h !== undefined) heard.textContent = h; if (s !== undefined) said.textContent = s; };
  function speak(text) {
    if (!text) return;
    if (typeof android?.speak === "function") android.speak(text);
    else if (speech) { speech.cancel(); speech.speak(new SpeechSynthesisUtterance(text)); }
  }
  function paint() { mic.setAttribute("aria-pressed", String(listening)); mic.textContent = listening ? "Listening… tap to stop" : "🎤 Tap and speak"; mic.disabled = !canListen; }
  async function send(text, confirm = null) {
    confirmBar.hidden = true; confirmVerb = null;
    try {
      const reply = await api("/api/assistant", { method: "POST", body: JSON.stringify(confirm ? { confirm } : { text }) });
      show(undefined, reply.say); speak(reply.say);
      if (reply.needsConfirm) { confirmVerb = reply.needsConfirm; confirmBar.hidden = false; }
    } catch (error) { show(undefined, error.message); speak(error.message); }
  }
  function onResult(text, final = true) {
    // Hands-free speech can arrive while the screen is closed. Open it so a "Yes/No" question can be answered.
    if (final && !dialog.open) { confirmBar.hidden = true; dialog.showModal(); paint(); }
    show("“" + text + "”");
    if (!final) return;
    listening = false; paint();
    if (text.trim()) send(text.trim());
  }
  function onError(message) { listening = false; paint(); show(undefined, message || "I didn't catch that."); }
  function start() {
    if (listening) return stop();
    if (!canListen) return show(undefined, "This phone can't listen in the dock. Update the Android app.");
    speech?.cancel?.(); show("", "Listening…"); buzz(12);
    listening = true; paint();
    if (nativeVoice) { android.startListening(); return; }
    recognizer = new SpeechRecognition(); recognizer.lang = "en-US"; recognizer.interimResults = true; recognizer.maxAlternatives = 1;
    recognizer.onresult = (e) => { const r = e.results[e.results.length - 1]; onResult(r[0].transcript, r.isFinal); };
    recognizer.onerror = (e) => onError(e.error === "not-allowed" ? "Allow the microphone for the dock." : undefined);
    recognizer.onend = () => { if (listening) { listening = false; paint(); } };
    recognizer.start();
  }
  function stop() { if (nativeVoice) android.stopListening?.(); try { recognizer?.stop(); } catch { /* already stopped */ } listening = false; paint(); }
  // The Android shell calls these.
  globalThis.WinDockVoice = { onResult, onError };
  mic.addEventListener("click", start);
  get("voice-yes").addEventListener("click", () => { if (confirmVerb) send("", confirmVerb); });
  get("voice-no").addEventListener("click", () => { confirmBar.hidden = true; confirmVerb = null; show(undefined, "Okay, cancelled."); });
  dialog.addEventListener("close", () => { stop(); speech?.cancel?.(); android?.stopSpeaking?.(); });
  return { open(autoListen = false) { show("", ""); confirmBar.hidden = true; paint(); if (!dialog.open) dialog.showModal(); if (autoListen) start(); }, send, onResult, onError };
}
