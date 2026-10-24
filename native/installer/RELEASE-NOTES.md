## WinDock 0.2.3-preview.1

WinDock now runs on Linux too. This release adds prebuilt packages for Hyprland desktops and small dock fixes for every PC.

- **Linux preview:** the PC host runs on Hyprland, with app launching, running apps, media, volume, brightness, lock, screenshots and recordings, plus the touchpad, phone keyboard and signatures. Packages for Arch/Omarchy and Debian/Ubuntu bundle everything they need; see **WinDock for Linux** below.
- **Clearer messages:** touchpad, signature and capture messages no longer ask a Linux PC to update a Windows host. The app picker labels apps with your PC’s platform, and the tray tip for stopping a recording appears only with the Windows host.
- **No dead-end Reconnect:** when your PC has no touchpad support, the touchpad panel no longer offers a Reconnect button that can only fail again.
- **Hidden apps stay hidden:** on Linux, an app you hid with your own desktop entry no longer appears in the app picker.

### Update instructions

1. Quit WinDock from the Windows tray, then download and run **WinDockSetup.exe**. Your dock settings are preserved.
2. Start WinDock, then disconnect/reconnect your Android app to load the updated dock. Pair again with the tray PIN if prompted.

**No Android APK update is required.** The APK included here is byte-for-byte the 0.2.2-preview.1 Android build (version code 4), included for new users. Public Android previews older than 0.2.2 use a different signing key: uninstall the old app first, install this APK, and pair again. Phone-only preferences reset; your PC dock is kept.

Windows 0.2.1-preview.1 and newer can discover this release through **Check for updates** or a startup notification. Downloading and installing remain manual.

### Preview status

The release build checks native input, update detection, app tests, and installer installation, launch, upgrade and uninstall. Automated checks cover the new dock messages and the hidden Reconnect button. Linux testing is described below.

Windows is unsigned and Android remains debug-signed. iOS remains in development with no installable public release.

Windows and Android download hashes are in **SHA256SUMS.txt**. See the full [version history](https://github.com/aliihsaad/WinDock/blob/main/CHANGELOG.md).
