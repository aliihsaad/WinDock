import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { bezelFor } from "../public/glass.js";
import { createLevelSender, createQuickControls } from "../public/quick-controls.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createLinuxProvider } from "../src/platform/linux.js";

const t = createChecker("quick-controls");
const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const css = read("public/style.css"), html = read("public/index.html");
const settle = () => new Promise((resolve) => setTimeout(resolve));

// Sliders fire faster than a monitor answers, so the newest value must win.
{
  const sent = [], pending = [];
  const sender = createLevelSender((value) => { sent.push(value); return new Promise((resolve) => pending.push(resolve)); }, () => {});
  sender(10); sender(20); sender(30);
  t.deepEqual(sent, [10], "only one level is in flight at a time");
  pending.shift()();
  await settle();
  t.deepEqual(sent, [10, 30], "levels in between are dropped and the newest is sent");
  pending.shift()();
  await settle();
  sender(40);
  t.deepEqual(sent, [10, 30, 40], "the sender is ready again once it has drained");
  pending.shift()();
  await settle();

  const failures = [], attempts = [];
  const failing = createLevelSender(async (value) => { attempts.push(value); if (value === 1) throw new Error("no display"); }, (error) => failures.push(error.message));
  await failing(1);
  await failing(2);
  t.deepEqual(failures, ["no display"], "a failed level is reported");
  t.deepEqual(attempts, [1, 2], "a failed level does not stop later ones");
}

// A scripted curtain: just enough DOM for the module's real logic.
function curtain({ levels = { volume: 64, brightness: 72 }, online = true, control = { ok: true } } = {}) {
  const element = () => {
    const node = { hidden: false, dataset: {}, listeners: {}, attributes: {}, textContent: "", innerHTML: "", value: "0", disabled: false,
      style: { setProperty(name, value) { node.style[name] = value; } },
      setAttribute(name, value) { node.attributes[name] = value; },
      addEventListener(type, listener) { node.listeners[type] = listener; },
      querySelector: () => node.input };
    return node;
  };
  const nodes = {};
  for (const id of ["level-brightness", "level-volume"]) { nodes[id] = element(); nodes[id].input = element(); }
  for (const id of ["qc-mute", "qc-music", "qc-music-title", "qc-music-artist", "qc-music-toggle"]) nodes[id] = element();
  globalThis.document = { getElementById: (id) => nodes[id] };
  const requests = [], notices = [], errors = [];
  const api = async (path, options) => {
    if (path === "/api/levels") return typeof levels === "function" ? levels() : levels;
    requests.push(JSON.parse(options.body));
    return control;
  };
  const controls = createQuickControls({ api, isOnline: () => online, notify: (...notice) => notices.push(notice), report: (error) => errors.push(error) });
  const drag = async (id, value) => { nodes[id].input.value = String(value); nodes[id].input.listeners.input(); await settle(); };
  return { controls, nodes, requests, notices, errors, drag };
}
const allVerbs = ["brightness-set", "volume-set", "mute-toggle", "media-play-pause"];

