/** A short plain-text history of connection changes, kept on this phone only, so drops can be diagnosed. */
const KEY = "tara-connlog", MAX = 40;
const store = () => { try { return globalThis.TaraPreferences || globalThis.localStorage; } catch { return null; } };
export function logConn(event, detail = "") {
  try {
    const s = store(); if (!s) return;
    const rows = JSON.parse(s.getItem(KEY) || "[]");
    rows.push([Date.now(), String(event).slice(0, 60), String(detail).slice(0, 120)]);
    s.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch { /* the log is optional */ }
}
export function connLogText() {
  try {
    const rows = JSON.parse(store()?.getItem(KEY) || "[]");
    if (!rows.length) return "No connection changes yet.";
    return rows.slice().reverse().map(([t, event, detail]) => new Date(t).toLocaleTimeString() + "  " + event + (detail ? " · " + detail : "")).join("\n");
  } catch { return "The log could not be read."; }
}
export function clearConnLog() { try { store()?.removeItem(KEY); } catch { /* optional */ } }
