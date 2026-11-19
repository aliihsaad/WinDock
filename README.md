# Tara

Tara turns your phone into a dock for your PC: shortcuts, a touchpad and keyboard, media and render controls, and a voice assistant you wake by saying "Hey Tara".

Tara began as a fork of [WinDock](https://github.com/aliihsaad/WinDock) by aliihsaad and keeps its MIT license.

## Get it

Open the downloads app (GitHub Pages for this repo) or the [Releases](https://github.com/yeshwanthkumardomala/Tara/releases) page. Each build has:

- `Tara-android-debug.apk` for the phone
- `TaraSetup.exe` for the PC

Install the PC app, open it, then enter the address and PIN in the phone app. The apps update themselves from `latest.json` on the `upgrades-latest` release.

## Voice

Say "Hey Tara" or just "Tara", wait for the beep, then speak. Try "open Blender", "volume down", or "tell me when my render finishes". For general questions, paste a free Google AI Studio key on the PC at `http://localhost:<port>/cast`.

## Develop

```
npm ci
npm test
```

The Android app is in `android/`, the Windows tray and helper in `native/`, and the shared web UI in `public/`.
