/**
 * The quick controls curtain's live parts: brightness and volume sliders, and the
 * music card. Its buttons use the shared data-action="control" path in app.js.
 */

import { icon } from "./icons.js";

/**
 * Sends the newest level and drops the ones in between. A slider fires far faster
 * than a monitor can answer, so this never has more than one request in flight
 * and always finishes on the value the finger stopped at.
 */
export function createLevelSender(send, onError) {
  let latest = null, sending = false;
  return async function sendLevel(value) {
    latest = value;
    if (sending) return;
    sending = true;
    while (latest !== null) {
      const next = latest;
      latest = null;
      try { await send(next); }
      catch (error) { onError(error); }
    }
    sending = false;
  };
}

export function createQuickControls({ api, isOnline, notify, report }) {
  const $ = (id) => document.getElementById(id);

  function createSlider(id, verb, field) {
    const root = $(id), input = root.querySelector("input");
    let touched = false, warned = false;
    const paint = (value) => {
      input.value = value;
      root.style.setProperty("--level", value);
      // The icon sits at the start of the track, so it flips once the fill reaches it.
      root.dataset.covered = String(value >= 14);
    };
    const send = createLevelSender(async (value) => {
      const result = await api("/api/control", { method: "POST", body: JSON.stringify({ verb, value }) });
      if (result.warning === "hdr-active" && !warned) {
        warned = true;
        notify("Command sent. HDR may prevent the brightness from changing.", false, true);
      }
    }, report);
    input.addEventListener("input", () => {
      touched = true;
      paint(Number(input.value));
      if (isOnline()) send(Number(input.value));
    });
    return {
      show(verbs) { root.hidden = !verbs.includes(verb); touched = false; warned = false; },
      load(levels) {
        // A slow monitor must not pull the slider out from under a finger.
        if (touched) return;
        const value = levels[field];
        // A display that cannot report its level cannot be set either.
        input.disabled = field === "brightness" && value === null;
        paint(value ?? 0);
      },
    };
  }

  const sliders = [createSlider("level-brightness", "brightness-set", "brightness"), createSlider("level-volume", "volume-set", "volume")];

  function media(track) {
    $("qc-music-title").textContent = track?.title || "Nothing playing";
    $("qc-music-artist").textContent = track?.artist ?? "";
    const toggle = $("qc-music-toggle"), playing = track?.playing === true;
    if (toggle.dataset.playing === String(playing)) return;
    toggle.dataset.playing = String(playing);
    toggle.innerHTML = icon(playing ? "pause" : "play");
    toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  media(null);

  function show(verbs) {
    sliders.forEach((slider) => slider.show(verbs));
    $("qc-mute").hidden = !verbs.includes("mute-toggle");
    $("qc-music").hidden = !verbs.includes("media-play-pause");
    api("/api/levels").then((levels) => sliders.forEach((slider) => slider.load(levels))).catch(() => {
      // Sliders stay usable without a reading; they simply start empty.
    });
  }

  return { show, media };
}
