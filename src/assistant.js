/**
 * Voice assistant brain. Understands a fixed set of PC commands without any AI service,
 * and forwards everything else to Gemini when the owner has pasted a key on the PC.
 * Nothing here touches the PC: it returns an intent, and the server decides whether to run it.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { privateDirectory, writePrivateJson } from "./private-store.js";

const WAKE = /^(?:(?:hey|ok|okay|hi)\s+)?(?:tara|tera)\b[\s,.:!-]*/;
const FILLER = /\b(?:please|could you|can you|would you|for me|the pc|my pc|the computer|my computer)\b/g;
const norm = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s%.']/gu, " ").replace(WAKE, "").replace(FILLER, " ").replace(/\s+/g, " ").trim();
const number = (text) => { const m = text.match(/\b(\d{1,3})\b/); return m ? Number(m[1]) : null; };

const POWER = { sleep: ["sleep", "Put the PC to sleep?"], shutdown: ["shutdown", "Shut the PC down?"], restart: ["restart", "Restart the PC?"], lock: ["lock", "Lock the PC?"] };

/** Which installed app the words name. Returns null unless exactly one app fits best. */
export function matchApp(name, apps) {
  const want = norm(name).replace(/^(?:the|my)\s+/, "");
  if (!want) return null;
  const score = (app) => {
    const n = norm(app.name || "");
    if (n === want) return 4;
    if (n.startsWith(want) || want.startsWith(n) && n.length >= 3) return 3;
    if (n.split(" ").includes(want)) return 3;
    if (n.includes(want) && want.length >= 3) return 1;
    return 0;
  };
  const ranked = apps.map((app) => ({ app, s: score(app) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.app.name.length - b.app.name.length);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].s === ranked[1].s && ranked[0].s < 4 && ranked[0].app.name.length === ranked[1].app.name.length) return null;
  return ranked[0].app;
}

export function parseIntent(input) {
  const text = norm(input);
  if (!text) return { type: "none" };
  let m;
  if (/\b(?:stop|cancel|turn off)\b.*\b(?:render watch|render watcher|watching)\b/.test(text)) return { type: "render", action: "off", say: "Okay, I stopped watching the render." };
  // Render watcher: "tell me when my render finishes (then sleep|shut down)"
  if (/\brender\b/.test(text) && /\b(?:finish|finishes|done|ends|complete|completes|over)\b|\bwatch\b/.test(text)) {
    const action = /\bshut ?down\b|power off/.test(text) ? "shutdown" : /\bsleep\b/.test(text) ? "sleep" : "notify";
    return { type: "render", action, say: action === "notify" ? "Okay, I'll tell you when the render finishes." : "Okay. When the render finishes I'll ask the PC to " + (action === "sleep" ? "sleep." : "shut down.") };
  }
  // Power: always confirmed by the caller.
  if (/\b(?:shut ?down|power off|turn off)\b/.test(text)) return { type: "power", verb: "shutdown", say: POWER.shutdown[1] };
  if (/\b(?:restart|reboot)\b/.test(text)) return { type: "power", verb: "restart", say: POWER.restart[1] };
  if (/\block\b/.test(text)) return { type: "power", verb: "lock", say: POWER.lock[1] };
  if (/\b(?:sleep|hibernate)\b/.test(text) && !/render|finish|done|when/.test(text)) return { type: "power", verb: "sleep", say: POWER.sleep[1] };
  // Volume, brightness, media
  if ((m = text.match(/\b(?:set )?volume (?:to|at) (\d{1,3})\b/)) || (m = text.match(/\b(\d{1,3}) ?% ?volume\b/))) return { type: "control", verb: "volume-set", value: Math.min(100, Number(m[1])), say: "Volume " + Math.min(100, Number(m[1])) + " percent." };
  if (/\b(?:unmute|mute)\b/.test(text)) return { type: "control", verb: "mute-toggle", say: "Done." };
  if (/\b(?:volume up|louder|turn it up|raise the volume|increase the volume)\b/.test(text)) return { type: "control", verb: "volume-up", say: "Louder." };
  if (/\b(?:volume down|quieter|softer|turn it down|lower the volume|decrease the volume|reduce the volume)\b/.test(text)) return { type: "control", verb: "volume-down", say: "Quieter." };
  if ((m = text.match(/\bbrightness (?:to|at) (\d{1,3})\b/))) return { type: "control", verb: "brightness-set", value: Math.min(100, Number(m[1])), say: "Brightness " + Math.min(100, Number(m[1])) + " percent." };
  if (/\b(?:next (?:song|track|video)|skip)\b/.test(text)) return { type: "control", verb: "media-next", say: "Next." };
  if (/\b(?:previous|last) (?:song|track|video)\b|\bgo back\b/.test(text)) return { type: "control", verb: "media-previous", say: "Previous." };
  if (/^(?:pause|play|resume|stop|continue)\b/.test(text) && !/^(?:play|stop) \w+ \w+/.test(text) || /^(?:pause|resume) /.test(text)) return { type: "control", verb: /^stop\b/.test(text) ? "media-stop" : "media-play-pause", say: /^pause\b/.test(text) ? "Paused." : "Okay." };
  // Status
  if (/\b(?:battery)\b/.test(text)) return { type: "stats", what: "battery" };
  if (/\bcpu|processor\b/.test(text)) return { type: "stats", what: "cpu" };
  if (/\bgpu|graphics card\b/.test(text)) return { type: "stats", what: "gpu" };
  if (/\bwi ?fi|wifi|internet|signal\b/.test(text)) return { type: "stats", what: "wifi" };
  // Apps
  if ((m = text.match(/^(?:open|launch|start|run)\s+(.+)$/))) return { type: "launch", name: m[1] };
  if ((m = text.match(/^(?:close|quit|exit|kill)\s+(.+)$/))) return { type: "close", name: m[1] };
  if ((m = text.match(/^(?:switch to|go to|focus|show|bring up)\s+(.+)$/))) return { type: "focus", name: m[1] };
  return { type: "none" };
}