{
  const { controls, nodes } = curtain();
  controls.show(["volume-set"]);
  await settle();
  t.ok(nodes["level-brightness"].hidden, "a host without brightness shows no brightness slider");
  t.ok(!nodes["level-volume"].hidden, "a host with volume shows its slider");
  t.ok(nodes["qc-mute"].hidden && nodes["qc-music"].hidden, "mute and music follow the host's verbs too");
  controls.show(allVerbs);
  await settle();
  t.ok(!nodes["level-brightness"].hidden && !nodes["qc-mute"].hidden && !nodes["qc-music"].hidden, "every supported control appears");
  t.equal(nodes["level-volume"].input.value, 64, "volume opens at the host's reading");
  t.equal(nodes["level-brightness"].style["--level"], 72, "the fill shows the host's reading");
  t.equal(nodes["level-volume"].dataset.covered, "true", "the icon flips once the fill reaches it");
}
{
  const { controls, nodes } = curtain({ levels: { volume: 5, brightness: null } });
  controls.show(allVerbs);
  await settle();
  t.ok(nodes["level-brightness"].input.disabled, "a display that cannot report its level is disabled");
  t.ok(!nodes["level-volume"].input.disabled, "volume stays usable");
  t.equal(nodes["level-volume"].dataset.covered, "false", "the icon stays light on an empty track");
}
{
  const { controls, nodes } = curtain({ levels: { volume: null, brightness: 50 } });
  controls.show(allVerbs);
  await settle();
  t.ok(!nodes["level-volume"].input.disabled, "an unknown volume can still be set");
  t.equal(nodes["level-volume"].input.value, 0, "an unknown level starts empty rather than guessing");
}
{
  const { controls, nodes } = curtain({ levels: () => { throw new Error("older host"); } });
  controls.show(allVerbs);
  await settle();
  t.ok(!nodes["level-volume"].hidden && !nodes["level-brightness"].input.disabled, "a failed read leaves the sliders usable");
}
{
  let finishRead;
  const { controls, nodes, drag } = curtain({ levels: () => new Promise((resolve) => { finishRead = resolve; }) });
  controls.show(allVerbs);
  await drag("level-volume", 30);
  finishRead({ volume: 90, brightness: 20 });
  await settle();
  t.equal(Number(nodes["level-volume"].input.value), 30, "a slow reading cannot pull a slider from under a finger");
  t.equal(nodes["level-brightness"].input.value, 20, "untouched sliders still take the reading");
}
{
  const { controls, requests, drag } = curtain();
  controls.show(allVerbs);
  await settle();
  await drag("level-volume", 41);
  await drag("level-brightness", 58);
  t.deepEqual(requests, [{ verb: "volume-set", value: 41 }, { verb: "brightness-set", value: 58 }], "sliders send their verb and a number");
}
{
  const { controls, requests, drag } = curtain({ online: false });
  controls.show(allVerbs);
  await settle();
  await drag("level-volume", 41);
  t.deepEqual(requests, [], "nothing is sent while the PC is offline");
}
{
  const { controls, notices, drag } = curtain({ control: { ok: true, warning: "hdr-active" } });
  controls.show(allVerbs);
  await settle();
  await drag("level-brightness", 40);
  await drag("level-brightness", 45);
  t.equal(notices.length, 1, "the HDR warning shows once, not on every step of a drag");
  t.equal(notices[0][0], "Command sent. HDR may prevent the brightness from changing.", "the HDR warning keeps its wording");
  t.equal(notices[0][2], true, "the HDR warning stays a warning");
}
{
  const { controls, nodes } = curtain();
  t.equal(nodes["qc-music-title"].textContent, "Nothing playing", "the card has something to say with no track");
  t.equal(nodes["qc-music-toggle"].attributes["aria-label"], "Play", "the button starts as play");
  controls.media({ title: "<b>Track</b>", artist: "Band", playing: true });
  t.equal(nodes["qc-music-title"].textContent, "<b>Track</b>", "track titles stay plain text");
  t.equal(nodes["qc-music-artist"].textContent, "Band", "the artist appears");
  t.equal(nodes["qc-music-toggle"].attributes["aria-label"], "Pause", "the button follows playback");
  const icon = nodes["qc-music-toggle"].innerHTML;
  nodes["qc-music-toggle"].innerHTML = "kept";
  controls.media({ title: "Next", artist: "", playing: true });
  t.equal(nodes["qc-music-toggle"].innerHTML, "kept", "an unchanged state leaves the button alone under a finger");
  t.ok(icon.includes("<svg"), "the button draws an icon");
  controls.media(null);
  t.equal(nodes["qc-music-artist"].textContent, "", "stopping clears the artist");
}

// Levels from each host, using the Windows helper's real output.
const windows = (outputs) => createWindowsProvider({ helperPath: "helper", exec: async (_, [command]) => {
  if (outputs[command] === undefined) throw new Error("exit 2");
  return { stdout: outputs[command] };
} });
const realDisplay = '{"displays":[{"name":"Generic PnP Monitor","method":"ddc-ci","min":0,"current":24,"max":100,"percent":24}],"hdrActive":false}';
t.deepEqual(await windows({ volume: '{"volume":0.423}', brightness: realDisplay }).levels(), { volume: 42, brightness: 24 }, "Windows reports both levels as percentages");
t.deepEqual(await windows({ volume: '{"volume":1}' }).levels(), { volume: 100, brightness: null }, "a display without support reads as unknown");
t.deepEqual(await windows({ volume: '{"volume":null}', brightness: "not json" }).levels(), { volume: null, brightness: null }, "missing or broken readings stay unknown, never zero");
t.deepEqual(await windows({ volume: '{"volume":1.4}', brightness: '{"displays":[]}' }).levels(), { volume: 100, brightness: null }, "readings stay within 0 to 100");

