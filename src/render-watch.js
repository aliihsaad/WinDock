/**
 * Render watcher: wait until the PC has been busy (a render or export) and then goes quiet,
 * and then tell the phone or put the PC to sleep. It never acts on a PC that was idle all along.
 */
export const WATCH_ACTIONS = Object.freeze(["notify", "sleep", "shutdown"]);

export function createRenderWatch({
  readStats, act, now = Date.now, setTimer = setInterval, clearTimer = clearInterval,
  intervalMs = 5000, busyAt = 50, idleAt = 15, idleForMs = 45000, startBusyWithinMs = 10 * 60 * 1000, maxMs = 12 * 3600 * 1000,
}) {
  let timer = null;
  let state = { phase: "off" };
  let armedAt = 0, quietSince = null, busySeen = false, busy = false;

  const load = (s) => Math.max(Number.isFinite(s?.cpu) ? s.cpu : 0, Number.isFinite(s?.gpu?.util) ? s.gpu.util : 0);
  const stop = () => { if (timer !== null) clearTimer(timer); timer = null; };
  async function tick() {
    if (state.phase !== "waiting" && state.phase !== "busy") return;
    const t = now();
    if (t - armedAt > maxMs || (!busySeen && t - armedAt > startBusyWithinMs)) { stop(); state = { phase: "expired", action: state.action }; return; }
    if (busy) return; // one reading at a time
    busy = true;
    let stats;
    try { stats = await readStats(); } catch { busy = false; return; }
    busy = false;
    if (state.phase !== "waiting" && state.phase !== "busy") return;
    const l = load(stats);
    if (l >= busyAt) { busySeen = true; quietSince = null; state = { phase: "busy", action: state.action, load: l }; return; }
    if (!busySeen) { state = { phase: "waiting", action: state.action, load: l }; return; }
    if (l < idleAt) {
      quietSince ??= t;
      if (t - quietSince >= idleForMs) {
        stop();
        const { action } = state;
        state = { phase: "done", action, finishedAt: new Date(t).toISOString() };
        if (action !== "notify") await Promise.resolve(act(action)).catch(() => { state = { ...state, error: "The PC could not " + action + "." }; });
      }
    } else quietSince = null;
  }
  return {
    state: () => ({ ...state }),
    arm(action) {
      if (!WATCH_ACTIONS.includes(action)) throw Object.assign(new Error("Choose notify, sleep or shutdown."), { status: 400 });
      stop(); armedAt = now(); quietSince = null; busySeen = false; busy = false;
      state = { phase: "waiting", action };
      timer = setTimer(() => { tick(); }, intervalMs);
      timer?.unref?.();
      return { ...state };
    },
    disarm() { stop(); state = { phase: "off" }; return { ...state }; },
    tick,
    dispose: stop,
  };
}
