#!/bin/bash
# Called inside the Linux builder. Users install its output; they need no SDK.
set -euo pipefail
umask 022
cd "$(dirname "$0")/.."
version=${1:-$(node -p "require('./package.json').version")}
release=${2:-1}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid package version" >&2; exit 1; }
[[ "$release" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid package release" >&2; exit 1; }
[[ "$(uname -m)" = x86_64 ]] || { echo "Build on Linux x86-64" >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
root="$stage/root"
app="$root/usr/lib/windock"
mkdir -p "$app" "$root/usr/bin" "$root/usr/share/applications" \
    "$root/usr/share/icons/hicolor/512x512/apps" "$root/usr/lib/udev/rules.d" \
    "$root/usr/lib/modules-load.d" "$root/usr/share/licenses/windock" artifacts/linux
cp server.js package.json package-lock.json "$app/"
cp -R src public "$app/"
# A checkout on a Windows drive marks every file executable; ship data as 0644.
find "$app" -type d -exec chmod 755 {} +
find "$app" -type f -exec chmod 644 {} +
npm ci --prefix "$app" --omit=dev --ignore-scripts --no-audit --no-fund
install -m 755 "$(command -v node)" "$app/node"
install -m 755 native/linux/target/release/windock-input "$app/windock-input"
install -m 755 native/linux/packaging/windock "$root/usr/bin/windock"
install -m 644 native/linux/packaging/windock.desktop "$root/usr/share/applications/"
install -m 644 public/icon-512.png "$root/usr/share/icons/hicolor/512x512/apps/windock.png"
install -m 644 native/linux/70-windock-uinput.rules "$root/usr/lib/udev/rules.d/"
printf 'uinput\n' > "$root/usr/lib/modules-load.d/windock.conf"
install -m 644 LICENSE "$root/usr/share/licenses/windock/LICENSE"
install -m 644 "${NODE_LICENSE:?Set NODE_LICENSE to the bundled Node distribution license}" "$root/usr/share/licenses/windock/Node-LICENSE"
node scripts/linux-license-notices.mjs "$root/usr/share/licenses/windock/rust"
# npm package licenses are retained alongside their installed modules.
# A CRLF checkout would ship Windows line endings in scripts, rules and sources.
if grep -rlI --exclude-dir=node_modules --exclude-dir=licenses $'\r' "$root"; then
    echo "Packaged text files above contain CR line endings; check out with LF (see .gitattributes)" >&2
    exit 1
fi
du_kib=$(du -sk "$root" | cut -f1)
mkdir "$root/DEBIAN"
cat > "$root/DEBIAN/control" <<EOF
Package: windock
Version: $version-$release
Section: net
Priority: optional
Architecture: amd64
Maintainer: Ali Saad <aliihsaad@users.noreply.github.com>
Homepage: https://windock.vercel.app
Installed-Size: $du_kib
Depends: libc6 (>= 2.36), libstdc++6, libgcc-s1, libgtk-3-bin, grim, wl-clipboard, wtype, pulseaudio-utils, systemd, udev, kmod, x-terminal-emulator
Recommends: brightnessctl, ddcutil, wf-recorder
Description: Phone companion for a Hyprland desktop (preview)
 Includes the Node.js runtime and native input helper; no compilation needed.
 A running Hyprland session is required. Open WinDock from the application
 menu and keep its connection window open. GNOME and KDE are not supported.
EOF
install -m 755 native/linux/packaging/postinst "$root/DEBIAN/postinst"
install -m 755 native/linux/packaging/postrm "$root/DEBIAN/postrm"
dpkg-deb --root-owner-group --build "$root" artifacts/linux/WinDock-linux-amd64.deb
# Arch uses the same payload, with native dependency names and install hooks.
rm -r -- "$root/DEBIAN"
cat > "$root/.PKGINFO" <<EOF
pkgname = windock
pkgbase = windock
pkgver = $version-$release
pkgdesc = Phone companion for a Hyprland desktop (preview, bundled runtime)
url = https://windock.vercel.app
builddate = $(date +%s)
packager = Ali Saad <aliihsaad@users.noreply.github.com>
size = $(du -sb "$root" | cut -f1)
arch = x86_64
license = MIT
depend = glibc>=2.36
depend = gcc-libs
depend = gtk3
depend = grim
depend = wl-clipboard
depend = wtype
depend = libpulse
depend = systemd
depend = kmod
optdepend = brightnessctl: laptop panel brightness
optdepend = ddcutil: external monitor brightness
optdepend = wf-recorder: screen recording
optdepend = hyprland: supported desktop session
optdepend = xterm: fallback terminal for the connection window
EOF
install -m 644 native/linux/packaging/arch.install "$root/.INSTALL"
# pacman checks installed files against .MTREE (pacman -Qkk); makepkg writes it
# the same way. Ownership is recorded as root to match the archive. It is written
# outside the payload, then moved in, so it never lists itself.
(
    cd "$root"
    export LC_COLLATE=C
    shopt -s dotglob globstar
    printf '%s\0' ** \
        | LANG=C bsdtar -cnf - --format=mtree --uid 0 --gid 0 \
            --options='!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link' \
            --null --files-from - \
        | gzip -c -f -n > "$stage/mtree.gz"
)
mv "$stage/mtree.gz" "$root/.MTREE"
tar --sort=name --owner=0 --group=0 --numeric-owner --zstd -cf artifacts/linux/WinDock-linux-x64.pkg.tar.zst -C "$root" .PKGINFO .MTREE .INSTALL usr
node -p "JSON.stringify({version: '$version-$release', node: process.version, arch: process.arch, platform: process.platform}, null, 2)" > artifacts/linux/build-info.json
(cd artifacts/linux && sha256sum WinDock-linux-amd64.deb WinDock-linux-x64.pkg.tar.zst > SHA256SUMS-linux.txt)
echo "Linux packages ready in artifacts/linux"
