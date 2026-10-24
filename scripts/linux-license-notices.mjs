import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const destination = process.argv[2];
if (!destination) throw new Error("License output directory required");
const metadata = JSON.parse(execFileSync("cargo", [
  "metadata", "--locked", "--offline", "--format-version", "1",
  "--filter-platform", "x86_64-unknown-linux-gnu", "--manifest-path", "native/linux/Cargo.toml",
], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
mkdirSync(destination, { recursive: true });
const notices = [];
for (const pkg of metadata.packages.filter((pkg) => pkg.source)) {
  const dir = dirname(pkg.manifest_path);
  const files = readdirSync(dir).filter((name) => /^(LICENSE|COPYING|NOTICE)([._-]|$)/i.test(name));
  if (pkg.license_file && existsSync(join(dir, pkg.license_file))) files.push(pkg.license_file);
  const out = join(destination, `${pkg.name}-${pkg.version}`);
  mkdirSync(out, { recursive: true });
  for (const name of new Set(files)) copyFileSync(join(dir, name), join(out, basename(name)));
  notices.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license || pkg.license_file}\n${pkg.repository || `https://crates.io/crates/${pkg.name}`}\n`);
}
writeFileSync(join(destination, "THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
