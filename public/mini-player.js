/** Small floating player: PC videos streamed from the host, and YouTube links in a bridge-less native window. */
const ID = /^[A-Za-z0-9_-]{11}$/;
/** Accepts the usual YouTube link shapes and returns a plain watch URL, or null for anything else. */
export function parseYouTube(text) {
  let url;
  try { url = new URL(String(text).trim().includes("://") ? String(text).trim() : "https://" + String(text).trim()); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const [, kind, rest] = url.pathname.split("/");
    id = kind === "watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(kind) ? rest : null;
  }
  return ID.test(id || "") ? "https://m.youtube.com/watch?v=" + id : null;
}
export const videoSrc = (root, path) => "/api/videos/stream?root=" + encodeURIComponent(root) + "&path=" + encodeURIComponent(path);
const join = (dir, name) => (dir ? dir + "/" + name : name);

export function createMiniPlayer({ api, get = (id) => document.getElementById(id), notify, android = globalThis.WinDockAndroid, open = (u) => globalThis.open(u, "_blank", "noopener,noreferrer"), secure = false }) {
  const dialog = get("mini"), list = get("mini-list"), crumbs = get("mini-path"), float = get("mini-float"), video = get("mini-video");
  let roots = [], rootId = "", dir = "";
  const tab = (name) => { dialog.dataset.tab = name; for (const b of dialog.querySelectorAll("[data-mini-tab]")) b.setAttribute("aria-pressed", String(b.dataset.miniTab === name)); };
  const row = (text, attrs, meta = "") => { const li = document.createElement("li"), b = document.createElement("button"); b.type = "button"; b.className = "window-row"; Object.assign(b.dataset, attrs); b.textContent = text; if (meta) { const s = document.createElement("small"); s.textContent = meta; b.append(s); } li.append(b); return li; };
  async function show() {
    list.replaceChildren();
    if (!roots.length) { crumbs.textContent = ""; list.append(row("No video folders found on this PC.", {})); return; }
    if (!rootId) { crumbs.textContent = "Folders"; for (const r of roots) list.append(row("📁 " + r.name, { root: r.id })); return; }
    crumbs.textContent = roots.find((r) => r.id === rootId)?.name + (dir ? " / " + dir.replaceAll("/", " / ") : "");
    list.append(row("↰ Back", { up: "1" }));
    try {
      const data = await api("/api/videos/list?root=" + encodeURIComponent(rootId) + "&path=" + encodeURIComponent(dir));
      for (const d of data.dirs || []) list.append(row("📁 " + d, { dir: d }));
      for (const f of data.files || []) list.append(row("▶ " + f.name, f.playable === false ? { unplayable: "1" } : { file: f.name }, f.playable === false ? "Phone can’t play this format" : ""));
      if (!(data.dirs?.length || data.files?.length)) list.append(row("No videos here.", {}));
    } catch (error) { notify(error.message || "Could not read that folder.", true); }
  }
  function play(path) {
    if (secure) return notify("Videos play on a normal Wi-Fi connection; this secure link can’t stream them yet.", true);
    video.src = videoSrc(rootId, path); float.hidden = false; video.play().catch(() => {});
  }
  function closeVideo() { video.pause(); video.removeAttribute("src"); video.load(); float.hidden = true; }
  dialog.addEventListener("click", async (event) => {
    const t = event.target.closest("button"); if (!t) return;
    if (t.dataset.miniTab) return tab(t.dataset.miniTab);
    if (t.dataset.root) { rootId = t.dataset.root; dir = ""; return show(); }
    if (t.dataset.up) { if (dir) dir = dir.split("/").slice(0, -1).join("/"); else rootId = ""; return show(); }
    if (t.dataset.dir) { dir = join(dir, t.dataset.dir); return show(); }
    if (t.dataset.file) { play(join(dir, t.dataset.file)); return dialog.close(); }
    if (t.id === "mini-youtube-go") {
      const url = parseYouTube(get("mini-youtube-input").value);
      if (!url) return notify("Paste a YouTube video link.", true);
      if (typeof android?.openYoutube === "function") android.openYoutube(url); else open(url);
      dialog.close();
    }
  });
  get("mini-close").addEventListener("click", closeVideo);
  get("mini-size").addEventListener("click", () => { float.dataset.size = float.dataset.size === "large" ? "small" : "large"; });
  // Drag the floating window by its handle; keep it on screen.
  const handle = get("mini-drag");
  let drag = null;
  handle.addEventListener("pointerdown", (e) => { const r = float.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointermove", (e) => { if (!drag || e.pointerId !== drag.id) return; const r = float.getBoundingClientRect(); float.style.left = Math.max(0, Math.min(innerWidth - r.width, e.clientX - drag.dx)) + "px"; float.style.top = Math.max(0, Math.min(innerHeight - r.height, e.clientY - drag.dy)) + "px"; float.style.right = "auto"; float.style.bottom = "auto"; });
  handle.addEventListener("pointerup", () => { drag = null; });
  handle.addEventListener("pointercancel", () => { drag = null; });
  return {
    async open() {
      tab(dialog.dataset.tab || "pc");
      if (!dialog.open) dialog.showModal();
      try { roots = (await api("/api/videos/roots")).roots || []; } catch { roots = []; }
      rootId = ""; dir = ""; show();
    },
    closeVideo,
  };
}
