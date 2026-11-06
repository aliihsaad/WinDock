# Files & Media — local implementation and validation

31 October 2026. Branch `play-store-integration-v0.2.6`. Uncommitted local work;
no deployment, publication, Play upload, or production signing operation.

## Implemented behavior

- Android: Files & Media in the swipe-down controls curtain and connection screen.
  Review photos, videos or documents selected through the system picker, or use
  another app's Share → WinDock. Both single and multiple content-URI shares work
  through the same review screen; sending always requires an explicit action.
- Photos/videos use the system Photo Picker on API 33+; documents and the fallback
  on older devices use `ACTION_OPEN_DOCUMENT`. No broad storage permission,
  microphone permission, transfer service, or notification permission is added.
- Selection, per-file status, total progress, cancellation, completion, and useful
  connection/storage/provider errors appear in the native Android panel. Unknown
  file sizes show indeterminate progress. Selection handles remain while connecting
  and in activity saved state; expired provider grants require selecting again.
- Windows: tray → Files & Media opens native receive settings, progress/receipts,
  Cancel selected batch, destination picker, and explicit Open folder. Tray balloons
  report incoming/completed/failed batches without exposing filenames.
- Linux: `windock files` opens the loopback-only receive dashboard. The existing
  host receives files using the same Node implementation; `notify-send` notifications
  are best effort. `xdg-open` opens the configured folder only on an explicit action.
- Securely paired phones can send immediately. Only the computer can disable
  receiving or change the destination. Default: the user's Downloads/WinDock
  (XDG Downloads on Linux). There is no remote file browser or arbitrary PC path API.

## Transport and storage contract

`FileConnection.kt` derives a dedicated streaming client from `SecureTransport`'s
existing certificate trust, host identity, DNS routing and private session cookie.
The manually configured HTTPS path uses existing Android trust and its HTTPS
session. Neither path accepts redirects or disables TLS verification. HTTP clients
cannot transfer files, but their existing control protocol remains available.

`server.js` adds `/api/transfers` to the existing listeners. Remote transfer routes
require real TLS, a valid authenticated session, existing Host/origin checks, and
batch ownership. Session authorization is checked during upload and verification.
Local receive settings require a loopback peer, loopback Host, same-origin request,
and the explicit local-control header; a paired phone cannot change them.

`src/transfers.js` bounds each batch to 50 files / 32 GiB, each file to 8 GiB,
four pending batches and two concurrent uploads across clients. Android sends one
file at a time. Both ends use 64 KiB streaming buffers and incremental SHA-256;
the receiver verifies the staged disk bytes before publication. Cloud content is
read through its selected provider without making another complete phone copy.

Partial files have fixed random-ID names inside private `.windock-incoming`
staging. Incoming names are sanitized for Windows and Linux, including separators,
reserved names, control/bidi characters and length. Symlink destinations are
rejected. No file is automatically opened or executed. Final publication uses an
exclusive hard link, preserving existing files and adding ` (1)`, ` (2)`, etc.
**The chosen destination must support hard links (for example NTFS or ext4).**
FAT/exFAT and some network shares can fail safely; choose a compatible local folder.

Space is checked before the batch and periodically while streaming; OS out-of-space
errors are handled too. Uploads time out after 30 seconds without progress or one
hour overall. Verification allows five minutes on Android. Large files on very slow
devices/networks may require a smaller selection. The 8 GiB limit is a safety cap,
not a claim that physical-device 8 GiB performance has been accepted.

Transfers are foreground-only. Leaving WinDock or losing the connection cancels
the active request. Completed files remain on the PC. Explicit Retry/check status
reuses the batch/file IDs and verifies receipts, skipping files already completed;
there is no automatic retry/resume and no automatic new batch after uncertainty.
Cancellation concurrent with final publication may leave a completed file; the
receipt distinguishes that from an interrupted file. Receipt recovery handles a
restart or lost response around publication without blindly duplicating the file.

