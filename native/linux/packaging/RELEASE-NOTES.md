## WinDock 0.3.0 for Linux

Prebuilt packages for **x86-64 Hyprland desktops**. Node.js and the compiled
input helper are bundled, so you do not need to install Node.js, npm or Rust.
For 0.3.0 (Linux package 0.3.0-1), update the Android companion too
for secure QR pairing and Files & Media. Existing appearance settings are retained. The
**Switch PC** picker discovers running hosts and lets you choose one while keeping
other hosts running. Scan each computer's pairing code; PIN pairing remains for older clients. The touchpad also offers PC text clipboard
history from the manager you already run (Omarchy's own, Elephant, cliphist,
clipman, CopyQ or Klipper), or just the current clipboard without one; paste uses
wl-copy and Ctrl+V. The dock Updates screen checks public releases without installing them.
WinDock now keeps running in the background after you close its window, so the
phone stays connected.

### Omarchy / Arch

Download **WinDock-linux-x64.pkg.tar.zst**. From its download folder:

```bash
sudo pacman -U ./WinDock-linux-x64.pkg.tar.zst
```

### Debian 12+ / Ubuntu 24.04+ with Hyprland

Download **WinDock-linux-amd64.deb**. From its download folder:

```bash
sudo apt install ./WinDock-linux-amd64.deb
```

### Connect

Open **WinDock** in your application menu, or run `windock` as your normal user.
WinDock starts in the background and its window shows a local pairing link.
Open that link on the PC, then choose **Scan computer code** on the phone.
The address and PIN remain available for browser and older clients.
You can close the window. To see the PIN again, open WinDock again or run
`windock status`. To stop WinDock, press **S** in its window or run `windock stop`;
it also stops when you log out.

The package sets up the touchpad's udev rule. If the touchpad cannot start,
log out and back in or reboot. Optional desktop tools for recording and
brightness are listed in the [setup guide](https://github.com/aliihsaad/WinDock/blob/main/README.md#linux-preview).
Run `windock network` and choose **Check connection** before pairing if your firewall
restricts incoming connections. The page shows the actual listening ports, including
managed HTTPS (usually TCP 8621, or 8622 alongside external TLS, possibly another
port after automatic fallback), legacy HTTP and UDP discovery. Choose the interface
and subnet shared with your phone. It provides scoped UFW or firewalld commands
to review and run with administrator permission. It never changes rules itself.
USB tethering can create another interface/subnet; check again with tethering enabled.

If pairing is paused for all devices, the PC-local recovery command is in the
[development guide](https://github.com/aliihsaad/WinDock/blob/main/docs/DEVELOPMENT.md#pairing-recovery-and-older-clients).

To update, install the new package with the same command. A background WinDock
restarts with the update and shows a new PIN. If a WinDock window from an older
version is still open, close it first, then open WinDock again.
To remove it, use `sudo pacman -R windock` or `sudo apt remove windock`; this
also stops a background WinDock. Your personal dock configuration and captures are preserved.

### Linux support scope

- Hyprland, x86-64, glibc 2.36 or newer. GNOME/KDE and ARM builds are not supported.
- No tray icon, autostart or automatic updater yet. The background host is the
  systemd user service `windock.service`; without a systemd user session, WinDock
  runs in its window as before.
- Container checks cover packaging, startup, pairing, signature rendering,
  upgrade and uninstall on Debian 12, Ubuntu 24.04 and Arch. On a physical
  Omarchy desktop with an Android phone, installation, menu launch, pairing,
  Wi-Fi reconnect, apps, touchpad, keyboard, media, capture, signatures and
  touchpad permissions were tested.
- These are unsigned packages. SHA-256 hashes are in `SHA256SUMS-linux.txt`.
