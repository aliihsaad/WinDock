import { createChecker } from "./lib/assert.mjs";
import { parseIntent, matchApp, fuzzyApp, statsSentence, askGemini, createKeyStore, GEMINI_ENDPOINT } from "../src/assistant.js";
const t = createChecker("assistant");
const intent = (s) => parseIntent(s);
t.deepEqual([intent("Hey Tara, volume down").verb, intent("make it quieter please").verb, intent("louder").verb], ["volume-down", "volume-down", "volume-up"], "volume words");
t.deepEqual([intent("set volume to 35").value, intent("set the volume to 300").value], [35, 100], "volume number is capped");
t.equal(intent("mute").verb, "mute-toggle", "mute");
t.equal(intent("set brightness to 40").value, 40, "brightness");
t.deepEqual([intent("pause").verb, intent("resume").verb, intent("next song").verb, intent("previous track").verb], ["media-play-pause", "media-play-pause", "media-next", "media-previous"], "music words");
for (const [s, verb] of [["shut down the pc", "shutdown"], ["restart my computer", "restart"], ["lock the pc", "lock"], ["put the pc to sleep", "sleep"]]) t.deepEqual([intent(s).type, intent(s).verb], ["power", verb], "power needs confirmation: " + s);
t.deepEqual([intent("tell me when my render finishes").action, intent("tell me when my render finishes then sleep").action, intent("when the render is done shut down").action], ["notify", "sleep", "shutdown"], "render watcher words");
t.equal(intent("stop watching the render").action, "off", "stop the render watcher");
t.equal(intent("how is my battery").what, "battery", "battery question");
t.deepEqual([intent("open Blender").type, intent("open Blender").name, intent("close chrome").type, intent("switch to resolve").type], ["launch", "blender", "close", "focus"], "app words");
t.equal(intent("what is a normal map").type, "none", "questions fall through to the AI");
t.equal(intent("").type, "none", "empty");
const apps = [{ id: "1", name: "Blender" }, { id: "2", name: "DaVinci Resolve" }, { id: "3", name: "Google Chrome" }, { id: "4", name: "Chrome Remote Desktop" }];
t.equal(matchApp("blender", apps).id, "1", "exact app");
t.equal(matchApp("resolve", apps).id, "2", "word inside the name");
t.equal(matchApp("chrome", apps).id, "3", "shorter name wins a tie");
t.equal(matchApp("photoshop", apps), null, "unknown app is not guessed");
t.equal(fuzzyApp("blend her", apps)?.id, "1", "a misheard name that sounds like an app is matched");
t.equal(fuzzyApp("blinder", apps)?.id, "1", "one wrong letter is tolerated");
t.equal(fuzzyApp("photoshop", apps), null, "fuzzy matching still does not guess unknown apps");
t.equal(fuzzyApp("cat", apps), null, "very short words are never fuzzy-matched");
t.ok(statsSentence("battery", { battery: 80.4, charging: true }).includes("80 percent and charging"), "battery sentence");
t.ok(statsSentence("gpu", {}).includes("can't"), "missing reading is said plainly");
// Gemini
const KEY = "AIzaSyA-fake_key_for_tests_0123456789abcdef";
const DOTTED = "AQ.Ab8RN6fakefakefakefakefakefakefake_0123456789-x";
for (const [label, key] of [["classic AIza key", KEY], ["dotted AQ. key", DOTTED]]) {
  const saved = []; const dir = null;
  t.deepEqual(createKeyStore({ dir, env: { GEMINI_API_KEY: key } }).status().configured, true, label + " is accepted");
}
for (const bad of ["", "short", "has space in the middle of the key 0123456789", "key\nwith-newline-0123456789abcdef", "<script>alert(1)</script>0123456789", "x".repeat(300)])
  t.deepEqual(createKeyStore({ dir: null, env: { GEMINI_API_KEY: bad } }).status().configured, false, "refused: " + JSON.stringify(bad).slice(0, 30));
t.equal(await askGemini("x", { key: DOTTED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) }) }), "ok", "a dotted key can be used to ask");
let seen;
const ok = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "A **normal map** stores surface direction." }] } }] }) }; };
t.equal(await askGemini("what is a normal map", { key: KEY, fetchImpl: ok }), "A normal map stores surface direction.", "answer cleaned of markdown");
t.ok(seen.url.startsWith(GEMINI_ENDPOINT) && !seen.url.includes(KEY), "key is never in the URL");
t.equal(seen.init.headers["x-goog-api-key"], KEY, "key sent as a header");
t.equal(seen.init.redirect, "error", "redirects refused");
for (const [status, code] of [[429, 429], [403, 502], [500, 502]]) {
  const err = await askGemini("x", { key: KEY, fetchImpl: async () => ({ ok: false, status }) }).catch((e) => e);
  t.equal(err.status, code, "status " + status + " maps to " + code);
  t.ok(!String(err.message).includes(KEY), "error never contains the key");
}
t.equal((await askGemini("x", { key: "", fetchImpl: ok }).catch((e) => e)).status, 503, "missing key is a clear 503");
t.equal((await askGemini("x", { key: KEY, model: "../evil", fetchImpl: ok }).catch((e) => e)).status, 503, "bad model name refused");
const store = createKeyStore({ dir: null, env: { GEMINI_API_KEY: KEY } });
t.deepEqual(store.status(), { configured: true, model: "gemini-flash-latest" }, "key from environment");
t.ok(!JSON.stringify(store.status()).includes(KEY), "status never includes the key");
t.equal((await store.set("short").catch((e) => e)).status, 500, "no folder, no save");
t.done("assistant verification passed");
