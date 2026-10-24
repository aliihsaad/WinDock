/**
 * Add the Linux installers to the website download manifest.
 *
 * package-downloads.ps1 writes downloads.json for Windows and Android; the
 * release workflow then runs this with the Linux packages from build-linux.yml.
 * Every package must match SHA256SUMS-linux.txt, so the website never shows a
 * checksum that the release does not carry.
 *
 *   node scripts/linux-downloads.mjs <download base> [--require]
 *
 * The base is ./downloads for a local preview, or the release-asset URL.
 * Without --require, a build without Linux packages leaves the manifest alone.
 */

import { createHash } from "node:crypto";
import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LINUX_PACKAGES = Object.freeze({
  arch: "WinDock-linux-x64.pkg.tar.zst",
  debian: "WinDock-linux-amd64.deb",
});
export const LINUX_SUMS = "SHA256SUMS-linux.txt";

/** `sha256sum` output: one "<hash>  <name>" line per file. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64}) [ *](\S+)$/i);
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function checkedBase(base) {
  if (base === "./downloads" || /^https:\/\/\S+$/.test(String(base))) return String(base).replace(/\/+$/, "");
  throw new Error("Download base must be ./downloads or an HTTPS release-asset base URL");
}

/** Manifest entries for the Linux packages in `linuxDir`, verified against their sums file. */
export async function linuxDownloads({ linuxDir, base }) {
  const root = checkedBase(base);
  const sums = parseSums(await readFile(join(linuxDir, LINUX_SUMS), "utf8"));
  const entries = {};
  for (const [kind, name] of Object.entries(LINUX_PACKAGES)) {
    const path = join(linuxDir, name);
    const { size } = await stat(path);
    const hash = await sha256(path);
    if (sums.get(name) !== hash) throw new Error(`${name} does not match ${LINUX_SUMS}`);
    entries[kind] = { url: `${root}/${name}`, bytes: size, sha256: hash };
  }
  entries.checksums = `${root}/${LINUX_SUMS}`;
  return entries;
}

/** Add `linux` to the manifest; returns false when packages are absent and not required. */
export async function addLinuxDownloads({ manifestPath, linuxDir, base, require = false }) {
  try {
    await stat(join(linuxDir, LINUX_SUMS));
  } catch {
    if (require) throw new Error(`Linux packages not found in ${linuxDir}`);
    return false;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.linux = await linuxDownloads({ linuxDir, base });
  if (base === "./downloads") {
    // The local preview server serves files from beside the manifest. Copy them
    // first, so a failed copy never leaves links to files that are not there.
    for (const name of [...Object.values(LINUX_PACKAGES), LINUX_SUMS]) {
      await copyFile(join(linuxDir, name), join(manifestPath, "..", name));
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.find((arg) => !arg.startsWith("--"));
  const root = resolve(import.meta.dirname, "..");
  const added = await addLinuxDownloads({
    manifestPath: join(root, "artifacts", "website-downloads", "downloads.json"),
    linuxDir: join(root, "artifacts", "linux"),
    base: base ?? "./downloads",
    require: args.includes("--require"),
  });
  console.log(added ? "Linux installers added to downloads.json" : "No Linux packages found; downloads.json unchanged");
}
