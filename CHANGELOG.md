# Version history

## Unreleased

- Add the first native iPhone companion source: remembered PC address, PIN pairing
  through the shared landscape dock, and reconnect/change-PC controls.
- Add a GitHub macOS workflow for simulator tests, screenshots and unsigned iOS
  archives. This is not an installable iPhone release; signing and physical testing
  are still pending. This is separate from the Windows and Android releases below.

## [0.2.6](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.6-preview.1) — October 29, 2026

- Android: preserve Performance mode, layout, app labels and theme across restarts
  and PC address changes using durable per-PC settings. Migrate existing preferences.
- Auto Performance mode also enables on devices with at most 2 GiB of usable RAM,
  including ROMs that do not report low-RAM status. Manual On/Off takes priority.
- Windows: recover when the default port is reserved or occupied. Add a saved
  server-port setting; explicitly configured ports retain clear failure behavior.
- Update both the PC host and Android companion. The APK keeps the existing signing
  certificate and increases to version code 9 so it upgrades without clearing data.

## [0.2.5](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.5-preview.3) — October 26, 2026

- Website: add a dedicated 0.2.5 feature section, updated setup and update-check
  guidance, and a clipboard demo using fictional text. Simulated paste changes
  only the page's demo output. Downloads now point to the verified 0.2.5 installers.

- Linux: WinDock keeps running in the background after you close its window, as
  the systemd user service `windock.service`, so the phone stays connected.
  Opening WinDock from the menu shows the address and PIN, and so does
  `windock status`. Press **S** in that window or run `windock stop` to stop it;
  it also stops at logout. Apps opened from the phone keep running when WinDock
  stops. Upgrading the package restarts a background WinDock with a new PIN, and
  removing the package stops it. Without a systemd user session, the window runs
  WinDock as before; `windock --foreground` does so on request.
