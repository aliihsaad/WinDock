import { createHash } from "node:crypto";

// Links are app-shaped tiles so existing clients retain, reorder and launch them.
export function linkApp(value, name = "") {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value) || !/^https?:\/\//i.test(value)) return null;
  if (typeof name !== "string" || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) return null;
  return { id: "link:" + createHash("sha256").update(url.href).digest("hex"), name: name.trim() || url.hostname,
    target: url.href, args: "", icon: "", source: "link" };
}

export function linkFromTile(tile) {
  if (tile?.kind !== "app" || tile.args) return null;
  const app = linkApp(tile.target, tile.label);
  return app?.id === tile.id ? app : null;
}

export const LINK_ICON = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect x="4" y="4" width="88" height="88" rx="24" fill="#193c50"/><g fill="none" stroke="#9bd9fa" stroke-width="5"><circle cx="48" cy="48" r="28"/><ellipse cx="48" cy="48" rx="12" ry="28"/><path d="M20 48h56M25 33h46M25 63h46"/></g></svg>');
