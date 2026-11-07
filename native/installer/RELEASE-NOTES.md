## WinDock 0.3.1

A more responsive touchpad with controls that stay out of your way.

- **Gesture-aware dot field:** dots react to taps, scrolling, pinch zoom and drag.
  Animation stops when idle; Performance mode and reduced motion keep simpler feedback.
- **Thumb-friendly controls:** Left and Right click sit in the bottom corners,
  tools stay along the top, and controls fade while you touch the pad.
- **Optional PC keys:** use the PC keys toggle to show Esc, Tab and Delete on the
  left and Home, End and arrow keys on the right. Keys dim and disable during touch.
- **Keyboard correction:** Android no longer requests sentence capitalization
  from a repeatedly cleared input draft. PC navigation commits composing text first.
  Manual Shift remains available; behavior on the originally reported tablet still
  needs device confirmation.
- **Quick connections:** Switch PC and Connection sit together at the bottom of
  the drawer, keeping quick switching and connection settings easy to reach.
- **One download page:** update actions on Android, Windows and the shared dock
  open the WinDock website download section. Installer and APK links remain on GitHub.

Update both the PC companion and Android app to get all improvements.
The website demo includes the same controls and simulated key feedback.

### Upgrade

1. Quit the Windows companion and run WinDockSetup.exe under the same Windows
   account, or update the Linux package. Keep your existing data; do not uninstall
   or clear it. Keep start-at-sign-in selected if you use it.
2. Install WinDock-android-debug.apk over the existing Android app. Version 0.3.1
   uses version code 11 and the existing GitHub signing certificate. The historical
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
