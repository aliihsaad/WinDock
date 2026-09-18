# WinDock Roadmap

Updated 2026-09-18 after continuing the original Linux experiment on Windows.

**Status: 17 of 18 gates met. G14 (physical Android phone → Windows PC) remains pending.**
`npm test` passes all 16 verification scripts, 930 assertions, on Windows with
Node 24.11.0. Native builds and earlier smoke runs passed. The latest smoke run
currently fails at window focus with both the previous and updated helpers;
this needs a separate Windows foreground-focus investigation.

## Main-monitor capture — 2026-09-18

The drawer now offers full-resolution PNG screenshots and silent MP4 recordings,
saved to the PC's Pictures/WinDock and Videos/WinDock folders. Recording includes
a phone timer/Stop button, state recovery after reconnecting, a Windows tray
Stop action and folder shortcuts, and a 60-minute limit. Windows' built-in H.264
encoder needs no additional install. Output preserves aspect ratio within
1920×1080 at up to 15 fps. No audio or cursor overlay in this first version.
Native file checks and authenticated API/error/lifecycle tests pass.

## Completed Windows stabilization

- Fixed oversized HTTP uploads causing connection resets; tested fixed-length
  and chunked bodies, complete error responses and subsequent socket reuse.
- Installed .NET SDK 8.0.425 locally in ignored `.tools/dotnet`.
- Corrected brightness compilation and Core Audio COM signatures.
- Built self-contained Windows helper/tray and packaged their Node host/assets.
- Verified native launch arguments, running-window enumeration, focus, polite
  close, volume read/set at the current level, and the now-playing command.
- Verified tray startup, URL/PIN parsing, and shutdown of its child server.
- Preferred the physical LAN interface over VPN/VM adapters; added `WINDOCK_HOST`
  for explicitly selecting another address assigned to this computer.
- Preserved shortcut argument strings and distinct shortcut profiles/modes.
- Verified PIN pairing, live sync, real app inventory, tile add/edit/remove and
  saved state after reload in a desktop browser against the LAN address.
- Registered the project and saved the audit/results in Vault.

Full original audit and completion evidence: [WINDOWS_READINESS.md](WINDOWS_READINESS.md).
The acceptance ledger is [GATES.md](GATES.md); `npm run gates` reports recorded
status without executing any commands.

## Completed: landscape launcher redesign

The user confirmed the phone connection works and requested a dark home-screen
experience. The web interface now has real 256px Windows app icons, horizontal
pages, long-press editing with a gentle jiggle, drag reordering (including edge
navigation between pages), and tap-to-open remove/move options. Swipe up opens
the glass drawer. Appearance offers 4/6/8 icons per page in two rows. Settings are
saved per browser; tile order still syncs through the PC.

The library supports search and adding multiple apps without reopening it.
Controls use consistent vector symbols, actions report failures visibly, and
power actions ask for confirmation. Portrait screens show a rotate prompt;
fullscreen requests landscape when the browser supports orientation locking.
The PWA manifest and Android wrapper source also request landscape.

### Immersive glass mode

The default view now shows icons only, without dashboard headings, visible
toolbars, or app names. Swipe up reveals a glass drawer with Apps, Controls,
Appearance, Arrange, and Fullscreen. Density controls use exactly 2×2, 3×2, and
4×2 grids with automatically scaled icons. Appearance has four bundled
backgrounds and three glass styles, plus optional app names and a switch back
to the earlier layout. Preferences persist per device. Native extraction was
increased to 256px so large icons stay sharper.

## Next: phone gesture acceptance

Try the redesigned dock on the physical phone: hold an icon or empty dock space,
drag between positions/pages, tap for options, swipe pages, and swipe up for
settings. Desktop browser checks cannot establish the feel of real touch input.
The user has confirmed connectivity; the exact Android launch/focus evidence
for G14 has not been recorded yet.

1. Run `artifacts\WinDock-win-x64\WinDockTray.exe` on the PC.
2. Put the phone and PC on the same LAN; use the URL/PIN shown by the tray.
3. Open that URL in the phone browser, pair, add an app and verify launch/focus.
4. Confirm LAN reachability through the PC firewall and actual router. Local
   browser checks do not prove a separate phone can connect.
5. Verify media controls with a player. Brightness now supports external displays
   through DDC/CI as well as WMI panels; Samsung LC34G55T hardware readback and
   the live API passed a 24% → 29% → 24% check. Now-playing command execution
   has passed; an active music session and media-key effects still need checking.

The browser interface works online over HTTP. Service-worker/offline behavior
requires a secure origin such as HTTPS; do not equate an HTTP home-screen
shortcut with a verified offline PWA.

## Completed: installable Android test app

`npm run build:android` now produces `artifacts/WinDock-android-debug.apk` using
Gradle 8.9, AGP 8.5.2, Kotlin 1.9.24, SDK 34 and Android Studio's Java 21. The
wrapper includes Gradle's official SHA256. Adaptive/legacy launcher icons,
dark connection screen, manual address/retry, strict LAN URL validation,
bounded health checks, landscape immersive mode, load error recovery and
Activity cleanup are implemented. The shared PIN form also tolerates submission
without a submitter button.

