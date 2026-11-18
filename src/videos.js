import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join, sep, extname, basename } from "node:path";
import { homedir } from "node:os";

/** Video library: read-only browsing and streaming of videos under a small set of PC folders. */
export const VIDEO_TYPES = Object.freeze({
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mkv": "video/x-matroska", ".ogv": "video/ogg", ".avi": "video/x-msvideo",
});
// What a phone's built-in player can usually decode; the rest are listed but flagged.
const PLAYABLE = new Set([".mp4", ".m4v", ".webm", ".ogv"]);
const MAX_ENTRIES = 400;

export function defaultVideoRoots({ home = homedir() } = {}) {
  return [
    { id: "videos", name: "Videos", path: join(home, "Videos") },
    { id: "downloads", name: "Downloads", path: join(home, "Downloads") },
    { id: "desktop", name: "Desktop", path: join(home, "Desktop") },
  ];
}

/** A relative path made only of plain names; no drive letters, streams, dots or separators tricks. */
export function cleanRelative(value) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 600 || /[\x00-\x1f\x7f:*?"<>|]/.test(value)) return null;
  const parts = value.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || /[. ]$/.test(p))) return null;
  return parts;
}

async function inside(rootPath, parts) {
  const base = await realpath(rootPath);
  const target = await realpath(join(base, ...parts));
  if (target !== base && !target.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  return target;
}

export async function listVideos(root, relative) {
  const parts = cleanRelative(relative);
  if (!parts) throw Object.assign(new Error("Invalid folder."), { status: 400 });
  const dir = await inside(root.path, parts).catch(() => null);
  if (!dir) throw Object.assign(new Error("Folder not found."), { status: 404 });
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) throw Object.assign(new Error("Folder not found."), { status: 404 });
  const dirs = [], files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { dirs.push(entry.name); continue; }
    const ext = extname(entry.name).toLowerCase();
    if (!entry.isFile() || !VIDEO_TYPES[ext]) continue;
    const info = await stat(join(dir, entry.name)).catch(() => null);
    if (info) files.push({ name: entry.name, size: info.size, mtime: info.mtimeMs, playable: PLAYABLE.has(ext) });
  }
  dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  files.sort((a, b) => b.mtime - a.mtime);
  return { root: root.id, path: parts.join("/"), dirs: dirs.slice(0, MAX_ENTRIES), files: files.slice(0, MAX_ENTRIES), truncated: dirs.length + files.length > MAX_ENTRIES };
}

/** Stream one video file with HTTP Range support so seeking works. */
export async function streamVideo(root, relative, req, res) {
  const parts = cleanRelative(relative);
  const ext = parts?.length ? extname(parts.at(-1)).toLowerCase() : "";
  if (!parts || !parts.length || !VIDEO_TYPES[ext]) { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"Invalid video."}'); return; }
  const file = await inside(root.path, parts).catch(() => null);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info?.isFile()) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"Video not found."}'); return; }
  const headers = {
    "content-type": VIDEO_TYPES[ext], "accept-ranges": "bytes", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": `inline; filename="${basename(file).replace(/[^\w.\- ]/g, "_")}"`,
  };
  const size = info.size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    if (!range || (range[1] === "" && range[2] === "")) { res.writeHead(416, { ...headers, "content-range": `bytes */${size}` }); res.end(); return; }
    if (range[1] === "") { start = Math.max(0, size - Number(range[2])); }
    else { start = Number(range[1]); if (range[2] !== "") end = Math.min(end, Number(range[2])); }
    if (!(start <= end) || start >= size) { res.writeHead(416, { ...headers, "content-range": `bytes */${size}` }); res.end(); return; }
    status = 206; headers["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["content-length"] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD") { res.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

export const isVideoRootId = (id) => typeof id === "string" && /^[a-z0-9:_-]{1,40}$/.test(id);
