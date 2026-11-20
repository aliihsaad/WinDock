import { win32 } from "node:path";
import { copyFile, readdir, stat } from "node:fs/promises";

/** Blender puts the open file in its window title: `Blender* [D:\work\scene.blend]`. */
export function findBlendPath(windows) {
  for (const window of Array.isArray(windows) ? windows : []) {
    if (!/blender/i.test(String(window?.name || window?.id || ""))) continue;
    const match = /\[([A-Za-z]:\\[^\]\r\n]{1,380}\.blend)\]/i.exec(String(window?.title || ""));
    if (!match) continue;
    const path = win32.normalize(match[1]);
    if (!/^[A-Za-z]:\\/.test(path) || path.split("\\").includes("..") || /[\x00-\x1f<>|?*"]/.test(path)) continue;
    return path;
  }
  return null;
}

/** scene.blend -> scene_v001.blend, then v002 and so on; an existing _vNNN suffix is replaced, not stacked. */
export function nextVersionName(fileName, existing) {
  const base = fileName.replace(/\.blend$/i, "").replace(/_v\d{1,4}$/i, "");
  const used = (existing || []).map((n) => new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "_v(\\d{1,4})\\.blend$", "i").exec(n)?.[1]).filter(Boolean).map(Number);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${base}_v${String(next).padStart(3, "0")}.blend`;
}

/** Copy the saved .blend next to itself under the next version name. Returns the new file's name. */
export async function versionedSave(windows, { fs = { copyFile, readdir, stat } } = {}) {
  const path = findBlendPath(windows);
  if (!path) throw Object.assign(new Error("Open and save a .blend file in Blender first."), { status: 404 });
  const info = await fs.stat(path).catch(() => null);
  if (!info?.isFile()) throw Object.assign(new Error("Blender has not saved this file yet. Press Save first."), { status: 409 });
  const dir = win32.dirname(path);
  const name = nextVersionName(win32.basename(path), await fs.readdir(dir).catch(() => []));
  await fs.copyFile(path, win32.join(dir, name), 1 /* COPYFILE_EXCL: never overwrite */);
  return { name };
}