export const statsSentence = (what, stats = {}) => {
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  if (what === "battery") return n(stats.battery) === null ? "This PC has no battery reading." : `The PC battery is at ${n(stats.battery)} percent${stats.charging ? " and charging" : ""}.`;
  if (what === "cpu") return n(stats.cpu) === null ? "I can't read the processor right now." : `The processor is at ${n(stats.cpu)} percent.`;
  if (what === "gpu") return n(stats.gpu?.util) === null ? "I can't read the graphics card on this PC." : `The graphics card is at ${n(stats.gpu.util)} percent.`;
  const w = n(stats.wifi);
  return w === null ? "I can't read the Wi-Fi signal right now." : `The Wi-Fi signal is ${w >= 75 ? "strong" : w >= 50 ? "good" : w >= 25 ? "weak" : "very weak"}, ${w} percent.`;
};

// ---- Gemini ---------------------------------------------------------------------
export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";
export const DEFAULT_MODEL = "gemini-flash-latest";
// Google issues keys like "AIza…" and the newer dotted "AQ.…" style. Anything else is refused before it is stored or sent.
const KEY_SHAPE = /^[A-Za-z0-9._-]{20,256}$/;
const MODEL_SHAPE = /^[a-z0-9][a-z0-9.\-]{2,63}$/;
const SYSTEM = "You are the voice assistant inside Tara, a phone dock for a Windows PC used for Blender and DaVinci Resolve. " +
  "Answer in at most three short spoken sentences. No markdown, lists, emoji or links. If you are not sure, say so briefly.";

export async function askGemini(question, { key, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!KEY_SHAPE.test(key || "") || !MODEL_SHAPE.test(model)) throw Object.assign(new Error("The assistant's AI key is not set up on the PC."), { status: 503, exposed: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${GEMINI_ENDPOINT}${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: controller.signal, redirect: "error",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: String(question).slice(0, 1000) }] }], generationConfig: { maxOutputTokens: 300, temperature: 0.6 } }),
    });
    if (response.status === 429) throw Object.assign(new Error("The free AI limit was reached for now. Try again in a minute."), { status: 429, exposed: true });
    if (response.status === 400 || response.status === 403) throw Object.assign(new Error("Google rejected the AI key. Paste a fresh key on the PC."), { status: 502, exposed: true });
    if (!response.ok) throw new Error("AI unavailable");
    const body = await response.json();
    const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Empty answer");
    return text.slice(0, 600);
  } catch (error) {
    if (error.exposed) throw error;
    throw Object.assign(new Error("I couldn't reach the AI service. Check the PC's internet connection."), { status: 502, exposed: true });
  } finally { clearTimeout(timer); }
}

/** Key lives only on the PC, in a user-only folder, and is never returned to any client. */
export function createKeyStore({ dir, env = process.env, readFile = (p) => readFileSync(p, "utf8") } = {}) {
  const file = dir ? join(dir, "assistant.json") : null;
  const read = () => { try { return JSON.parse(readFile(file)); } catch { return {}; } };
  return {
    get() { const saved = file ? read() : {}; return { key: saved.apiKey || env.GEMINI_API_KEY || "", model: saved.model || env.GEMINI_MODEL || DEFAULT_MODEL }; },
    status() { const { key, model } = this.get(); return { configured: KEY_SHAPE.test(key), model }; },
    async set(key, model) {
      if (!file) throw Object.assign(new Error("No place to save the key."), { status: 500, exposed: true });
      if (key !== "" && !KEY_SHAPE.test(key)) throw Object.assign(new Error("That doesn't look like a Google AI key. Copy it again from aistudio.google.com/apikey, with nothing before or after it."), { status: 400, exposed: true });
      if (model && !MODEL_SHAPE.test(model)) throw Object.assign(new Error("That model name looks wrong."), { status: 400, exposed: true });
      await privateDirectory(dir);
      writePrivateJson(file, key === "" ? {} : { apiKey: key, model: model || DEFAULT_MODEL });
    },
  };
}
