# WinDock Roadmap

Where the project stands, what is proven, and exactly what to do next on a
Windows machine.

**Status:** 16 of 18 acceptance gates met, 2 abandoned as hardware handoffs.
744 assertions across 14 verification oracles, all passing (`npm test`).

Everything here was built on Arch Linux. That constraint shaped the
architecture: all OS calls sit behind a provider interface, and a real Linux
provider ships alongside the Windows one so the whole stack could be run and
tested rather than merely written.

---

## Done

### Host (Node.js) — verified

| Area | What exists | Gate |
|---|---|---|
| Platform contract | Provider interface with arity-checked conformance; boot fails loudly on a bad provider | `G1` |
| Windows provider | Start Menu + registry inventory parsing, running-window enumeration, stats | `G2` `G3` |
| Launch / focus / close | argv-array dispatch to `WinDockHelper.exe`, never a shell string | `G4` |
| Control verbs | All 13 verbs mapped on both platforms, range-validated | `G5` |
| Auth | 4-digit PIN, constant-time compare, 5-strike lockout, 180-day sessions | `G6` |
| Injection defence | 10 payloads, each with a positive control | `G7` |
| Discovery | UDP responder; answers only a valid probe | `G8` |
| HTTP API | 11 routes, CSRF guard, body limits, live-server tested | `G9` |
| WebSocket sync | Snapshot on connect, broadcast on change, origin-checked upgrades | `G10` |
| Linux provider | Working dev provider (`.desktop` scan, pactl/playerctl) | — |

### PWA — verified

| Area | What exists | Gate |
|---|---|---|
| Dock | Responsive tile grid, running badges, launch/focus on tap | `G11` |
| Editing | Add, remove and reorder tiles; edit mode disables actions | `G15` |
| Control tiles | Grouped picker (Volume / Media / Display / Power); valued presets | `G15` |
| Offline shell | Service worker; `/api/` never cached; installable manifest | `G16` |
| Escaping | Host-controlled app names cannot inject markup | `G11` |

### Native sources — written, NOT compiled

| File | Purpose | Lines |
|---|---|---|
| `native/win/Program.cs` | argv interface; launch, focus, close, control, nowplaying | ~260 |
| `native/win/Audio.cs` | Core Audio `IAudioEndpointVolume` for absolute volume | ~75 |
| `native/win/Brightness.cs` | WMI `WmiSetBrightness` | ~50 |
| `native/win/MediaSession.cs` | `GlobalSystemMediaTransportControls` now-playing | ~45 |
| `native/tray/Program.cs` | System-tray host; supervises the server, shows URL + PIN | ~150 |
| `android/**/*.kt` | WebView wrapper: UDP discovery, endpoint memory | 187 |

The Android sources are unbuilt but **not unverified**: `G17` parses the Kotlin
discovery constants and drives the host's own `replyFor()` with them, so the two
implementations cannot drift apart silently.

---

## Left

### 1. Compile the Windows helpers — clears `G13`

Blocked here: `dotnet --list-sdks` is empty (runtime 10.0.11 only, no SDK).

```powershell
dotnet publish native\win\WinDockHelper.csproj -c Release -r win-x64
dotnet publish native\tray\WinDockTray.csproj  -c Release -r win-x64
```

Put `WinDockHelper.exe` beside `server.js`, then `npm start`.

Expect to fix on first compile — these have never seen a compiler:
- `Audio.cs` COM interop vtable order. The `IAudioEndpointVolume` methods must
  appear in exact interface order; the two `NotImpl` placeholders are padding for
  methods WinDock does not call. If volume-set silently does nothing, this is why.
- `MediaSession.cs` needs the `windows10.0.19041.0` target framework for the
  WinRT projection. If `Windows.Media.Control` will not resolve, confirm the TFM
  in `WinDockHelper.csproj`.
- `System.Management` (WMI) is a `PackageReference`; restore must succeed.

Then mark `G13` met in `GATES.md` and replace the `ABANDON: G13` line.

### 2. Build and run the Android app — clears `G14`

Needs JDK 17 + Android SDK.

```sh
cd android && ./gradlew assembleDebug
```

Not yet present: launcher icons (`res/mipmap-*/ic_launcher.png`), a Gradle
wrapper (`gradlew` + `gradle-wrapper.jar`), and a release signing config.
Generate the wrapper with `gradle wrapper` once, and keep keystore values
external — never commit them.

The PWA is installable today without the APK: open the host URL and choose
**Add to Home Screen**.

### 3. Verify on real hardware

Nothing below has run against actual Win32:

- [ ] Start Menu inventory returns real apps (parsing is fixture-proven only)
- [ ] `SetForegroundWindow` actually raises a window — the `AttachThreadInput`
      dance is the documented workaround, but Windows foreground rules are
      strict and this needs a real test
- [ ] Media keys reach the active player via `keybd_event`
- [ ] Absolute volume works through Core Audio
- [ ] Brightness on a real panel (WMI works on laptops/AIOs; most desktop
      monitors on HDMI/DP do not expose it and will fail cleanly)
- [ ] Now-playing reports a real session
- [ ] Phone → PC launch and focus over the LAN, end to end
- [ ] UDP discovery across a real router (some APs block broadcast)

### 4. Known gaps worth closing

- **App icons.** `apps.js` in the original Dokke extracted real icons; WinDock
  currently renders a letter glyph. `ExtractIconEx`/`SHGetFileInfo` → PNG, served
  from a cached `/api/icon/:id`, is the natural addition and the single biggest
  visual upgrade.
- **Brightness feedback.** Tiles set absolute values but nothing reads current
  brightness or volume back, so the UI cannot show a slider position.
- **HTTPS.** The host is plain HTTP. iOS PWAs require HTTPS for some features;
  a self-signed cert or Tailscale would address it.
- **Tray polish.** `WinDockTray` uses a stock icon and has no autostart option.
- **Drag to reorder.** Editing uses ◀ ▶ buttons — deliberate, since drag on a
  touch grid is fiddly, but drag would be nicer on a tablet.

### 5. Deliberately out of scope for v1

Discussed and set aside, not forgotten. The tile model and control-verb
allowlist already accommodate them without rework:

- Macro / multi-action tiles (Stream Deck style)
- Phone as remote keyboard and trackpad
- Live CPU/RAM/GPU monitoring widgets
- Multi-host control from one phone

---

## Picking this up on Windows

```powershell
git clone <this repo>
cd WinDock
npm install
npm test          # should print SUITE OK — 14 oracles, 744 assertions
npm start         # selects the Windows provider automatically
```

`npm test` passing on Windows is itself informative: it proves the parsing,
auth, discovery, sync and PWA layers survive the platform change before any
native code is involved.

The acceptance ledger is `GATES.md`. To re-run it:

```powershell
node <path-to-unlazy>\scripts\gate-check.mjs --status GATES.md
```

`--status` never executes anything. Read every `CHECK:` line before approving
execution with `--approve`.
