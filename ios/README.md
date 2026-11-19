# Tara for iPhone — development build

A small native iOS companion for the **existing Windows host**. It remembers your
PC's address, verifies `/health`, and opens the shared landscape dock in `WKWebView`.
PIN pairing, app icons, the drawer and live updates come from your PC.

This is source and a GitHub simulator build, **not a public iPhone download**.
The Windows and Android release versions are unchanged. An unsigned archive cannot
be installed on a phone by downloading it; signing and provisioning are still needed.

## Connect (once installed with signing)

1. Run Tara on Windows and put the iPhone on the same trusted network.
2. In the Windows tray menu, choose **Show connection info**.
3. Enter that address in the iPhone app, for example `192.168.1.20:8620`.
4. Allow **Local Network** access when iOS asks, then enter the PC's PIN.

The app remembers a working address and retains the dock's pairing cookie. The PC
may request a fresh PIN after restarting. The small **…** button at the upper left
offers **Reconnect** and **Change PC**. The screen stays awake while the dock is open.
If connection fails, check the PC address, Wi-Fi, Windows firewall and iOS
**Settings → Privacy & Security → Local Network → Tara**, then retry.

## Build on GitHub from Windows

Open [Build Tara iOS](https://github.com/yeshwanthkumardomala/tara/actions/workflows/build-ios.yml)
and select **Run workflow** on `main`. Relevant source changes also run it automatically.
The workflow uses a GitHub-hosted macOS runner, Xcode 16.4 and XcodeGen. No Apple
account, certificate or device credentials are needed for this unsigned build.

Each successful run produces one artifact containing:

- `Tara-simulator.zip`: the app for **iOS Simulator on a Mac**.
- `Tara-unsigned-archive.zip`: an **unsigned device archive**, ready for a later
  signing workflow; it is not an installable IPA.
- Simulator screenshots, `.xcresult` test results, build logs and fixture events.

Artifacts expire after 14 days and require GitHub access to download. These are
development artifacts, so they are not linked as downloads on the public website.

The tests exercise the real shared web interface and Node host with an isolated
fake PC provider: incorrect/correct PIN, cookie reuse, a new native controller,
WebSocket connection, app launch/focus, drawer rendering, invalid/unreachable
addresses, redirect/oversized/wrong-service health responses and foreign-origin
navigation/subresource blocking. They do not control a real Windows desktop.

## Build on a Mac

Requires Xcode 16.4 or later, an installed iOS Simulator, Node 20+ and XcodeGen:

```sh
npm ci
cd ios
swift scripts/generate-icon.swift
xcodegen generate
open Tara.xcodeproj
```

For the integration tests, first run `node ios/scripts/smoke-host.mjs` from the
repository root in another terminal. Choose an iPhone simulator and run the
`Tara` scheme's tests. Use `node ios/scripts/verify-events.mjs` afterwards to
verify that launch/focus reached the test host.

`project.yml` is the source of truth; the generated Xcode project, icon PNG and build
output are ignored. The generated icon uses the existing four-square Tara brand.
The bundle ID is `dev.ali-saad.tara`; configure an appropriate team and available
bundle ID when adding signing. Do not commit certificates, profiles or Apple secrets.

## First-version boundaries

- Manual private IPv4 address entry; no automatic discovery, IPv6 or hostnames
  other than `localhost` yet. A bare address defaults to port 8620.
- iOS 16+; landscape iPhone/iPad layout. Physical-device acceptance is still pending.
- Native health checks reject redirects, bound the response to 4 KiB and time out.
  Navigation is limited to the selected origin; WebKit content rules additionally
  restrict web subresources. Local HTTP exceptions cover private/loopback addresses,
  without a global `NSAllowsArbitraryLoads` exception. HTTPS retains normal certificate
  validation. This remains a companion for a trusted LAN, not internet remote access.
- The shared dock includes touchpad, signature and manual web keyboard UI. Their
  gestures, keyboard focus, safe areas and background/reconnection behavior need
  real iPhone testing. The Android native automatic keyboard bridge is **not** part
  of this first iOS shell. Do not claim iOS feature parity before testing it.
- No TestFlight/App Store distribution is configured. The next milestone is signing,
  physical iPhone testing and then a distributable preview. The website stays
  **coming soon** until an installable release is available.
