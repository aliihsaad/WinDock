import { readFileSync } from "node:fs";

export const DOWNLOADS_PAGE_URL = "https://windock.vercel.app/#download";
export const RELEASES_URL = "https://github.com/aliihsaad/WinDock/releases";
export const MANIFEST_URL = "https://windock.vercel.app/downloads.json";
export const INSTALLED_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).releaseVersion;
const LIMIT = 64 * 1024;

export function parseVersion(value) {
  if (typeof value !== "string" || value.length > 100) throw new Error("Invalid version");
  const m = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!m || m[0] !== value) throw new Error("Invalid version");
  const preview = m[4]?.split(".") || [];
  if (preview.some(p => /^0[0-9]+$/.test(p))) throw new Error("Invalid preview");
  return { core: m.slice(1, 4).map(BigInt), preview };
}
export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  const compare = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  for (let i = 0; i < 3; i++) { const n = compare(a.core[i], b.core[i]); if (n) return n; }
  if (!a.preview.length || !b.preview.length) return compare(!a.preview.length, !b.preview.length);
  for (let i = 0; i < Math.min(a.preview.length, b.preview.length); i++) {
    const x = a.preview[i], y = b.preview[i], nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    const n = nx && ny ? compare(BigInt(x), BigInt(y)) : nx !== ny ? (nx ? -1 : 1) : compare(x, y);
    if (n) return n;
  }
  return compare(a.preview.length, b.preview.length);
}
export function parseUpdateManifest(manifest, installedVersion, platform) {
  const version = manifest?.version;
  parseVersion(version);
  if (manifest.available !== true) throw new Error("Release unavailable");
  const base = RELEASES_URL + "/download/v" + version + "/";
  if (platform === "windows") {
    if (manifest.windows?.url !== base + "WinDockSetup.exe") throw new Error("Unexpected installer");
  } else if (platform === "linux") {
    if (manifest.linux?.arch?.url !== base + "WinDock-linux-x64.pkg.tar.zst" ||
        manifest.linux?.debian?.url !== base + "WinDock-linux-amd64.deb") throw new Error("Unexpected package");
  } else throw new Error("Unsupported platform");
  return { status: compareVersions(version, installedVersion) > 0 ? "available" : "current",
    installedVersion, latestVersion: version, releasePage: DOWNLOADS_PAGE_URL };
}

// One bounded request per host, shared by concurrent clients. Only a manual check
// contacts the public release feed. Never send a PIN, session, or PC address.
export function createUpdateService({ installedVersion = INSTALLED_VERSION, platform = "windows",
  fetchImpl = fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  parseVersion(installedVersion);
  let result = { status: "unchecked", installedVersion }, pending, checkedAt = -Infinity;
  return {
    state: () => ({ ...result }),
    check() {
      if (pending) return pending;
      if (result.status !== "failed" && now() - checkedAt < 30000) return Promise.resolve({ ...result });
      pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await Promise.resolve().then(() => fetchImpl(MANIFEST_URL, { redirect: "error", signal: controller.signal,
            headers: { "cache-control": "no-cache", "user-agent": "WinDock/" + installedVersion } }));
          if (!response.ok || !response.body) throw new Error("Feed unavailable");
          const reader = response.body.getReader();
          const chunks = []; let size = 0;
          try {
            while (true) {
              const { value, done } = await reader.read(); if (done) break;
              size += value.length; if (size > LIMIT) throw new Error("Feed too large");
              chunks.push(value);
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          result = { ...parseUpdateManifest(JSON.parse(Buffer.concat(chunks).toString("utf8")), installedVersion, platform), checkedAt: new Date(now()).toISOString() };
        } catch { result = { status: "failed", installedVersion }; }
        finally { clearTimeout(timer); checkedAt = now(); pending = null; }
        return { ...result };
      })();
      return pending;
    },
  };
}
