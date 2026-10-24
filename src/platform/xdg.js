/** XDG base and user directories, shared by the Linux provider modules. */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** XDG data dirs, user first: a user entry overrides a system one with the same id. */
export function dataDirs(env = process.env, home = homedir()) {
  const user = env.XDG_DATA_HOME || join(home, ".local/share");
  const system = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
  return [...new Set([user, ...system])].filter((dir) => dir.startsWith("/"));
}

const USER_DIR_DEFAULTS = Object.freeze({ PICTURES: "Pictures", VIDEOS: "Videos" });

/**
 * A localized user directory such as Pictures, read from user-dirs.dirs the
 * way xdg-user-dir does. A disabled entry ("$HOME/") falls back to the
 * English default rather than writing captures into the home directory.
 */
export async function userDir(kind, { env = process.env, home = homedir() } = {}) {
  const fallback = join(home, USER_DIR_DEFAULTS[kind] || kind);
  try {
    const config = env.XDG_CONFIG_HOME || join(home, ".config");
    const body = await readFile(join(config, "user-dirs.dirs"), "utf8");
    const value = body.match(new RegExp(`^XDG_${kind}_DIR="(.*)"\\s*$`, "m"))?.[1];
    const path = value?.replace(/^\$HOME(?=\/|$)/, home).replace(/\/+$/, "");
    if (path && isAbsolute(path) && path !== home) return path;
  } catch {
    /* no user-dirs.dirs: use the default */
  }
  return fallback;
}
