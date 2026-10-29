## WinDock 0.2.6 — settings and connection fixes

This bug-fix release combines #42 and #43. Update both the PC host and the Android
companion to get the complete settings-persistence fix.

- **Saved appearance:** Android retains Performance mode, layout, app-name labels
  and theme across restarts and changes to the PC's address or port. Existing
  preferences migrate automatically; each PC keeps its own settings.
- **Better Auto detection:** Performance mode enables when Android reports a
  low-RAM device or at most 2 GiB of usable RAM. Manual On/Off always takes priority.
- **Windows startup:** if the default port is reserved or occupied, WinDock picks
  an available port. The tray also provides a saved server-port setting. Explicitly
  configured ports still report a failure instead of silently changing ports.

### Upgrade

1. Quit WinDock on the PC and install the new Windows setup, or upgrade the Linux
   package using your package manager.
2. Install the new Android APK over the existing app. It is version
   `0.2.6-preview.1` (code 9), signed with the same certificate as the previous
   public release. Do not uninstall or clear app data.
3. Reopen the PC host and Android app; pair again if the restarted host asks.

Windows and Android installers are attached below. Linux packages target
Hyprland on x86-64 (Debian/Ubuntu and Arch/Omarchy). The existing 0.2.5 features,
including PC switching, clipboard history and update checks, remain available.

Emulator checks cover settings migration, app/host restart, address changes,
manual overrides, and Auto on 2 GB and 4 GB configurations. Physical Galaxy S4
confirmation remains tracked in #9. iOS source is not an installable iPhone release.

Windows/Linux packages are unsigned; Android keeps the existing debug signing
certificate. Verify `SHA256SUMS.txt` and `SHA256SUMS-linux.txt` beside the downloads.
