> Historical implementation report. The owner approved removal on 31 October
> 2026 after Samsung/Huawei testing. Dedicated voice code and RECORD_AUDIO have
> now been removed; existing keyboard voice typing is preserved. The APK/ZIP
> links and voice test counts below describe the superseded test build, not the
> current Files & Media build. See FILES_AND_MEDIA.md for current validation.

# Voice to PC — implementation and local validation

31 October 2026. Local work on `play-store-integration-v0.2.6`; no release version
assigned, commit, upload, deployment or production signing operation performed.
This report also covers consolidation of quick actions and the top controls island.

## User experience

Open Quick controls by pulling down on the dock or tapping/pulling the top island.
The island has reserved space above the icons, including short landscape screens.
The swipe-up drawer contains Apps, Appearance, Updates, Arrange and Fullscreen.
Controls, Capture and Touch & sign are no longer duplicated there. The standard
non-immersive layout still has its footer entry to the same curtain.

On the updated Android app, **Voice to PC** is a microphone action in the curtain.
Select the PC text field first. Tap the microphone, speak, and let the recognizer
finish, or select **Stop listening**. A first-use disclosure and Android permission
request precede microphone use. Normal final results are inserted automatically.
**Review before sending** makes Send explicit. Text containing line breaks or tabs
always requires review because some receiving apps, particularly terminals, can
interpret pasted multiline content as commands. WinDock never appends Enter or
sends an Enter key command for dictation. Cancel discards unsent speech. Once a
send is in flight, closing the dialog cannot undo it.

The dialog shows connecting/starting, listening, processing, preview, sending,
success, error and uncertain-delivery states. Partials are preview-only. There is
no Android keyboard or external speech activity in this flow. Recognition retries
require another tap and a fresh session; an old transcript is never replayed.

## Architecture and compatibility

1. `MainActivity.kt` exposes three narrow voice bridge commands and an on-device
   availability flag to the existing trusted WebView. Starting requires a visible,
   foreground, allowed HTTPS page. Existing pairing/TLS code supplies that trust.
2. `NativeVoice.kt` owns one SpeechRecognizer at a time on Android's main thread.
   It requests RECORD_AUDIO only after the microphone action/disclosure. The
   listener sends session-scoped partial/final/state events to the WebView. A
   final/error/cancel/pause/navigation/connection failure/destruction releases the recognizer.
   Listening has a 60-second watchdog, finalization 10 seconds. The display's
   idle-rest cover also cancels speech; partials keep the active display awake.
3. `VoiceSession.kt` rejects malformed, stale or duplicate callbacks and limits
   transcripts to 8,192 UTF-16 units. Text is never trimmed, normalized or logged.
4. `public/voice-session.js` controls final-only insertion and the original focus
   token. `public/voice-to-pc.js` displays the dialog and uses the existing
   DockWebSocket `/input` path and heartbeat, including the native secure bridge.
   It does not create an audio endpoint or use Web Speech/cloud APIs.
5. `src/input.js` validates `{type:"dictate", id, target, text}` with a random
   128-bit operation ID, exact keys, size/Unicode/control-character checks.
   `src/input-hub.js` requires existing authorization, allowed origin, a real TLS
   socket and native dictation capability. The existing single-owner input lease
   remains in effect. An additional input owner gets a clear busy error.
6. `src/platform/input.js` forwards capability flags and sanitized native result
   receipts. The host acknowledges insertion only after the helper reports the
   input API result. Receiving a WebSocket message alone is not success.
7. Windows refreshes UI Automation focus after each dictation request and fails
   closed after one second if focus cannot be verified. It rejects password and
   unknown/non-editable destinations. It injects one bounded KEYEVENTF_UNICODE
   batch through the existing RemoteKeyboard implementation. It does not use the
   clipboard or add Enter/Tab commands. Partial API failures are uncertain.
8. Linux rechecks the AT-SPI object's focused/writable state, and the active
   Hyprland window when available. Single-line text uses the existing `wtype`
   stdin path. Line breaks/tabs use the existing clipboard and uinput paste path,
   with focus checked again after copying. This is disclosed in the dialog.
   Clipboard failures are distinct from uncertain insertion. No new dependency.

The existing `text`, `key`, `paste`, touchpad, signature, capture, pairing,
discovery and update protocols remain supported. New helper capability flags are
optional additions to `ready`. Old Android clients ignore them; new Android
clients connected to an old host keep existing controls, with dictation absent
or an update-required message. Old native helpers never receive `dictate` from
the hub. Legacy HTTP control remains supported, but dictation is HTTPS-only.

