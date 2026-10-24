/**
 * Freedesktop icon lookup for app tiles.
 *
 * Follows the Icon Theme spec as far as app icons need: the user's theme, its
 * Inherits chain, hicolor, then pixmaps. Only Applications-context directories
 * are indexed, once per theme, so a tile request is a map lookup. A result is
 * PNG or SVG bytes; anything else (XPM, oversized files) falls back to the
 * generic tile icon.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { dataDirs as defaultDataDirs } from "./xdg.js";

export const ICON_MAX_BYTES = 512 * 1024;
/** Tiles are 48-96 CSS px on 2-3x phone screens. */
const WANT_PX = 128;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/;

/** Parse an index.theme into its inheritance and directory metadata. */
export function parseIndexTheme(body) {
  const sections = new Map();
  let current = null;
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = trimmed.match(/^\[(.+)\]$/);
    if (header) {
      current = new Map();
      sections.set(header[1], current);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (current && eq > 0) current.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  const theme = sections.get("Icon Theme") || new Map();
  const list = (key) => (theme.get(key) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const dirs = [...new Set([...list("Directories"), ...list("ScaledDirectories")])].map((path) => {
    const section = sections.get(path) || new Map();
    const size = Number(section.get("Size")) || 0;
    const scale = Number(section.get("Scale")) || 1;
    return {
      path,
      px: size * scale,
      scalable: section.get("Type") === "Scalable",
      context: section.get("Context") || "",
    };
  });
  return { inherits: list("Inherits"), dirs };
}

/**
 * Best file for a tile: the smallest PNG at least WANT_PX, else a scalable
 * SVG, else the largest PNG available.
 */
export function pickIcon(candidates) {
  const pngs = candidates.filter((c) => c.path.endsWith(".png")).sort((a, b) => a.px - b.px);
  return pngs.find((c) => c.px >= WANT_PX)
    || candidates.find((c) => c.path.endsWith(".svg"))
    || pngs.at(-1)
    || null;
}

/** PNG or SVG bytes, or null. SVG is recognised by its root element, not the file name. */
export function iconBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return null;
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return bytes;
  return /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString("utf8")) ? bytes : null;
}

export function createIconLookup({
  exec,
  theme,
  home = homedir(),
  dataDirs = defaultDataDirs(),
} = {}) {
  const roots = [join(home, ".icons"), ...dataDirs.map((dir) => join(dir, "icons"))];
  const pixmaps = [...dataDirs.map((dir) => join(dir, "pixmaps")), "/usr/share/pixmaps"];
  const indexes = new Map();
  let chain = null;

  async function userTheme() {
    if (theme) return theme;
    try {
      const { stdout } = await exec("gsettings", ["get", "org.gnome.desktop.interface", "icon-theme"]);
      const name = String(stdout).trim().replace(/^'(.*)'$/, "$1");
      if (NAME.test(name)) return name;
    } catch {
      /* no gsettings: try the GTK settings file */
    }
    try {
      const ini = await readFile(join(home, ".config/gtk-3.0/settings.ini"), "utf8");
      const name = ini.match(/^\s*gtk-icon-theme-name\s*=\s*(.+?)\s*$/m)?.[1];
      if (NAME.test(name || "")) return name;
    } catch {
      /* no GTK settings */
    }
    return "hicolor";
  }

  /** The first root holding a theme's index.theme defines it; any root may hold its files. */
  async function loadTheme(name) {
    for (const root of roots) {
      try {
        return parseIndexTheme(await readFile(join(root, name, "index.theme"), "utf8"));
      } catch {
        /* not in this root */
      }
    }
    return null;
  }

  async function themeChain() {
    if (chain) return chain;
    const order = [];
    const queue = [await userTheme()];
    while (queue.length && order.length < 16) {
      const name = queue.shift();
      if (!NAME.test(name) || order.some((entry) => entry.name === name)) continue;
      const parsed = await loadTheme(name);
      if (!parsed) continue;
      order.push({ name, dirs: parsed.dirs });
      queue.push(...parsed.inherits);
    }
    if (!order.some((entry) => entry.name === "hicolor")) {
      const hicolor = await loadTheme("hicolor");
      if (hicolor) order.push({ name: "hicolor", dirs: hicolor.dirs });
    }
    chain = order;
    return chain;
  }

  async function themeIndex(entry) {
    if (indexes.has(entry.name)) return indexes.get(entry.name);
    const index = new Map();
    for (const dir of entry.dirs) {
      if (dir.context && dir.context !== "Applications") continue;
      for (const root of roots) {
        let files;
        try {
          files = await readdir(join(root, entry.name, dir.path));
        } catch {
          continue;
        }
        for (const file of files) {
          const match = file.match(/^(.+)\.(png|svg)$/);
          if (!match) continue;
          const list = index.get(match[1]) || [];
          list.push({ path: join(root, entry.name, dir.path, file), px: dir.scalable ? Infinity : dir.px });
          index.set(match[1], list);
        }
      }
    }
    indexes.set(entry.name, index);
    return index;
  }

  async function readIcon(path) {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > ICON_MAX_BYTES) return null;
      return iconBytes(await readFile(path));
    } catch {
      return null;
    }
  }

  return async function lookup(icon) {
    const value = typeof icon === "string" ? icon.trim() : "";
    if (!value) return null;
    if (isAbsolute(value)) return /\.(png|svg)$/i.test(value) ? readIcon(value) : null;
    // Icon= should be a bare name, but "app.png" is common in the wild.
    const name = value.replace(/\.(png|svg|xpm)$/i, "");
    if (!NAME.test(name)) return null;
    for (const entry of await themeChain()) {
      const candidates = (await themeIndex(entry)).get(name);
      const best = candidates && pickIcon(candidates);
      const bytes = best && (await readIcon(best.path));
      if (bytes) return bytes;
    }
    for (const dir of pixmaps) {
      for (const ext of ["png", "svg"]) {
        const bytes = await readIcon(join(dir, `${name}.${ext}`));
        if (bytes) return bytes;
      }
    }
    return null;
  };
}
