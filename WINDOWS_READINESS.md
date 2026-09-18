# Windows readiness review — 2026-09-17

Reviewed baseline: `e6ab859` on `main`, cloned from
`https://github.com/aliihsaad/WinDock.git`.

## Capture follow-up — 2026-09-18

Added PNG screenshots and silent H.264 MP4 recording of the main monitor using
the Windows helper and built-in encoder. Files stay in Pictures/WinDock and
Videos/WinDock. The phone drawer has Capture, an active recording timer and
Stop; the tray provides Stop recording and folder shortcuts. Recordings fit
within 1920×1080 at up to 15 fps and stop after 60 minutes.

Native checks produced full-resolution 3440×1440 PNGs and finalized 1920×802
video-only MP4s. Live API/UI capture state and a saved recording were observed;
the 844×390 capture panel fits without horizontal overflow. All 16 automated
scripts pass (930 assertions), including pairing/origin checks, rejected custom
paths/options, duplicate requests, encoder failures and process lifecycle.
The tray startup smoke check passed. Both helper and tray are in the running
Windows package; the Android wrapper uses these updated hosted assets.

## Brightness follow-up — 2026-09-18

The Samsung LC34G55T does not expose WMI brightness. Added DDC/CI external-monitor
support with a VCP luminance fallback, range conversion, serialized commands,
and actionable phone errors. The rebuilt helper passed hardware readback at
24% → 29% → 24%, both directly and through the live host's `/api/control` route.
The original level and personal dock configuration were preserved. The live
Windows package now includes the fix; all 15 JavaScript checks pass (867 assertions).
This supersedes the brightness limitation in the historical audit below.

## Stabilization outcome — 2026-09-17

The audit below is retained as the original baseline. The following items have
since been fixed and verified in the working tree:

- All 14 JavaScript checks pass: **761 assertions**. Oversized fixed-length and
  chunked requests return complete 413 responses; a follow-up request reuses the
  same socket successfully without resetting it or changing persisted tiles.
- Microsoft-signed installer installed .NET SDK 8.0.425 in ignored `.tools/dotnet`.
  Brightness compilation and Core Audio COM signatures are corrected.
- `npm run build:windows` produces a self-contained helper and tray, with Node,
  server code, web assets and ws under `artifacts/WinDock-win-x64`. It also stages
  the helper in the development root. No system PATH change is needed.
- `npm run test:windows` passed on this PC: real launch arguments (spaces and
  ampersands), running-window enumeration, foreground focus, polite close, Core
  Audio read/set at the unchanged current level, and now-playing command execution.
  An isolated off-screen fixture was used; no existing user application was closed.
- The packaged tray passed its startup/cleanup check from a different working
  directory using bundled Node. Callbacks now marshal onto its UI thread.
- Discovery selects Ethernet before Tailscale/Hyper-V. `WINDOCK_HOST` can select
  another IPv4 address assigned to the computer.
- Argument-bearing shortcuts retain distinct IDs and pass their argument strings
  intact. These tiles launch the requested shortcut mode each time; executable-only
  process information cannot reliably identify a specific profile to focus.
- Desktop-browser verification against the LAN address passed PIN pairing, live
  WebSocket connection, real app picker, adding a tile, edit mode, removal and
  persisted state after reload. No browser warnings/errors were recorded.

**G13 is met. G14 remains pending.** A physical-phone/router test, Android build
completion, media-key effects with an active player, and real-panel brightness
are still outstanding. The later product gaps below remain open unless listed
as fixed above. `ROADMAP.md` now contains the current next-step order.

WinDock has a useful, working JavaScript foundation. It is ready for a Windows
stabilization milestone, but the current checkout is not yet ready for a complete
phone-to-PC control demonstration. The Linux-era “all passing” status in the
README and roadmap does not describe the results on this machine.

## Project continuity

- Created the **WinDock** work project in Vault, linked to this repository and
  `C:\Users\Mini\Desktop\Projects\WinDock`.
- Recorded the user's context: this was an experiment on another Linux machine,
  published on GitHub and cloned here to continue development on Windows.
- The initial Git working tree was clean. This review installed the locked npm
  dependency and added this report; application source was not modified.

## Verified locally

| Check | Result |
|---|---|
| Node / npm | Node 24.11.0; npm 11.6.2 |
| Dependency installation | `npm ci --ignore-scripts --no-audit --no-fund` succeeded |
| Repository test suite | **13/14 verification scripts passed** |
| API test retry | Failed again at `scripts/verify-api.mjs:186`, `ECONNRESET` |
| Isolated API diagnostic | Remaining 47 assertions passed with only the oversized-body case omitted in memory; original test and source unchanged |
| Real Windows inventory | 87 apps returned; 14 carry shortcut arguments |
| Real running-app enumeration | 8 apps returned at the time of the check |
| Real Windows telemetry | CPU and memory query succeeded |
| Local HTTP smoke check | Shell and health returned 200; provider selected Windows |
| Pairing smoke check | Unpaired state request returned 401; correct PIN returned 200; paired state returned 200 |
| Android tooling | Android Studio, SDK platform/build-tools 34, adb, and bundled Java 21.0.8 exist |
| .NET tooling | `dotnet` unavailable on PATH; standard `Program Files\dotnet\dotnet.exe` absent |

The first sandboxed test attempt could not spawn child processes (`EPERM`), so
it was not treated as a test result. The 13/14 result above comes from the
unrestricted run. The smoke check bound a temporary HTTP server to loopback,
used an in-memory empty configuration, performed no PC control actions, and
closed the server afterward. No browser UI or physical phone test was performed.