Application ID `com.windock.app`, version code **10**, current version name,
minimum API **24** and target/compile API **36** are unchanged. Updates from the
existing locally signed test APK should retain saved PCs and settings. This local
debug APK is not a Play upload candidate. No production signing keys were opened.

## Recognition provider, languages and privacy

The installed default Android speech service supplies recognition. On-device-only
mode is initially preferred on API 31+ devices reporting support; the setting is
remembered. Unsupported/missing language models produce a useful error; there is
no silent online fallback. The user may turn off On-device only and retry with
the configured default service. API 24–30 devices use that default service.
WinDock omits EXTRA_LANGUAGE so the service's configured language applies.
Punctuation is preserved when supplied; API 33+ requests formatting, which a
provider may ignore. Language availability, accents, silence detection, voice
commands and recognition quality remain provider-dependent.

There is no paid API, subscription, custom AI backend, downloaded model or audio
file. The provider may process audio remotely when on-device-only mode is off.
WinDock does not control provider retention. Microphone access is foreground-only;
there is no microphone foreground service or background recording permission.
Incoming calls may stop recognition through lifecycle/audio errors; a physical
call test is still required on the Huawei device.

Partials stay in the phone's memory. Finals use the existing authenticated HTTPS
channel directly to the PC. Phone preview text is cleared on close/background.
The PC deduplication ledger stores at most 256 IDs, hashes and result receipts for
ten minutes, without transcripts. An interrupted insertion is never retried
automatically, including after reconnection. Duplicate IDs cannot reinsert text
within that window, and cannot be reused with different contents. The client
generates a new ID only for a new user-initiated dictation. Receiving applications
and Linux clipboard/history may retain inserted content independently.

Privacy drafts were updated in `android/app/src/main/assets/privacy.txt` and
`website/privacy.html`, with the Data Safety review in `docs/PRIVACY_REVIEW.md`.
The drafts are local. The optional provider-dependent audio flow must be evaluated
before final Console declarations; do not reuse a blanket no-data statement.

Official references reviewed:

