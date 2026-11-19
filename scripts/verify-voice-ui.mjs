import { createChecker } from "./lib/assert.mjs";
import { createVoice } from "../public/voice.js";
const t = createChecker("voice-ui");
const el = (extra = {}) => ({ listeners: {}, hidden: false, textContent: "", value: "", checked: false, disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }, dispatchEvent(e) { for (const f of this.listeners[e.type] || []) f(e); }, ...extra });
function rig({ voice = { installed: true, stt: true, tts: true, installing: false, progress: 100, error: "" }, rawFetch, android = {} } = {}) {
  const els = {};
  for (const id of ["voice-heard", "voice-said", "voice-mic", "voice-confirm", "voice-model-button", "voice-names", "voice-pack-note", "voice-pack-button", "voice-handsfree", "voice-yes", "voice-no"]) els[id] = el();
  els["voice-model-note"] = el({ parentElement: { hidden: true } });
  els.voice = el({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  const calls = []; const heard = [];
  const api = async (path, opts = {}) => {
    calls.push([path, opts.body]);
    if (path === "/api/assistant" && !opts.method) return { ai: false, destructive: false, voice };
    if (path === "/api/assistant") { heard.push(JSON.parse(opts.body)); return { say: "Quieter." }; }
    return {};
  };
  const pauses = [], spoken = [];
  const players = [];
  const v = createVoice({
    api, rawFetch, get: (id) => els[id], notify() {}, speech: null, SpeechRecognition: null,
    android: { startListening() {}, speak: (x) => spoken.push(x), pauseListening: (on) => pauses.push(on), setSendAudio() {}, voiceModelState: () => JSON.stringify({ ready: false }), wakeNames: () => "dock, sid", downloadVoiceModel() {}, ...android },
    makeAudio: (url) => { const p = { url, pause() {}, play: async () => {} }; players.push(p); return p; },
  });
  return { v, els, calls, heard, pauses, spoken, players };
}
const b64 = Buffer.alloc(6400).toString("base64");

{ // PC Whisper gives a better transcript than the phone's own text
  const sent = [];
  const r = rig({ rawFetch: async (path, opts) => { sent.push([path, opts.body.length, opts.headers["x-windock-assistant"]]); return new Response(JSON.stringify({ text: "volume down" })); } });
  await r.v.refresh();
  await r.v.onUtterance("volume dow", b64);
  t.deepEqual(sent[0], ["/api/assistant/audio", 6400, "voice"], "audio goes to the PC with the voice header");
  t.equal(r.heard[0].text, "volume down", "the PC transcript is used");
  t.ok(r.els.voice.open, "dialog opens for a hands-free result");
}
{ // PC unreachable: the phone's text still works
  const r = rig({ rawFetch: async () => { throw new Error("offline"); } });
  await r.v.refresh();
  await r.v.onUtterance("open blender", b64);
  t.equal(r.heard[0].text, "open blender", "falls back to the phone's text");
}
{ // no pack: nothing is uploaded
  let uploaded = 0;
  const r = rig({ voice: { installed: false, stt: false, tts: false }, rawFetch: async () => { uploaded++; return new Response("{}"); } });
  await r.v.refresh(); await r.v.onUtterance("mute", b64);
  t.deepEqual([uploaded, r.heard[0].text], [0, "mute"], "no pack means no upload");
}
{ // nothing heard
  const r = rig({ rawFetch: async () => new Response("{}") });
  await r.v.refresh(); await r.v.onUtterance("", null);
  t.equal(r.els["voice-said"].textContent, "I didn't catch that.", "silence is reported");
  t.equal(r.heard.length, 0, "silence is not sent");
}
{ // spoken reply: PC voice plays, microphone pauses and resumes
  const r = rig({ rawFetch: async () => new Response(new Blob(["RIFFfake"])) });
  await r.v.refresh(); await r.v.send("volume down");
  await new Promise((go) => setTimeout(go, 20));
  t.equal(r.players.length, 1, "the PC voice is played");
  t.deepEqual(r.pauses, [true], "microphone paused while it speaks");
  r.players[0].onended();
  t.deepEqual(r.pauses, [true, false], "microphone resumes afterwards");
  t.equal(r.spoken.length, 0, "phone voice not used when the PC voice worked");
}
{ // PC voice fails: the phone's voice speaks instead
  const r = rig({ rawFetch: async () => new Response("nope", { status: 500 }) });
  await r.v.refresh(); await r.v.send("volume down");
  await new Promise((go) => setTimeout(go, 20));
  t.deepEqual(r.spoken, ["Quieter."], "falls back to the phone's voice");
}
{ // hands-free needs the model
  const r = rig({ rawFetch: async () => new Response("{}") });
  r.els["voice-handsfree"].checked = true; globalThis.WinDockVoice.onNeedModel();
  t.deepEqual([r.els["voice-handsfree"].checked, r.els.voice.open], [false, true], "hands-free switch turns off and the dialog explains");
  t.ok(r.els["voice-said"].textContent.includes("Download"), "tells the person what to do");
}
t.done("voice-ui verification passed");
