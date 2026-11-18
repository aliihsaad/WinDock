import { DECKS, MODIFIER_LABELS, chordMessage, detectDeck, scrubSteps } from "./decks.js";

/** Shortcut decks, held modifiers and the timeline scrub strip inside the touchpad dialog. */
const notifySave = (name, error) => document.dispatchEvent(new CustomEvent("windock-toast", { detail: { message: name ? "Saved " + name : error, error: !name } }));
export function createKeysPane({ api, send, isReady, storage = localStorage, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  let deckId = "general", pageId = null, detected = null, timer = null, userChose = false;
  try { const saved = storage.getItem("windock-deck"); if (DECKS.some((d) => d.id === saved)) { deckId = saved; userChose = true; } } catch { /* optional */ }
  const deck = () => DECKS.find((d) => d.id === deckId) ?? DECKS[DECKS.length - 1];
  const page = () => deck().pages.find((p) => p.id === pageId) ?? deck().pages[0];
  const held = new Set();

  function renderDecks() {
    $("keys-decks").innerHTML = DECKS.map((d) => `<button type="button" data-deck="${d.id}" aria-pressed="${d.id === deckId}">${d.name}${detected === d.id ? ' <span class="keys-live" title="Open on your PC">●</span>' : ""}</button>`).join("");
    $("keys-pages").innerHTML = deck().pages.length > 1
      ? deck().pages.map((p) => `<button type="button" data-page="${p.id}" aria-pressed="${p.id === page().id}">${p.name}</button>`).join("") : "";
  }
  function renderGrid() {
    const current = page();
    $("keys-grid").dataset.layout = current.layout || "grid";
    $("keys-grid").innerHTML = current.keys.map((entry, index) => {
      const combo = [...entry.mods.map((m) => MODIFIER_LABELS[m]), entry.hint || (entry.key.length === 1 ? entry.key.toUpperCase() : entry.key)].join("+");
      return `<button type="button" data-index="${index}" ${isReady() ? "" : "disabled"}><span class="keys-name">${entry.label}</span><span class="keys-combo">${combo}</span></button>`;
    }).join("");
  }
  function paint() { renderDecks(); renderGrid(); for (const b of doc.querySelectorAll("[data-mod]")) b.setAttribute("aria-pressed", String(held.has(b.dataset.mod))); }

  $("keys-decks").addEventListener("click", (event) => {
    const button = event.target.closest("[data-deck]"); if (!button) return;
    deckId = button.dataset.deck; pageId = null; userChose = true;
    try { storage.setItem("windock-deck", deckId); } catch { /* optional */ }
    paint();
  });
  $("keys-pages").addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) { pageId = button.dataset.page; paint(); } });
  $("keys-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]"); if (!button) return;
    const entry = page().keys[Number(button.dataset.index)];
    send(chordMessage(entry));
    // Save first, then let Blender finish writing before the PC copies the file as the next version.
    if (entry.action === "versioned-save") setTimeout(() => api("/api/versioned-save", { method: "POST", body: "{}" }).then((r) => notifySave(r.name), (e) => notifySave(null, e.message)), 1500);
    navigator.vibrate?.(8);
  });
  // Sticky modifiers: tap once to hold on the PC, tap again to let go.
  doc.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-mod]"); if (!button) return;
    const name = button.dataset.mod, down = !held.has(name);
    if (send({ type: "modifier", key: name, down })) { if (down) held.add(name); else held.delete(name); paint(); }
  });

  // Swipe along the strip to step frames; the farther the swipe, the more frames.
  const strip = $("scrub-strip");
  let last = null, carried = 0;
  strip.addEventListener("pointerdown", (event) => { if (!isReady()) return; last = event.clientX; carried = 0; strip.setPointerCapture(event.pointerId); strip.dataset.active = "true"; });
  strip.addEventListener("pointermove", (event) => {
    if (last === null) return;
    const result = scrubSteps(event.clientX - last, carried); last = event.clientX; carried = result.carried;
    if (result.steps) send(chordMessage({ mods: [], key: result.steps > 0 ? "ArrowRight" : "ArrowLeft" }, Math.abs(result.steps)));
  });
  const end = () => { last = null; strip.dataset.active = "false"; };
  strip.addEventListener("pointerup", end); strip.addEventListener("pointercancel", end); strip.addEventListener("lostpointercapture", end);

  async function refreshDetected() {
    try {
      const state = await api("/api/state");
      detected = detectDeck(Array.isArray(state?.running) ? state.running : []);
      if (detected && !userChose && detected !== deckId) { deckId = detected; pageId = null; }
      paint();
    } catch { /* detection is a convenience only */ }
  }
  return {
    paint,
    /** The host released every held modifier (disconnect or release); clear the buttons. */
    cleared() { if (held.size) { held.clear(); paint(); } },
    open() { paint(); refreshDetected(); clearInterval(timer); timer = setInterval(refreshDetected, 6000); },
    /** Stop polling but keep modifiers held, for switching between the touchpad and keys on one connection. */
    pause() { clearInterval(timer); timer = null; },
    close() { clearInterval(timer); timer = null; this.cleared(); },
    heldModifiers: () => [...held],
  };
}
