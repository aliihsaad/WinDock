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
The four-digit PIN and LAN HTTP design are intended for a trusted local network;
do not expose the host port directly to the internet.

## Windows configuration and checks

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
