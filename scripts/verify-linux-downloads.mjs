/** Linux installers in the website download manifest: verified sums, URLs and opt-in. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { addLinuxDownloads, LINUX_PACKAGES, LINUX_SUMS, linuxDownloads, parseSums } from "./linux-downloads.mjs";

const t = createChecker("linux-downloads");
const tmp = await mkdtemp(join(tmpdir(), "windock-linux-downloads-"));
const linuxDir = join(tmp, "linux"), siteDir = join(tmp, "website-downloads");
await mkdir(linuxDir);
await mkdir(siteDir);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const arch = "arch package bytes", debian = "debian package bytes!";
await writeFile(join(linuxDir, LINUX_PACKAGES.arch), arch);
await writeFile(join(linuxDir, LINUX_PACKAGES.debian), debian);
const sums = `${hash(debian)}  ${LINUX_PACKAGES.debian}\n${hash(arch)}  ${LINUX_PACKAGES.arch}\n`;
await writeFile(join(linuxDir, LINUX_SUMS), sums);
const manifestPath = join(siteDir, "downloads.json");
const original = { version: "0.2.3-preview.1", available: true, windows: { url: "w" }, android: { url: "a" }, checksums: "c" };
await writeFile(manifestPath, JSON.stringify(original));

t.equal(parseSums(sums).get(LINUX_PACKAGES.arch), hash(arch), "sha256sum output is parsed");
t.equal(parseSums("not a sums file").size, 0, "anything else yields no sums");

const base = "https://github.com/aliihsaad/WinDock/releases/download/v0.2.3-preview.1";
t.ok(await addLinuxDownloads({ manifestPath, linuxDir, base, require: true }), "packages are added");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
t.deepEqual(manifest.linux, {
  arch: { url: `${base}/${LINUX_PACKAGES.arch}`, bytes: arch.length, sha256: hash(arch) },
  debian: { url: `${base}/${LINUX_PACKAGES.debian}`, bytes: debian.length, sha256: hash(debian) },
  checksums: `${base}/${LINUX_SUMS}`,
}, "each package gets its release URL, size and verified SHA-256");
t.deepEqual({ ...manifest, linux: undefined }, { ...original, linux: undefined }, "Windows and Android entries are untouched");

await writeFile(join(linuxDir, LINUX_SUMS), `${hash("other")}  ${LINUX_PACKAGES.arch}\n${hash(debian)}  ${LINUX_PACKAGES.debian}\n`);
await t.rejects(() => linuxDownloads({ linuxDir, base }), "a package that does not match its sums file is refused");
await writeFile(join(linuxDir, LINUX_SUMS), `${hash(arch)}  ${LINUX_PACKAGES.arch}\n`);
await t.rejects(() => linuxDownloads({ linuxDir, base }), "a package missing from the sums file is refused");
await writeFile(join(linuxDir, LINUX_SUMS), sums);
for (const bad of ["http://example.test/x", "file:///etc", "", "https://bad url"]) {
  await t.rejects(() => linuxDownloads({ linuxDir, base: bad }), `base ${JSON.stringify(bad)} is refused`);
}

await writeFile(manifestPath, JSON.stringify(original));
t.ok(await addLinuxDownloads({ manifestPath, linuxDir, base: "./downloads" }), "a local preview can use ./downloads");
t.equal(JSON.parse(await readFile(manifestPath, "utf8")).linux.arch.url, `./downloads/${LINUX_PACKAGES.arch}`, "local URLs point at the preview server");
t.deepEqual((await readdir(siteDir)).sort(), ["downloads.json", ...Object.values(LINUX_PACKAGES), LINUX_SUMS].sort(),
  "local previews copy the packages beside the manifest");
const blockedSite = join(tmp, "blocked-site"), blockedManifest = join(blockedSite, "downloads.json");
await mkdir(join(blockedSite, LINUX_PACKAGES.debian), { recursive: true }); // a directory where a package must go
await writeFile(blockedManifest, JSON.stringify(original));
await t.rejects(() => addLinuxDownloads({ manifestPath: blockedManifest, linuxDir, base: "./downloads" }), "a failed preview copy is reported");
t.equal(JSON.parse(await readFile(blockedManifest, "utf8")).linux, undefined, "a failed copy leaves no links to missing files");

const empty = join(tmp, "no-linux");
await mkdir(empty);
await writeFile(manifestPath, JSON.stringify(original));
t.equal(await addLinuxDownloads({ manifestPath, linuxDir: empty, base }), false, "a build without Linux packages is left alone");
t.equal(JSON.parse(await readFile(manifestPath, "utf8")).linux, undefined, "no Linux entry is invented");
await t.rejects(() => addLinuxDownloads({ manifestPath, linuxDir: empty, base, require: true }), "the release workflow requires the packages");

await rm(tmp, { recursive: true, force: true });
t.done("linux-downloads verification passed");
