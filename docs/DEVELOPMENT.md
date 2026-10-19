# Developer reference

## Architecture

The Android app is a Kotlin WebView host: it discovers the PC by UDP broadcast,
remembers the endpoint, and loads the same web interface served to browsers.
The web interface handles pairing; the Android wrapper does not receive the PIN
or session cookie. Ordinary browsers do not perform UDP discovery.

The Node host owns pinned tiles and publishes updates over WebSocket. Platform
providers implement a common contract. The Windows provider invokes a C# helper
for app identity, launch, focus, icons, media, brightness, and screen capture.
A Linux provider supports development without the Windows native layer.

| Path | Responsibility |
| --- | --- |
| `server.js` | HTTP API, static serving, provider wiring |
| `src/platform/` | Provider contract, Windows/Linux implementations, capture lifecycle |
| `src/auth.js` | PIN pairing, sessions, lockout |
| `src/config.js` | Atomic tile persistence |
| `src/discovery.js` | UDP responder |
| `src/sync.js` | WebSocket updates |
| `src/input-hub.js`, `src/input.js` | Exclusive touchpad channel, bounded input/signature validation |
| `src/platform/input.js` | Persistent Windows touchpad helper and signature export process |
| `public/` | Shared dock UI and offline shell |
| `android/` | Discovery, validated endpoints, landscape WebView |
| `native/win/` | Windows helper |
| `native/tray/` | System tray host |
| `website/` | Static product website and isolated demo |
| `scripts/verify-*.mjs` | Platform-independent verification scripts |

## Boundaries

- Native commands use `execFile` with argument arrays and `shell: false`.
  Inventory and telemetry use fixed read-only PowerShell scripts without
  interpolating user input. Control verbs are allowlisted.
- App close uses `WM_CLOSE`, allowing the application to offer a save prompt.
- Shortcut argument strings are preserved. Shortcut profiles have separate IDs
  because an executable path alone cannot identify the requested launch mode.
- Packaged Windows apps use stable app identities rather than versioned paths
  inside WindowsApps.
- The service worker never caches `/api/` requests or replays actions. It needs
  a secure origin; ordinary LAN HTTP can serve the online interface only.
- Android permits LAN HTTP, validates private/loopback IPv4 endpoints, and
  restricts navigation and intercepted requests to the selected origin. DNS
  names other than localhost and IPv6 are not supported by this wrapper yet.

## Pairing and network access

`POST /api/auth` exchanges a PIN for a session. Other `/api/*` routes require
that session or trusted loopback access. `/health` and the web UI are public.
PIN comparison is constant-time; five failed attempts lock a client out for
60 seconds. Cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS.
Their maximum age is 180 days, but in-memory sessions disappear on host restart.

State-changing requests and WebSocket upgrades check the request origin.
Loopback is trusted by default for the tray; `trustLoopback: false` in
`createApp` also requires pairing on the host. Discovery never includes the PIN.
The six-digit PIN and LAN HTTP design are intended for a trusted local network;
do not expose the host port directly to the internet.

## Windows configuration and checks

Touchpad input uses a dedicated `/input` WebSocket; the ordinary dock socket
remains read-only. Upgrades check pairing and origin; messages and the lease
timer recheck session validity. Only one device owns the input worker at once.
Frames are limited to 8192 bytes and 240 messages/second; deltas are bounded.
The phone sends a heartbeat every 500 ms and the host expires an idle input
session after 2 seconds. The native helper independently releases buttons on
stdin EOF or a 2-second read timeout, including if the Node host disappears.
Movement is relative Win32 mouse input; it follows Windows UIPI restrictions.
Two-finger gestures sample both pointers once per frame and lock to scroll or
pinch. Zoom accepts only `{type: "zoom", steps: -8..-1 | 1..8}` and sends
Ctrl + complete 120-unit wheel notches in one native input batch. An existing
Ctrl press is preserved; partial injection releases the synthetic modifier,
with teardown retrying a failed release. Text is bounded to 1024 valid UTF-16 code
units; only named editing keys are accepted. No arbitrary shortcuts are exposed.
The helper watches UI Automation focus on a separate MTA thread while the input
session is active. It emits only opaque focus tokens, editability and password
flags, never field values. Keyboard input requires the current token and foreground
window, and is refused while physical modifier keys are held. Unicode input uses
paired Win32 KEYEVENTF_UNICODE packets, preserving emoji surrogate pairs.
Android's origin-scoped bridge opens a native IME editor. Composition remains
local until committed; each new target invalidates old input connections and
discards pending text. The web fallback has a manually opened composer.

