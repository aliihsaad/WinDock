/**
 * Knobs: rotary dials in the touchpad sheet turn into input messages the
 * host already validates, and nothing a knob emits widens the protocol.
 *
 * The dial geometry and the profile mapping are pure, so every assertion runs
 * under Node. The wiring checks read the shell: a knob that is rendered but
 * never reaches the socket, or a profile that emits a message validateInput
 * rejects, would look fine on the phone and simply do nothing on the PC.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { KnobDial, PROFILES, profileById, knobMessages, renderProfiles, renderKnobs, formatSteps, WHEEL_NOTCH } from "../public/knobs.js";
import { validateInput } from "../src/input.js";

const t = createChecker("knobs");
const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// ---- dial geometry: positions around a centre become whole steps ----
let time = 0;
const dial = new KnobDial({ stepDegrees: 12, deadZone: 14, fastDegreesPerSecond: 240, fastFactor: 3, now: () => time });
const at = (deg, r = 60) => [100 + r * Math.cos((deg * Math.PI) / 180), 100 + r * Math.sin((deg * Math.PI) / 180)];
function sweep(from, to, by = 3, ms = 20) {
  let total = 0;
  dial.begin(100, 100, ...at(from));
  for (let deg = from + by; by > 0 ? deg <= to : deg >= to; deg += by) { time += ms; total += dial.turn(...at(deg)); }
  dial.end();
  return total;
}
t.equal(sweep(0, 90), 7, "a slow clockwise quarter turn at 12° per step gives seven steps and keeps the remainder");
t.equal(sweep(90, 0, -3), -7, "counter-clockwise turns are negative");
t.equal(sweep(170, 190), 1, "crossing the ±180° seam does not jump a full turn");
t.equal(sweep(-170, -190, -3), -1, "crossing the seam the other way is symmetric");
t.equal(sweep(0, 360), 30, "a full slow turn is 360 / 12 steps");
t.equal(sweep(0, 90, 3, 1), 21, "a fast quarter turn multiplies each step by the acceleration factor");
dial.begin(100, 100, ...at(0));
time += 20;
t.equal(dial.turn(103, 101), 0, "inside the dead zone nothing is emitted");
time += 20;
t.equal(dial.turn(...at(45)), 0, "leaving the dead zone re-anchors instead of counting the jump");
time += 200;
t.equal(dial.turn(...at(60)), 1, "a slow turn continues from the new anchor");
dial.end();
t.equal(dial.turn(...at(90)), 0, "an ended dial ignores movement");
t.ok(dial.rotation > 0, "the face rotation accumulates for the visual");
t.equal(sweep(0, 6), 0, "half a step emits nothing");
t.equal(sweep(0, 12), 1, "exactly one step emits one");

// ---- profiles: every message a knob can emit passes host validation ----
t.equal(PROFILES.length, 2, "two profiles ship");
for (const profile of PROFILES) {
  t.equal(profile.knobs.length, 3, `${profile.name} has three knobs`);
  for (const knob of profile.knobs) {
    for (const steps of [1, -1, 5, -5, 40, -40]) {
      const { messages, blocked } = knobMessages(knob, steps, { target: "7" });
      t.equal(blocked, null, `${profile.name}/${knob.id} emits for ${steps}`);
      t.ok(messages.length > 0, `${profile.name}/${knob.id} produces messages for ${steps}`);
      for (const message of messages) t.deepEqual(validateInput(message), message, `${profile.name}/${knob.id} message passes validateInput`);
    }
  }
}
t.equal(profileById("arrows").name, "Arrows", "profiles resolve by id");
t.equal(profileById("midi").id, "wheel", "an unknown id falls back to the first profile");
const wheel = profileById("wheel");
t.deepEqual(knobMessages(wheel.knobs[0], 1).messages, [{ type: "scroll", dx: 0, dy: WHEEL_NOTCH }], "one clockwise step is one wheel notch up");
t.deepEqual(knobMessages(wheel.knobs[0], -2).messages, [{ type: "scroll", dx: 0, dy: -2 * WHEEL_NOTCH }], "counter-clockwise scrolls down");
t.deepEqual(knobMessages(wheel.knobs[1], 3).messages, [{ type: "scroll", dx: 3 * WHEEL_NOTCH, dy: 0 }], "the side wheel scrolls horizontally");
t.deepEqual(knobMessages(wheel.knobs[0], 40).messages, [{ type: "scroll", dx: 0, dy: 2040 }, { type: "scroll", dx: 0, dy: 2040 }, { type: "scroll", dx: 0, dy: 720 }], "a big turn is split under the host's delta limit");
t.deepEqual(knobMessages(wheel.knobs[2], 3).messages, [{ type: "zoom", steps: 3 }], "zoom sends steps");
t.deepEqual(knobMessages(wheel.knobs[2], -11).messages, [{ type: "zoom", steps: -8 }, { type: "zoom", steps: -3 }], "zoom is split under the host's step limit");
const arrows = profileById("arrows");
const noFocus = knobMessages(arrows.knobs[0], 2);
t.deepEqual(noFocus.messages, [], "arrow knobs send nothing without a focus token");
t.ok(/Click a value or field on the PC first/.test(noFocus.blocked), "the user is told to click a field first");
t.equal(knobMessages(arrows.knobs[0], 2, { target: "../x" }).messages.length, 0, "a malformed focus token is not used");
t.deepEqual(knobMessages(arrows.knobs[0], 2, { target: "12" }).messages, [{ type: "key", target: "12", key: "ArrowUp" }, { type: "key", target: "12", key: "ArrowUp" }], "clockwise presses ArrowUp once per step");
t.deepEqual(knobMessages(arrows.knobs[1], -1, { target: "12" }).messages, [{ type: "key", target: "12", key: "ArrowLeft" }], "the horizontal knob presses ArrowLeft counter-clockwise");
t.equal(knobMessages(arrows.knobs[0], 100, { target: "12" }).messages.length, 24, "a flick cannot flood the host with key presses");
t.deepEqual(knobMessages(arrows.knobs[0], 0, { target: "12" }).messages, [], "zero steps emit nothing");
t.deepEqual(knobMessages(null, 3).messages, [], "a missing knob emits nothing");
t.deepEqual(knobMessages({ action: { type: "text" } }, 3, { target: "1" }).messages, [], "a profile cannot invent a new action type");
const keys = new Set(PROFILES.flatMap((p) => p.knobs).filter((k) => k.action.type === "key").flatMap((k) => [k.action.up, k.action.down]));
t.deepEqual([...keys].sort(), ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"], "knobs press arrow keys only, never modifiers or shortcuts");
// Negative control: the validator still rejects what a profile must never send.
t.equal(validateInput({ type: "key", target: "1", key: "Shift" }), null, "negative control: a modifier would be rejected by the host");
t.equal(validateInput({ type: "scroll", dx: 0, dy: 2049 }), null, "negative control: an oversized delta would be rejected by the host");

// ---- rendering ----
const chooser = renderProfiles(PROFILES, "arrows");
t.equal((chooser.match(/<button/g) || []).length, 2, "every profile gets a button");
t.ok(chooser.includes('data-profile="arrows" aria-pressed="true"'), "the active profile is pressed");
t.ok(chooser.includes('data-profile="wheel" aria-pressed="false"'), "the other profile is not");
const grid = renderKnobs(wheel);
t.equal((grid.match(/class="knob__dial"/g) || []).length, 3, "three dials render");
t.ok(grid.includes('data-knob="zoom"'), "dials carry their knob id");
t.ok(grid.includes('class="knob__value"'), "each dial has a readout");
t.equal(renderKnobs(null), "", "a missing profile renders nothing");
const hostile = renderKnobs({ knobs: [{ id: "<b>", label: '<img src=x onerror="alert(1)">', detail: "d", action: { type: "zoom" } }] });
t.ok(!hostile.includes("<img") && hostile.includes("&lt;img"), "labels are escaped");
t.equal(formatSteps(3), "+3", "positive readouts carry a sign");
t.equal(formatSteps(-2), "-2", "negative readouts are plain");
t.equal(formatSteps("x"), "0", "a bad readout is zero");

// ---- shell wiring ----
const html = read("public/index.html"), pad = read("public/input-pad.js"), css = read("public/style.css"), sw = read("public/sw.js");
t.ok(/<section id="touchpad-pane"[\s\S]*<aside id="knobs-dock"[\s\S]*<\/section>/.test(html), "the knobs live inside the touchpad pane, not a separate tab");
t.ok(!html.includes('id="input-knobs-tab"') && !html.includes('id="knobs-pane"'), "there is no separate Knobs tab to jump to");
t.ok(/<button id="touchpad-knobs"[^>]*aria-pressed="false"/.test(html), "the toolbar button is a toggle that starts off");
for (const id of ["knobs-dock", "knobs-profiles", "knobs-grid", "knobs-hint", "touchpad-knobs"]) t.ok(html.includes(`id="${id}"`), `the shell defines #${id}`);
t.ok(pad.includes('from "./knobs.js"'), "the input pad uses the shared knobs module");
t.ok(/knobMessages\(/.test(pad) && /new KnobDial\(/.test(pad), "dials and profiles drive the pad");
t.ok(pad.includes('$("knobs-dock").hidden = !(knobsOpen && mode === "touchpad")'), "the dials show only beside a live touchpad");
t.ok(pad.includes('storage.getItem("windock-knobs-open")'), "the toggle is remembered per device");
t.ok(!pad.includes('select("knobs")'), "knobs are never a mode of their own");
t.ok(/focusTarget = message\.target/.test(pad), "the pad remembers the PC's focus token for arrow knobs");
t.ok(css.includes(".knob__dial") && css.includes("touch-action: none"), "dials own their touches");
t.ok(sw.includes('"/knobs.js"'), "the service worker precaches knobs.js");
t.ok(read("README.md").includes("## Knobs"), "the README documents knobs");

t.done("knobs verification passed");
