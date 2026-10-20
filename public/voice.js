/**
 * Voice command interpreter.
 *
 * Pure: no DOM, no network, no speech APIs. The Android wrapper transcribes on
 * the phone and hands the text to the shell; the shell calls `interpret` and
 * then reuses the same /api calls the buttons already make. Keeping this module
 * free of browser globals lets the gate exercise every phrase under Node.
 *
 * The vocabulary is closed on purpose. A transcript either maps onto one of the
 * actions the dock already offers, or it comes back as not understood. Nothing
 * here can reach a host action a tap cannot.
 */

/** Lower-case, accent-free, single-spaced text for matching. */
export function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wake words and courtesy fillers people say around a command. */
const FILLER = /^(?:oye|hey|ok|okay|hola|windock|win dock|por favor|please|quiero|i want to|can you|could you|puedes|podrias)\s+|\s+(?:por favor|please|ahora|now)$/;
function stripFiller(text) {
  let out = text;
  for (let i = 0; i < 4 && FILLER.test(out); i++) out = out.replace(FILLER, "").trim();
  return out;
}

/** Spoken levels for volume: digits or the round numbers people actually say. */
const NUMBER_WORDS = {
  cero: 0, zero: 0, diez: 10, ten: 10, veinte: 20, twenty: 20, treinta: 30, thirty: 30,
  cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, setenta: 70,
  seventy: 70, ochenta: 80, eighty: 80, noventa: 90, ninety: 90, cien: 100, hundred: 100,
  "one hundred": 100, maximo: 100, max: 100, maximum: 100, minimo: 0, min: 0, minimum: 0,
};
const LEVEL = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
function parseLevel(raw) {
  const level = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return Number.isInteger(level) && level >= 0 && level <= 100 ? level : null;
}

const PC = "(?:el |la |mi |the |my )?(?:pc|computadora|computador|ordenador|equipo|computer|machine)";
const ARTICLE = "(?:el |la |los |las |the |a |an |mi |my )?";

/**
 * Ordered rules. Recording and page rules come before playback and launch so
 * "start recording" never opens an app and "next page" never skips a track.
 * Every pattern is anchored to the whole (normalized) phrase.
 */