`GET /api/input` advertises support. `POST /api/signature` accepts only black/blue
ink and up to 64 strokes / 2048 normalized points in the existing 64 KiB body
limit. The helper rasterizes validated vectors to transparent PNG. Clients cannot
supply output paths, filenames, dimensions, native commands, or arbitrary SVG.
POST /api/signature/insert uses the same validation, saves a PNG, writes PNG and
bitmap clipboard formats, and requests Ctrl+V only if foreground focus is unchanged
and no physical modifier is down. A successful paste request does not prove the
receiving app accepted an image. Otherwise the clipboard/file remain available.
Only explicit Save or Insert creates a file; strokes are kept in memory on the phone,
not persisted to browser storage or added to logs. This is image export, not
cryptographic document signing.

`scripts/verify-input.mjs` tests protocol validation, authentication, origin,
ownership, timeout/revocation cleanup, native-process handling and gestures.
`dotnet run --project native/input-tests/WinDockInputTests.csproj -c Release`
checks the native INPUT layout, button/modifier cleanup and PNG transparency/rendering
without moving the desktop cursor. It is also part of Windows CI.

The host prefers physical LAN adapters over VPN/VM adapters. Set `WINDOCK_HOST`
to choose another assigned local IPv4 address, `PORT` to change the port, or
`WINDOCK_HELPER` to select another helper executable. `WINDOCK_CONFIG` overrides
the configuration path; the normal tray uses the user's application-data folder.

Brightness uses WMI for built-in panels and DDC/CI for supported HDMI/DisplayPort
monitors, with a VCP luminance fallback. Percentages map to each display's range.
DDC/CI may need enabling in the monitor's own menu.

`WinDockHelper.exe brightness` reads support and current levels.
`node scripts/smoke-brightness.mjs` makes a five-point change and restores the
original level in a `finally` block. Add `--base-url http://127.0.0.1:8620`
to exercise the running host API. This hardware check is separate from `npm test`.

`node scripts/smoke-capture.mjs` explicitly creates a screenshot and short
recording. It is also separate from `npm test`. Captures stay on the PC and are
not served over HTTP. Recording uses one worker, main-monitor capture, silent
H.264 MP4 up to 1920×1080 / 15 fps, and a 60-minute limit.

`npm run test:installer` refuses to overwrite an existing installation or Start
menu shortcut. It tests a separate workspace installation and checks that
personal configuration is unchanged. See [Windows readiness](../WINDOWS_READINESS.md)
for the known focus-smoke failure and other hardware acceptance evidence.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public health check |
| POST | `/api/auth` | Exchange PIN for a session |
| GET | `/api/state` | Tiles, running apps, available verbs |
| GET | `/api/apps/installed` | Installed-app inventory |
| GET | `/api/apps/icon` | App icon by validated ID |
| GET / PUT | `/api/tiles` | Read or replace pinned tiles |
| POST | `/api/apps/launch` | Launch an app by ID |
| POST | `/api/apps/focus` | Focus a running PID |
| POST | `/api/apps/close` | Ask a running PID to close |
| POST | `/api/control` | Run an allowed control verb |
| GET | `/api/nowplaying` | Current media session |
| GET | `/api/stats` | CPU, memory, battery |
| GET | `/api/capture` | Recording phase, elapsed time, last saved file |
| POST | `/api/capture/screenshot` | Save the main monitor as PNG |
| POST | `/api/capture/start` | Start one silent MP4 recording; idempotent |
| POST | `/api/capture/stop` | Stop and finalize the recording |

Capture actions accept an empty JSON object and use the same authentication
and origin checks as other actions. Clients cannot choose output paths or
supply encoder arguments.

Control verbs: `volume-up`, `volume-down`, `volume-set`, `mute-toggle`,
`media-play-pause`, `media-next`, `media-previous`, `media-stop`, `brightness-set`,
`lock`, `sleep`, `shutdown`, and `restart`. `volume-set` and `brightness-set`
take integers from 0 to 100; their tiles are keyed by both verb and value.

## Windows update checks

The tray checks `https://windock.vercel.app/downloads.json` once after startup
and on **Check for updates**. `native/tray/UpdateChecker.cs` compares semantic
versions (including preview numbers) against the tray's informational version.
Only this repository's tagged installer URL is accepted. The check has a
12-second timeout and a 64 KiB response limit; startup failures are silent.
An available update shows a notification and a download menu item that opens
the GitHub release page. The app never downloads or executes an installer itself.

Run `dotnet run --project native/update-tests/WinDockUpdateTests.csproj -c Release`
for version, HTTP, invalid-feed and notification-policy checks. Add `-- --live`
after publishing 0.2.1-preview.1 to check the actual public feed for current and
older installations. Update `package.json`, `package-lock.json`, and the tray
project's numeric/informational versions together for future Windows releases.
