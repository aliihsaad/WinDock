#!/bin/bash
# Disposable container only: installs and removes system packages.
set -euo pipefail
[[ -f /.dockerenv ]] || { echo "Run package tests inside Docker" >&2; exit 1; }
kind=${1:?deb or arch}
if [[ "$kind" = deb ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends /packages/WinDock-linux-amd64.deb
elif [[ "$kind" = arch ]]; then
    pacman -Syu --noconfirm
    pacman -U --noconfirm /packages/WinDock-linux-x64.pkg.tar.zst
else
    echo "Unknown package type" >&2
    exit 1
fi
useradd --create-home tester
if windock > /tmp/windock-root.log 2>&1; then
    echo "App must refuse running as root" >&2
    exit 1
fi
grep -q 'without sudo' /tmp/windock-root.log
test -x /usr/lib/windock/node
test -x /usr/lib/windock/windock-input
test -f /usr/share/applications/windock.desktop
grep -qx 'Exec=windock stop' /usr/share/applications/windock.desktop
# The menu entry starts the host as this user service, so it outlives its window.
grep -qx 'ExecStart=/usr/lib/windock/node /usr/lib/windock/src/platform/linux-service.js' /usr/lib/systemd/user/windock.service
test -f /usr/lib/windock/src/platform/linux-service.js
test -x /usr/lib/windock/user-service
grep -q 'TAG+="uaccess"' /usr/lib/udev/rules.d/70-windock-uinput.rules
grep -qx uinput /usr/lib/modules-load.d/windock.conf
# Text ships with LF line endings, and only the binaries and the scripts are executable.
if grep -rlI $'\r' /usr/bin/windock /usr/lib/windock/server.js /usr/lib/windock/src /usr/lib/windock/user-service \
    /usr/lib/udev/rules.d/70-windock-uinput.rules /usr/share/applications/windock.desktop \
    /usr/lib/systemd/user/windock.service; then
    echo "Installed text files contain CR line endings" >&2
    exit 1
fi
test "$(stat -c %a /usr/lib/windock/server.js)" = 644
if [[ -n "$(find /usr/lib/windock/src /usr/lib/windock/public -type f -perm /111)" ]]; then
    echo "Installed data files are executable" >&2
    exit 1
fi
if [[ "$kind" = arch ]]; then
    # .MTREE lets pacman verify every installed file; any terminal can host the window.
    # pacman -Qkk exits 0 even for altered files, so read its summary instead.
    pacman -Qkk windock | tee /tmp/windock-mtree.log
    if ! grep -q ' 0 altered files' /tmp/windock-mtree.log; then
        echo "pacman could not verify every installed file against .MTREE" >&2
        exit 1
    fi
    if pacman -Qi windock | grep -q '^Depends On.*xterm'; then
        echo "xterm must stay optional" >&2
        exit 1
    fi
fi
runuser -u tester -- /usr/lib/windock/node /tests/test-linux-installed.mjs
settings_hash=$(sha256sum /home/tester/.config/windock/config.json | cut -d ' ' -f1)
identity_hash=$(sha256sum /home/tester/.config/windock/config.json.host-id | cut -d ' ' -f1)
# The container runs no systemd. A stand-in for the tester's user manager records
# what the package scripts ask of it, and reports the background host as running.
tester_runtime="/run/user/$(id -u tester)"
mkdir -p "$tester_runtime/systemd"
touch "$tester_runtime/systemd/private" /tmp/windock-systemctl.log
chmod 666 /tmp/windock-systemctl.log
# shellcheck disable=SC2016 # the stand-in's own script, written literally
printf '%s\n' '#!/bin/sh' \
    'echo "$(id -un) ${XDG_RUNTIME_DIR:-} $*" >> /tmp/windock-systemctl.log' \
    '[ "$*" = "--user is-active --quiet windock.service" ] && exit 0' \
    'echo "Failed to connect to bus" >&2' \
    'exit 1' > /usr/local/bin/systemctl
chmod 755 /usr/local/bin/systemctl
# Give a copy a higher package revision to exercise an actual upgrade.
mkdir /tmp/windock-upgrade
if [[ "$kind" = deb ]]; then
    upgraded_version="$(dpkg-query -W -f='${Version}' windock).1"
    dpkg-deb -R /packages/WinDock-linux-amd64.deb /tmp/windock-upgrade
    sed -i "s/^Version: .*/Version: $upgraded_version/" /tmp/windock-upgrade/DEBIAN/control
    dpkg-deb --root-owner-group --build /tmp/windock-upgrade /tmp/windock-upgrade.deb
    apt-get install -y --no-install-recommends /tmp/windock-upgrade.deb
    test "$(dpkg-query -W -f='${Version}' windock)" = "$upgraded_version"
else
    upgraded_version="$(pacman -Q windock | cut -d ' ' -f2).1"
    bsdtar -xf /packages/WinDock-linux-x64.pkg.tar.zst -C /tmp/windock-upgrade
    sed -i "s/^pkgver = .*/pkgver = $upgraded_version/" /tmp/windock-upgrade/.PKGINFO
    bsdtar --zstd -cf /tmp/windock-upgrade.pkg.tar.zst -C /tmp/windock-upgrade .PKGINFO .INSTALL usr
    pacman -U --noconfirm /tmp/windock-upgrade.pkg.tar.zst
    test "$(pacman -Q windock)" = "windock $upgraded_version"
fi
test "$(sha256sum /home/tester/.config/windock/config.json | cut -d ' ' -f1)" = "$settings_hash"
# The upgrade restarted the tester's background host with the new unit file, and stopped nothing.
grep -qx "tester $tester_runtime --user daemon-reload" /tmp/windock-systemctl.log
grep -qx "tester $tester_runtime --user try-restart windock.service" /tmp/windock-systemctl.log
if grep -q 'stop windock.service' /tmp/windock-systemctl.log; then
    echo "An upgrade must restart the background host, not stop it" >&2
    exit 1
fi
runuser -u tester -- /usr/lib/windock/node /tests/test-linux-installed.mjs
test "$(sha256sum /home/tester/.config/windock/config.json.host-id | cut -d ' ' -f1)" = "$identity_hash"
if [[ "$kind" = deb ]]; then
    apt-get purge -y windock
else
    pacman -R --noconfirm windock
fi
# Removal stopped the background host while its files were still there.
grep -qx "tester $tester_runtime --user stop windock.service" /tmp/windock-systemctl.log
test ! -e /usr/bin/windock
test ! -e /usr/lib/windock
test ! -e /usr/lib/systemd/user/windock.service
test ! -e /usr/share/applications/windock.desktop
test ! -e /usr/lib/udev/rules.d/70-windock-uinput.rules
test ! -e /usr/lib/modules-load.d/windock.conf
test "$(sha256sum /home/tester/.config/windock/config.json | cut -d ' ' -f1)" = "$settings_hash"
test "$(sha256sum /home/tester/.config/windock/config.json.host-id | cut -d ' ' -f1)" = "$identity_hash"
echo "Linux $kind install, upgrade and uninstall PASS"
