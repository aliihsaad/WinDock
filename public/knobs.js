/**
 * Knobs: rotary dials for the touchpad session.
 *
 * Pure: no DOM APIs, no sockets. A dial turns pointer positions into whole
 * steps; a profile turns steps into the input messages the host already
 * accepts (scroll, zoom, arrow keys). Nothing here widens the input protocol:
 * a knob can only do what two fingers or the remote keyboard could already do,
 * which is exactly why it needs no new native code on the PC.
 */

import { escapeHtml } from "./dock.js";

/** One wheel notch, the unit Windows wheel data and Linux REL_WHEEL_HI_RES share. */
export const WHEEL_NOTCH = 120;
/** The host rejects a scroll delta beyond 2048; bigger turns are split into whole notches. */
const MAX_DELTA = Math.floor(2048 / WHEEL_NOTCH) * WHEEL_NOTCH;
const MAX_ZOOM = 8;

/**
 * Profiles map each of the three knobs to an action.
 *  - scroll: wheel notches on an axis, for the control under the PC cursor
 *  - zoom:   Ctrl/Cmd + wheel steps
 *  - key:    arrow keys sent to the control the PC reports as focused
 * Everything an action can emit already passes validateInput on the host.
 */
export const PROFILES = Object.freeze([
  {
    id: "wheel",
    name: "Wheel",
    hint: "Point the PC cursor at a slider or a page, then turn. Each click of the knob is one wheel notch.",
    knobs: [
      { id: "wheel", label: "Wheel", detail: "Up / down", action: { type: "scroll", axis: "dy" } },
      { id: "side", label: "Side wheel", detail: "Left / right", action: { type: "scroll", axis: "dx" } },
      { id: "zoom", label: "Zoom", detail: "Ctrl + wheel", action: { type: "zoom" } },
    ],
  },
  {
    id: "arrows",
    name: "Arrows",
    hint: "Click a value or field on the PC first. The knobs press its arrow keys, one step per click.",
    knobs: [
      { id: "vertical", label: "Up / Down", detail: "↑ and ↓ keys", action: { type: "key", up: "ArrowUp", down: "ArrowDown" } },
      { id: "horizontal", label: "Left / Right", detail: "→ and ← keys", action: { type: "key", up: "ArrowRight", down: "ArrowLeft" } },
      { id: "wheel", label: "Wheel", detail: "Up / down", action: { type: "scroll", axis: "dy" } },
    ],
  },
]);

/** The profile with this id, or the first one when the stored id is stale. */
export function profileById(id) {
  return PROFILES.find((profile) => profile.id === id) || PROFILES[0];
}

/**
 * Turns pointer positions around a centre into whole steps. Clockwise is
 * positive. A fast turn multiplies the steps so a flick covers ground while a
 * slow turn stays one notch at a time, the way a physical encoder with
 * acceleration feels.
 */
export class KnobDial {
  /** Thresholds are in degrees, pixels and degrees per second; `now` is injectable for tests. */
  constructor({ stepDegrees = 12, deadZone = 14, fastDegreesPerSecond = 240, fastFactor = 3, now = () => performance.now() } = {}) {
    Object.assign(this, { stepDegrees, deadZone, fastDegreesPerSecond, fastFactor, now });
    this.rotation = 0;
    this.reset();
  }
  /** Forget the current turn; the accumulated face rotation is kept for the visual. */
  reset() { this.active = false; this.angle = null; this.residual = 0; this.time = null; this.cx = 0; this.cy = 0; }
  /** Angle of a point around the centre, in degrees, clockwise positive on screen. */
  angleAt(x, y) { return (Math.atan2(y - this.cy, x - this.cx) * 180) / Math.PI; }
  /** Start a turn around (cx, cy) from the first touch; inside the dead zone the anchor waits. */
  begin(cx, cy, x, y) {
    this.reset();
    this.active = true; this.cx = cx; this.cy = cy; this.time = this.now();
    if (Math.hypot(x - cx, y - cy) >= this.deadZone) this.angle = this.angleAt(x, y);
  }
  /** Returns the whole steps this movement produced; zero when nothing crossed a step. */
  turn(x, y) {
    if (!this.active) return 0;
    const time = this.now();
    if (Math.hypot(x - this.cx, y - this.cy) < this.deadZone) { this.angle = null; this.time = time; return 0; }
    const angle = this.angleAt(x, y);
    if (this.angle === null) { this.angle = angle; this.time = time; return 0; }
    let delta = angle - this.angle;
    if (delta > 180) delta -= 360; else if (delta <= -180) delta += 360;
    this.angle = angle;
    this.rotation += delta;
    this.residual += delta;
    const seconds = Math.max(0.001, (time - this.time) / 1000);
    this.time = time;
    const fast = Math.abs(delta) / seconds >= this.fastDegreesPerSecond;
    const steps = Math.trunc(this.residual / this.stepDegrees);
    if (!steps) return 0;
    this.residual -= steps * this.stepDegrees;
    return steps * (fast ? this.fastFactor : 1);
  }
  /** Finish the turn; later movement is ignored until `begin` is called again. */
  end() { this.reset(); }
}

