## WinDock for Linux (preview)

Prebuilt packages for **x86-64 Hyprland desktops**. Node.js and the compiled
input helper are bundled, so you do not need to install Node.js, npm or Rust.
Use the existing WinDock Android companion.

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
Keep its connection window open. On your phone, open WinDock and select
**Connect by Wi-Fi → Find my PC**, then enter the PIN shown on the PC.
Close the connection window or press Ctrl+C to stop the host.

The package sets up the touchpad's udev rule. If the touchpad cannot start,
log out and back in or reboot. Optional desktop tools for recording and
brightness are listed in the [setup guide](https://github.com/aliihsaad/WinDock/blob/main/README.md#linux-preview).
An active firewall may need TCP 8620 and UDP 41234 allowed from your trusted LAN.

To update, quit WinDock and install the new package with the same command.
To remove it, use `sudo pacman -R windock` or `sudo apt remove windock`.
Your personal dock configuration and captures are preserved.

### Preview scope

- Hyprland, x86-64, glibc 2.36 or newer. GNOME/KDE and ARM builds are not supported.
- No tray icon, autostart or automatic updater yet; keep the connection window open.
- Container checks cover packaging, startup, pairing, signature rendering,
  upgrade and uninstall on Debian 12, Ubuntu 24.04 and Arch. On a physical
  Omarchy desktop with an Android phone, installation, menu launch, pairing,
  Wi-Fi reconnect, apps, touchpad, keyboard, media, capture, signatures and
  touchpad permissions were tested.
- These are unsigned preview packages. SHA-256 hashes are in `SHA256SUMS-linux.txt`.