- [Android SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer): foreground adapter lifecycle, RECORD_AUDIO, main-thread use, recognition-service visibility and on-device APIs.
- [RecognizerIntent](https://developer.android.com/reference/android/speech/RecognizerIntent): free-form recognition, language/defaults, partial results and formatting.
- [Google Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311): transparency and sensitive permission handling.
- [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469): optional audio/content flows and provider handling require review.

## Changed files

Android: `NativeVoice.kt`, `VoiceSession.kt`, `MainActivity.kt`, manifest, offline
privacy policy, `VoiceSessionTest.kt`, `NativeVoiceTest.kt`; four existing Android
UI tests now use the curtain's input shortcut. `PcPickerTest.kt` waits for the
recovered page to become visible before querying its JavaScript.

Shared UI: `voice-session.js`, `voice-to-pc.js`, `app.js`, `index.html`, `icons.js`,
`style.css`, `sw.js`. The website demo asset copier includes the two new modules;
it does not expose real recognition in the public preview.

Host: `src/input.js`, `src/input-hub.js`, `src/platform/input.js`;
Windows `RemoteKeyboard.cs`, `Touchpad.cs`, `native/input-tests/Program.cs`;
Linux `protocol.rs`, `focus.rs`, `atspi.rs`, `touchpad.rs` with Rust tests.

Tests/docs: `scripts/verify-voice.mjs`, `voice-browser-check.js`, updated
`quick-controls-browser-check.js`, `clipboard-browser-check.js`, `test/run.mjs`,
this report, `QUICK_CONTROLS.md`, `PRIVACY_REVIEW.md`, `PLAY_RELEASE.md`,
`UPCOMING_RELEASE.md`, and the unpublished website privacy page.

## Automated validation

Tests with simulated recognition verify control flow, not speech accuracy or
physical microphone behavior. Browser fixtures do not control the real PC.
Native unit tests use fake SendInput sinks. Package smoke tests use disposable
identity/configuration and ports.

| Validation | Result and evidence |
| --- | --- |
| Repository regression suite | **34/34 oracles passed**, including 58 new voice assertions; `artifacts/voice-regression.log`. After final receipt-expiry cleanup, voice, input (119 assertions), and real TLS transport checks were rerun successfully. |
| Android JVM | **45 tests passed**, including five new voice state/Unicode tests; `android/app/build/test-results/testDebugUnitTest`. |
| Android builds/lint | Debug APK, debug instrumentation APK, unsigned release APK/AAB, debug and release lint passed; zero lint errors. `artifacts/voice-android-build.log`. |
| Android voice, PC picker, idle settings | **13/13 final targeted tests passed**, including all seven new native voice tests. Fake recognizers cover permissions, unavailable services, partial/final/duplicate callbacks, Unicode, stop/cancel, background, errors and connection-failure mic cleanup. `artifacts/voice-android-final-targeted.log`. |
| Android wider installed-app coverage | **30 distinct tests passed across full and targeted runs**. Six opt-in release/appearance/process-phase scenarios were not rerun. Full-run diagnostics and resolution are described below. |
| Managed Android HTTPS | **2 passed, 1 explicit process-phase scenario skipped**. Covers secure session persistence, certificate renewal, restart, endpoint movement, identity rejection, revocation, shared dock/input and lifecycle reconnection. `artifacts/voice-managed-android.log`. |
| Windows native unit tests | **59 input**, **42 update**, **21 port**, **31 native-pairing** checks passed. No real desktop text was injected by unit tests. |
| Browser UI | **37 curtain/island**, **20 voice**, **19 clipboard**, **64 website** checks passed. Tests include real touch events, 844×390/640×320 bounds, no island/tile overlap, no gesture theft, preview-only partials, focus loss, duplicate suppression and uncertain delivery. |
| Packaged Windows smoke | New kit starts its bundled host from another working directory and shuts it down with isolated state; launcher CheckOnly passes; all packaged `src`/`public` files match source. Existing tray remains untouched. `artifacts/voice-packaged-smoke.log`. |
| APK/AAB | Debug APK signature verified against the previous installed-test certificate; bundletool validates AAB; inspection AAB confirmed unsigned. Application ID, code 10, min 24, target 36 unchanged; release cleartext disabled. |
| Linux | Node Linux protocol/platform regression oracles pass; changed Rust sources parse with installed rustfmt. **Native compilation/Rust tests and real desktop injection remain pending**: Docker exits without exposing its engine and only the Windows Rust target is installed. |

The first full Android run lacked the media fixture and timed out during clipboard
connection; both passed with their fixtures present (`voice-android-fixture-rerun.log`).
A subsequent full run had 26 passes, eight opt-in skips and one PC-picker JS
callback timeout during manual recovery. The harness had queried the hidden
WebView while it was navigating away from an unreachable host. It now waits for
the recovered page to be visible, preserving the original 20-second recovery
deadline and title assertion. All four PC-picker tests passed in the final
13-test rerun. No discovery/networking implementation was changed for that issue.
The browser cleanup assertion likewise now waits for the dialog's queued close
event before checking cleared text. This report does not claim a single pristine
full-suite run, or that skipped scenarios executed.

Final local APK SHA-256:
`115CA159AED84288CAEEBCB36484C423B4002043E582B4D31E432EDD0D2A41A9`.
Final helper SHA-256:
`58177245847FDD3854921A32C497E8244CAF769DCBA4E8FBB1B4862A45B147F2`.
The tray executable matches the previous native-pairing/curtain kit; its displayed
version intentionally remains unchanged. The helper, host and shared UI are new.

## Physical-device feedback — 31 October 2026

The owner reports that the new native Voice to PC action works on a Samsung
Galaxy S24 Ultra but ends after short sentences, and does not work on the Huawei.
The Huawei error, model, installed recognition service and exact failure stage
have not been captured, so its root cause is not established. These results do
not qualify the feature as accepted for release.

The keyboard's microphone supports extended dictation on both phones according
to the owner. The feedback message itself was dictated with the Samsung keyboard
microphone, not the new native Voice to PC action. Keep those test paths distinct.
Our native implementation ends on the first final recognition result and also
has a 60-second watchdog; it is not a continuous keyboard-dictation replacement.
Android documents SpeechRecognizer as unsuitable for continuous recognition.
Keyboard speech availability alone does not prove that the public recognition
service path used by WinDock will work on that device.

Recommendation pending the owner's decision: omit the dedicated native voice
feature from the upcoming Play release and use the existing keyboard microphone
through the curtain's Keyboard action. Retain the top island and consolidated
controls. No voice implementation or permission has been removed yet. If removal
is chosen, update code, tests and privacy drafts consistently; preserve all
existing keyboard, HTTPS, pairing, clipboard and desktop compatibility behavior.

## Local test kit and Huawei checklist

Files are under the repository's `artifacts` directory:

- Android: `WinDock-voice-local-test.apk` (debug/local testing only).
- Windows: `WinDock-voice-local-test/Start-SecureTest.ps1` beside the rebuilt helper.
- The launcher reuses `%LOCALAPPDATA%/WinDock-LocalTest-20261031/config.json` and its
  existing secure identity. Do not delete that state, reinstall a CA, or scan a
  new QR unless the application explicitly requires it. The launcher refuses to
  stop another tray instance; your currently running companion was not replaced.

1. Install the APK as an update on the same Huawei phone. Do not uninstall the
   existing app or clear its data. Confirm existing tiles and saved pairing remain.
2. Quit WinDock using its current tray menu, then run the new kit's launcher.
   Open WinDock on the phone and allow it to reconnect over Wi-Fi.
3. Confirm the top island does not cover any icons in your chosen grid, scale,
   orientation and label settings. Tap/pull it; confirm the swipe-up drawer has
   no Controls, Capture or Touch & sign duplicates. Verify those actions in the
   curtain, including keyboard, clipboard, screenshot and signature.
4. On the PC, select an empty Notepad field. In the curtain choose Voice to PC,
   read the disclosure, grant microphone permission and speak a short sentence.
   Confirm a listening indicator, no Android keyboard, preview, and one insertion.
   Confirm no automatic submission. Verify the Windows clipboard stays unchanged.
5. Test punctuation, your configured recognition language, Arabic/non-English
   text, emoji when supported by the provider, and a longer paragraph. Compare
   the phone preview with inserted text. Provider transcription mistakes are not
   transport failures. Test Stop, Cancel, no speech and rapid repeated taps.
6. Enable Review before sending, dictate, inspect the result, then Send once.
   Cancel a second result and confirm nothing reaches the PC. Try a multiline
   result if the installed service supports spoken line breaks; it must wait for
   review and preserve line breaks without appending an Enter key command.
7. While speaking, switch the focused PC field/window. Confirm dictation stops
   or insertion is rejected. Password and unverified destinations must be rejected.
   Repeat in a browser input, Teams/chat draft and editor. Use a harmless terminal
   prompt only, initially with no newline; terminal support is limited by focus
   metadata and each application's handling of injected/pasted text.
8. Background/lock the phone while listening, return, and confirm no late text is
   inserted. Test a phone call and microphone privacy disabled. Deny permission
   once, then restore it in Android settings and retry. Other controls must work
   while microphone access is denied.
9. Interrupt Wi-Fi during recognition and during sending. Verify a useful error
   or uncertain result, no replay and no duplicate after reconnect. Inspect the PC
   before starting another dictation if delivery was uncertain.
10. Enable USB tethering, turn phone Wi-Fi off, and repeat a short dictation,
    review/send, cancellation and clipboard/keyboard checks. Return to Wi-Fi and
    confirm automatic reconnect and retained tiles without rescanning the QR.
11. On Android 12+ hardware, test On-device only with the required language model,
    including internet unavailable. On the Huawei's older Android version this
    option may be unavailable; a clear error is expected, not online fallback.

For Linux, run `cargo test --locked --manifest-path native/linux/Cargo.toml`, then
test on the supported desktop with AT-SPI focus reporting, `wtype` and the usual
WinDock uinput permissions. Validate single-line text, focus changes, Unicode,
formatted clipboard paste, failed clipboard tools, disconnects, and preservation
of existing touchpad/keyboard/signature/clipboard actions. No Linux physical pass
has been claimed.

## Limitations and release holds

- Real microphone accuracy and the Huawei permission/call/provider behavior need
  the checklist above. Previous keyboard-based voice testing is not validation of
  this new native microphone feature.
- A successful native result means the OS/helper accepted insertion. It cannot
  prove that every receiving application displayed it, or prevent a focus change
  in the tiny interval after final validation and OS dispatch. No field contents
  or password are read to verify success. Check the PC before submitting.
- Unknown/password focus fails closed. Elevated Windows applications can reject
  input due to integrity isolation; some browser/editor/Linux applications need
  accessibility enabled. Existing manual keyboard behavior remains available.
- Linux formatted text can remain in clipboard/history. A target may submit pasted
  lines; review is mandatory. WinDock never adds a submission key.
- Continuous/live insertion and press-and-hold are intentionally deferred: partial
  recognition results can change, and touch cancellation would add gesture conflicts.
- Linux native compilation/tests and physical insertion require a working Linux
  runtime. Windows currently has no Linux Rust target; installed Docker Desktop
  exited without exposing its engine. No packages/toolchains were installed.
- Production signing approval/keys, owner-reviewed privacy policy publication,
  Data Safety/listing/content declarations, required personal-account testing and
  remaining release/device validation are still Google Play gates. No Console
  listing, uploads, policy publication or deployment was performed.
