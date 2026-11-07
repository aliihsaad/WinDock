// The bundled backgrounds, in picker order. Layouts save these ids, so a shipped id
// must stay valid. Each one also needs its art in /wallpapers and a rule in style.css.
export const SCENES = ["aurora", "midnight", "dusk", "ember", "lagoon", "silk", "obsidian", "prism"];

const FADE_MS = 520;
let latest = 0;

/** Applies a scene, fading from the old one once the new art is ready to paint. */
export async function showScene(scene) {
  const ticket = ++latest; // Also cancels a pending fade when the choice changes back.
  const root = document.documentElement;
  const previous = root.dataset.background;
  if (previous === scene) return;
  const still = root.classList.contains("perf") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!previous || still) {
    root.dataset.background = scene;
    return;
  }
  const art = new Image();
  art.src = `wallpapers/${scene}.webp`;
  await art.decode().catch(() => {}); // Missing art still has to change the colours.
  if (ticket !== latest) return;
  const wallpaper = document.getElementById("wallpaper");
  const fade = document.createElement("div");
  fade.className = "wallpaper__fade";
  fade.style.backgroundImage = getComputedStyle(wallpaper).backgroundImage;
  wallpaper.append(fade);
  root.dataset.background = scene;
  // A timer rather than animationend, which never fires if motion is turned off mid-fade.
  setTimeout(() => fade.remove(), FADE_MS);
}
