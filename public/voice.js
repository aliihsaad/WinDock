/** Voice assistant: listen (phone), ask the PC, speak the reply. */
const VOICE = { "x-windock-assistant": "voice" };
const bytesFromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function createVoice({ api, rawFetch = (...a) => fetch(...a), get = (id) => document.getElementById(id), notify, buzz = () => {}, android = globalThis.WinDockAndroid, SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, speech = globalThis.speechSynthesis, makeAudio = (url) => new Audio(url) }) {
  const dialog = get("voice"), heard = get("voice-heard"), said = get("voice-said"), mic = get("voice-mic"), confirmBar = get("voice-confirm");
  const modelNote = get("voice-model-note"), modelButton = get("voice-model-button"), namesInput = get("voice-names");
  const packNote = get("voice-pack-note"), packButton = get("voice-pack-button"), keyNote = get("voice-key-note"), keyLink = get("voice-key-link");
  let listening = false, recognizer = null, confirmVerb = null, pack = { installed: false, stt: false, tts: false, installing: false, progress: 0, error: "" }, packTimer = null, player = null;
  const nativeVoice = typeof android?.startListening === "function";
  const offlineCapable = typeof android?.downloadVoiceModel === "function";
  const canListen = nativeVoice || Boolean(SpeechRecognition);
  const show = (h, s) => { if (h !== undefined) heard.textContent = h; if (s !== undefined) said.textContent = s; };
  const modelReady = () => { try { return offlineCapable && JSON.parse(android.voiceModelState()).ready === true; } catch { return false; } };

  // ---- speaking: the PC's natural voice when installed, the phone's own voice otherwise ----
  function speakNative(text) {
    if (typeof android?.speak === "function") android.speak(text);
    else if (speech) { speech.cancel(); speech.speak(new SpeechSynthesisUtterance(text)); }
  }
  async function speak(text) {
    if (!text) return;
    if (pack.tts) {
      try {
        const res = await rawFetch("/api/assistant/speak", { method: "POST", credentials: "same-origin", headers: { ...VOICE, "content-type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok) throw new Error("no speech");
        const url = URL.createObjectURL(await res.blob());
        player?.pause(); player = makeAudio(url);
        // The microphone must not hear the reply.
        const release = () => { android?.pauseListening?.(false); URL.revokeObjectURL(url); };
        android?.pauseListening?.(true);
        player.onended = release; player.onerror = () => { release(); speakNative(text); };
        await player.play();
        return;
      } catch { android?.pauseListening?.(false); /* fall through to the phone's voice */ }
    }
    speakNative(text);
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
  function openDialog() { if (!dialog.open) { confirmBar.hidden = true; dialog.showModal(); paint(); } }
  function onResult(text, final = true) {
    // Hands-free speech can arrive while the screen is closed. Open it so a "Yes/No" question can be answered.
    if (final) openDialog();
    show("“" + text + "”");
    if (!final) return;
    listening = false; paint();
    if (text.trim()) send(text.trim());
  }
  /** Offline phone engine finished a command. The PC's Whisper, when installed, gets the audio for a second, more accurate opinion. */
  async function onUtterance(text, audioBase64) {
    listening = false; paint();
    let final = (text || "").trim();
    if (pack.stt && audioBase64) {
      try {
        const res = await rawFetch("/api/assistant/audio", { method: "POST", credentials: "same-origin", headers: { ...VOICE, "content-type": "application/octet-stream" }, body: bytesFromBase64(audioBase64) });
        if (res.ok) { const better = String((await res.json()).text || "").trim(); if (better) final = better; }
      } catch { /* keep the phone's own text */ }
    }
    if (!final) return onError();
    onResult(final, true);
  }
  function onWake() { openDialog(); listening = true; paint(); show("", "Listening…"); buzz(15); }
  function onError(message) { listening = false; paint(); show(undefined, message || "I didn't catch that."); }
  function onNeedModel() { openDialog(); get("voice-handsfree").checked = false; try { localStorage.setItem("windock-handsfree", "0"); } catch { /* private mode */ } show("", "Download the offline voice model first, then turn hands-free on."); paintModel(); }

  // ---- phone model (Android only) ----
  function paintModel(state) {
    if (!modelNote) return;
    modelNote.parentElement.hidden = !offlineCapable;
    if (!offlineCapable) return;
    const ready = state?.ready ?? modelReady();
    modelNote.textContent = state?.error || (ready ? "Offline voice is ready on this phone." : state && state.progress != null ? "Downloading… " + state.progress + "%" : "Needed for hands-free. About 40 MB, downloaded once.");
    modelButton.hidden = ready; modelButton.disabled = Boolean(state && state.progress != null && !state.error && !ready);
    if (namesInput) namesInput.value = (() => { try { return android.wakeNames(); } catch { return ""; } })();
  }
  function onModelState(state) { paintModel(state); if (state?.ready) { show(undefined, "Offline voice is ready."); get("voice-handsfree").dispatchEvent(new Event("voice-model-ready")); } }

  // ---- PC voice pack ----
  function paintPack() {
    if (!packNote) return;
    packNote.textContent = pack.error || (pack.installing ? "Installing on the PC… " + pack.progress + "%" : pack.installed ? "Installed: accurate listening and a natural voice." : "Optional. Accurate listening and a natural voice, about 150 MB on the PC.");
    packButton.textContent = pack.installed ? "Remove" : "Install on PC"; packButton.disabled = pack.installing;
    try { android?.setSendAudio?.(pack.stt); } catch { /* older shell */ }
  }
  /** The key lives on the PC for safety, so the phone says where to paste it and opens the page that makes one. */
  function paintKey(configured) {
    if (!keyNote) return;
    const port = globalThis.location?.port;
    keyNote.textContent = configured ? "A Google AI key is saved on the PC, so you can ask general questions."
      : "PC commands work without it. To ask general questions: tap below to get a free key, copy it, then on the PC open http://localhost:" + (port || "<dock port>") + "/cast and paste it into the box.";
    if (keyLink) keyLink.hidden = configured || typeof android?.openAiKeyPage !== "function";
  }
  async function refresh() {
    try { const info = await api("/api/assistant"); pack = { ...pack, ...(info.voice || {}) }; paintKey(info.ai === true); } catch { return; }
    paintPack();
    clearTimeout(packTimer);
    if (pack.installing) packTimer = setTimeout(refresh, 2000);
  }
  async function packAction() {
    try { pack = { ...pack, ...(await api("/api/assistant/voicepack", { method: "POST", headers: { ...VOICE, "content-type": "application/json" }, body: JSON.stringify({ action: pack.installed ? "remove" : "install" }) })) }; }
    catch (error) { pack.error = error.message; }
    paintPack(); if (pack.installing) refresh();
  }

  function start() {
    if (listening) return stop();
    if (!canListen) return show(undefined, "This phone can't listen in the dock. Update the Android app.");
    speech?.cancel?.(); player?.pause(); show("", "Listening…"); buzz(12);
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
  globalThis.WinDockVoice = { onResult, onError, onUtterance, onWake, onModelState, onNeedModel };
  mic.addEventListener("click", start);
  modelButton?.addEventListener("click", () => { try { android.downloadVoiceModel(); paintModel({ ready: false, progress: 0 }); } catch { /* older shell */ } });
  packButton?.addEventListener("click", packAction);
  keyLink?.addEventListener("click", () => { try { android.openAiKeyPage(); } catch { /* older shell */ } });
  namesInput?.addEventListener("change", () => { try { android.setWakeNames(namesInput.value); namesInput.value = android.wakeNames(); } catch { /* older shell */ } });
  get("voice-yes").addEventListener("click", () => { if (confirmVerb) send("", confirmVerb); });
  get("voice-no").addEventListener("click", () => { confirmBar.hidden = true; confirmVerb = null; show(undefined, "Okay, cancelled."); });
  dialog.addEventListener("close", () => { stop(); speech?.cancel?.(); player?.pause(); android?.stopSpeaking?.(); clearTimeout(packTimer); });
  return { open(autoListen = false) { show("", ""); confirmBar.hidden = true; paint(); paintModel(); refresh(); if (!dialog.open) dialog.showModal(); if (autoListen) start(); }, send, onResult, onError, onUtterance, refresh };
}
