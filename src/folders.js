// Folder shortcuts retain the existing app-tile wire format for older clients.
// Only local, fully qualified Windows directories are eligible; never commands,
// Shell URLs, files, UNC/device paths or user-supplied launch arguments.
import { win32 } from "node:path";
import { createHash } from "node:crypto";

export function folderApp(value) {
  if (typeof value !== "string" || value.length > 400 || !/^[a-z]:[\\/]/i.test(value) ||
      /[\x00-\x1f\x7f"<>|?*]/.test(value) || value.slice(2).includes(":")) return null;
  const target = win32.normalize(value).replace(/\\+$/, "");
  const path = /^[a-z]:$/i.test(target) ? target + "\\" : target;
  if (path.slice(3).split("\\").some(part => /[. ]$/.test(part))) return null;
  return {
    id: "folder:" + createHash("sha256").update(path.toLowerCase()).digest("hex"),
    name: win32.basename(path) || path,
    target: path, args: "", icon: "", source: "folder",
  };
}

export function folderFromTile(tile) {
  if (tile?.kind !== "app" || tile.args) return null;
  const app = folderApp(tile.target);
  return app && tile.id === app.id ? { ...app, name: tile.label || app.name } : null;
}

export const FOLDER_ICON = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><path fill="#d49a32" d="M10 26a8 8 0 0 1 8-8h22l10 10h28a8 8 0 0 1 8 8v38a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8z"/><path fill="#f4c563" d="M10 40a8 8 0 0 1 8-8h60a8 8 0 0 1 8 8v34a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8z"/></svg>');
