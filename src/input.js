/** Bounded input protocol shared by the HTTP/WS boundaries and Windows bridge. */
export function validateInput(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const exact = (...keys) => Object.keys(message).length === keys.length && keys.every((key) => Object.hasOwn(message, key));
  const delta = (n) => Number.isInteger(n) && Math.abs(n) <= 2048;
  if (["ping", "release", "focus"].includes(message.type) && exact("type")) return { type: message.type };
  const target = typeof message.target === "string" && /^[1-9][0-9]{0,15}$/.test(message.target);
  if (message.type === "paste" && exact("type", "target", "text") && target && typeof message.text === "string" && message.text.length > 0 && message.text.length <= 32768 && message.text.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message.text)) {
    return { type: "paste", target: message.target, text: message.text };
  }
  if (message.type === "text" && exact("type", "target", "text") && target && typeof message.text === "string" && message.text.length > 0 && message.text.length <= 1024 && message.text.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message.text)) {
    return { type: "text", target: message.target, text: message.text };
  }
  if (message.type === "key" && exact("type", "target", "key") && target && ["Backspace", "Delete", "Enter", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(message.key)) {
    return { type: "key", target: message.target, key: message.key };
  }
  if (["move", "scroll"].includes(message.type) && exact("type", "dx", "dy") && delta(message.dx) && delta(message.dy)) {
    return { type: message.type, dx: message.dx, dy: message.dy };
  }
  if (message.type === "zoom" && exact("type", "steps") && Number.isInteger(message.steps) && Math.abs(message.steps) >= 1 && Math.abs(message.steps) <= 8) {
    return { type: "zoom", steps: message.steps };
  }
  if (message.type === "button" && exact("type", "button", "down") && ["left", "right"].includes(message.button) && typeof message.down === "boolean") {
    return { type: "button", button: message.button, down: message.down };
  }
  return null;
}

export function validateSignature(body) {
  const bad = () => { throw Object.assign(new Error("Draw a signature with up to 64 strokes and 2048 points."), { status: 400 }); };
  if (!body || Object.keys(body).some((key) => !["strokes", "color"].includes(key))) bad();
  if (!["black", "blue"].includes(body.color) || !Array.isArray(body.strokes) || body.strokes.length < 1 || body.strokes.length > 64) bad();
  let count = 0;
  const strokes = body.strokes.map((stroke) => {
    if (!Array.isArray(stroke) || !stroke.length || (count += stroke.length) > 2048) bad();
    return stroke.map((point) => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) bad();
      return point.map((n) => Math.round(n * 10000) / 10000);
    });
  });
  return { strokes, color: body.color };
}
