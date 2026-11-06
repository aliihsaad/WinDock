# Frozen candidate validation — 3 November 2026

Local validation only, on `play-store-integration-v0.2.6`. No commit, upload,
deployment, production-key operation or Play Console change was performed.
The ordered remaining gates are in [PLAY_BLOCKERS.md](PLAY_BLOCKERS.md).

## Result and scope

The owner reported the requested Wi-Fi, USB, saved-pairing reopen, typing,
clipboard and photo-transfer checks passed on Windows and Omarchy Linux.
The supplied settings identify a Xiaomi Pad 6 (Android 14 / HyperOS 2.0.14.0),
Galaxy S24 Ultra (SM-S928B/DS), and Huawei Mate 10 Pro (BLA-L09 / EMUI 12.0.0).
The Samsung/Huawei screenshots do not establish the underlying Android version.
This is owner-reported acceptance of `WinDock-local-address-secure-test.apk`,
not an independently measured complete device/host matrix. Device identifiers,
phone numbers and original settings screenshots are not copied into this report.

Minimum-OS validation then found and fixed a real startup crash. The resulting
release bundle passed the checks below. Exact physical acceptance of the later
font fix and eventual Play-signed build is separate from the owner's earlier APK
acceptance. Keep the production delivery tests in the release plan.

## Minimal application fix

