<p align="center">
  <img src="assets/tara-icon.png" alt="Tara" width="128" height="128">
</p>

<h1 align="center">Tara</h1>

<p align="center"><b>Your PC, within reach. Just say "Hey Tara".</b></p>

<p align="center">
  <a href="https://github.com/yeshwanthkumardomala/Tara/releases">Releases</a> ·
  <a href="https://yeshwanthkumardomala.github.io/Tara/">Downloads app</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

Tara turns your Android phone into a dock for your Windows PC: app shortcuts, a touchpad and keyboard, media and render controls, creative-tool decks for Blender and DaVinci Resolve, and a voice assistant that wakes when you say **"Tara"** or **"Hey Tara"**. No account and no cloud service.

## Get Tara

| | |
|---|---|
| **Phone** (Android 7+) | `Tara-android-debug.apk` |
| **PC** (Windows 10/11) | `TaraSetup.exe` |

Both are on the [latest release](https://github.com/yeshwanthkumardomala/Tara/releases/tag/upgrades-latest). You can also install the **Tara Downloads** app from the [downloads page](https://yeshwanthkumardomala.github.io/Tara/) to your phone's home screen. It always shows the newest build.

1. Install the PC app and open it from the system tray.
2. Install the phone app and pair it with the code or PIN the PC shows.
3. After that, both apps update themselves from the release feed.

Upgrading from WinDock? Tara is a separate app. Uninstall WinDock from the phone first, quit it on the PC, then install Tara.

## Voice

- Say **"Tara"** or **"Hey Tara"**, wait for the beep, then give a command.
- Try *"open Blender"*, *"volume down"*, *"set brightness to 40"*, *"tell me when my render finishes"*, or ask any question.
- Hands-free listening runs offline on the phone. Download the small speech model once from the Assistant screen, about 40 MB.
- Questions beyond PC commands use a free Google AI Studio key, kept only on the PC. Paste it at `http://localhost:<port>/cast` on the PC.
- Wake names are editable. The dock listens only while it is on screen and hands-free is switched on.

## Features

- Shortcut decks, sticky modifiers, orbit and scrub controls for Blender and DaVinci Resolve
- Touchpad on three taps and keyboard on five taps, with automatic reconnect
- Render watcher, versioned save, status bar and a mini YouTube player
- Send a YouTube link from the PC to the phone with the cast page
- Resumable updates and low-battery idle polling

## Develop

```
npm ci
npm test
```

The shared dock UI is in `public/`, the Node host in `server.js` and `src/`, the Android app in `android/`, and the Windows tray, helper and installer in `native/`. Every push to `upgrades` builds both apps and publishes them to the `upgrades-latest` release.

## Credits

Tara began as a fork of [WinDock](https://github.com/aliihsaad/WinDock) by aliihsaad and keeps its MIT license.