Private bounded receipts retain names, sizes, hashes, destination, and a hash of the
authorization session for up to 24 hours (64 batches / 500 files). Partial files are
cleaned on cancellation/failure, next host startup, or after ten minutes inactive
(checked once a minute). Saved files are not deleted when receipts expire. Only
WinDock's fixed-ID staging files are cleaned. If the host is stopped, startup does
the deferred cleanup. After receipt expiry or lost phone selection state, inspect
the destination before beginning a new batch to avoid intentional duplicate copies.

## Compatibility and Voice to PC removal

The dedicated SpeechRecognizer feature, microphone permission, voice UI/bridge and
dictation-only helper/protocol changes are removed. `RemoteKeyboard`, IME committed
text/composition, keyboard microphone dictation, clipboard, touchpad, signature,
capture, app/folder tiles, playback, pairing and updater behavior remain. The top
island and simplified controls curtain remain; Files & Media replaces the voice
shortcut. No new library or version increment was introduced for this feature.

Package ID remains `com.windock.app`, version code 10 / `0.3.0-preview.1`, minimum
API 24 and target API 36. The local APK uses the existing debug signer. It is not a
Play release candidate. The approved Play build still requires a secure companion;
older HTTP-only desktop versions do not gain file reception. Older Android clients
retain existing controls against the new desktop and simply lack the new native
Files action. Linux Rust input code is unchanged by this feature.

## Source and tests

- Android: `NativeFiles.kt`, `TransferRules.kt`, `FileConnection.kt`, `MainActivity.kt`,
  `SecureTransport.kt`, manifest and connection layout; `FilesTransferTest.kt` and
  a separate synthetic sharing app/provider in the instrumentation APK only.
- Host: `src/transfers.js`, `src/transfer-desktop.js`, `server.js`, Linux CLI/XDG;
  `native/tray/TransferWindow.cs` and tray event integration.
- Shared UI: `public/files*`, Files curtain action/icon, service-worker cache v24.
- `scripts/verify-transfers.mjs`: real authenticated local TLS, auth/origin/ownership,
  traversal/reserved/Unicode/long duplicate names, integrity, collision/retry/restart,
  cancellation/revocation/disable midstream, space failures, size bounds, symlinks,
  unknown-length/empty/binary/multiple files and a streamed 64 MiB synthetic file.
- `scripts/files-browser-check.js`: selection entry, no voice/duplicate controls,
  desktop settings/cancel/progress, safe filename rendering, error messages.

Final measured results and artifact hashes are recorded in
`artifacts/files-validation-results.txt`. Test fixtures use disposable state and
synthetic content; they never use the owner's Downloads folder or live companion.

## Local test kit and update steps

1. Use `artifacts/WinDock-files-local-test.apk` and extract
   `artifacts/WinDock-files-local-test-windows.zip` into a new folder.
2. On Windows, finish any active task, then quit the existing WinDock tray app.
   Run the new folder's `Start-SecureTest.ps1` in PowerShell. It reuses the existing
   local-test configuration and pairing identity, refuses to stop another instance,
   and does not require installing a CA or rescanning a code for a remembered PC.
3. Install the APK as an update. Do not uninstall the existing app; that removes
   saved pairing/settings. If Android reports a signer mismatch, stop and report it.
4. Open WinDock. It should reconnect and retain tiles. Confirm the PC tray's Files
   & Media window shows receiving enabled and your intended destination.

## Physical-device acceptance checklist

Owner confirmation, 31 October 2026: Files & Media works on both the Huawei and
Samsung Galaxy S24 Ultra. Multiple-photo Gallery sharing, USB transfers and the
Windows Open folder fix were also explicitly confirmed. These are real-device
results, separate from the automated tests. The checklist below remains the
reference for detailed stress/provider cases; the owner's messages do not provide
per-case measurements or a native Linux result.

Run on both the Huawei and Samsung Galaxy S24 Ultra, using non-sensitive files.

1. Wi-Fi: put both devices on the same reachable LAN. Open the curtain → Files &
   Media. Send one photo, several photos, a video and a PDF. Check bytes/content on
   the PC; each should appear only after verification, with completion on the phone.