## Issues to address before the first complete Windows demo

### 1. Restore a passing API test baseline

`server.js:55` reads bodies with `for await` and throws after exceeding the size
limit. The full API test gets past its 413 assertion but subsequently fails at
the invalid-session request with a connection reset. This reproduced twice on
Node 24.11.0. Omitting only the oversized-body request from an in-memory copy
lets all other API assertions pass.

This isolates the problematic request sequence, but does not yet establish the
complete fix. Inspect oversized-request handling together with fetch response
consumption and connection reuse in the test. Node documents that early exit
from the default readable async iterator destroys the stream.
[Node stream documentation](https://nodejs.org/docs/latest-v24.x/api/stream.html#readablesymbolasynciterator)

### 2. Compile and correct the native Windows helper

- `native/win/Brightness.cs:21` uses `using var` with `ManagementScope`.
  Local .NET reflection confirms that type does not implement `IDisposable`;
  this declaration must be corrected before the helper can compile.
- `native/win/Audio.cs:47` onward declares COM methods returning HRESULT as
  `int` without `[PreserveSig]`. Its volume setters also pass the event GUID by
  value rather than matching the native pointer signature. These are source-level
  interop defects; audio behavior has not been tested on hardware.
  [Microsoft COM signature rules](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/preserve-sig)
  and [volume setter signature](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nf-endpointvolume-iaudioendpointvolume-setmastervolumelevelscalar).
- Both projects target .NET 8 and publish with `SelfContained=false`. Make the
  build SDK and required runtime available, then compile both helper and tray.
- `native/tray/Program.cs:55` expects `server.js` beside the tray executable.
  The publish project does not copy the Node host, `src`, `public`, or npm
  dependency into its output. Define a complete runtime layout before calling
  the tray publish output runnable.

No native project was compiled during this review, so additional compiler or
runtime defects remain possible.

### 3. Advertise an address the phone can reach

`src/discovery.js:20` chooses the first non-loopback IPv4 address. On this machine
that is **Tailscale**, ahead of Ethernet; a Hyper-V interface is also present.
`server.js:280` uses that choice for both the startup URL and UDP discovery reply.
Prefer the intended LAN interface or provide an explicit advertised-host setting.
A phone without the corresponding VPN connection may otherwise discover an
unreachable address.

### 4. Preserve Windows shortcut launch behavior

`src/platform/windows.js:240` launches only the executable target, discarding the
shortcut arguments already collected by inventory. The native launch verb also
accepts only a path. This affects 14 inventory entries on this machine; some
shortcuts require arguments to open the intended app, profile, or mode. IDs are
also keyed only by executable path, so distinct argument-based shortcuts can
collapse into one tile candidate.

### 5. Complete Android build and LAN access setup

- The repository has no Gradle wrapper or launcher icon resource, although the
  manifest references `@mipmap/ic_launcher`.
- The installed SDK includes API 34. Android Studio bundles Java 21.0.8, but
  Java, Gradle, and adb are not on this shell's PATH, and the usual SDK/JDK
  environment variables are unset. Configure the project against the existing
  tooling and a compatible Gradle version; do not assume the Android SDK is absent.
- `android/app/src/main/res/xml/network_security_config.xml:8` treats
  `192.168.0.0`, `10.0.0.0`, and `172.16.0.0` as if domain rules described address
  ranges. Android matches domains/subdomains, not those IP ranges. With the
  fallback denying cleartext, normal discovered LAN addresses are not covered.
  This is a source/configuration finding; the APK has not been run.
  [Android network security configuration](https://developer.android.com/privacy-and-security/security-config#domain)
- Release signing is still unconfigured. It is not required for the first debug
  APK demonstration.

## Other gaps the current documentation overstates

- **Registry inventory:** the parser accepts registry fixtures, but the actual
  inventory PowerShell only enumerates Start Menu shortcuts.
- **Live running/media state:** broadcasts follow WinDock tile/app actions, but
  there is no provider watcher or periodic refresh for changes made directly on
  the PC. Now-playing is fetched only during an explicit refresh/initial load.
- **Persistent pairing:** sessions live in an in-memory `Map`; restarting the
  host loses them despite the cookie's 180-day maximum age.
- **Phone offline PWA:** plain HTTP on a LAN IP does not provide the secure
  context needed for a service worker. The online web interface can still be
  used, but offline capability is not established by the manifest/source tests.
  This is broader than the roadmap's iOS-only framing.
  [Service worker requirements](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers#setting_up_to_play_with_service_workers)
- **Telemetry:** `parseStats` converts a missing battery (`null`) into `0`
  through numeric coercion, which can misreport a desktop as having an empty battery.
- **Portable gate tooling:** `npm run gates` and the G0 check depend on external
  Claude/unlazy paths from the original environment. They are not self-contained.

## Recommended next milestone

1. Fix the API request-sequence regression and add meaningful regression coverage.
2. Configure the .NET toolchain, fix native compilation/interop, and publish a
   complete helper/tray/Node runtime layout.
3. Fix LAN address selection and shortcut argument handling.
4. Verify launch/focus and selected media/volume controls locally, then from a
   phone browser over the LAN. Verify firewall/router reachability at this stage.
5. Restore the Android wrapper/icons, configure the existing SDK/JDK, correct
   LAN access policy, and perform the real-device run required by G14.
6. Update README, ROADMAP, and GATES with actual Windows evidence. Mark G13/G14
   complete only when their stated outcomes have been verified.

Feature polish can follow this milestone. Focus/close, volume/media, brightness,
now-playing through the native helper, tray behavior, and phone/router discovery
are still unverified on real hardware.