const linux = (outputs) => createLinuxProvider({ appDirs: [], icons: async () => null, capture: {}, exec: async (file) => {
  if (outputs[file] === undefined) throw new Error("not installed");
  return { stdout: outputs[file] };
} });
t.deepEqual(await linux({ pactl: "Volume: front-left: 26214 /  40% / -23.87 dB,   front-right: 26214 /  40% / -23.87 dB\n        balance 0.00\n", brightnessctl: "intel_backlight,backlight,720,75%,960\n" }).levels(), { volume: 40, brightness: 75 }, "Linux reads both levels");
t.deepEqual(await linux({ pactl: "Volume: front-left: 98304 / 150% / 10.57 dB" }).levels(), { volume: 100, brightness: null }, "boosted volume stays within range and a missing tool reads as unknown");
t.deepEqual(await linux({}).levels(), { volume: null, brightness: null }, "a host without either tool reads as unknown");

// The route and everything that ships with it.
const server = read("server.js");
t.ok(/path === "\/api\/levels" && req\.method === "GET"/.test(server), "the host exposes the levels");
t.ok(/typeof provider\.levels === "function"/.test(server), "levels stay optional for providers");
t.ok(!read("src/platform/contract.js").includes("levels"), "levels are not a required provider method");
t.ok(read("public/sw.js").includes('"/quick-controls.js"'), "the offline shell precaches the curtain");
t.ok(read("scripts/build-website-demo.mjs").includes("'quick-controls.js'"), "the website demo copies the curtain");
t.ok(read("website/preview-transport.js").includes("/api/levels"), "the website demo answers level reads");

const curtainHtml = html.slice(html.indexOf('<dialog id="controls"'), html.indexOf('<dialog id="power-controls"'));
for (const label of ["Display brightness", "PC volume"]) t.ok(new RegExp(`type="range" min="0" max="100" value="0" aria-label="${label}"`).test(curtainHtml), `${label} is a labelled 0 to 100 range`);
for (const key of ["mute-toggle", "media-previous", "media-play-pause", "media-next"]) t.ok(curtainHtml.includes(`data-action="control" data-key="${key}"`), `${key} uses the shared control path`);
for (const key of ["lock", "sleep", "restart", "shutdown"]) t.ok(!curtainHtml.includes(`data-key="${key}"`), `${key} stays behind the Power sheet`);
t.ok(curtainHtml.includes('id="controls-title" class="visually-hidden"'), "the panel keeps a name for screen readers");
for (const id of ["quick-files", "quick-input", "quick-capture", "quick-power"]) t.ok(curtainHtml.includes(`id="${id}"`), `${id} keeps its id for the native tests`);

// The curtain and the notch are one object.
const reach = Number(css.match(/--qc-reach: (\d+)px/)?.[1]);
t.ok(reach >= bezelFor(Infinity), "the top rim and lens band always stay above the screen");
t.ok(/\.controls-curtain \{[\s\S]*?clip-path: var\(--qc-notch\);/.test(css), "a closed panel is clipped to the notch");
t.ok(/@starting-style \{ \.controls-curtain\[open\] \{ clip-path: var\(--qc-notch\); \} \}/.test(css), "opening starts from the notch");
t.ok(/transition: clip-path [^;]*display [^;]*allow-discrete, overlay [^;]*allow-discrete;/.test(css), "closing stays on screen long enough to shrink back");
t.ok(/\.controls-curtain \{[\s\S]*?position: fixed;/.test(css), "the panel keeps its place after it stops being modal");
t.ok(/\.controls-curtain:not\(\[open\]\) \{ pointer-events: none; \}/.test(css), "a closing panel lets taps through to the dock");
t.ok(/html\.perf \.controls-curtain, html\.perf \.controls-curtain > \* \{ transition: none; \}/.test(css), "Performance mode opens instantly");
t.ok(/\.controls-grip \{[^}]*min-height: 40px;/.test(css), "the grip stays a usable tap target");
t.ok(/\.level input \{[^}]*touch-action: none;/.test(css), "a slider drag cannot turn into a page gesture");
t.ok(/\.drawer-grip:focus-visible > span \{ outline:/.test(css), "keyboard focus marks the small grip, not a line across the panel");
t.ok(/curtainSwipe\(\$\("controls-grip"\), -1/.test(read("public/app.js")), "only the grip closes the panel by swipe, so sliders stay free");

t.done("quick-controls verification passed");
