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
app="$root/usr/lib/tara"
mkdir -p "$app" "$root/usr/bin" "$root/usr/share/applications" \
    "$root/usr/share/icons/hicolor/512x512/apps" "$root/usr/lib/udev/rules.d" \
    "$root/usr/lib/modules-load.d" "$root/usr/lib/systemd/user" "$root/usr/share/licenses/tara" artifacts/linux
cp server.js package.json package-lock.json "$app/"
cp -R src public "$app/"
# A checkout on a Windows drive marks every file executable; ship data as 0644.
find "$app" -type d -exec chmod 755 {} +
find "$app" -type f -exec chmod 644 {} +
npm ci --prefix "$app" --omit=dev --ignore-scripts --no-audit --no-fund
install -m 755 "$(command -v node)" "$app/node"
install -m 755 native/linux/target/release/tara-input "$app/tara-input"
install -m 755 native/linux/packaging/user-service "$app/user-service"
install -m 755 native/linux/packaging/tara "$root/usr/bin/tara"
install -m 644 native/linux/packaging/tara.desktop "$root/usr/share/applications/"
install -m 644 native/linux/packaging/tara.service "$root/usr/lib/systemd/user/"
install -m 644 public/icon-512.png "$root/usr/share/icons/hicolor/512x512/apps/tara.png"
install -m 644 native/linux/70-tara-uinput.rules "$root/usr/lib/udev/rules.d/"
printf 'uinput\n' > "$root/usr/lib/modules-load.d/tara.conf"
install -m 644 LICENSE "$root/usr/share/licenses/tara/LICENSE"
install -m 644 "${NODE_LICENSE:?Set NODE_LICENSE to the bundled Node distribution license}" "$root/usr/share/licenses/tara/Node-LICENSE"
node scripts/linux-license-notices.mjs "$root/usr/share/licenses/tara/rust"
# npm package licenses are retained alongside their installed modules.
# A CRLF checkout would ship Windows line endings in scripts, rules and sources.
if grep -rlI --exclude-dir=node_modules --exclude-dir=licenses $'\r' "$root"; then
    echo "Packaged text files above contain CR line endings; check out with LF (see .gitattributes)" >&2
    exit 1
fi
du_kib=$(du -sk "$root" | cut -f1)
mkdir "$root/DEBIAN"
cat > "$root/DEBIAN/control" <<EOF
Package: tara
Version: $version-$release
Section: net
Priority: optional
Architecture: amd64
Maintainer: Ali Saad <aliihsaad@users.noreply.github.com>
Homepage: https://github.com/yeshwanthkumardomala/Tara
Installed-Size: $du_kib
Depends: libc6 (>= 2.36), libstdc++6, libgcc-s1, libgtk-3-bin, grim, wl-clipboard, wtype, pulseaudio-utils, systemd, udev, kmod, x-terminal-emulator
Recommends: brightnessctl, ddcutil, wf-recorder, libnotify-bin
Description: Phone companion for a Hyprland desktop (preview)
 Includes the Node.js runtime and native input helper; no compilation needed.
 A running Hyprland session is required. Open Tara from the application
 menu; it keeps running in the background as a systemd user service after
 its window closes. GNOME and KDE are not supported.
EOF
install -m 755 native/linux/packaging/postinst "$root/DEBIAN/postinst"
install -m 755 native/linux/packaging/prerm "$root/DEBIAN/prerm"
install -m 755 native/linux/packaging/postrm "$root/DEBIAN/postrm"
dpkg-deb --root-owner-group --build "$root" artifacts/linux/Tara-linux-amd64.deb
# Arch uses the same payload, with native dependency names and install hooks.
rm -r -- "$root/DEBIAN"
cat > "$root/.PKGINFO" <<EOF
pkgname = tara
pkgbase = tara
pkgver = $version-$release
pkgdesc = Phone companion for a Hyprland desktop (preview, bundled runtime)
url = https://github.com/yeshwanthkumardomala/Tara
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
optdepend = libnotify: notification when Tara starts in the background
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
tar --sort=name --owner=0 --group=0 --numeric-owner --zstd -cf artifacts/linux/Tara-linux-x64.pkg.tar.zst -C "$root" .PKGINFO .MTREE .INSTALL usr
node -p "JSON.stringify({version: '$version-$release', node: process.version, arch: process.arch, platform: process.platform}, null, 2)" > artifacts/linux/build-info.json
(cd artifacts/linux && sha256sum Tara-linux-amd64.deb Tara-linux-x64.pkg.tar.zst > SHA256SUMS-linux.txt)
echo "Linux packages ready in artifacts/linux"