Verification: four real Kotlin unit tests pass; Android lint has no errors
(11 advisory warnings, including the intentional landscape/LAN HTTP choices and
older pinned SDK/dependencies); APK v2 signature verifies. An Android 16/API 36.1
emulator passed wrong/correct PIN, WebSocket connection, two pages, no headings
or app names, left/right and upward touch swipes, Back-to-close drawer,
long-press editing, fixture launch/focus requests, failed-address recovery,
manual reconnection and remembered host/pairing after Activity recreation.
The emulator fixture does not launch real Windows apps or modify the user's dock.

Next: install this APK on the physical phone and verify actual LAN discovery,
gesture feel and Windows launch/focus. No USB phone was connected during the
build. External signing and target-SDK updates remain release work.

G14 is cleared only by a real Android-device launch/focus run against Windows,
not by a successful APK compilation alone.

## Completed: packaged Windows apps

The installed-app scan now reads the Windows AppsFolder catalog alongside
classic Start Menu shortcuts. Claude, ChatGPT, and ChatGPT Classic are detected
with their native icons. Packaged apps launch through their validated Windows
app identity; running processes map back to that same identity for activation.
This avoids pinning version-specific paths inside WindowsApps. The real scan
found 150 apps on this PC, and fixtures cover inventory, running identity,
launch/icon/activation arguments, and malformed identifiers.

## Remaining functional gaps

- Current native smoke focus attempts are rejected by both old and new helpers.
  Icon extraction, packaging and the UI checks pass; investigate the current
  Windows focus behavior before calling the latest native smoke run green.
- Start Menu and packaged-app inventory work; actual registry enumeration is not implemented.
- Running badges/media information need refresh when things change directly on
  the PC; there is no provider watcher or periodic polling yet.
- Pairing sessions are in memory and are lost on host restart despite the
  cookie's 180-day maximum age.
- Missing battery data is currently coerced to zero in Windows stats parsing.

## Later polish

The product website is live at [windock.vercel.app](https://windock.vercel.app):
responsive ivory-and-sage design, the actual app UI as an isolated interactive
demo, setup/FAQ, and direct Windows installer and Android APK downloads with
checksums. The GitHub repository is public and release `v0.1.0-preview.1`
contains both GitHub-built downloads. Pushes to `main` deploy the website on
Vercel. `npm run website` still serves local review at http://127.0.0.1:4173.

The Windows tray and executable now use the mint/blue WinDock four-tile mark,
embedded at nine sizes from 16 to 256px (2026-09-18). The updated tray build and
isolated startup/shutdown smoke pass; it is installed in the running package.

Remaining polish: volume/brightness feedback and HTTPS setup.

The Windows installer now provides optional sign-in startup, Start menu/desktop
shortcuts, and uninstall support. A local install/launch/reinstall/uninstall test
passed and preserved the user's dock. `.github/workflows/build-release.yml`
prepares GitHub builds and optional draft releases with direct EXE/APK links.
The first [GitHub run](https://github.com/aliihsaad/WinDock/actions/runs/35344001331)
passed Windows build, installer install/launch/upgrade/uninstall, and Android
build, unit tests, lint, and signature checks on 2026-09-18.

Still outside v1: macros, remote keyboard/trackpad, monitoring widgets and
multi-host control.

## Planned: iOS companion

The website and README announce iOS as **coming soon**, with no release date.
No iOS build or App Store listing exists yet. This is a feasible companion for
the Windows host, not a port of the Windows native helper to the iPhone.

- Reuse the shared HTML/CSS/JavaScript dock in a landscape `WKWebView`.
- Start with manual PC address entry and PIN pairing, restrict navigation to
  the chosen PC origin, and verify cookies/WebSocket reconnection on an iPhone.
- Configure local HTTP transport deliberately. Native discovery needs the
  appropriate local-network usage description; porting UDP broadcast also
  requires assessing Apple's multicast entitlement. Manual entry avoids
  making discovery entitlement approval a first-build dependency.
- Build/sign with Xcode, test gestures, safe areas, foreground/background
  reconnection and landscape behavior on physical iPhones, then prepare distribution.

Feasibility references: Apple's [WKWebView documentation](https://developer.apple.com/documentation/webkit/wkwebview),
[local-network privacy requirements](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy),
and [local networking transport setting](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).

## Repeatable Windows commands

```powershell
npm ci
npm test
npm run build:windows
npm run test:windows
npm run build:android
npm run gates
```

The build finds `.tools\dotnet\dotnet.exe` first, then an SDK on PATH. The
resulting `artifacts\WinDock-win-x64` folder includes its runtimes and can be
launched without installing Node or .NET globally. The native smoke check uses
an isolated test window and does not execute shutdown, restart, lock or sleep.
