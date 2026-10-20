/**
 * Voice commands: the interpreter maps a closed Spanish/English vocabulary onto
 * existing dock actions, and the shell/Android layers are wired to it.
 *
 * The interpreter is pure, so every phrase runs under Node. The wiring checks
 * read the shell and the Kotlin sources: a transcript that never reaches
 * `interpret`, or a recognizer that is allowed to leave the phone, would compile
 * perfectly and fail only on a real device.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { interpret, matchApp, normalize, VOCABULARY } from "../public/voice.js";
import { CONTROL_VERBS, DESTRUCTIVE_VERBS } from "../src/platform/contract.js";

const t = createChecker("voice");
const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const apps = [
  { id: "c:/vs.exe", name: "Visual Studio" },
  { id: "c:/code.exe", name: "Visual Studio Code" },
  { id: "c:/chrome.exe", name: "Google Chrome" },
  { id: "c:/word.exe", name: "Microsoft Word" },
  { id: "c:/wordpad.exe", name: "WordPad" },
  { id: "c:/spotify.exe", name: "Spotify" },
  { id: "c:/term", name: "Terminal" },
  { id: "c:/claude", name: "Claude" },
  { id: "c:/photos", name: "Photos" },
];
const run = (phrase, options = {}) => interpret(phrase, { apps, ...options });
const control = (phrase, verb, options) => {
  const command = run(phrase, options);
  t.deepEqual({ action: command.action, verb: command.args.verb }, { action: "control", verb }, `"${phrase}" → ${verb}`);
  return command;
};

// ---- normalization ----
t.equal(normalize("  Página   SIGUIENTE, ¡ya!  "), "pagina siguiente ya", "normalize strips accents, case, punctuation and extra spaces");
t.equal(normalize("Ábreme el Código"), "abreme el codigo", "normalize handles leading accented capitals");
t.equal(normalize(null), "", "normalize tolerates a missing transcript");

// ---- opening apps, Spanish and English ----
for (const [phrase, id] of [
  ["Abre Visual Studio", "c:/vs.exe"], ["abrir visual studio code", "c:/code.exe"], ["open visual studio", "c:/vs.exe"],
  ["Launch Visual Studio Code", "c:/code.exe"], ["abre el chrome", "c:/chrome.exe"], ["Open Chrome, please", "c:/chrome.exe"],
  ["abre word", "c:/word.exe"], ["open wordpad", "c:/wordpad.exe"], ["oye abre spotify por favor", "c:/spotify.exe"],
  ["start spotifai", "c:/spotify.exe"], ["ejecuta la aplicación terminal", "c:/term"], ["run claude", "c:/claude"],
  ["abre la terminal", "c:/term"], ["inicia Microsoft Word", "c:/word.exe"],
]) {
  const command = run(phrase);
  t.equal(command.action, "launch", `"${phrase}" opens an app`);
  t.equal(command.args.id, id, `"${phrase}" picks ${id}`);
  t.equal(command.confirm, false, `"${phrase}" needs no confirmation`);
}
t.equal(run("abre visual studio").args.name, "Visual Studio", "an exact name beats the longer app that starts with it");
t.equal(run("open word").args.name, "Microsoft Word", "a whole word beats a substring of another app");
t.equal(matchApp("visual", apps).name, "Visual Studio", "a prefix shared by two apps resolves to the shorter name");
t.equal(matchApp("photoshop", apps), null, "an app that is not installed does not match anything, even one that starts like Photos");
t.equal(matchApp("photos", apps).name, "Photos", "the installed app itself still matches");
t.equal(matchApp("fotos", apps), null, "a translation is not guessed; the vocabulary is closed");
t.equal(matchApp("spotifai", apps).name, "Spotify", "a recognizer slip of similar length is forgiven");
t.equal(matchApp("", apps), null, "an empty name matches nothing");
t.equal(matchApp("chrome", [{ id: "x" }, null, { id: "y", name: 7 }]), null, "malformed inventory entries are skipped");
const missing = run("abre photoshop");
t.equal(missing.action, "unknown", "opening an app that is not installed is not understood");
t.equal(missing.args.app, "photoshop", "the shell learns which app name was not found");
t.equal(missing.args.phrase, "abre photoshop", "the original phrase is kept for the toast");
t.equal(run("open").action, "unknown", "a verb without an app name is not understood");

// ---- the vocabulary maps only onto verbs the host serves ----
control("sube el volumen", "volume-up"); control("Volume up", "volume-up"); control("más alto", "volume-up"); control("louder", "volume-up");
control("baja el volumen", "volume-down"); control("volume down", "volume-down"); control("quieter", "volume-down");
control("silencio", "mute-toggle"); control("mute", "mute-toggle"); control("quitar silencio", "mute-toggle"); control("unmute", "mute-toggle");
control("pausa", "media-play-pause"); control("reproducir", "media-play-pause"); control("play", "media-play-pause"); control("pause the music", "media-play-pause");
control("siguiente", "media-next"); control("siguiente canción", "media-next"); control("next track", "media-next"); control("skip", "media-next");
control("anterior", "media-previous"); control("canción anterior", "media-previous"); control("previous", "media-previous");
control("detener la música", "media-stop"); control("stop", "media-stop"); control("para", "media-stop");
for (const [phrase, value] of [["volumen al 50", 50], ["volumen 30%", 30], ["volume to fifty percent", 50], ["set the volume to 0", 0], ["volumen al cien", 100]]) {
  const command = control(phrase, "volume-set");
  t.equal(command.args.value, value, `"${phrase}" carries the level ${value}`);
}
t.equal(run("volume 150").action, "unknown", "a level outside 0–100 is not sent to the host");
t.equal(run("volumen al doscientos").action, "unknown", "an unknown number word is not guessed");

// ---- capture and pages ----
for (const [phrase, action] of [
  ["captura de pantalla", "screenshot"], ["pantallazo", "screenshot"], ["toma una captura", "screenshot"], ["screenshot", "screenshot"], ["take a screenshot", "screenshot"], ["capture the screen", "screenshot"],
  ["grabar pantalla", "start"], ["empieza a grabar", "start"], ["iniciar grabación", "start"], ["start recording", "start"], ["record my screen", "start"],
  ["detener grabación", "stop"], ["deja de grabar", "stop"], ["stop recording", "stop"], ["end the recording", "stop"],
]) {
  const command = run(phrase);
  t.deepEqual({ action: command.action, kind: command.args.action }, { action: "capture", kind: action }, `"${phrase}" → capture ${action}`);
}
t.deepEqual(run("stop", { recording: true }).args, { action: "stop" }, "while recording, a bare stop ends the recording");
t.deepEqual(run("para", { recording: true }).args, { action: "stop" }, "while recording, a bare Spanish stop ends the recording");
t.equal(run("stop", { recording: false }).args.verb, "media-stop", "when nothing records, stop is for playback");
t.equal(run("start recording").action, "capture", "start recording never opens an app called recording");
for (const [phrase, delta] of [["página siguiente", 1], ["pagina siguiente", 1], ["siguiente página", 1], ["next page", 1], ["página anterior", -1], ["previous page", -1], ["go back a page", -1]]) {
  const command = run(phrase);
  t.deepEqual({ action: command.action, delta: command.args.delta }, { action: "page", delta }, `"${phrase}" → page ${delta}`);
}

// ---- power actions always ask first ----
for (const [phrase, verb] of [
  ["bloquear", "lock"], ["bloquea la pantalla", "lock"], ["lock the pc", "lock"], ["lock", "lock"],
  ["suspender", "sleep"], ["suspende el equipo", "sleep"], ["put the computer to sleep", "sleep"], ["sleep", "sleep"],
  ["apagar", "shutdown"], ["apaga la computadora", "shutdown"], ["shut down", "shutdown"], ["shutdown the pc", "shutdown"], ["turn off the computer", "shutdown"],
  ["reiniciar", "restart"], ["reinicia el pc", "restart"], ["restart", "restart"], ["reboot the machine", "restart"],
]) {
  const command = control(phrase, verb);
  t.equal(command.confirm, true, `"${phrase}" requires confirmation`);
  t.ok(DESTRUCTIVE_VERBS.includes(command.args.verb), `"${phrase}" maps onto a verb the host gates as destructive`);
}
const everything = ["sube el volumen", "baja el volumen", "silencio", "pausa", "siguiente", "anterior", "stop", "volumen al 40", "bloquear", "suspender", "apagar", "reiniciar"].map((p) => run(p));
t.ok(everything.every((c) => CONTROL_VERBS.includes(c.args.verb)), "every spoken control is a verb in the provider contract");
t.ok(everything.every((c) => c.confirm === DESTRUCTIVE_VERBS.includes(c.args.verb)), "exactly the destructive verbs ask for confirmation");

// ---- not understood ----
for (const phrase of ["hazme un café", "what time is it", "", "   ", "volumen", "abre", "the quick brown fox", "página", "windock"]) {
  const command = run(phrase);
  t.equal(command.action, "unknown", `"${phrase}" is not understood`);
  t.equal(command.args.phrase, phrase.trim(), `"${phrase}" is echoed back trimmed`);
  t.equal(command.confirm, false, "not understood never asks for confirmation");
}
t.equal(run(undefined).action, "unknown", "a missing transcript is not understood");
t.equal(run(42).action, "unknown", "a non-string transcript is not understood");
// Negative control: a phrase that only looks like a command must not slip through.
t.equal(run("abre la puerta del volumen").action, "unknown", "an app name that is not installed is not a volume command");
t.equal(run("do not shut down").action, "unknown", "a negated power phrase is not a power command");

// ---- README vocabulary agrees with the interpreter ----
for (const group of VOCABULARY) {
  for (const example of group.say) {
    if (example.includes("<app>") || example.includes(" / ")) continue;
    t.ok(run(example).action !== "unknown", `documented phrase is understood: "${example}"`);
  }
}

// ---- shell wiring ----
const html = read("public/index.html"), appJs = read("public/app.js"), sw = read("public/sw.js");
t.ok(/<button id="drawer-voice"[^>]*\bhidden\b/.test(html), "the Voice button starts hidden; only the Android bridge reveals it");
t.ok(html.includes('id="voice-confirm"') && html.includes('id="voice-confirm-go"'), "the shell has a confirmation toast with a Confirm button");
t.ok(appJs.includes('import { interpret } from "./voice.js"'), "the shell uses the shared interpreter");
t.ok(/typeof window\.WinDockAndroid\?\.listen === "function"/.test(appJs), "the Voice button depends on the bridge exposing listen()");
t.ok(appJs.includes("window.WinDockVoice = {") && appJs.includes("onResult(") && appJs.includes("onError("), "the shell exposes the WinDockVoice callbacks");
t.ok(/if \(command\.confirm\) return offerVoiceConfirm/.test(appJs), "a confirm command is never executed directly");
t.ok(/VOICE_CONFIRM_MS = 4000/.test(appJs), "the confirmation offer lasts four seconds");
t.ok(appJs.includes("Didn’t catch that"), "not understood tells the user what was heard");
t.ok(sw.includes('"/voice.js"'), "the service worker precaches voice.js");
t.ok(/<div id="voice-online-row" hidden>/.test(html) && html.includes('id="voice-online"'), "the online switch exists and starts hidden");
t.ok(appJs.includes("window.WinDockAndroid.setVoiceOnline(") && appJs.includes("window.WinDockAndroid.voiceOnline()"), "the switch reads and writes the phone's setting through the bridge");
t.ok(!appJs.includes(String.raw`$("voice-online").checked = true`), "the shell never turns online recognition on by itself");
t.ok(!appJs.includes("webkitSpeechRecognition") && !appJs.includes("getUserMedia"), "the shell never records audio in the browser");

// ---- Android wiring: recognition stays on the phone ----
const main = read("android/app/src/main/java/com/windock/app/MainActivity.kt");
const recognition = read("android/app/src/main/java/com/windock/app/VoiceRecognition.kt");
const manifest = read("android/app/src/main/AndroidManifest.xml");
t.ok(/@JavascriptInterface fun listen\(\)/.test(main), "the bridge exposes listen() to the dock");
t.ok(main.includes("window.WinDockVoice&&window.WinDockVoice.onResult(") && main.includes("window.WinDockVoice&&window.WinDockVoice.onError("), "the Activity delivers results and errors through WinDockVoice");
t.ok(/JSONObject\.quote\(text\)/.test(main), "transcripts are JSON-quoted before reaching the page");
t.ok(main.includes("Manifest.permission.RECORD_AUDIO") && main.includes("requestPermissions("), "the microphone permission is requested at runtime");
t.ok(manifest.includes("android.permission.RECORD_AUDIO"), "the manifest declares RECORD_AUDIO");
t.ok(manifest.includes("android.speech.RecognitionService"), "the manifest can see speech recognition services on Android 11+");
t.ok(recognition.includes("RecognizerIntent.EXTRA_PREFER_OFFLINE, !online"), "recognition prefers the offline pack unless the user opted in to online");
t.ok(main.includes("@JavascriptInterface fun setVoiceOnline(") && main.includes("@JavascriptInterface fun voiceOnline()"), "the bridge exposes the online opt-in");
t.ok(read("android/app/src/main/java/com/windock/app/PhonePreferences.kt").includes('getBoolean("voiceOnline", false)'), "online recognition is off by default on the phone");
t.ok(read("README.md").includes("Online voice recognition"), "the README documents the online opt-in");
t.ok(recognition.includes("createOnDeviceSpeechRecognizer"), "Android 12+ uses the on-device recognizer");
t.ok(!/https?:\/\//.test(recognition) && !recognition.includes("HttpURLConnection"), "the recognizer never talks to a server itself");
t.ok(!/\bevaluateJavascript\(/.test(recognition), "the recognizer never touches the page; the Activity gates every message");

t.done("voice verification passed");
