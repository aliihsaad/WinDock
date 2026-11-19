// Shows the newest Tara build and its download links, straight from GitHub's public release list.
const API = "https://api.github.com/repos/yeshwanthkumardomala/tara/releases?per_page=12";
const CACHE_KEY = "tara-releases-v1";
const $ = (id) => document.getElementById(id);

/** Keep only builds that carry an app file, newest first. */
export function usable(releases) {
  return (Array.isArray(releases) ? releases : [])
    .filter((r) => !r.draft && Array.isArray(r.assets) && r.assets.some((a) => /\.(apk|exe)$/i.test(a.name)))
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
}
export const pick = (release, ext) => release?.assets?.find((a) => a.name.toLowerCase().endsWith(ext) && a.browser_download_url?.startsWith("https://github.com/yeshwanthkumardomala/tara/"));
const size = (a) => a ? " · " + (a.size / 1048576).toFixed(0) + " MB" : "";
const when = (r) => new Date(r.published_at || r.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function render(releases, note) {
  const list = usable(releases);
  if (!list.length) { $("status").textContent = note || "No downloads are published yet."; return; }
  const [latest, ...older] = list;
  const apk = pick(latest, ".apk"), exe = pick(latest, ".exe");
  $("status").textContent = note || "Up to date. This is the newest build.";
  $("latest").hidden = false;
  $("latest-title").textContent = (latest.name || latest.tag_name) + (latest.prerelease ? "" : "");
  $("latest-meta").textContent = "Published " + when(latest);
  for (const [id, asset, label] of [["get-apk", apk, "Download for phone (APK)"], ["get-exe", exe, "Download for PC (installer)"]]) {
    const a = $(id); a.hidden = !asset;
    if (asset) { a.href = asset.browser_download_url; a.setAttribute("download", asset.name); a.textContent = label + size(asset); }
  }
  $("older").hidden = older.length === 0;
  const ul = $("older-list"); ul.replaceChildren();
  for (const r of older.slice(0, 6)) {
    const li = document.createElement("li");
    const name = document.createElement("span"); name.textContent = (r.name || r.tag_name) + " · " + when(r);
    li.append(name);
    for (const [ext, label] of [[".apk", "Phone"], [".exe", "PC"]]) { const asset = pick(r, ext); if (!asset) continue; const a = document.createElement("a"); a.href = asset.browser_download_url; a.textContent = label; li.append(a); }
    ul.append(li);
  }
}

async function load() {
  $("status").textContent = "Checking for the latest version…";
  try {
    const res = await fetch(API, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const releases = await res.json();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(releases)); } catch { /* private mode */ }
    render(releases);
  } catch {
    let cached = null; try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { /* none */ }
    if (cached) render(cached, "You're offline, or GitHub is busy. Showing the last version this app saw.");
    else $("status").textContent = "Couldn't reach GitHub. Check the connection and try again.";
  }
}
if (typeof document !== "undefined" && document.getElementById("status")) {
  $("refresh").addEventListener("click", load);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  load();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
