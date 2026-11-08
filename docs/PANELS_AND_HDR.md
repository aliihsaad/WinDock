# Simplified panels and HDR feedback

Local preparation, 1 November 2026, on `play-store-integration-v0.2.6`.
No commit, push, release, production deployment, or signing-key changes.

**Installed locally after owner approval (1 November, 23:15):** the updated
Windows companion is running on this PC. All 19 current tiles (including order
and contents), pairing identity/session files, desktop shortcut, and sign-in
startup preference are preserved. The current phone APK can remain installed.

## Behavior

- Swipe down: the notch expands into compact Files & Media (native Android only),
  Touch & sign, Capture, and Power shortcuts, above live brightness and volume
  sliders and a music card.
- Power opens a separate sheet. Lock, Sleep, Restart, and Shut down retain
  their existing confirmations, capability filtering, and server authorization.
  Back/Escape closes the top sheet and returns to quick controls.
- Swipe up: Apps, Appearance, Edit dock, Updates. Edit dock retains tile editing.
- Fullscreen remains in browser Appearance; native Android hides it because the
  app already hides system bars. Existing Android keyboard bridges are recognized.
- Updates uses a download-to-tray icon. Update checks and installation behavior
  are unchanged; no speculative update badge or new polling was added.
- A successful Windows brightness request can show an amber toast:
  “Command sent. HDR may prevent the brightness from changing.” It appears only
  when the host reports active HDR. Real failures retain red error feedback.
  The laptop/external-display failure text now describes both kinds of display.

## Implementation and compatibility

Shared UI: `public/app.js`, `dock.js`, `index.html`, `icons.js`, `style.css`;
browser shell cache bumped to `windock-v26-quick-controls` in `public/sw.js`.
Android loads this UI from the companion: **no new APK is required** for this change.

`native/win/DisplayColor.cs` reads active display paths with Windows DisplayConfig.
It queries GET_ADVANCED_COLOR_INFO_2 (HDR versus SDR/WCG) and falls back to the
legacy advanced-color structure. A hot-plug buffer race retries at most three
times. Unsupported/failed queries return unknown; they cannot turn a successful
brightness request into failure. No display-setting API is called. The warning
is advisory if any active display reports HDR; it does not identify which monitor
visibly changed, and a DDC readback alone cannot establish that.

`native/win/Program.cs` adds `hdrActive` JSON after successful brightness commands
and to the read-only `brightness` diagnostic. Existing WMI/DDC brightness routing
in `Brightness.cs` is unchanged. `src/platform/windows.js` accepts empty legacy
helper output and emits only the recognized `hdr-active` marker. `server.js`
whitelists that marker only for brightness. Request shape, authentication, and
endpoints are unchanged. Older clients ignore the additive response field; newer
UI works with older hosts that return only `ok` and `verb`.

No changes to pairing, certificates, discovery, Wi-Fi/USB transport, file transfers,
clipboard, keyboard/IME voice input, capture, update mechanisms, or Linux control
routing. HDR state is not stored or sent to a third party. Native Windows HDR
diagnostics require the updated helper; this warning is not a Linux HDR detector.

