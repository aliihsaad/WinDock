# Version history

## Unreleased

- Add Android USB networking through USB tethering, with a dedicated USB-only
  connection flow and discovery that follows the responding network adapter.
- Add phone-only idle dimming, timed black-screen rest with Android sleep,
  and optional keep-awake while the dock is open. A first tap wakes the dock
  without activating its controls. Thanks to [waly-git](https://github.com/waly-git)
  for [suggesting #6](https://github.com/aliihsaad/WinDock/issues/6).
  These features require the new Android build. USB pairing and PC app control
  were verified on a Huawei Mate 10 Pro with the phone’s Wi-Fi off.
- Add the first native iPhone companion source: remembered PC address, PIN pairing
  through the shared landscape dock, and reconnect/change-PC controls.
- Add a GitHub macOS workflow for simulator tests, screenshots and unsigned iOS
  archives. This is not an installable iPhone release; signing and physical testing
  are still pending. This is separate from the Windows maintenance releases below.

## [0.2.1-preview.1](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.1-preview.1) — October 17, 2026

- Update the playing track, artist and playback state automatically while the dock
  is connected and visible. No Refresh tap is needed. Thanks to
  [Peter-KIbe](https://github.com/Peter-KIbe) for [reporting #1](https://github.com/aliihsaad/WinDock/issues/1).
- Pause media polling in the background, refresh on return, and recover from
  temporary failures without overlapping requests or replacing unchanged controls.
- Add **Check for updates** to the Windows tray and a startup notification when
  a newer published Windows release is available. Notifications and the download
  menu open the release page; installation remains manual.

Quit WinDock from the PC tray and run the new Windows installer. Dock settings
are preserved. Reconnect the phone app to load the updated interface. **No Android
update is needed for this fix**: the APK is the unchanged 0.2.0-preview.1 build
(version code 3). Older Windows installations need this one manual update before
they can notify you about future releases. Windows notification settings may
hide startup notifications; the tray check remains available.

## [0.2.0-preview.1](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.0-preview.1) — October 11, 2026

- Use the phone as a full-screen touchpad, with a small grid and blue touch glow.
- Move, click, drag, scroll with two fingers, adjust pointer speed, and pinch to zoom in apps that support Ctrl + mouse wheel.
- Open the Android keyboard automatically when a supported PC text field receives focus. Type text and emoji, or open the keyboard manually.
- Draw signatures in black or blue, save transparent PNGs to the PC, and paste into apps that accept images.
- Recover real app icons after temporary extraction failures instead of keeping generic placeholders cached.
- Try touchpad, typing, signature and capture modes in the website demo. The demo never controls a PC or saves files.
- Browse the version history on the website.

Update both the Windows host and Android app. The APK has version code 3.
The September 18 public APK used a different debug signing key, so it must be
uninstalled before installing this APK. Recent local test builds can update
directly. Re-pair after reinstalling; the dock stored on the PC is preserved.

The Windows installer is unsigned and Android remains debug-signed. Automatic
keyboard opening depends on the PC app exposing text focus; use the keyboard
button otherwise. A signature is a handwritten PNG image, not a certificate-based
digital signature. Pasting requires an app that accepts images.

## [0.1.0-preview.1](https://github.com/aliihsaad/WinDock/releases/tag/v0.1.0-preview.1) — September 18, 2026

- First public Windows installer and Android companion.
- Landscape app dock with real icons, 4/6/8 icons per page, drag rearranging, backgrounds and glass themes.
- Local PIN pairing, app launch/focus, media and system controls.
- Main-monitor PNG screenshots and silent MP4 screen recordings saved to the PC.
- Interactive website demo and direct EXE/APK downloads.
