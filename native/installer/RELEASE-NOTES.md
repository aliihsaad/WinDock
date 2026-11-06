## WinDock 0.3.0

Pair your Android phone with a computer by scanning its code, send files to that
computer, and keep everyday controls close to your dock.

- **Secure QR pairing:** pair once with each computer. Saved computer identities
  support reconnection and switching between Wi-Fi and USB tethering. The local
  pairing page also lets you manage paired phones.
- **Files & Media:** select photos, videos or documents using Android's system
  picker, or Share to WinDock from another app. Review your selection, follow
  progress and cancel transfers. Files go to Downloads/WinDock by default;
  choose another destination on the computer. Transfers require secure pairing
  and the updated phone app and companion.
- **Folder and website tiles:** add shortcuts to folders and links on the computer.
- **Quick controls:** a compact top panel groups controls, Capture, Touch & sign
  and Files & Media. Updated display controls explain HDR limitations.
- **Connection help:** inspect the active network and ports, with scoped firewall
  instructions for Windows and Linux. WinDock does not apply firewall rules itself.
- **Compatibility fixes:** Android 7 startup resources and Windows HTTP/HTTPS
  port selection were corrected. Existing clipboard, keyboard, touchpad, media
  and signature features remain available.

### Upgrade

1. Quit the Windows companion and run WinDockSetup.exe under the same Windows
   account, or update the Linux package. Keep your existing data; do not uninstall
   or clear it. Keep start-at-sign-in selected if you use it.
2. Install WinDock-android-debug.apk over the existing Android app. Version 0.3.0
   uses version code 10 and the existing GitHub signing certificate. The historical
   filename is retained for compatibility with update checks.
3. Open the companion and phone app. Existing secure pairings should reconnect.
   Users moving from the older PIN-only connection can choose Scan computer code
   to enable secure features. The GitHub APK retains older HTTP/PIN connections;
   file transfer requires the new secure connection.

Android 7 or newer and an up-to-date compatible WebView are required. Android's
App updates checks the WinDock download feed and opens GitHub; it does not use
Google Play or silently install updates. Updating this GitHub version requires
the same signing certificate. Google Play delivery is a separate future channel.

### Scope and known limitations

- Windows packages are unsigned; Android retains the existing debug certificate
  and debug build configuration. Stable version numbering does not change these
  signing properties. Verify the supplied SHA-256 checksums.
- Linux packages support x86-64 Hyprland desktops; see the Linux instructions below.
- Galaxy S4 automatic Performance mode detection remains tracked in #9; use
  manual On when needed. The Omen brightness/error-report discrepancy in #52 is
  not claimed fixed. Network-specific firewall permission can still be required.
- Native Voice to PC was removed; voice typing through the Android keyboard
  remains available. No microphone or broad storage permission is required.
- iOS source is not an installable iPhone release. No macOS host is included.
