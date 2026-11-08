## WinDock 0.3.2

Glass controls, eight backgrounds, and your music at a glance.

- **Full glass:** drawers, sheets and menus gain a lit rim and reflection, with
  refraction on supported Android and Chromium browsers. Performance mode keeps
  simpler solid surfaces.
- **Eight backgrounds:** Aurora, Midnight, Dusk, Ember, Lagoon, Silk, Obsidian and
  Prism, selected from previews in Appearance with a smooth change between scenes.
- **Quick controls:** the glass notch expands into live volume and brightness
  sliders, playback controls and shortcuts. Delayed readings no longer overwrite
  your adjustments.
- **Now playing:** on Windows, song artwork appears in the music card and expanded
  notch alongside the title and artist. Tap the notch for controls; paused tracks
  remain visible. Players without artwork keep a music icon.
- **Android Back:** dismisses an open glass menu before closing the sheet behind it.
- **Website demo:** try the notch, cover art and playback controls with three
  fictional, silent tracks from the Music shortcut.

Update both the PC companion and Android app to get all improvements.
The updated APK remembers all eight backgrounds; older apps can return to Aurora
when saving one of the four new scenes. Your other layout settings are preserved.

### Upgrade

1. Quit the Windows companion and run WinDockSetup.exe under the same Windows
   account, or update the Linux package. Keep your existing data; do not uninstall
   or clear it. Keep start-at-sign-in selected if you use it.
2. Install WinDock-android-debug.apk over the existing Android app. Version 0.3.2
   uses version code 12 and the existing GitHub signing certificate. The historical
   filename is retained for compatibility with update checks.
   Public APKs older than 0.2.2 used a different signing key and require uninstalling
   that old Android app first. This resets phone-only settings; the PC dock is kept.
3. Open the companion and phone app. Existing secure pairings should reconnect.
   Users moving from the older PIN-only connection can choose Scan computer code
   to enable secure features. The GitHub APK retains older HTTP/PIN connections;
   file transfer requires the new secure connection.

Android 7 or newer and an up-to-date compatible WebView are required. Android's
App updates checks the WinDock download feed and opens the website download page; it does not use
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