API references:
- [Microsoft DisplayConfig device info types](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ne-wingdi-displayconfig_device_info_type)
- [Microsoft SDK wingdi.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/wingdi.h)
- [Microsoft GetMonitorBrightness](https://learn.microsoft.com/en-us/windows/win32/api/highlevelmonitorconfigurationapi/nf-highlevelmonitorconfigurationapi-getmonitorbrightness)

## Validation

- Full Node suite: **35/35 passed**, including Windows/Linux providers, API,
  authentication, managed HTTPS, discovery, reconnection, clipboard, files,
  editing, updates, and controls. Control suite: **141 assertions**; API: **77**.
  Log: `artifacts/panels-node-tests.txt`.
- Native display tests: **21 assertions**, covering SDK layout sizes/offsets,
  HDR/SDR/WCG decoding, unknown states, and mixed-display aggregation.
  Live read-only DisplayConfig smoke reports HDR false on this PC with HDR off.
  Log: `artifacts/panels-native-display.txt`.
- `scripts/panels-browser-check.js`: **31 passed**, including Android/browser
  differences, all four power confirmations, simulated HDR/error/legacy responses,
  Android Back semantics, native Files bridge, and 844×390, 640×320, 568×320 layouts.
  Log: `artifacts/panels-browser-tests.txt`.
- `scripts/quick-controls-browser-check.js`: **39 passed**, including actual
  Chromium touch gestures, paging, editing, input/capture, reduced motion, and
  performance mode. Log: `artifacts/panels-gestures.txt`.
- Existing website regression: **64 passed**; setup guide: **72 passed**.
  Logs: `artifacts/panels-website-regression.txt`, `panels-setup-guide.txt`.
- Windows companion build succeeded. Packaged changed runtime assets match source;
  no private keys, signing stores, or user config/identity/session files found in
  the package. The installed companion was left running during build validation;
  the owner subsequently approved the local update recorded above.
- Local installer compilation succeeded; output copied to
  `artifacts/WinDock-panels-local-test-Setup.exe`. Subsequent installation over the
  live app succeeded without a Windows restart. Logs:
  `artifacts/panels-installer-build.txt`, `artifacts/panels-local-install.log`.
- Post-install checks: 18 installed runtime files match the built package;
  all 5 saved-state files retain their pre-update hashes; live dock contents and
  public CA/host identity match exactly; managed HTTPS validates using the existing
  CA and hostname. HTTP/HTTPS listen on 8620/8621. Tray PID 49464, server PID 50068
  at validation. Results: `artifacts/panels-install-result.json` and
  `artifacts/panels-install-live-check.json`.
- Private rollback backup:
  `C:\Users\Mini\AppData\Local\WinDockBackups\before-panels-20261101-231307`.
  Contains the old installed app and exact live state, restricted to the current
  user and SYSTEM. A redirected tool view showed an older 15-tile dock/different
  CA; this was caught before stopping the host. Backup/install were executed via
  Windows' native process service against the verified live 19-tile state. No
  state migration, reset, or key replacement was needed.
- Packaged read-only brightness diagnostic returned valid JSON, HDR false, and
  no controllable displays (exit 2) at this check. The previously installed helper
  also returned zero displays/exit 2 in the same session. This is not evidence of
  a new brightness regression, nor a passing physical brightness test. No monitor
  brightness or HDR setting was changed by automation.

Browser fixtures simulate native bridges and PC actions; they do not replace
physical-device acceptance. No Android build was needed, and no new Linux binary
or deployment was made for these shared UI changes.

## Local acceptance

**Owner-reported pass:** after installation, the owner replied “all checks” to
the three requested checks: reopen the existing Android app and reconnect,
test the new swipe-down/swipe-up panels, and test the HDR warning. Recorded as
acceptance of those checks on the current setup. This is user-reported physical
testing, not an additional automated run. No phone model was specified in this
confirmation; it does not establish Windows 10, mixed-monitor, or Linux coverage.

On this PC, the update is already installed: close and reopen the Android app.
For another local installation, use `artifacts/WinDock-win-x64` or the prepared local
installer `artifacts/WinDock-panels-local-test-Setup.exe`. Quit the existing tray
app before updating it; retain its existing app data and paired identity. Reopen
WinDock on the phone after the companion restarts. Keep the existing APK.

1. Check both swipe directions, Edit dock/Done, Updates, and Appearance. Native
   Android must not show Fullscreen; browser Appearance must still offer it.
2. Open each shortcut. Confirm Android Back returns Power → controls → dock.
   Cancel each power confirmation; cancellation must not affect the PC.
3. Check keyboard voice typing, clipboard, capture, file transfers, tile launch,
   and reconnection over the already tested Wi-Fi and USB paths.
4. With HDR off and the display awake, test brightness 25/50/100 and compare the
   monitor's physical menu and visible result. Expect ordinary success or a useful
   real failure. Then optionally enable HDR in Windows and repeat: a successful
   command should show the amber advisory. Restore the preferred HDR setting.
5. A Windows 10/older-driver live fallback check and mixed HDR/SDR-monitor check
   remain pending; decoding/aggregation are covered by deterministic tests.

## Issue #52

[Diagnostic request posted as aliihsaad](https://github.com/aliihsaad/WinDock/issues/52#issuecomment-6562109651)
using GitHub CLI, without the GitHub connector or attribution prefixes.
Requested desktop/Windows versions, exact laptop model, connected monitors/docks,
HDR status, working WMI command, and read-only helper output. The laptop issue
remains open and is not claimed fixed. The owner's external Samsung monitor was
previously confirmed to work with HDR off; that does not establish the laptop's
root cause. Setup & help now documents the panel changes and HDR troubleshooting.

Broader device acceptance, the pending laptop diagnostics, and the existing Google Play
signing/listing/device-test gates remain separate from these passing local checks.

### Reporter follow-up reviewed on 3 November 2026

Read [the reporter's reply](https://github.com/aliihsaad/WinDock/issues/52#issuecomment-6569837098) using GitHub CLI. They report desktop `0.2.6-preview.1`, an Omen 16 with Ryzen 7840HS/RTX 4050, and only the built-in screen. Crucially, they clarify that **WinDock changes the laptop brightness successfully, but the phone displays the error afterward**. Their settings screenshot shows HDR games/apps unsupported; HDR video streaming is a separate setting and does not establish the external-monitor HDR problem seen on the owner's PC.

The supplied helper diagnostic lists one WMI-controlled display at 50 percent and exit code 0. That command was `brightness` (read-only), not `control brightness-set`, so it does not establish the setter's return code or elapsed time. The report now concerns erroneous failure feedback after an observed brightness change, rather than absent WMI support.

`native/win/Brightness.cs` already uses WMI and is unchanged from this branch's release baseline. Its setter counts accepted/rejected attempts and returns false if no attempt succeeds or any counted attempt fails. `Program.cs` then exits 2. The Windows provider also maps process execution failure (including timeout) to the same user-facing brightness error; the shared execution ceiling is 20 seconds. The existing evidence cannot distinguish these paths. Microsoft's WmiSetBrightness documentation defines 0 as success; do not simply ignore a nonzero result or change the aggregate success rule without establishing which condition occurs on the reporter's hardware.

Next diagnostic: have the reporter run the installed helper's `control brightness-set 50` once in normal PowerShell, capturing stdout/stderr, exit code and elapsed seconds, and confirm whether brightness visibly changes. Explain that this command changes brightness to 50 percent. Ask them to redact personal paths/hardware identifiers; no PIN, QR, credentials or full system logs are required. This follow-up is prepared locally, **not posted**. No application changes or new tests were made for this read-only investigation; no root cause or fix on the Omen is claimed yet.

### Version scope clarified after owner feedback

The reporter has only tested public **`v0.2.6-preview.1`**; the observed laptop issue is **not reproduced on the current unreleased build**. Verified the public release tag through GitHub CLI: commit `24500ac3beb95a8758c4a54511479d6c499aca00`. GitHub's `Brightness.cs` blob is `09b76931c33d5f2f82517f519adcd38070ae1fec`, identical to the normalized working-copy blob. The release tag and integration baseline `c247264` also have no differences in Brightness.cs, Program.cs, Windows provider, process wrapper, app.js or server.js, validating the earlier baseline comparison for these files.

The current brightness-specific changes add HDR reporting/warning and laptop-aware failure wording. Native success/failure accounting, request serialization and the default 20-second helper execution timeout are retained. Other UI/transport changes exist, so identical core logic does not prove identical end-to-end behavior on the Omen. Status: confirmed report against public 0.2.6; current-build reproduction unknown; no confirmed fix for this symptom. A controlled current-companion retest on the affected laptop would establish current-build relevance; a timed setter diagnostic can distinguish native failure from timeout. Do not claim the new preview fixes the report or change brightness behavior speculatively. No test build was distributed and no issue reply was posted during this comparison.
