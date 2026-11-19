/**
 * Battery saver: background polling slows down while nobody is touching the phone.
 * `idleGate()` returns a function to call at the top of a timer tick; it says whether this tick should run.
 * While active every tick runs. After `idleAfterMs` without a touch only one tick in `factor` runs.
 */
let lastTouch = Date.now();
const touch = () => { lastTouch = Date.now(); };
if (typeof document !== "undefined") for (const type of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(type, touch, { passive: true, capture: true });
export const isIdle = (idleAfterMs = 45000, now = Date.now()) => now - lastTouch > idleAfterMs;
export function idleGate({ factor = 4, idleAfterMs = 45000, now = Date.now, idle = (ms) => isIdle(ms, now()) } = {}) {
  let skipped = 0;
  return () => {
    if (!idle(idleAfterMs)) { skipped = 0; return true; }
    if (++skipped >= factor) { skipped = 0; return true; }
    return false;
  };
}
export const markActive = touch;
