import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { createTouchpadField } from "../public/touchpad-field.js";

const t = createChecker("touchpad-field");
const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");

// A scripted browser: time and animation frames only advance when the test pumps them.
let clock = 1000, queue = [], perf = false, reducedMotion = false;
Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true });
globalThis.document = { documentElement: { classList: { contains: (name) => name === "perf" && perf } } };
globalThis.matchMedia = () => ({ matches: reducedMotion });
globalThis.window = { devicePixelRatio: 3 };
globalThis.requestAnimationFrame = (callback) => queue.push(callback);
globalThis.ResizeObserver = class { observe() {} };

function fakeGl({ compiles = true, links = true } = {}) {
  const gl = {
    draws: 0, values: {}, lost: false, VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => compiles, createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => links, isContextLost: () => gl.lost, useProgram() {}, bindBuffer() {}, createBuffer: () => ({}), bufferData() {}, getAttribLocation: () => 0,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, getUniformLocation: (program, name) => name, viewport() {},
    uniform1f(name, value) { gl.values[name] = value; }, uniform2f(name, x, y) { gl.values[name] = [x, y]; }, uniform3fv(name, value) { gl.values[name] = value; },
    drawArrays() { gl.draws += 1; },
  };
  return gl;
}
function harness(gl) {
  queue = []; perf = false; reducedMotion = false;
  const listeners = {}, requests = [];
  const canvas = { hidden: true, width: 0, height: 0, addEventListener: (name, listener) => { listeners[name] = listener; }, getContext: (type, options) => { requests.push({ type, options }); return gl; } };
  return { canvas, listeners, requests, field: createTouchpadField(canvas, { clientWidth: 800, clientHeight: 400 }) };
}
function pump(frames, step = 16) {
  let ran = 0;
  while (ran < frames && queue.length) {
    const pending = queue; queue = []; clock += step;
    for (const callback of pending) callback(clock);
    ran += 1;
  }
  return ran;
}
const open = { open: true, dragging: false };

// The previous feedback stays in charge whenever the field cannot run.
for (const [name, gl] of [["without WebGL", null], ["when shaders do not compile", fakeGl({ compiles: false })], ["when the program does not link", fakeGl({ links: false })]]) {
  const { canvas, field } = harness(gl);
  field.update(open);
  t.equal(canvas.hidden, true, `the canvas stays hidden ${name}`);
  t.equal(field.touch(1, 10, 10), false, `touches fall back to the DOM feedback ${name}`);
  t.equal(queue.length, 0, `no frames are scheduled ${name}`);
}
for (const [name, set] of [["Performance mode", () => { perf = true; }], ["reduced motion", () => { reducedMotion = true; }]]) {
  const { canvas, field, requests } = harness(fakeGl());
  set(); field.update(open);
  t.equal(requests.length, 0, `${name} never creates a WebGL context`);
  t.equal(canvas.hidden, true, `${name} hides the canvas`);
  t.equal(field.touch(1, 10, 10), false, `${name} uses the DOM feedback`);
}

