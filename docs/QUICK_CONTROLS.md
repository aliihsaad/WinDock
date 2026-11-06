# Swipe-down quick controls — local test preparation

**1 November follow-up:** See [PANELS_AND_HDR.md](PANELS_AND_HDR.md) for the
simplified panels, Edit dock label, Android fullscreen visibility, Updates icon,
and contextual HDR feedback. The implementation notes below describe the earlier build.

**Current update:** The reserved top island remains. Dedicated Voice to PC was
removed at the owner's request; keyboard voice typing remains. Files & Media is
now in the curtain. See [FILES_AND_MEDIA.md](FILES_AND_MEDIA.md) for the current
APK/companion and validation. The checks below describe earlier builds.

31 October 2026, `play-store-integration-v0.2.6`. No publication or production
signing operations. This extends the already tested managed HTTPS/QR companion.

## Behavior

- Swipe down on the main dock to open Quick controls directly. Begin inside
  WinDock rather than Android's status-bar edge. The existing swipe-up drawer
  and sideways page navigation remain available.
- In immersive mode, tap or pull the small integrated island at the top.
  The trigger is hidden while arranging tiles and before pairing. Standard
  mode retains its footer Controls button. Controls, Capture and Touch & sign
  have been removed from the swipe-up drawer; the curtain is their single home.
- The panel opens from the top. Sound, playback and brightness appear in one
  row on wider landscape phones; the contents scroll on short/narrow displays.
  **Touch & sign** and **Capture** open the existing screens directly. The updated
  Android app now exposes **Files & Media** here.
- Swipe up on the panel's bottom handle, tap Close, use Escape in a browser,
  or use the existing Android Back behavior to dismiss. Power commands still
  require the existing confirmation. The native Android Back handler is unchanged.
- Touchpad, signature, keyboard, clipboard and scrollable panels do not listen
  for the dock's curtain gesture. Tile drags/long presses do not open it. A swipe's
  generated click is suppressed so it cannot activate a tile or control.
- Existing performance mode and reduced-motion preferences disable the entrance
  animation. No new dependency, permission, transport endpoint or background
  activity is introduced.

## Scope and compatibility

Five shared UI files changed: `public/app.js`, `public/dock.js`,
`public/index.html`, `public/style.css`, `public/sw.js`. Control rendering still
filters the host's advertised verbs and destructive-action setting. Actions
use the same `activate()` flow and API payloads. The web shell cache version is
bumped to `windock-v22-quick-controls` for browser clients. Managed Android
already loads host assets without a service worker.

The native tray/helper, server protocol, pairing/session identity, TLS lifecycle,
clipboard protocol, updater and Android APK are unchanged by this enhancement.
No Android rebuild or reinstall is needed. The local website demo is regenerated
from the same shared UI; nothing was deployed.

## Validation

- `node test/run.mjs`: **33/33 oracles passed** on the final code, including
  controls, input, clipboard, folders, pairing/TLS, discovery, updates and Linux
  adapters. Log: `artifacts/quick-controls-regression.log`.
- `scripts/quick-controls-browser-check.js`, run through Playwright CLI:
  **34 checks passed** with actual Chromium touch events. Covers downward/open,
  upward/dismiss, sideways paging, cancelled/horizontal handle gestures, tile
  arrangement, no accidental activation, accessibility state, power confirmation,
  input/capture shortcuts, touchpad isolation, reduced motion, performance mode,
  and 844×390 / 640×320 landscape layouts. No runtime exceptions and no real
  PC API requests. Uses only the in-memory demo.
- Existing `scripts/website-release-browser-check.js`: **64 checks passed**,
  including demo clipboard, capture, signature, PC switching and responsive UI.
  Log: `artifacts/quick-controls-website.log`.
- New local package: the five updated UI assets match source; native executables,
  server, managed TLS and session modules match the previously accepted package.
  No private keys/config/session state bundled. Launcher preflight and isolated
  packaged-tray startup/shutdown smoke passed. The user's live companion stayed
  running unchanged throughout validation.
- Rendered screenshots inspected in `output/playwright/quick-controls-phone.png`
  and `quick-controls-short-phone.png`. Test selectors were corrected to choose
  one tile and the visible touchpad Back button; these were harness corrections.

Repeat the browser checks with the local preview running:

```powershell
node scripts/website-server.mjs
# In another terminal, with the existing Playwright CLI available:
npx --no-install --package @playwright/cli playwright-cli -s=windock-curtain open http://127.0.0.1:4173/demo/index.html
npx --no-install --package @playwright/cli playwright-cli -s=windock-curtain run-code --filename=scripts/quick-controls-browser-check.js
```

## Local phone acceptance

Prepared separately in `artifacts/WinDock-quick-controls`; the running
`artifacts/WinDock-native-pairing` package is not overwritten. Quit the current
tray, then run the new folder's `Start-SecureTest.ps1`. It reuses the existing
`%LOCALAPPDATA%\WinDock-LocalTest-20261031\config.json` and private identity.
Close/reopen WinDock on the phone to load the new UI; do not reset pairing.

Pending physical checks: swipe down from the dock, tap the top Controls button,
adjust volume/playback, dismiss with the handle and Android Back, and open
Touch & sign to confirm ordinary typing/mouse input still feels right. Chromium
touch emulation and existing Android Back code are not physical Huawei acceptance.

No commit, merge, push, upload, deployment, publication or production signing-key
change is authorized by this work. Remaining Play release gates are unchanged.
