/** Validate a PC→phone control command. Only these actions ever reach the phone. */
const GLOBAL = new Set(["back", "home", "recents", "notifications"]);
const frac = (v) => typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
export function validatePhoneCommand(body) {
  if (!body || typeof body !== "object" || typeof body.type !== "string") return null;
  if (GLOBAL.has(body.type)) return { type: body.type };
  if (body.type === "tap") { const x1 = frac(body.x1), y1 = frac(body.y1); return x1 === null || y1 === null ? null : { type: "tap", x1, y1 }; }
  if (body.type === "swipe") {
    const [x1, y1, x2, y2] = [body.x1, body.y1, body.x2, body.y2].map(frac);
    if ([x1, y1, x2, y2].includes(null)) return null;
    const ms = Number.isFinite(body.ms) ? Math.min(1500, Math.max(50, Math.round(body.ms))) : 300;
    return { type: "swipe", x1, y1, x2, y2, ms };
  }
  return null;
}
