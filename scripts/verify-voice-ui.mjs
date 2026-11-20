import { createChecker } from "./lib/assert.mjs";
import { createVoice } from "../public/voice.js";
const t = createChecker("voice-ui");
const el = (extra = {}) => ({ listeners: {}, hidden: false, textContent: "", value: "", checked: false, disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }, dispatchEvent(e) { for (const f of this.listeners[e.type] || []) f(e); }, ...extra });
function rig({ ai = false, android = {} } = {}) {
  const els = {};
  for (const id of ["voice-key-note", "voice-key-link", "voice-heard", "voice-said", "voice-mic", "voice-confirm", "voice-model-button", "voice-names", "voice-handsfree", "voice-yes", "voice-no"]) els[id] = el();
  els["voice-model-note"] = el({ parentElement: { hidden: true } });
  els.voice = el({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  const heard = [], spoken = [];
  const api = async (path, opts = {}) => { if (path === "/api/assistant" && !opts.method) return { ai }; heard.push(JSON.parse(opts.body)); return { say: "Quieter." }; };
  const v = createVoice({ api, get: (id) => els[id], notify() {}, speech: null, SpeechRecognition: null,
    android: { startListening() {}, speak: (x) => spoken.push(x), voiceModelState: () => JSON.stringify({ ready: false }), wakeNames: () => "tara", downloadVoiceModel() {}, ...android } });
  return { v, els, heard, spoken };
}
{ // the offline engine's text is sent to the PC and the reply is spoken by the phone
  const r = rig(); r.v.onUtterance("volume down");
  await new Promise((go) => setTimeout(go, 10));
  t.equal(r.heard[0].text, "volume down", "command text goes to the PC");
  t.ok(r.els.voice.open, "dialog opens for a hands-free result");
  t.deepEqual(r.spoken, ["Quieter."], "reply is spoken by the phone");
}
{ // nothing heard
  const r = rig(); r.v.onUtterance("");
  t.equal(r.els["voice-said"].textContent, "I didn't catch that.", "silence is reported");
  t.equal(r.heard.length, 0, "silence is not sent");
}
{ // waking: dialog opens and shows it is listening
  const r = rig(); globalThis.TaraVoice.onWake();
  t.deepEqual([r.els.voice.open, r.els["voice-said"].textContent], [true, "Listening…"], "wake opens the assistant");
}
{ // the orb: wake shows it without opening the dialog, words stream in, errors reset it
  const els = {}; const orbEls = {};
  const r = rig();
  const orb = el({ hidden: true, dataset: {}, style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }, showPopover() {}, hidePopover() {} });
  const rig2 = (() => {
    const e = {};
    for (const id of ["voice-key-note", "voice-key-link", "voice-heard", "voice-said", "voice-mic", "voice-confirm", "voice-model-button", "voice-names", "voice-handsfree", "voice-yes", "voice-no", "tara-orb-words", "tara-orb-reply", "tara-orb-core"]) e[id] = el();
    e["voice-model-note"] = el({ parentElement: { hidden: true } }); e["tara-orb"] = orb;
    e.voice = el({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
    const v = createVoice({ api: async () => ({ say: "Done." }), get: (id) => e[id], notify() {}, speech: null, SpeechRecognition: null, android: { startListening() {}, speak() {}, voiceModelState: () => JSON.stringify({ ready: true }), wakeNames: () => "tara" } });
    return { v, e };
  })();
  globalThis.TaraVoice.onWake();
  t.deepEqual([orb.hidden, orb.dataset.state, rig2.e.voice.open], [false, "listening", false], "wake shows the orb and leaves the dialog closed");
  globalThis.TaraVoice.onResult("open blender", false);
  t.equal(rig2.e["tara-orb-words"].textContent, "“open blender”", "live words appear on the orb");
  globalThis.TaraVoice.onLevel(.5); t.equal(orb.style["--level"], "0.5", "mic level drives the orb");
  globalThis.TaraVoice.onResult("open blender", true);
  t.equal(orb.dataset.state, "thinking", "final words start thinking");
  await new Promise((go) => setTimeout(go, 10));
  t.deepEqual([orb.dataset.state, rig2.e["tara-orb-reply"].textContent], ["answer", "Done."], "reply is shown on the orb");
  t.equal(rig2.e.voice.open, false, "the full dialog stayed closed");
  globalThis.TaraVoice.onWake(); globalThis.TaraVoice.onError();
  t.equal(orb.dataset.state, "error", "silence shows the error state");
  rig2.e["tara-orb-core"].dispatchEvent({ type: "click" });
  t.equal(orb.hidden, true, "tapping the orb dismisses it");
  rig2.v.listenNow();
  t.deepEqual([orb.hidden, orb.dataset.state, rig2.e.voice.open], [false, "listening", false], "the Tara button listens behind the orb, without the dialog");
  rig2.v.listenNow();
  t.equal(orb.hidden, true, "pressing the Tara button again stops listening");
}
{ // hands-free needs the model
  const r = rig(); r.els["voice-handsfree"].checked = true; globalThis.TaraVoice.onNeedModel();
  t.deepEqual([r.els["voice-handsfree"].checked, r.els.voice.open], [false, true], "hands-free switch turns off and the dialog explains");
  t.ok(r.els["voice-said"].textContent.includes("Download"), "tells the person what to do");
}
{ // the AI key note says where to paste it and hides itself once a key exists
  globalThis.location = { port: "8620" };
  const r = rig({ android: { openAiKeyPage() { r.opened = true; } } });
  await r.v.refresh();
  t.ok(r.els["voice-key-note"].textContent.includes("localhost:8620/cast"), "tells where to paste the key");
  t.equal(r.els["voice-key-link"].hidden, false, "get-a-key button shown without a key");
  r.els["voice-key-link"].listeners.click[0](); t.ok(r.opened, "button opens the key page");
  const done = rig({ ai: true }); await done.v.refresh();
  t.equal(done.els["voice-key-link"].hidden, true, "button hidden once a key is saved");
}
t.done("voice-ui verification passed");
