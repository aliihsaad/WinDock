# WinDock

A remote app dock and control surface for a Windows PC, driven from a phone on
the same network. Pin your apps as tiles, tap to launch or focus them, and drive
volume, media, brightness and power without getting up.

Inspired by [Dokke](https://github.com/felipenalves/Dokke) (macOS), rebuilt
Windows-first with a platform provider layer and a much larger control surface.

## Status

The Node host, platform layer, Windows provider logic, PWA, dock editing,
offline shell, Android wrapper source and security boundary are implemented and
verified: **14 verification oracles, 744 assertions, all passing**
(`npm test`). The acceptance ledger reports **16 gates met, 2 abandoned**.

Two outcomes are **explicit handoffs**, not finished work — this machine is Arch
Linux with no .NET SDK, no Android SDK and no Windows:

| Handoff | Why | What is needed |
|---|---|---|
| `G13` C# helpers compile into a runnable tray host | no .NET SDK here (`dotnet --list-sdks` is empty) | a Windows box with the .NET 8 SDK |
| `G14` real device launches an app on a real PC | no Android SDK, no JDK, no adb, no Windows | hardware for an end-to-end run |

The C# and Kotlin sources are delivered complete and unbuilt. Because the APK
cannot be compiled here, `G17` verifies the thing a build would not catch
anyway: that the Kotlin discovery constants and the Node host describe the *same
protocol*. Drift there compiles perfectly and then simply never finds the PC.

See `GATES.md` for the full acceptance ledger.

## How it works

```
   phone / browser                         Windows PC
 ┌──────────────────┐                 ┌──────────────────────┐
 │  PWA (installed) │◀── WebSocket ──▶│  Node host           │
 │  tiles + control │    snapshots    │   ├ HTTP API (PIN)   │
 └──────────────────┘                 │   ├ UDP discovery    │
          ▲                           │   └ platform provider│
          └──── UDP probe ────────────│         │            │
             "where is the dock?"     │         ▼            │
                                      │  WinDockHelper.exe   │
                                      │  (Win32: focus,      │
                                      │   media keys, volume)│
                                      └──────────────────────┘
```

1. The host serves the PWA and owns all dock state.
2. A phone finds the host by UDP broadcast — no typing IP addresses.
3. Pairing takes one 4-digit PIN; the device then holds a 180-day session.
4. Tapping a tile calls the authenticated API, which delegates to the provider.
5. Every change broadcasts a fresh snapshot to every connected device.

## Design decisions worth knowing

**Nothing ever reaches a shell.** `execFile` is called with an argv array and
`shell: false`. A path containing `& shutdown /s /t 0` is one opaque argument,
never a second command. `verify-injection.mjs` proves this with ten payloads,
each paired with a positive control that must be caught by the same detector.

**Read-only PowerShell is constant.** Inventory and telemetry run fixed scripts
with no interpolation; the injection gate greps the source to prove no template
literal ever enters one.

**Actions go through a helper binary.** Win32 P/Invoke (`SetForegroundWindow`,
media keys, Core Audio, WMI brightness, media transport controls) lives in
`WinDockHelper.exe` behind an argv interface. That keeps the Node side pure and
testable on any OS — which is why the Windows logic is verifiable here at all.

**A real Linux provider ships alongside Windows.** `src/platform/linux.js` is a
working provider, not a stub, so the whole stack runs and is tested on a dev
machine instead of being Windows code nobody has executed.

**Close asks, never kills.** `WM_CLOSE` lets an app prompt to save. Losing
unsaved work to a phone tap is not an acceptable failure mode.

**Valued controls carry their value.** `volume-set` and `brightness-set` need a
number, so their tiles store one ("Volume 25%", "Brightness 50%") and are keyed
by verb *and* value. A control tile for a valued verb with no value is rejected
by the host rather than producing a tile that fails on every tap.

**The service worker never caches live state.** Everything under `/api/` is
network-only. Caching dock state could show a stale running badge or, far worse,
replay a control action from cache.

## Run it

```sh
npm install
npm start
```

The host prints its LAN URL and PIN. Open the URL on your phone and enter the
PIN. On Linux it runs with the Linux provider; on Windows it selects the Windows
provider automatically.

```sh
npm test        # all 14 oracles
```

Tap **Add** to pin apps or controls, **Edit** to reorder and remove them.

### Build the Windows native pieces

On a Windows machine with the .NET 8 SDK:

```powershell
dotnet publish native\win\WinDockHelper.csproj  -c Release -r win-x64
dotnet publish native\tray\WinDockTray.csproj   -c Release -r win-x64
```

Put `WinDockHelper.exe` next to `server.js` (or point at it with
`helperPath`), then run `WinDockTray.exe`.

Brightness uses WMI and works on laptop and all-in-one panels; most desktop
monitors on HDMI/DisplayPort do not expose it, and the call fails cleanly rather
than pretending to succeed.

### Build the Android app

On a machine with a JDK 17 and the Android SDK:

```sh
cd android && ./gradlew assembleDebug
```

The app is a thin WebView host: it finds the PC by UDP broadcast, remembers the
endpoint, and loads the same PWA. It never handles the PIN or session cookie —
pairing stays inside the WebView, and `G17` asserts that boundary in code.

The PWA is installable today without the APK: open the URL and choose
**Add to Home Screen**.

## Security boundary

- All `/api/*` routes require a PIN-issued session. `/health` is the only public
  route.
- PIN comparison is constant-time; 5 failures lock a client out for 60 seconds.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS.
- State-changing requests and WebSocket upgrades are same-origin checked, so a
  hostile page cannot ride a paired session.
- Loopback is trusted by default so the host's own tray needs no pairing. Set
  `trustLoopback: false` to require pairing even on the host.
- Discovery replies advertise only the endpoint — never the PIN.

WinDock is designed for a home LAN. Do not expose the port to the internet: a
4-digit PIN is appropriate for a local network, not a public one.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Public health check |
| POST | `/api/auth` | Exchange the PIN for a session |
| GET | `/api/state` | Tiles, running apps, available verbs |
| GET | `/api/apps/installed` | Full installed-app inventory |
| GET/PUT | `/api/tiles` | Read or replace the pinned tiles |
| POST | `/api/apps/launch` | Launch an app by id |
| POST | `/api/apps/focus` | Focus a running pid |
| POST | `/api/apps/close` | Ask a running pid to close |
| POST | `/api/control` | Run a control verb |
| GET | `/api/nowplaying` | Current media session |
| GET | `/api/stats` | CPU, memory, battery |

## Control verbs

`volume-up` `volume-down` `volume-set` `mute-toggle` `media-play-pause`
`media-next` `media-previous` `media-stop` `brightness-set` `lock` `sleep`
`shutdown` `restart`

`volume-set` and `brightness-set` take an integer 0–100. Every verb is matched
against a fixed allowlist before it can reach a command line.

## Layout

```
server.js              HTTP API, static serving, wiring
src/platform/          contract + windows + linux providers
src/auth.js            PIN, sessions, lockout
src/config.js          tile persistence (atomic writes)
src/discovery.js       UDP responder
src/sync.js            WebSocket hub
public/                PWA — dock.js and tiles.js are pure and headlessly tested
public/sw.js           service worker (shell cached, /api never cached)
android/               Kotlin WebView wrapper (discovery + endpoint memory)
native/win/            WinDockHelper — Win32 surface
native/tray/           WinDockTray — system tray host
scripts/verify-*.mjs   the gate oracles
GATES.md               acceptance ledger
```
