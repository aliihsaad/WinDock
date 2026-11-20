const $ = (id) => document.getElementById(id);
const status = (text, error = false) => { $("status").textContent = text; $("status").dataset.error = String(error); };
async function send(command) {
  try {
    const res = await fetch("/api/phone/send", { method: "POST", headers: { "content-type": "application/json", "x-tara-phone": "local" }, body: JSON.stringify(command), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not send.");
    status(body.phones ? "Sent." : "No phone is connected to Tara right now.", !body.phones);
  } catch (error) { status(error.message, true); }
}
for (const button of document.querySelectorAll("[data-type]")) button.addEventListener("click", () => send({ type: button.dataset.type }));
for (const button of document.querySelectorAll("[data-swipe]")) button.addEventListener("click", () => {
  const up = button.dataset.swipe === "up";
  send({ type: "swipe", x1: .5, y1: up ? .72 : .28, x2: .5, y2: up ? .28 : .72, ms: 320 });
});
const pad = $("pad");
let start = null;
const point = (e) => { const r = pad.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), t: performance.now() }; };
pad.addEventListener("pointerdown", (e) => { pad.setPointerCapture(e.pointerId); start = point(e); });
pad.addEventListener("pointerup", (e) => {
  if (!start) return;
  const end = point(e), moved = Math.hypot(end.x - start.x, end.y - start.y);
  if (moved < .03) {
    send({ type: "tap", x1: end.x, y1: end.y });
    const dot = document.createElement("i"); dot.className = "dot"; dot.style.left = end.x * 100 + "%"; dot.style.top = end.y * 100 + "%"; pad.append(dot); setTimeout(() => dot.remove(), 350);
  } else send({ type: "swipe", x1: start.x, y1: start.y, x2: end.x, y2: end.y, ms: Math.round(Math.min(1500, Math.max(120, end.t - start.t))) });
  start = null;
});
pad.addEventListener("pointercancel", () => { start = null; });