const RULES = [
  { action: "capture", args: { action: "stop" }, label: "Stop recording", patterns: [
    "(?:detener|deten|parar|para|terminar|termina|finalizar|finaliza|dejar de|deja de) (?:la |el )?grab(?:ar|acion)(?: de (?:la )?pantalla)?",
    "(?:stop|end|finish) (?:the )?(?:screen )?recording", "stop recording (?:the |my )?screen",
  ] },
  { action: "capture", args: { action: "start" }, label: "Recording", patterns: [
    "(?:grabar|graba|grabame|empezar a grabar|empieza a grabar|comenzar a grabar|comienza a grabar)(?: (?:la |mi )?pantalla)?",
    "(?:iniciar|inicia|empezar|empieza|comenzar|comienza) (?:la |una )?grabacion(?: de (?:la )?pantalla)?",
    "record(?: (?:the |my )?screen)?", "(?:start|begin) (?:a |the )?(?:screen )?recording", "start recording(?: (?:the |my )?screen)?",
  ] },
  { action: "capture", args: { action: "screenshot" }, label: "Screenshot", patterns: [
    "(?:captura|capturar|pantallazo)(?: (?:de |la )?(?:la )?pantalla)?", "(?:toma|tomar|haz|hacer|saca|sacar) (?:una |un )?(?:captura|pantallazo)(?: de (?:la )?pantalla)?",
    "foto de (?:la )?pantalla", "screenshot", "(?:take|grab) (?:a )?screenshot", "capture(?: (?:the |my )?screen)?", "screen capture", "snap (?:the |my )?screen",
  ] },
  { action: "page", args: { delta: 1 }, label: "Next page", patterns: [
    "(?:pagina siguiente|siguiente pagina|proxima pagina|pasar (?:de )?pagina|pasa (?:de )?pagina)", "next page", "page right", "turn the page", "go to (?:the )?next page",
  ] },
  { action: "page", args: { delta: -1 }, label: "Previous page", patterns: [
    "(?:pagina anterior|anterior pagina|pagina previa|retroceder pagina|retrocede pagina|volver pagina|volver de pagina)", "previous page", "page left", "(?:go )?back a page", "go to (?:the )?previous page",
  ] },
  { action: "control", verb: "volume-set", level: true, patterns: [
    `(?:volumen|volume|pon el volumen|poner el volumen|set (?:the )?volume) (?:al? |en |to |at )?${LEVEL}(?: ?(?:%|por ciento|porciento|percent))?`,
  ] },
  { action: "control", verb: "volume-up", label: "Volume up", patterns: [
    "(?:sube|subir|subele|subeme|aumenta|aumentar|incrementa) (?:el |al )?volumen", "volumen (?:arriba|mas alto|alto)", "mas volumen", "mas alto",
    "volume up", "turn (?:it |the volume )?up", "(?:raise|increase) (?:the )?volume", "louder", "turn up the volume",
  ] },
  { action: "control", verb: "volume-down", label: "Volume down", patterns: [
    "(?:baja|bajar|bajale|bajame|reduce|reducir|disminuye|disminuir) (?:el |al )?volumen", "volumen (?:abajo|mas bajo|bajo)", "menos volumen", "mas bajo",
    "volume down", "turn (?:it |the volume )?down", "(?:lower|decrease) (?:the )?volume", "quieter", "softer", "turn down the volume",
  ] },
  { action: "control", verb: "mute-toggle", label: "Mute", patterns: [
    "(?:silencio|silenciar|silencia|silencialo|mutear|mutea|sin sonido|modo silencio|callate)", "(?:activar|activa|quitar|quita|desactivar|desactiva) (?:el )?silencio",
    "(?:mute|unmute)(?: it| the (?:pc|sound|audio|volume))?", "silence",
  ] },
  { action: "control", verb: "media-play-pause", label: "Play / pause", patterns: [
    "(?:pausa|pausar|pausalo|pon pausa|poner pausa|reproducir|reproduce|reanudar|reanuda|continuar|continua)(?: (?:la )?musica)?",
    "(?:play|pause|resume)(?: it| playback| the music| music)?", "toggle playback", "play (?:or |/ )?pause",
  ] },
  { action: "control", verb: "media-next", label: "Next track", patterns: [
    "(?:la )?siguiente(?: (?:cancion|pista|tema|track))?", "(?:proxima|siguiente) (?:cancion|pista)", "(?:cancion|pista|tema) siguiente", "pasar (?:la )?cancion", "saltar", "salta",
    "next(?: track| song)?", "skip(?: track| song| this)?", "play (?:the )?next(?: track| song| one)?",
  ] },
  { action: "control", verb: "media-previous", label: "Previous track", patterns: [
    "(?:la )?anterior", "(?:cancion|pista|tema) anterior", "(?:cancion|pista) previa", "volver atras", "atras",
    "previous(?: track| song)?", "go back", "back", "last (?:track|song)", "play (?:the )?previous(?: track| song| one)?",
  ] },
  { action: "control", verb: "media-stop", label: "Stop playback", patterns: [
    "(?:detener|deten|parar|para)(?: (?:la )?(?:musica|reproduccion))?", "stop(?: it| (?:the )?(?:music|playback|playing))?",
  ] },
  { action: "control", verb: "lock", confirm: true, label: "Lock PC", patterns: [
    `(?:bloquear|bloquea|bloquealo)(?: ${PC}| (?:la )?(?:pantalla|sesion))?`, "lock(?: (?:the |my )?(?:pc|computer|screen|session|machine))?",
  ] },
  { action: "control", verb: "sleep", confirm: true, label: "Sleep", patterns: [
    `(?:suspender|suspende|suspendelo|dormir|duerme|a dormir|hibernar|hiberna)(?: ${PC})?`, `(?:poner|pon) ${PC} a dormir`,
    "(?:sleep|suspend|go to sleep)(?: (?:the |my )?(?:pc|computer|machine))?", "put (?:the |my |it )?(?:pc |computer |machine )?to sleep",
  ] },
  { action: "control", verb: "shutdown", confirm: true, label: "Shut down", patterns: [
    `(?:apagar|apaga|apagalo)(?: ${PC})?`, "(?:shut ?down|power off|turn off|switch off)(?: (?:the |my )?(?:pc|computer|machine))?", "turn (?:the |my )?(?:pc|computer|machine) off",
  ] },
  { action: "control", verb: "restart", confirm: true, label: "Restart", patterns: [
    `(?:reiniciar|reinicia|reinicialo|resetear|resetea)(?: ${PC})?`, "(?:restart|reboot)(?: (?:the |my )?(?:pc|computer|machine))?",
  ] },
  // Last: whatever follows the verb is an app name.
  { action: "launch", patterns: [
    `(?:abrir|abre|abreme|abrime|abra|lanzar|lanza|ejecutar|ejecuta|iniciar|inicia|arrancar|arranca|open|open up|launch|start|run|bring up) ${ARTICLE}(?:app |aplicacion |programa |application )?(.+)`,
  ] },
].map((rule) => ({ ...rule, regexes: rule.patterns.map((p) => new RegExp(`^(?:${p})$`, "u")) }));

