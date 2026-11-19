import { readFileSync } from "node:fs";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Updates come from this fork's rolling `upgrades-latest` release, which CI refreshes on every build.
export const RELEASES_URL = "https://github.com/yeshwanthkumardomala/tara/releases";
export const FEED_BASE = RELEASES_URL + "/download/upgrades-latest/";
export const DOWNLOADS_PAGE_URL = RELEASES_URL + "/tag/upgrades-latest";
export const MANIFEST_URL = FEED_BASE + "latest.json";
export const INSTALLED_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).releaseVersion;
const LIMIT = 64 * 1024;
const MAX_INSTALLER_BYTES = 300 * 1024 * 1024;
// GitHub serves release assets from its own storage hosts after a redirect.
const ASSET_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
export function allowedAssetUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.port && ASSET_HOSTS.has(u.hostname); }
  catch { return false; }
}
/** GET following at most four redirects, each of which must stay on GitHub's own hosts. */
export async function fetchAsset(url, { fetchImpl = fetch, signal, headers = {} } = {}) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!allowedAssetUrl(current)) throw new Error("Unexpected download location");
    const response = await Promise.resolve().then(() => fetchImpl(current, { redirect: "manual", signal, headers }));
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("Bad redirect");
      current = new URL(next, current).toString();
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

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
/** Validates the published feed. Only the fork's own release assets are ever accepted. */
export function parseUpdateManifest(manifest, installedVersion, platform) {
  const version = manifest?.version;
  parseVersion(version);
  if (manifest.available !== true) throw new Error("Release unavailable");
  if (platform !== "windows") throw new Error("Unsupported platform");
  if (manifest.windows?.url !== FEED_BASE + "TaraSetup.exe") throw new Error("Unexpected installer");
  const sha256 = String(manifest.windows?.sha256 || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Installer checksum missing");
  const status = compareVersions(version, installedVersion) > 0 ? "available" : "current";
  return { status, installedVersion, latestVersion: version, releasePage: DOWNLOADS_PAGE_URL, canInstall: status === "available", sha256, url: manifest.windows.url };
}

const fail = (message, status = 502) => Object.assign(new Error(message), { status, exposed: true });
const publicState = ({ sha256, url, ...rest }) => rest;
async function readLimited(response, limit) {
  if (!response.ok || !response.body) throw new Error("Feed unavailable");
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error("Feed too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

// One bounded request per host, shared by concurrent clients. Only a manual check
// contacts the release feed. Never send a PIN, session, or PC address.
export function createUpdateService({ installedVersion = INSTALLED_VERSION, platform = "windows",
  fetchImpl = fetch, now = Date.now, timeoutMs = 12000, downloadTimeoutMs = 10 * 60 * 1000,
  tempDir = join(tmpdir(), "tara-update"), spawnImpl = spawn, log = () => {} } = {}) {
  parseVersion(installedVersion);
  let result = { status: "unchecked", installedVersion }, pending, checkedAt = -Infinity, installing = false;
  const service = {
    state: () => publicState(result),
    check() {
      if (pending) return pending;
      if (result.status !== "failed" && now() - checkedAt < 30000) return Promise.resolve(publicState(result));
      pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchAsset(MANIFEST_URL, { fetchImpl, signal: controller.signal,
            headers: { "cache-control": "no-cache", "user-agent": "Tara/" + installedVersion } });
          const body = await readLimited(response, LIMIT);
          result = { ...parseUpdateManifest(JSON.parse(body.toString("utf8")), installedVersion, platform), checkedAt: new Date(now()).toISOString() };
        } catch { result = { status: "failed", installedVersion }; }
        finally { clearTimeout(timer); checkedAt = now(); pending = null; }
        return publicState(result);
      })();
      return pending;
    },
    /**
     * Download the published installer, verify its SHA-256 against the feed, then run it
     * silently. Setup closes this app, upgrades in place and starts it again.
     */
    async install() {
      if (platform !== "windows") throw fail("Updating from the phone is only available for the Windows app.", 501);
      if (result.status !== "available" || !result.sha256) throw fail("Check for updates first.", 409);
      if (installing) throw fail("An update is already being installed.", 409);
      installing = true;
      const { sha256, url, latestVersion } = result;
      const file = join(tempDir, "TaraSetup-" + latestVersion + ".exe");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), downloadTimeoutMs);
      try {
        await mkdir(tempDir, { recursive: true });
        const response = await fetchAsset(url, { fetchImpl, signal: controller.signal, headers: { "user-agent": "Tara/" + installedVersion } });
        if (!response.ok || !response.body) throw fail("The update could not be downloaded.");
        const hash = createHash("sha256"); let size = 0;
        const out = createWriteStream(file, { flags: "w", mode: 0o600 });
        try {
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_INSTALLER_BYTES) throw fail("The installer is larger than expected, so it was not run.");
            hash.update(chunk);
            if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
          }
        } finally { await new Promise((r) => out.end(r)); }
        if (hash.digest("hex") !== sha256) throw fail("The downloaded installer did not match its checksum, so it was not run.");
        const child = spawnImpl(file, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/FORCECLOSEAPPLICATIONS"],
          { detached: true, stdio: "ignore", windowsHide: true });
        child.unref?.();
        log("update installer started for " + latestVersion);
        return { status: "installing", latestVersion };
      } catch (error) {
        await rm(file, { force: true }).catch(() => {});
        installing = false;
        throw error.exposed ? error : fail("The update could not be downloaded. Check the PC\u2019s internet connection and try again.");
      } finally { clearTimeout(timer); }
    },
  };
  return service;
}