2. In Gallery and Files (and a cloud provider if used), select one file then several
   files → Share → WinDock. Review and Send to PC. Try sharing while disconnected;
   connect and verify the selection remains. Cancel the system picker once.
3. Repeat the same filename, Unicode/emoji/spaces, and two identical basenames
   from different folders. Confirm existing contents remain and suffixes are used.
4. Transfer a large video while watching both progress views and responsiveness.
   Record size, duration and phone model. Compare SHA-256 before/after where possible.
5. Cancel mid-transfer from Android, then from the PC. Try backgrounding/locking the
   phone and disconnecting Wi-Fi. Return, reconnect and explicitly retry. Confirm
   completed files are skipped and incomplete files never appear as finished files.
6. Disable receiving on the PC during a transfer. Confirm it stops and a new batch
   is rejected until re-enabled. Use a dedicated small test volume to test low space;
   do not fill the normal system drive. Try a revoked document-provider grant.
7. USB: connect a data cable, enable Android USB tethering, select the USB connection,
   and repeat single/multiple Share, a video, cancellation and reconnect. USB debugging
   is not required. Repeat switching Wi-Fi ↔ USB and restarting phone/companion.
8. Confirm apps/folder tiles, touchpad, clipboard paste/history, screen capture,
   ordinary typing, emoji, composition, Gboard/Huawei keyboard microphone dictation,
   updates UI, and saved pairing all still work. Dedicated Voice to PC should be absent.
9. Repeat receiver tests on a real supported Linux desktop, including `windock files`,
   XDG destination, notifications, cancellation, Unicode filenames and permissions.
10. Test API24/older-provider fallback, denied/revoked grants, offline cloud files,
    receiver crash around completion, slow storage, long sessions, and production
    Play-delivered builds after separate signing/upload authorization.

## Remaining release gates

Core phone acceptance is owner-confirmed on Huawei and Samsung, including the
reported Gallery sharing and USB tests. Native Linux, any remaining provider/stress
cases, and production Play delivery still need validation.
The local environment has no running Linux Docker engine; JavaScript Linux adapter
tests on Windows do not replace a native Linux build/runtime test. Lint warnings
remain visible, including the existing manually configured user-CA trust allowance;
no TLS bypass was added. Privacy and Data Safety drafts were updated locally in
`website/privacy.html`, Android `assets/privacy.txt`, `PRIVACY_REVIEW.md` and
`PLAY_LISTING.md`. Owner review, public policy hosting, production signing/custody,
store assets/Console declarations, required closed testing and Play distribution
validation are still gates. All publishing and signing-key operations remain on hold.