/**
 * Messages for `steps` turns of a knob. `target` is the focus token the PC
 * last reported; arrow knobs cannot send without one and say so.
 * Returns { messages, blocked }.
 */
export function knobMessages(knob, steps, { target = null } = {}) {
  const count = Math.trunc(Number(steps) || 0);
  if (!knob || !count) return { messages: [], blocked: null };
  const action = knob.action || {};
  if (action.type === "scroll") {
    const messages = [];
    let remaining = count * WHEEL_NOTCH;
    while (remaining !== 0) {
      const chunk = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, remaining));
      remaining -= chunk;
      messages.push(action.axis === "dx" ? { type: "scroll", dx: chunk, dy: 0 } : { type: "scroll", dx: 0, dy: chunk });
    }
    return { messages, blocked: null };
  }
  if (action.type === "zoom") {
    const messages = [];
    let remaining = count;
    while (remaining !== 0) {
      const chunk = Math.max(-MAX_ZOOM, Math.min(MAX_ZOOM, remaining));
      remaining -= chunk;
      messages.push({ type: "zoom", steps: chunk });
    }
    return { messages, blocked: null };
  }
  if (action.type === "key") {
    if (typeof target !== "string" || !/^[1-9][0-9]{0,15}$/.test(target)) {
      return { messages: [], blocked: "Click a value or field on the PC first, then turn the knob." };
    }
    const key = count > 0 ? action.up : action.down;
    return { messages: Array.from({ length: Math.min(Math.abs(count), 24) }, () => ({ type: "key", target, key })), blocked: null };
  }
  return { messages: [], blocked: null };
}

/** Profile chooser buttons. */
export function renderProfiles(profiles, activeId) {
  return (Array.isArray(profiles) ? profiles : [])
    .map((profile) => `<button type="button" data-profile="${escapeHtml(profile.id)}" aria-pressed="${String(profile.id === activeId)}">${escapeHtml(profile.name)}</button>`)
    .join("");
}

/** The three dials of a profile. The face rotates; the button takes the pointer. */
export function renderKnobs(profile) {
  const knobs = Array.isArray(profile?.knobs) ? profile.knobs : [];
  return knobs
    .map((knob) => [
      `<div class="knob" data-knob="${escapeHtml(knob.id)}">`,
      `<button class="knob__dial" type="button" aria-label="${escapeHtml(knob.label)} knob · ${escapeHtml(knob.detail)}">`,
      '<span class="knob__face" aria-hidden="true"><span class="knob__pointer"></span></span>',
      "</button>",
      `<strong class="knob__label">${escapeHtml(knob.label)}</strong>`,
      `<small class="knob__detail">${escapeHtml(knob.detail)}</small>`,
      '<output class="knob__value" aria-live="off">0</output>',
      "</div>",
    ].join(""))
    .join("");
}

/** The readout under a dial: signed steps since the profile was chosen. */
export function formatSteps(total) {
  const n = Math.trunc(Number(total) || 0);
  return n > 0 ? `+${n}` : String(n);
}