/** Bigram Dice coefficient: tolerant of the small slips a recognizer makes. */
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ga = grams(a), gb = grams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) || 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/** 0..1 score for how well a spoken name fits an installed app name. */
function similarity(query, name) {
  if (name === query) return 1;
  const nameTokens = name.split(" "), queryTokens = query.split(" ");
  if (name.startsWith(query + " ")) return 0.95;
  if (queryTokens.every((t) => nameTokens.includes(t))) return 0.9 - 0.01 * (nameTokens.length - queryTokens.length);
  if (name.includes(query)) return 0.7;
  // Fuzzy only rescues a recognizer slip ("spotifai"), never a longer word that
  // merely starts like an app ("photoshop" must not open Photos).
  const compactQuery = query.replace(/ /g, ""), compactName = name.replace(/ /g, "");
  if (Math.abs(compactQuery.length - compactName.length) > 2) return 0;
  const closeness = dice(compactQuery, compactName);
  return closeness >= 0.7 ? closeness * 0.8 : 0;
}

/**
 * Pick the installed app a spoken name refers to, or null when nothing is close.
 * Exact beats prefix beats whole-word beats substring beats fuzzy, so "Visual
 * Studio" opens Visual Studio rather than Visual Studio Code and "Word" opens
 * Microsoft Word rather than WordPad. Ties go to the shorter name.
 */
export function matchApp(query, apps) {
  const spoken = normalize(query).replace(new RegExp(`^${ARTICLE}`), "").replace(/ (?:app|aplicacion|programa|application)$/, "").trim();
  if (!spoken) return null;
  const candidates = (Array.isArray(apps) ? apps : [])
    .filter((app) => app && typeof app.name === "string" && app.name.trim())
    .map((app) => ({ app, name: normalize(app.name), score: similarity(spoken, normalize(app.name)) }))
    .filter((entry) => entry.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  return candidates[0]?.app || null;
}

/**
 * Interpret a transcript. Returns `{ action, args, confirm, label }`:
 *  - launch   args { id, name }            open (or focus) an installed app
 *  - control  args { verb, value? }        a /api/control verb
 *  - capture  args { action }              screenshot | start | stop
 *  - page     args { delta }               move the dock one page
 *  - unknown  args { phrase, app? }        nothing in the vocabulary matched
 * Power verbs set `confirm: true`; the shell must ask before sending them.
 * While a recording is running, a bare "stop" stops the recording, not the music.
 */
export function interpret(text, { apps = [], recording = false } = {}) {
  const phrase = String(text ?? "").trim();
  const spoken = stripFiller(normalize(phrase));
  const unknown = (extra = {}) => ({ action: "unknown", args: { phrase, ...extra }, confirm: false, label: null });
  if (!spoken) return unknown();
  if (recording && /^(?:detener|deten|parar|para|stop|stop it|alto)$/.test(spoken)) {
    return { action: "capture", args: { action: "stop" }, confirm: false, label: "Stop recording" };
  }
  for (const rule of RULES) {
    for (const regex of rule.regexes) {
      const match = spoken.match(regex);
      if (!match) continue;
      if (rule.action === "launch") {
        const app = matchApp(match[1], apps);
        return app
          ? { action: "launch", args: { id: app.id, name: app.name }, confirm: false, label: `Open ${app.name}` }
          : unknown({ app: match[1].trim() });
      }
      if (rule.level) {
        const value = parseLevel(match[1]);
        return value === null ? unknown() : { action: "control", args: { verb: rule.verb, value }, confirm: false, label: `Volume ${value}%` };
      }
      const args = rule.action === "control" ? { verb: rule.verb } : { ...rule.args };
      return { action: rule.action, args, confirm: rule.confirm === true, label: rule.label };
    }
  }
  return unknown();
}

/** The vocabulary the README documents, grouped the way the controls sheet is. */
export const VOCABULARY = Object.freeze([
  { does: "Open an app", say: ["abrir / abre <app>", "open / launch <app>"] },
  { does: "Volume", say: ["sube el volumen", "baja el volumen", "volumen al 50", "silencio", "volume up", "volume down", "volume 50", "mute"] },
  { does: "Playback", say: ["pausa / reproducir", "siguiente", "anterior", "detener", "play / pause", "next", "previous", "stop"] },
  { does: "Capture", say: ["captura / pantallazo", "grabar pantalla", "detener grabación", "screenshot", "start recording", "stop recording"] },
  { does: "Dock pages", say: ["página siguiente", "página anterior", "next page", "previous page"] },
  { does: "Power (asks first)", say: ["bloquear", "suspender", "reiniciar", "apagar", "lock", "sleep", "restart", "shut down"] },
]);
