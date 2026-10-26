# Developer reference

## Architecture

The Android app is a Kotlin WebView host: it discovers the PC by UDP broadcast,
remembers the endpoint, and loads the same web interface served to browsers.
The web interface handles pairing; the Android wrapper does not receive the PIN
or session cookie. Ordinary browsers do not perform UDP discovery.

The Node host owns pinned tiles and publishes updates over WebSocket. Platform
providers implement a common contract. The Windows provider invokes a C# helper
for app identity, launch, focus, icons, media, brightness, and screen capture.
The Linux provider targets Hyprland and uses standard desktop tools, plus a
small Rust helper for the touchpad, phone keyboard and signatures (see
[Linux host](#linux-host)).

| Path | Responsibility |
| --- | --- |
| `server.js` | HTTP API, static serving, provider wiring |
| `src/platform/` | Provider contract, Windows/Linux implementations, capture lifecycle |
| `src/auth.js` | PIN pairing, sessions, lockout |
| `src/config.js` | Atomic tile persistence |
| `src/discovery.js` | UDP responder |
| `src/sync.js` | WebSocket updates |
| `src/input-hub.js`, `src/input.js` | Exclusive touchpad channel, bounded input/signature validation |
| `src/platform/input.js` | Bridge to the persistent touchpad helper and signature export process (Windows and Linux) |
| `src/platform/linux-input.js` | Linux input helper path and signature folder |
| `public/` | Shared dock UI and offline shell |
| `android/` | Discovery, validated endpoints, landscape WebView |
| `native/win/` | Windows helper |
| `native/linux/` | Linux input helper (`windock-input`, Rust) and its udev rule |
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

## Linux host

`npm start` on Linux serves the same dock. The provider is built for Hyprland;
on other desktops the running-app list is empty and focus/close are refused.

| Feature | Uses |
| --- | --- |
| App inventory | `.desktop` entries in `$XDG_DATA_HOME` and `$XDG_DATA_DIRS` (user entries win) |
| Launch | `gtk-launch <desktop id>`, detached; parsed `Exec=` argv if gtk-launch is missing |
| Running apps, focus, close | `hyprctl clients -j`; guarded `hyprctl eval` (Lua configs) or `hyprctl dispatch` |
| Media and now playing | MPRIS over the session D-Bus with `busctl` |
| Volume | `pactl` (PulseAudio or PipeWire) |
| Brightness | `brightnessctl` with a backlight device, otherwise `ddcutil` (DDC/CI) |
| Power | `loginctl lock-session`, `systemctl suspend/poweroff/reboot` |
| App icons | Icon theme from `gsettings`, its `Inherits` chain, `hicolor`, then `pixmaps` |
| Screenshots | `grim` on the focused monitor → `Pictures/WinDock` |
| Recordings | `wf-recorder`, else `gpu-screen-recorder` → `Videos/WinDock` |
| Touchpad | `windock-input`: a uinput virtual pointer (any compositor) |
| Phone keyboard | Text with `wtype`; named keys on the `windock-input` uinput keyboard |
| Keyboard auto-open | AT-SPI2 focus events plus Hyprland's active window |
| Signatures | PNG rendered by `windock-input` → `Pictures/WinDock/Signatures`; insert uses `wl-copy` |

- Apps launch detached with no inherited pipes, so they outlive the request
  and the host.
- Hyprland applies focus and close to the active window when a selector
  matches nothing. With a Lua config the existence check and the dispatch run
  in one `hyprctl eval`; with a hyprlang config the window list is re-read
  immediately before dispatching.
- Windows map to dock apps by `StartupWMClass`, desktop id, Chromium web-app
  host (`chrome-<host>__…` classes) or binary name. Web apps share the browser
  pid, so focus/close requests carry the app id as well as the pid.
- Theme SVG icons are served with a sandboxing Content-Security-Policy.
- Capture refuses to start while the display sleeps (screencopy produces no
  frames). `gpu-screen-recorder` startup errors count as a failed start because
  its KMS capture can run without producing frames.
- Not yet on Linux: tray icon, autostart.

### Background service

The packaged `windock` command (`src/platform/linux-cli.js`) runs the host as the
systemd user service `windock.service` (`native/linux/packaging/windock.service`),
so it outlives the terminal window that opened it.

- Before starting the service, `windock` writes the session's display, Hyprland,
  search-path and WinDock variables to `$XDG_RUNTIME_DIR/windock-session.env`.
  A host started for another Hyprland instance is restarted for the current one.
- The service entry (`src/platform/linux-service.js`) publishes the address and
  PIN in `$XDG_RUNTIME_DIR/windock/host.json` (mode 0600). systemd removes it when
  the service stops. `windock`, `windock status` and the connection window read it;
  the journal gets the address but not the PIN.
- Inside the service, apps start through `systemd-run --user --scope`, each in
  its own scope, so stopping or restarting the host leaves them running.
- `windock stop` stops the service; **S** in the connection window does the same.
  A host already answering on the port in a terminal window blocks a second one.
- Without a user manager or the installed unit, and with `windock --foreground`,
  the host runs in the terminal as before.
- Package upgrades restart each user's running service, and removal stops it
  (`/usr/lib/windock/user-service`, called from the Debian and Arch scripts).

### Touchpad, keyboard and signatures

`windock-input` (`native/linux`) speaks the Windows helper's JSON protocol over
stdin/stdout, so the input hub and the phone UI are shared. Build it with Rust
installed (`pacman -S rust`), then check what it can reach:

```bash
npm run build:linux
```

```bash
./windock-input check
```

`check` creates nothing and types nothing. `npm run test:linux` runs the
helper's unit tests; `npm test` also exercises the built binary's PNG export
when `./windock-input` exists. `WINDOCK_INPUT_HELPER` points the host at
another build.

Requirements:

- **uinput access.** `/dev/uinput` is root-only by default. The shipped rule
  tags it `uaccess`, so the user logged in at the seat gets an ACL that lets
  them create input devices but not read any keyboard. Adding the user to the
  `input` group would also let every program they run read every keyboard, so
  WinDock does not ask for that. Without the rule the touchpad fails to start
  and the host logs which rule to install:

  ```bash
  sudo install -m 644 native/linux/70-windock-uinput.rules /etc/udev/rules.d/
  ```

  ```bash
  sudo udevadm control --reload-rules && sudo modprobe uinput && sudo udevadm trigger --name-match=/dev/uinput
  ```

  Until the `uinput` module is loaded, `/dev/uinput` is only a static node
  that udev cannot match, so load it once by hand. From the next boot on,
  `static_node=` applies the ACL before the module loads, and opening the
  device loads it.

- **wtype** for typed text, **wl-clipboard** for signature insertion.
- **at-spi2-core** for opening the phone keyboard automatically. This is best
  effort. GTK apps report focus. Qt apps report it only when accessibility is
  switched on (`gsettings set org.gnome.desktop.interface toolkit-accessibility true`).
  Chromium and Electron report it only with renderer accessibility enabled,
  and apps they start inherit `NO_AT_BRIDGE=1`, which silences GTK. Most
  terminals report nothing. AT-SPI only announces focus changes, so a field
  that already had focus when the touchpad opened counts as unknown until
  focus moves. When focus is unknown the phone's keyboard button still works,
  typing into the active window.

Behaviour, compared with the Windows helper:

- The pointer is relative REL_X/REL_Y with left/right buttons. Scroll uses
  REL_WHEEL_HI_RES/REL_HWHEEL_HI_RES, which use the same 120-per-notch unit
  as Windows wheel data, plus whole REL_WHEEL notches. Zoom is Ctrl plus whole
  wheel notches. Ctrl, the wheel and the release are separate writes 20 ms
  apart, because Hyprland handles a batch's pointer events before its key
  events, so a single batch reaches the app as an unmodified scroll.
  The device is also a keyboard, used only for Ctrl, V and the named keys.
- Held buttons are released on `release`, on stdin EOF and after 2 seconds
  without a line. Removing the device on exit also makes libinput release
  anything still held, even after a crash.
- Text goes to `wtype -` over stdin, never argv, because other users can read
  process arguments. wtype uploads a keymap for exactly the symbols it types,
  so emoji and any script work regardless of layout.
- Named keys (only the `validateInput` allowlist), line breaks and tabs in
  text, and Ctrl+V are pressed on the uinput keyboard. Their evdev codes mean
  the same in every common layout. Through an input method such as fcitx5,
  key presses from wtype's virtual keyboard reach GTK apps but take no
  effect (BackSpace and Ctrl+V did nothing in testing), while a uinput key
  behaves like a physical one. Ctrl+V uses the key in the V position, so on
  Dvorak-style layouts insert may paste nothing; the PNG is still on the
  clipboard.
- Focus tokens are counters. The helper never reads a field's name, value or
  selection, only the AT-SPI role and state bits, and an AT-SPI focus counts
  only when its process owns Hyprland's active window. Keyboard input needs
  the current token, and the same window must still be active at the moment
  of typing. Unlike Windows, held physical modifiers cannot be detected
  without reading every keyboard, so they are not checked.
- Hyprland is only asked which window is active (`j/activewindow` on its
  socket). The helper never dispatches.
- Signatures are validated again, rendered to a transparent 1600×600 PNG
  (mode 0600) in the Pictures folder from `user-dirs.dirs`, and named with a
  timestamp and random suffix. Insert copies the PNG with
  `wl-copy --type image/png`, waits until `wl-paste --list-types` shows it,
  then sends Ctrl+V on a short-lived uinput keyboard (wtype without uinput
  access) only if the window that was active at the start is still active.
  Otherwise the PNG stays on the clipboard and on disk. A modal dialog in the
  target app can swallow the paste while `pasteRequested` is still true.

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
| GET | `/api/updates` | Installed PC version and last update-check result; no external request |
| POST | `/api/updates/check` | Check the fixed public HTTPS release feed; empty JSON body, paired and same-origin |
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

### Pairing recovery and older clients

The host now requires a six-digit PIN. If an older open phone page still accepts
only four digits, its pairing response tells the user to close and reopen the
app. Neither that legacy input nor any malformed PIN consumes the failure budget.
Only incorrect six-digit guesses count.

The phone shows the remaining wait and whether the pause affects that device or
all new pairing. On Windows, **Allow pairing now** in the tray menu clears the
host-wide pause and recent failure budget. It preserves individual device
lockouts and existing sessions; the PIN does not change.

For a host without a tray, run this on the PC (use its configured port):

    curl --request POST http://127.0.0.1:8620/api/pairing/reset \
      --header 'X-WinDock-Local-Action: allow-pairing' \
      --header 'Content-Type: application/json' --data '{}'

This endpoint requires a loopback connection, a loopback Host, the explicit
native-action header, no Origin or Sec-Fetch-Site header, and an empty JSON
object. Paired phones and browser requests cannot use it.

Custom WINDOCK_ALLOWED_HOSTS entries are comma-separated names, optionally with
a port or trailing DNS dot. Unknown names receive HTTP 421 with configuration
guidance. Only exact localhost has implicit name-based loopback trust;
subdomains require explicit allowlisting and still require pairing.

### Update screens (development builds)

The dock drawer and Appearance both open Updates. PC checks use the paired
host API; opening the screen only reads local status. A manual check fetches
https://windock.vercel.app/downloads.json with a 12-second deadline, a 64 KiB
limit, no redirects and no pairing credentials. Concurrent requests share one
fetch; successful results are reused for 30 seconds. Failures remain explicit
and can be retried. Windows startup notifications and the tray check still work;
the connection window now also offers Check for updates.

Android's native Updates screen is available before connecting, and through the
dock after connecting. It uses the same HTTPS feed with its own bounded request
and opens only this repository's release pages in an external browser. The feed's
android.versionCode and android.versionName describe the actual APK, separately
from the overall release tag. Without those fields, only a feed matching the
installed release can confirm current status; newer releases fail closed.
The packager extracts both fields from the APK with Android SDK aapt, including
when an existing APK is reused. Set ANDROID_HOME or ANDROID_SDK_ROOT if needed.

Keep package.json releaseVersion aligned with the Windows tray's
InformationalVersion when preparing a release. Native Android versionCode must
increase whenever shipping a changed APK. Published 0.2.4 binaries do not contain
these new screens; building the branch is required until the next release.

npm test includes update feed/authentication/network/UI-state regressions.
Android UpdatesTest exercises the native current/available/failure/retry states
and a live check on an emulator. All downloads and installations remain manual.