// Opening draws the resting field once, capped well below a phone's native resolution.
{
  const gl = fakeGl(), { canvas, field, requests } = harness(gl);
  field.update({ open: false, dragging: false });
  t.equal(requests.length, 0, "no WebGL context exists until the touchpad opens");
  t.equal(field.touch(1, 10, 10), false, "a closed touchpad ignores touches");
  field.update(open);
  t.equal(canvas.hidden, false, "the canvas shows when the touchpad opens");
  t.deepEqual([canvas.width, canvas.height], [1000, 500], "resolution is capped at 1.25x even on a 3x phone");
  const { options } = requests[0];
  t.equal(options.failIfMajorPerformanceCaveat, true, "software rendering is refused");
  t.equal(options.alpha, false, "the canvas is opaque");
  t.equal(pump(5), 1, "the resting field draws one frame and sleeps");
  const idle = gl.draws; pump(20);
  t.equal(gl.draws, idle, "an idle field draws nothing");
  perf = true;
  t.equal(field.touch(1, 10, 10), false, "enabling Performance mode hands touches back immediately");
  perf = false;

  // Fingers keep the loop alive only while there is something to show.
  t.equal(field.touch(1, 100, 100), true, "a live field takes the touch");
  t.equal(pump(120), 120, "the loop runs for as long as a finger is down");
  t.equal(field.touch(2, 200, 100), true, "a second finger is tracked");
  t.equal(field.touch(3, 300, 100), true, "extra fingers are absorbed, not passed to the DOM feedback");
  field.lift(3); field.lift(2); field.lift(1); pump(400);
  t.equal(queue.length, 0, "the loop stops once the surface settles");
  const settled = gl.draws; pump(20);
  t.equal(gl.draws, settled, "nothing draws after settling");

  // Each gesture has its own response, and every one of them comes to rest.
  field.touch(1, 120, 80); pump(3); field.lift(1); pump(400);
  field.tap(); const tapped = pump(400);
  t.ok(tapped > 60 && tapped < 120, `a tap ripples for about a second and a half (${tapped} frames)`);
  t.equal(queue.length, 0, "a tap settles");
  field.touch(1, 100, 100); field.touch(2, 200, 100); pump(2);
  const before = gl.values.F[1]; field.scroll(0, -30); pump(1);
  t.ok(gl.values.F[1] > before, "two fingers move the field with the scroll");
  pump(1); field.scroll(0, -30); pump(1);
  t.ok(Math.hypot(...gl.values.D) > 1, "scrolling stretches the dots");
  pump(60);
  t.ok(Math.hypot(...gl.values.D) < .1, "dots stop stretching once resting fingers stop moving");
  field.scroll(0, -30); pump(1); field.scroll(0, -30); pump(1);
  field.lift(1); field.lift(2);
  t.ok(pump(600) < 600, "scrolling coasts to a stop");
  field.touch(1, 100, 100); field.touch(2, 300, 100); field.zoom(8); pump(60);
  t.ok(gl.values.Z > 1.5, "spreading two fingers zooms the field");
  t.deepEqual(gl.values.ZC, [200, 100], "the field zooms around the fingers");
  field.lift(1); field.lift(2);
  t.ok(pump(600) < 600, "zoom settles after the fingers lift");
  t.ok(Math.abs(gl.values.Z - 1) < .01, "zoom returns to rest");
  field.update({ open: true, dragging: true }); pump(1); field.touch(1, 100, 100); pump(60);
  t.ok(gl.values.L > .95, "drag lock is visible under a finger");
  field.lift(1);
  t.ok(pump(600) < 600, "a held drag lock does not keep the loop running with no finger down");
  field.update(open); pump(600);
  field.touch(1, 100, 100); field.update({ open: false, dragging: false }); pump(2);
  t.equal(queue.length, 0, "closing the touchpad stops the loop");
  t.equal(canvas.hidden, true, "closing the touchpad hides the canvas");
}

// A slow phone gives back resolution, then the depth layer, and a fast one keeps both.
{
  const gl = fakeGl(), { canvas, field } = harness(gl);
  field.update(open); pump(1); field.touch(1, 100, 100);
  pump(200);
  t.equal(canvas.width, 1000, "a phone keeping pace stays at full quality");
  t.equal(gl.values.DP, 1, "a phone keeping pace keeps the depth layer");
  pump(41, 40);
  t.equal(canvas.width, 800, "slow frames lower the resolution");
  pump(41, 40);
  t.equal(canvas.width, 600, "still slow frames lower it again");
  pump(41, 40);
  t.equal(gl.values.DP, 0, "the depth layer goes last");
  t.equal(pump(10, 500), 10, "long stalls such as a backgrounded app are not counted as slow frames");
}

// Android may drop the GPU context while the app is in the background.
{
  const gl = fakeGl(), { canvas, field, listeners } = harness(gl);
  field.update(open); pump(1);
  let prevented = false;
  listeners.webglcontextlost({ preventDefault() { prevented = true; } });
  t.ok(prevented, "the context loss is claimed so the browser can restore it");
  t.equal(canvas.hidden, true, "a lost context hides the canvas");
  t.equal(field.touch(1, 10, 10), false, "a lost context falls back to the DOM feedback");
  listeners.webglcontextrestored();
  t.equal(canvas.hidden, false, "a restored context shows the canvas again");
  t.equal(field.touch(1, 10, 10), true, "a restored context takes touches again");
}

// A module the shell imports but the cache or website demo lacks breaks them outright.
const pad = read("public/input-pad.js"), html = read("public/index.html");
t.ok(pad.includes('from "./touchpad-field.js"'), "the touchpad loads the field");
t.ok(read("public/sw.js").includes('"/touchpad-field.js"'), "the offline shell precaches the field");
t.ok(read("scripts/build-website-demo.mjs").includes("'touchpad-field.js'"), "the website demo copies the field");
t.ok(html.indexOf('id="touchpad-field"') > 0 && html.indexOf('id="touchpad-field"') < html.indexOf('id="touchpad-feedback"'), "the field sits behind the feedback and hint");
t.ok(/\.touchpad-field \{[^}]*pointer-events: none/.test(read("public/style.css")), "the field never intercepts touches");
t.done("touchpad-field verification passed");
