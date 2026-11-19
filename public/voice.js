/** Voice assistant: listen on the phone ("Tara" / "Hey Tara" or tap), ask the PC, speak the reply in the phone's own voice. */
export function createVoice({ api, get = (id) => document.getElementById(id), notify, buzz = () => {}, android = globalThis.TaraAndroid, SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, speech = globalThis.speechSynthesis }) {
  const dialog = get("voice"), heard = get("voice-heard"), said = get("voice-said"), mic = get("voice-mic"), confirmBar = get("voice-confirm");
  const modelNote = get("voice-model-note"), modelButton = get("voice-model-button"), namesInput = get("voice-names");
  const keyNote = get("voice-key-note"), keyLink = get("voice-key-link");
  let listening = false, recognizer = null, confirmVerb = null;
  const nativeVoice = typeof android?.startListening === "function";
  const offlineCapable = typeof android?.downloadVoiceModel === "function";
  const canListen = nativeVoice || Boolean(SpeechRecognition);
  const show = (h, s) => { if (h !== undefined) heard.textContent = h; if (s !== undefined) said.textContent = s; };
  const modelReady = () => { try { return offlineCapable && JSON.parse(android.voiceModelState()).ready === true; } catch { return false; } };

  // The floating Tara orb: shown instead of the full dialog when the wake word fires while the dialog is closed.
  const orb = get("tara-orb"), orbWords = get("tara-orb-words"), orbReply = get("tara-orb-reply"), orbCore = get("tara-orb-core");
  let orbOn = false, orbTimer = null;
  const orbShow = () => { if (!orb || orbOn) return; orbOn = true; orb.hidden = false; try { orb.showPopover?.(); } catch { /* already open */ } };
  function orbHide() { clearTimeout(orbTimer); if (!orb || !orbOn) return; orbOn = false; orb.dataset.state = "idle"; orb.style.removeProperty("--level"); try { orb.hidePopover?.(); } catch { /* not open */ } orb.hidden = true; }
  function orbState(state, { words, reply, hideAfter } = {}) {
    if (!orb || !orbOn) return;
    clearTimeout(orbTimer); orb.dataset.state = state;
    if (words !== undefined && orbWords) orbWords.textContent = words;
    if (reply !== undefined && orbReply) orbReply.textContent = reply;
    if (hideAfter) orbTimer = setTimeout(orbHide, hideAfter);
  }
  function onLevel(level) { if (orbOn && orb.dataset.state === "listening") orb.style.setProperty("--level", String(Math.max(0, Math.min(1, level)))); }
  orbCore?.addEventListener("click", () => { try { android?.stopListening?.(); } catch { /* older shell */ } listening = false; orbHide(); });

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
      if (reply.needsConfirm) { confirmVerb = reply.needsConfirm; orbHide(); openDialog(); confirmBar.hidden = false; }
      else orbState("answer", { reply: reply.say, hideAfter: 4500 });
    } catch (error) { show(undefined, error.message); speak(error.message); orbState("error", { reply: error.message, hideAfter: 3500 }); }
  }
  function openDialog() { if (!dialog.open) { confirmBar.hidden = true; dialog.showModal(); paint(); } }
  function onResult(text, final = true) {
    // Hands-free speech can arrive while the screen is closed. Open it so a "Yes/No" question can be answered.
    if (final && !orbOn) openDialog();
    show("“" + text + "”"); orbState(final ? "thinking" : "listening", { words: "“" + text + "”" });
    if (!final) return;
    listening = false; paint();
    if (text.trim()) send(text.trim());
  }
  /** The offline engine finished a command. */
  function onUtterance(text) {
    listening = false; paint();
    const final = (text || "").trim();
    if (!final) return onError();
    onResult(final, true);
  }
  function onWake() {
    listening = true; show("", "Listening…"); buzz(15);
    if (dialog.open || !orb) { openDialog(); paint(); return; }
    orbShow(); orbState("listening", { words: "", reply: "" }); paint();
  }
  function onError(message) { listening = false; paint(); show(undefined, message || "I didn't catch that."); orbState("error", { reply: message || "Didn't catch that. Try again.", hideAfter: 3000 }); }
  function onNeedModel() { orbHide(); openDialog(); get("voice-handsfree").checked = false; try { localStorage.setItem("tara-handsfree", "0"); } catch { /* private mode */ } show("", "Download the offline voice model first, then turn hands-free on."); paintModel(); }

  // ---- offline model (Android only) ----
  function paintModel(state) {
    if (!modelNote) return;
    modelNote.parentElement.hidden = !offlineCapable;
    if (!offlineCapable) return;
    const ready = state?.ready ?? modelReady();
    modelNote.textContent = state?.error || (ready ? "Offline voice is ready on this phone." : state && state.progress != null ? "Downloading… " + state.progress + "%" : "Needed for hands-free. About 40 MB, downloaded once.");
    modelButton.textContent = state?.error ? "Try again" : "Download voice model";
    const strict = get("voice-strict"); if (strict) strict.checked = (() => { try { return android.wakeStrict() === true; } catch { return false; } })();
    modelButton.hidden = ready; modelButton.disabled = Boolean(state && state.progress != null && !state.error && !ready);
    if (namesInput) namesInput.value = (() => { try { return android.wakeNames(); } catch { return ""; } })();
  }
  function onModelState(state) { paintModel(state); if (state?.ready) { show(undefined, "Offline voice is ready."); get("voice-handsfree").dispatchEvent(new Event("voice-model-ready")); } }

  /** The key lives on the PC for safety, so the phone says where to paste it and opens the page that makes one. */
  async function refreshKey() {
    if (!keyNote) return;
    let configured = false;
    try { configured = (await api("/api/assistant")).ai === true; } catch { return; }
    const port = globalThis.location?.port;
    keyNote.textContent = configured ? "A Google AI key is saved on the PC, so you can ask general questions."
      : "PC commands work without it. To ask general questions: tap below to get a free key, copy it, then on the PC open http://localhost:" + (port || "<port>") + "/cast and paste it into the box.";
    if (keyLink) keyLink.hidden = configured || typeof android?.openAiKeyPage !== "function";
  }

  function start() {
    if (listening) return stop();
    if (!canListen) return show(undefined, "This phone can't listen in Tara. Update the Android app.");
    speech?.cancel?.(); show("", "Listening…"); buzz(12);
    listening = true; paint();
    if (nativeVoice) { android.startListening(); return; }
    recognizer = new SpeechRecognition(); recognizer.lang = "en-US"; recognizer.interimResults = true; recognizer.maxAlternatives = 1;
    recognizer.onresult = (e) => { const r = e.results[e.results.length - 1]; onResult(r[0].transcript, r.isFinal); };
    recognizer.onerror = (e) => onError(e.error === "not-allowed" ? "Allow the microphone for Tara." : undefined);
    recognizer.onend = () => { if (listening) { listening = false; paint(); } };
    recognizer.start();
  }
  function stop() { if (nativeVoice) android.stopListening?.(); try { recognizer?.stop(); } catch { /* already stopped */ } listening = false; paint(); }
  // The Android shell calls these.
  globalThis.TaraVoice = { onResult, onError, onUtterance, onWake, onLevel, onModelState, onNeedModel };
  mic.addEventListener("click", start);
  modelButton?.addEventListener("click", () => { try { android.downloadVoiceModel(); paintModel({ ready: false, progress: 0 }); } catch { /* older shell */ } });
  keyLink?.addEventListener("click", () => { try { android.openAiKeyPage(); } catch { /* older shell */ } });
  namesInput?.addEventListener("change", () => { try { android.setWakeNames(namesInput.value); namesInput.value = android.wakeNames(); } catch { /* older shell */ } });
  get("voice-strict")?.addEventListener("change", (event) => { try { android.setWakeStrict(event.target.checked); } catch { /* older shell */ } });
  get("voice-yes").addEventListener("click", () => { if (confirmVerb) send("", confirmVerb); });
  get("voice-no").addEventListener("click", () => { confirmBar.hidden = true; confirmVerb = null; show(undefined, "Okay, cancelled."); });
  dialog.addEventListener("close", () => { orbHide(); stop(); speech?.cancel?.(); android?.stopSpeaking?.(); });
  return { open(autoListen = false) { show("", ""); confirmBar.hidden = true; paint(); paintModel(); refreshKey(); if (!dialog.open) dialog.showModal(); if (autoListen) start(); }, send, onResult, onError, onUtterance, refresh: refreshKey };
}
