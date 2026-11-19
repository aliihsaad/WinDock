#!/bin/bash
# Disposable container only: installs and removes system packages.
set -euo pipefail
[[ -f /.dockerenv ]] || { echo "Run package tests inside Docker" >&2; exit 1; }
kind=${1:?deb or arch}
if [[ "$kind" = deb ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends /packages/Tara-linux-amd64.deb
elif [[ "$kind" = arch ]]; then
    pacman -Syu --noconfirm
    pacman -U --noconfirm /packages/Tara-linux-x64.pkg.tar.zst
else
    echo "Unknown package type" >&2
    exit 1
fi
useradd --create-home tester
if tara > /tmp/tara-root.log 2>&1; then
    echo "App must refuse running as root" >&2
    exit 1
fi
grep -q 'without sudo' /tmp/tara-root.log
test -x /usr/lib/tara/node
test -x /usr/lib/tara/tara-input
test -f /usr/share/applications/tara.desktop
grep -qx 'Exec=tara stop' /usr/share/applications/tara.desktop
# The menu entry starts the host as this user service, so it outlives its window.
grep -qx 'ExecStart=/usr/lib/tara/node /usr/lib/tara/src/platform/linux-service.js' /usr/lib/systemd/user/tara.service
test -f /usr/lib/tara/src/platform/linux-service.js
test -x /usr/lib/tara/user-service
grep -q 'TAG+="uaccess"' /usr/lib/udev/rules.d/70-tara-uinput.rules
grep -qx uinput /usr/lib/modules-load.d/tara.conf
# Text ships with LF line endings, and only the binaries and the scripts are executable.
if grep -rlI $'\r' /usr/bin/tara /usr/lib/tara/server.js /usr/lib/tara/src /usr/lib/tara/user-service \
    /usr/lib/udev/rules.d/70-tara-uinput.rules /usr/share/applications/tara.desktop \
    /usr/lib/systemd/user/tara.service; then
    echo "Installed text files contain CR line endings" >&2
    exit 1
fi
test "$(stat -c %a /usr/lib/tara/server.js)" = 644
if [[ -n "$(find /usr/lib/tara/src /usr/lib/tara/public -type f -perm /111)" ]]; then
    echo "Installed data files are executable" >&2
    exit 1
fi
if [[ "$kind" = arch ]]; then
    # .MTREE lets pacman verify every installed file; any terminal can host the window.
    # pacman -Qkk exits 0 even for altered files, so read its summary instead.
    pacman -Qkk tara | tee /tmp/tara-mtree.log
    if ! grep -q ' 0 altered files' /tmp/tara-mtree.log; then
        echo "pacman could not verify every installed file against .MTREE" >&2
        exit 1
    fi
    if pacman -Qi tara | grep -q '^Depends On.*xterm'; then
        echo "xterm must stay optional" >&2
        exit 1
    fi
fi
runuser -u tester -- /usr/lib/tara/node /tests/test-linux-installed.mjs
settings_hash=$(sha256sum /home/tester/.config/tara/config.json | cut -d ' ' -f1)
identity_hash=$(sha256sum /home/tester/.config/tara/config.json.host-id | cut -d ' ' -f1)
secure_hash=$(sha256sum /home/tester/.config/tara/config.json.secure/identity.json | cut -d ' ' -f1)
# The container runs no systemd. A stand-in for the tester's user manager records
# what the package scripts ask of it, and reports the background host as running.
tester_runtime="/run/user/$(id -u tester)"
mkdir -p "$tester_runtime/systemd"
touch "$tester_runtime/systemd/private" /tmp/tara-systemctl.log
chmod 666 /tmp/tara-systemctl.log
# shellcheck disable=SC2016 # the stand-in's own script, written literally
printf '%s\n' '#!/bin/sh' \
    'echo "$(id -un) ${XDG_RUNTIME_DIR:-} $*" >> /tmp/tara-systemctl.log' \
    '[ "$*" = "--user is-active --quiet tara.service" ] && exit 0' \
    'echo "Failed to connect to bus" >&2' \
    'exit 1' > /usr/local/bin/systemctl
chmod 755 /usr/local/bin/systemctl
# apt runs package scripts with PATH=/usr/sbin:/usr/bin:/sbin:/bin (its DPkg::Path),
# which hides the stand-in, so let /usr/local through for the upgrade and removal.
apt_stand_in=(-o DPkg::Path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin)
expect_call() {
    if ! grep -qx "tester $tester_runtime --user $1" /tmp/tara-systemctl.log; then
        echo "The package scripts did not run 'systemctl --user $1' as tester. They ran:" >&2
        cat /tmp/tara-systemctl.log >&2
        exit 1
    fi
}
# Give a copy a higher package revision to exercise an actual upgrade.
mkdir /tmp/tara-upgrade
if [[ "$kind" = deb ]]; then
    upgraded_version="$(dpkg-query -W -f='${Version}' tara).1"
    dpkg-deb -R /packages/Tara-linux-amd64.deb /tmp/tara-upgrade
    sed -i "s/^Version: .*/Version: $upgraded_version/" /tmp/tara-upgrade/DEBIAN/control
    dpkg-deb --root-owner-group --build /tmp/tara-upgrade /tmp/tara-upgrade.deb
    apt-get install -y --no-install-recommends "${apt_stand_in[@]}" /tmp/tara-upgrade.deb
    test "$(dpkg-query -W -f='${Version}' tara)" = "$upgraded_version"
else
    upgraded_version="$(pacman -Q tara | cut -d ' ' -f2).1"
    bsdtar -xf /packages/Tara-linux-x64.pkg.tar.zst -C /tmp/tara-upgrade
    sed -i "s/^pkgver = .*/pkgver = $upgraded_version/" /tmp/tara-upgrade/.PKGINFO
    bsdtar --zstd -cf /tmp/tara-upgrade.pkg.tar.zst -C /tmp/tara-upgrade .PKGINFO .INSTALL usr
    pacman -U --noconfirm /tmp/tara-upgrade.pkg.tar.zst
    test "$(pacman -Q tara)" = "tara $upgraded_version"
fi
test "$(sha256sum /home/tester/.config/tara/config.json | cut -d ' ' -f1)" = "$settings_hash"
# The upgrade restarted the tester's background host with the new unit file, and stopped nothing.
expect_call daemon-reload
expect_call "try-restart tara.service"
if grep -q 'stop tara.service' /tmp/tara-systemctl.log; then
    echo "An upgrade must restart the background host, not stop it" >&2
    exit 1
fi
runuser -u tester -- /usr/lib/tara/node /tests/test-linux-installed.mjs
test "$(sha256sum /home/tester/.config/tara/config.json.host-id | cut -d ' ' -f1)" = "$identity_hash"
test "$(sha256sum /home/tester/.config/tara/config.json.secure/identity.json | cut -d ' ' -f1)" = "$secure_hash"
if [[ "$kind" = deb ]]; then
    apt-get purge -y "${apt_stand_in[@]}" tara
else
    pacman -R --noconfirm tara
fi
# Removal stopped the background host while its files were still there.
expect_call "stop tara.service"
test ! -e /usr/bin/tara
test ! -e /usr/lib/tara
test ! -e /usr/lib/systemd/user/tara.service
test ! -e /usr/share/applications/tara.desktop
test ! -e /usr/lib/udev/rules.d/70-tara-uinput.rules
test ! -e /usr/lib/modules-load.d/tara.conf
test "$(sha256sum /home/tester/.config/tara/config.json | cut -d ' ' -f1)" = "$settings_hash"
test "$(sha256sum /home/tester/.config/tara/config.json.host-id | cut -d ' ' -f1)" = "$identity_hash"
echo "Linux $kind install, upgrade and uninstall PASS"