Official references: [Android receiving shares](https://developer.android.com/training/sharing/receive),
[Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker),
[Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files),
[Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469).

## Follow-up: Windows Open folder — 31 October 2026

The owner reported transfers working but Open folder appearing inactive. Reproduced
with an empty test folder: the original `windowsHide:true` Explorer launch created
one window with `IsWindowVisible=false`; the same launch with `windowsHide:false`
created a visible window. Both Explorer launches returned exit code 1, so that exit
code is not a reliable failure signal for Explorer handing off to the desktop shell.

`src/transfer-desktop.js` now requests a visible window for the explicit folder action.
The local API awaits successful process creation and returns a useful 503 error if
the file manager cannot be spawned, instead of swallowing the error. No shell command
is constructed; the validated local destination remains a separate argument. Transfers,
authentication, certificates, Android, signing and native binaries are unchanged.

`scripts/test-files-folder.ps1` exercises the real API from a hidden isolated Node
host and requires a visible Explorer window for its empty test destination. It closes
only that test window. Full Node suite: 34/34; transfer/launcher assertions: 90; native
Files window: 8. Packaged startup/shutdown passes. The local companion folder and ZIP
were refreshed; restart the existing local companion using Start-SecureTest.ps1.
No APK update is required. The user's live companion was not stopped during the fix.

## Follow-up: Android Photos → Send opened Switch PC — 2 November 2026

The owner reported this from **WinDock → Files & Media → Photos**, not Android's
Share menu. The system picker pauses the Activity; WinDock intentionally closes
its managed HTTPS transport while paused and reconnects to the saved PC on resume.
Previously the Send button checked only the selected files, not connection readiness.
`NativeFiles.start()` treated every missing transport as a reason to dismiss Files
and open the PC picker. A tap during reconnect could therefore close Files silently;
after a failed reconnect it opened **Switch PC**.

The Android fix keeps Send disabled until the existing secure connection is ready.
The selection stays visible with a reconnecting message. An unavailable connection
offers a separate **Connect to PC** action; Send itself never opens the PC chooser.
Reconnection never automatically starts a transfer. The callback also rechecks
readiness at tap time. Managed authentication, certificate validation, legacy HTTPS
sessions, batch/PC identity checks and foreground-only cancellation are unchanged.
No desktop, wire-protocol, permission, dependency or production-signing changes were
needed. Existing tiles and saved pairing are retained by installing the APK as an update.

Regression coverage in `FilesTransferTest` uses a real Android system Photo Picker,
a synthetic JPEG and a loopback mock PC with a controlled `/api/state` delay. It
checks that a premature tap keeps the selection open, reconnect enables explicit
Send, and the PC receives a completed file. A separate real revoked-session case
checks that only the explicit Connect button opens Switch PC. Existing single and
multiple Android shares and denied URI grants remain covered. The pre-fix
`WinDock-links-local-test.apk` reproduced the premature-tap failure; the old debug
build also reproduced the exact Switch PC popup after rejection.

Local test artifact: `artifacts/WinDock-files-reconnect-local-test.apk`. It uses the
release configuration (non-debuggable, HTTPS required) with the **existing debug
test certificate**, matching the previously installed local APK. It is not signed
for publication. Package `com.windock.app`, version code `10`, minimum API `24`
and target API `36` are unchanged. No key was generated or modified.

Validation for this fix:

- Repository suite: **35/35** oracles passed, including secure transfers, pairing,
  input, clipboard, updates and Windows/Linux JavaScript adapters.
- Android: debug and unsigned release builds passed; **43 JVM tests per variant**
  passed. Debug/release lint passed with zero errors and 31/32 warnings respectively
  (existing release-readiness work remains; this is not a clean-lint claim).
- API 36.1 emulator: all **four Files tests** passed on both debug and the exact
  packaged HTTPS release test APK. Both managed-connection tests and both release
  policy tests passed on the packaged APK (8 executed tests; the ninth reported by
  the runner is the separately gated process-restart test). Both seed/verify
  invocations of that process-restart test subsequently passed as separate app
  processes, preserving the stored pairing.
- Debug emulator: native keyboard bridge/editor **3/3**, legacy HTTP dock **1/1**.
  The legacy test needed clean emulator-only preferences after mixed fixture runs;
  it passed without changing the app's connection implementation.
- Public APK signature matches the previous local APK; alignment, manifest,
  non-debuggable status and cleartext prohibition were verified. Screenshots of
  reconnecting and completed transfers were checked for layout/readability.

Evidence is in `artifacts/files-picker-before-release.txt`,
`files-picker-before.txt`, `files-picker-after.txt`, `files-picker-final-apk-tests.txt`,
`files-picker-build-validation.log`, `files-picker-node-regression.log`,
`files-picker-keyboard-regression.txt`, `files-picker-legacy-regression.txt` and
`files-picker-release-verification.txt`, plus `files-picker-pairing-seed.txt` and
`files-picker-pairing-verify.txt`. The pre-fix failures are intentional
regression evidence, not failures of the final APK.

Physical acceptance still required: install over the current app without uninstalling;
open Photos inside Files & Media, choose an image, wait for Send to become enabled,
and send it. Repeat with multiple photos, Documents & files and USB tethering on
Huawei/Samsung. Verify a slow/offline PC keeps the selection and shows a useful
connection state. No desktop reinstall or new QR scan should be necessary.