On the official Android 7/API 24 Google emulator, both the pre-fix standalone
secure APK and bundle-generated splits crashed when `MainActivity.onCreate`
inflated the first explicitly styled Button. The exception was
`ArrayIndexOutOfBoundsException` in `StringBlock.get`, through
`TypedArray.getString` and `TextView.<init>`. Android 7's
[TextView source](https://android.googlesource.com/platform/frameworks/base/+/android-7.0.0_r1/core/java/android/widget/TextView.java)
reads the font-family string at that stack location.

The theme's literal `android:fontFamily` value `sans` now references a
non-translatable `@string/native_font_family` whose value remains `sans`:

- `android/app/src/main/res/values/styles.xml`
- `android/app/src/main/res/values/strings.xml`

This changes resource resolution without changing the font or layout. The same
Google API 24 image then passed normal activity startup and six native/release
checks. No application networking, desktop code, pairing format, clipboard,
update mechanism, package identifier or minimum SDK changed in this validation.

## Automated results

| Check | Result | Evidence under `artifacts/` |
| --- | --- | --- |
| Debug JVM tests | 51 passed, zero failures/errors | `play-freeze-final-test-build.log`; Gradle XML reports |
| Release JVM tests, lint and unsigned AAB | 51 passed; lint zero errors / 31 warnings; bundle build passed | `play-freeze-final-bundle-build.log`; Gradle reports |
| Bundletool validation and artifact inspection | Passed; target 36, minimum 24, package `com.windock.app`, code 10, `0.3.0-preview.1`; no native `.so` libraries | `play-freeze-final-bundle-validation.txt`, `play-freeze-final-manifest.xml`, `play-freeze-final-bundle-inspection.json` |
| Original Google API 24 image, fixed release splits | Six native/privacy/release-policy checks passed after the startup fix | `play-api24-final-native-tests.txt`, `play-api24-final-crash.txt` |
| API 24 with updated official AOSP WebView | 15 executed tests passed; two expected skips | `play-api24-updated-webview-tests.txt`, `play-api24-updated-webview-version.txt`, `play-api24-updated-webview-crash.txt` |
| Official Android 36.1 16 KB x86-64 image | `getconf PAGESIZE` returned 16384; 16 executed tests passed; one expected skip | `play-16k-final-regressions.txt`, `play-16k-final-regression-crash.txt` |
| Pairing across process death and local split-to-universal APK update | Seed and verify phases passed on each image, four executed phases total | `play-api24-pairing-seed.txt`, `play-api24-pairing-verify.txt`, `play-16k-pairing-seed.txt`, `play-16k-pairing-verify.txt` |
| Earlier desktop/security/regression checks | 36 Node suites passed before this resource-only application fix; desktop/protocol source unchanged | `local-address-node-tests.txt`; `LOCAL_ADDRESS_COMPATIBILITY.md` |
| Production npm dependencies | Zero reported advisories at this checkpoint | `play-freeze-dependency-audit.json` |

The shared Android suite covers TLS identity, session storage, certificate renewal,
host restart/port changes, wrong-identity rejection, revoked sessions, stale reads
without replaying control writes, slow/stalled optional media, two-PC switching,
connection-page editing, files/share handling, release update restrictions and
offline privacy access. The API 33+ Photo Picker case skips on API 24; native
single/multiple share and error cases still execute. The process-persistence
case skips in the combined runs and is executed separately with `managedPhase`.
JUnit's displayed `OK (17 tests)` includes these assumptions; it must not be
reported as 17 executed passes on either image.

## WebView requirement and emulator setup

The dock needs an updated WebView provider. The first Google API 24 image includes
old WebView 53 and Chrome 69 packages; its dock test failed despite native HTTPS
checks passing. A package's installed version alone does not prove which provider
was active. Do not attribute that entire failure solely to WebView 53.

For the full API 24 run, use an isolated plain-AOSP image and the official
[AOSP WebView prebuilt](https://android.googlesource.com/platform/external/chromium-webview/+/refs/heads/android14-release/prebuilt/x86_64/),
version `113.0.5672.136`, minimum API 24. Runtime logs confirm that provider loaded.
APK SHA-256: `8E8B2EED6C71F9F4DEF2395F92683DCE42071109795E5B4CAD3D82A0FA367F48`.
The old emulator preload has a different certificate, so ordinary installation
was rejected. The official prebuilt was placed only in the disposable emulator's
temporary writable system copy and Android services restarted. This is test
provisioning, not an instruction to root or alter users' phones. No WebView APK is
bundled with WinDock or offered as an end-user download.

Users should update WebView/Chrome using their device's official update source.
On Android 7–9, Chrome can provide WebView; see the
[Chromium WebView FAQ](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/faq.md).
The local setup-guide draft now mentions this. These results establish the tested
OS/provider combination, not compatibility with every obsolete factory WebView.

The 16 KB emulator initially used 2 GB RAM. Its logs record system-wide low-memory
kills, including the WebView renderer, which interrupted instrumentation. With
4 GB RAM, a settled boot and Android's first-run fullscreen tutorial dismissed,
the UI could be exercised. The saved `play-16k-picker-failure.xml` demonstrates
the tutorial intercepting taps before that setup correction.

Raw HTTP fixture reads also intermittently ended early (one diagnostic recorded
10 of 11 expected bytes for `/restart`). Buffering alone did not eliminate this.
The four secure/file/navigation test clients now buffer reads and request
keep-alive, consume the bounded Content-Length body, then close their socket.
The final complete suites passed on both images. The exact emulator/host socket
layer responsible for the earlier truncation was not proven; this is a test
transport workaround, not evidence of a production HTTPS defect. The app's
network implementation was not changed. API 24's uppercase `SDK` model is now
recognized by the two relevant emulator-only test guards, retaining explicit
fixture opt-in. Earlier failed logs are retained alongside the final runs.

Owned emulators and the loopback-only fixture were stopped after validation.
No physical device, installed companion, dock or real pairing was changed.

## Artifact identity and security

- Unsigned inspection AAB: `artifacts/play/WinDock-inspection-only.aab`;
  SHA-256 `5903DB62726DCC90589F5BF6AB049A56120ACBC6FDA06B3D3A80BD5D376C6AA8`.
- Local installable APK from that bundle:
  `artifacts/WinDock-play-validation-secure-test.apk`;
  SHA-256 `F6F7AD5CCA80484C40404BEB86870F6FDA843D464F3D83ABA93F8DADDB86939D`.
- APK certificate SHA-256:
  `488186d4c2e70bd171bafd8fe7a11b8cce7d0fa7863113f334e07f66f57f83c1`.
  This is the existing local debug certificate, not a production credential.
  APK v2/v3 signatures verified; the debug keystore's file hash is unchanged.
- Release application is non-debuggable, disables backups and cleartext traffic,
  and has optional camera plus existing network permissions. No microphone,
  broad storage or accessibility-service permission was introduced.
- The bounded archive inspection found no signatures in the unsigned AAB, no
  native libraries, no key/keystore filenames in the checked extensions, and no
  private-key PEM markers in the inspected text entries. Bundled privacy text
  matches source. This is not a universal secret-detection guarantee.
- Source hashes before/after validation are in
  `artifacts/play-freeze-candidate/source-hashes*.json`; no Git commit was created.
  Pre-fix AAB and the owner's already-tested APK were retained separately.

## Lint disposition and remaining gates

The 31 warnings were reviewed rather than treated as zero findings:

- The shared/main network configuration permits legacy/debug HTTP. The release
  overlay and actual manifest/runtime checks reject cleartext.
- Release user-installed CA support is intentional for existing manually
  provisioned HTTPS companions. Managed QR pairing uses its existing host trust
  handling. Certificate and hostname validation were not disabled.
- The API 33 back-callback attribute is ignored on older Android; API 24 navigation
  tests pass. Fixed landscape orientation remains an existing form-factor limit;
  the owner reported tablet testing, not a complete accessibility/foldable matrix.
- Remaining warnings concern a build-tool update, Kotlin conveniences, text and
  layout cleanup, and labeling. The address field already has a label and hint;
  TalkBack/accessibility review remains manual. No dependency upgrade or UI
  redesign was introduced during this freeze.

Next: validate clean companion install/upgrade/uninstall and state/firewall
behavior in isolation, then finalize reviewer instructions and signing custody.
The current Windows host has real WinDock data and must not be used as a clean
uninstall test target. An isolated VM on this PC can avoid needing another
physical computer, but Hyper-V management currently requires additional OS
permission and a suitable Windows installation image.

Production signing approval, public privacy/support/companion availability,
Console declarations, Play-distributed installation/upgrade/pre-launch testing,
the personal-account closed test and production access remain open. Local tests
do not replace any of those gates or guarantee Play review approval.