- Touchpad: add a collapsed **PC clipboard** panel for recent text history on
  Windows and Linux. Review or edit an item before explicitly pasting it into the
  selected PC field. History is fetched on demand and is cleared from the phone
  when the panel closes. Linux reads the history manager that is already running
  (Omarchy's own, Elephant, cliphist, clipman, CopyQ or Klipper); without one, the
  panel offers the PC's current clipboard.
- Android: add **Switch PC** in the dock drawer and connection screen. Scan for
  running hosts on local networks, check saved addresses, and choose a PC by name,
  platform and address. Keep the current dock open while choosing. Built on the
  saved-PC history contribution in PR #20 by Foxtrot Kreators.
- Android: forgetting a PC clears matching last-used addresses and prevents
  automatic reconnection, including after restart. A running forgotten PC remains
  available for explicit selection; forgetting does not revoke pairing.
- Include the PC name and a persistent public identifier in the health response
  to label PCs, group multiple addresses, and preserve Forget across address changes.
- Add an **Updates** screen in the dock drawer and Appearance, showing the
  installed PC version, manual update checks, and current/available/offline states.
- Add Android update checks from the connection screen and connected dock,
  plus an update shortcut in the Windows connection window. Installation stays
  manual. Android checks its own APK version code, including PC-only releases.

- Fix Android rejecting manual Tailscale/CGNAT addresses in `100.64.0.0/10`.
  Keep strict URL validation, same-origin WebView access and PIN pairing;
  add boundary/reconnect regression tests and manual VPN connection guidance.

## [0.2.4-preview.1](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.4-preview.1) — October 25, 2026

- Security: refuse HTTP and WebSocket requests whose Host header isn't an IP
  address, `localhost`, this PC's own name (plain or `.local`), or a name listed
  in `WINDOCK_ALLOWED_HOSTS`. This closes a DNS rebinding hole where a web page
  could point its domain at 127.0.0.1 and use the loopback trust to drive the PC.
- Security: loopback connections skip pairing only when the Host is also a
  loopback name.
- Security: the pairing PIN is now six digits, and a host-wide budget pauses new
  pairing for 10 minutes after 30 wrong PINs from any mix of addresses. Phones
  that are already paired keep working during the pause. Pairing requests that
  were still uploading when the pause began are refused too. The Windows tray's
  **Allow pairing now** action clears the host-wide pause locally; individual
  device lockouts still apply. Older four-digit clients show upgrade instructions
  without consuming the failure budget.
- Add **Appearance → Performance mode** with Auto, On, and Off. Reduce blur,
  shadows, animation, and touchpad effects; use instant dock paging while enabled.
  Auto follows the updated Android companion's low-RAM hint, with a remembered
  manual override. Off restores the existing background and glass preferences.
  Thanks to [waly-git](https://github.com/waly-git) for the detailed
  [Galaxy S4 report and prototype findings (#9)](https://github.com/aliihsaad/WinDock/issues/9).
- Reject malformed request targets with HTTP 400 instead of crashing the host.
- Thanks to [Ojas Sharma](https://github.com/ojaseminem) for the security contribution in [#10](https://github.com/aliihsaad/WinDock/pull/10).

Update the PC host and Android companion (version code 5) for automatic low-RAM
detection. The APK uses the same signing certificate as 0.2.2/0.2.3 and can update
those public builds in place. Reopen the phone app after updating the host and
pair with its new six-digit PIN. Older companions can enable Performance mode
manually. Linux package updates preserve the PC configuration.

## [0.2.3-preview.1](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.3-preview.1) — October 20, 2026

- Add a Hyprland-first Linux host. The same Android app connects to it and gets
  app launching, running apps, media, volume, brightness, lock, screenshots and
  recordings, plus the touchpad, phone keyboard and signatures through a small
  Rust input helper. GNOME and KDE are not supported yet.
- Add Linux x86-64 installer previews for Arch/Omarchy and Debian/Ubuntu
  running Hyprland. Packages include Node.js and the native input helper,
  an application-menu launcher, and automatic touchpad permission setup.
  Users no longer need to compile the app. Install, launch, upgrade and removal
  are checked in Debian 12, Ubuntu 24.04 and Arch containers, and the packages
  were tested with an Android phone on a physical Omarchy desktop.
  The launcher shows the pairing PIN in a terminal window that must stay open.
- Make touchpad, signature and capture messages platform-neutral, so a Linux PC
  is no longer told to update a Windows host. The app picker labels apps with
  the PC’s platform, and only the Windows host mentions its tray for stopping a
  recording.
- Hide the touchpad’s Reconnect button when the PC has no touchpad support,
  since retrying cannot change the answer.
- On Linux, keep apps hidden by a user desktop entry (`Hidden` or `NoDisplay`)
  out of the app picker.
- Make the website easier to read and tap on phones, and fold earlier releases
  into collapsible rows. The download section offers the Linux packages with
  their checksums and counts Linux downloads alongside Windows and Android.

Quit WinDock from the Windows tray and run the new installer; your dock settings
are kept. Reconnect the phone app to load the updated dock. No new Android APK is
needed: this release includes the 0.2.2-preview.1 APK (version code 4) for new
users. Public Android previews older than 0.2.2 use a different signing key and
must be uninstalled first. Linux install, update and removal steps are in the
[Linux preview guide](README.md#linux-preview).

## [0.2.2-preview.1](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.2-preview.1) — October 19, 2026

- Add Android USB networking through USB tethering, with a dedicated USB-only
  connection flow and discovery that follows the responding network adapter.
- Make Wi-Fi and USB separate connection choices with their own remembered PC
  addresses. Reopening the app after disconnecting USB returns to Wi-Fi.
- Add phone-only idle dimming, timed black-screen rest with Android sleep,
  and optional keep-awake while the dock is open. A first tap wakes the dock
  without activating its controls. Thanks to [waly-git](https://github.com/waly-git)
  for [suggesting #6](https://github.com/aliihsaad/WinDock/issues/6).
  These features require the new Android build. USB pairing and PC app control
  were verified on a Huawei Mate 10 Pro with the phone’s Wi-Fi off.
- Add **Appearance → This phone · screen & sleep** in the dock for Android.

Update both apps. Quit WinDock from the Windows tray and run the new installer;
your PC dock settings are preserved. The new Android APK is version code 4 and
uses a different debug signing key from the previous public previews. Uninstall
the old Android app, install this APK, and pair again. Phone-only preferences
reset on uninstall; the dock stored on the PC is kept. Recent local test builds
with the same key can update directly.

For USB, connect a data-capable cable, enable **USB tethering** in Android
Settings, then choose **Connect by USB → Find USB PC** and enter the normal
tray PIN. No USB debugging is required. Choose **Connect by Wi-Fi** to return
to wireless. Tethering may share mobile data with Windows.

Display options live under **This phone** on the connection screen or in the
dock’s Appearance panel. Timed rest goes black and lets Android sleep; the
phone’s own screen timeout may add a delay. These options reduce prolonged
display exposure but do not guarantee prevention of burn-in.

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
