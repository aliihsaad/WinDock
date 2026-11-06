# WinDock Play preparation: v0.2.6 integration and validation

Reviewed locally on 30 October 2026. **Integration is ready for code review, not
publication.** The native Windows smoke failure was traced to foreground-policy
eligibility and retested successfully; see [WINDOWS_FOCUS_TEST.md](WINDOWS_FOCUS_TEST.md).
Installer lifecycle testing was blocked by an existing installation, and real-device/release-account gates
remain open. No commit, merge, push, deployment, Console action or upload was made.
No production Android signing key was generated, replaced or used.

## Baseline and integration method

- Branch: `play-store-integration-v0.2.6`, created tracked-clean from
  `origin/main` at `80d4f6fc7878e1d0ecab715f760cc0be3d0b0a1e`.
- Compatibility release: published `v0.2.6-preview.1`, target
  `24500ac3beb95a8758c4a54511479d6c499aca00`, Android version code 9.
- Earlier preparation started from `4bd6234b411de02ff52ee7bde69c7fd4e0fe6221`.
  Its 53 files were backed up byte-for-byte with SHA-256 hashes before restoring
  the worktree and creating the integration branch. Backup, manifest, patch and
  rejected-hunk records are in `artifacts/play-preparation-backup-20261030/`.
  Unrelated image/attachment files were preserved.
- The release target is not a Git ancestor of main because its work was squash
  merged. Source comparison, rather than ancestry alone, established runtime
  parity. Main differs from the release in eight files: README, iOS integration
  tests, native update tests, website browser checks, and four website files.
  Those newer changes were retained.
- Preparation changes were reconciled individually against this baseline.
  Rejected old hunks were not forced over newer implementations. All resulting
  changes remain uncommitted and unstaged; HEAD is unchanged.

## What was integrated and what was preserved

| Area | Integrated behavior and source references |
| --- | --- |
| Host protocols | `server.js`, `src/auth.js`, `src/input-hub.js`, `src/sync.js`: optional HTTPS/WSS added beside the released HTTP/WS listener. API routes, payloads, shared dock state, provider, capture worker and input ownership remain compatible. HTTP retains `windock_session`; HTTPS uses `__Host-windock_session`. |
| Pairing/security | Released six-digit PIN, Host validation, auth/CSRF controls, host-wide lockout and PC-local recovery retained. HTTPS has a separate PIN and session store, but shares the failure budget with HTTP. Renaming a cookie cannot cross-authenticate. HTTPS loopback still requires pairing. |
| Discovery/ports | `src/discovery.js` preserves v1 responses and adds opt-in v2 HTTPS discovery. Released HTTP fallback and saved explicit port remain. HTTPS automatic port selection also falls back; an occupied explicit TLS port fails clearly. Tray/discovery advertise the actual bound endpoint. |
| Android discovery | `Discovery.kt`, `PcScanner.kt`, `PcPicker.kt`, `HostProbe.kt`: keep multi-PC scanning, saved PCs/Forget, identity matching and source-address rewriting for USB. Play filters insecure endpoints; previews retain v1/HTTP. Existing positional discovery arguments remain compatible. |
| Android identity/build | `android/app/build.gradle`: `com.windock.app`, minimum API 24, compile/target API 36, version code 10, version name `0.3.0-preview.1`. AGP 8.10.1, Gradle 8.11.1 with distribution checksum, Build Tools 36.1.0. No broad runtime SDK replacement. |
| Android lifecycle/security | `MainActivity.kt`, release manifest/network config, `public/app.js`, `public/style.css`: API 36 Back/inset handling, offline privacy entry, origin/bridge restrictions and HTTPS-only release behavior. Released performance heuristics, display preferences, native editor and per-PC appearance behavior retained. |
| Clipboard | Released `public/clipboard.js`, clipboard API/history and native paste implementations retained. The phone fetches up to 20 text entries on demand, edits locally, and pastes only on explicit action. Draft cleanup and Windows clipboard retention are accurately distinguished in the policy. |
| Updates | Released desktop update routes, startup/manual checks, trusted download restrictions and tray behavior retained. Preview Android manual updates remain. `AppUpdates.kt` routes Play users to Google Play without the external APK flow. |
| Windows packaging | `native/tray/Program.cs`, `scripts/build-windows.ps1`, installer/build scripts: add secure endpoint/PIN display and bundle the TLS setup helper/guide. Existing installer AppId, startup/port recovery and native helper remain. Package/tray versions become 0.3.0 / 0.3.0-preview.1. |
| Signing | Explicit opt-in signing plus approved public certificate fingerprint; ordinary/unsigned builds do not open inherited upload keys. Debug, expired, missing or mismatched signing identities fail validation. See `PLAY_SIGNING.md`. |
| Policy/listing | Offline `privacy.txt`, local `website/privacy.html`, `PRIVACY_REVIEW.md` and `PLAY_LISTING.md` describe the integrated implementation. Support is `alidevlab10@gmail.com`. App remains free, with no ads, purchases or registration. Website remains on its current released downloads. |

Released `AppearancePreferences.kt`, `KnownHosts.kt`, `ServerUrl.kt`,
`PerformancePolicy.kt`, `src/server-port.js` and `native/win/*` were not replaced
with older preparation implementations. The earlier `PLAY_REVIEW.md` remains a
historical review; this report supersedes its validation status.

### Approved compatibility boundary

Older Android clients continue to use the newer host's HTTP interface. The new
**preview/debug** client continues to use older HTTP hosts. The **Play/release**
client deliberately requires an updated HTTPS companion and trusted certificate,
as approved earlier; it does not connect to HTTP-only old hosts. This is a known
release requirement, not an assertion of universal two-way Play compatibility.
Users of older hosts retain their existing preview path until they update.

## Fresh validation results

All logs below are local evidence under `artifacts/`; they are not published.

| Check | Result | Evidence |
| --- | --- | --- |
| Complete repository suite | **31/31 oracles passed**, including released security, discovery, port fallback, clipboard, updates, input, capture, Linux adapters and new TLS checks | `play-integration-repository-tests.log` |
| Android JVM suites | **37 debug + 37 release tests passed**, no failures/errors | `android/app/build/test-results/testDebugUnitTest/` and `testReleaseUnitTest/` |
| Android builds | Debug APK, release APK, debug instrumentation APK and unsigned release AAB built successfully | `play-integration-final-android-build.log`, `play-integration-final-artifacts.log` |
| Android lint | **0 errors, 22 warnings** in release; warnings remain visible, including tooling/localization, landscape and deliberate user-CA/network-policy choices | `android/app/build/reports/lint-results-release.txt` |
| Main Android instrumentation | Runner reported 25 tests: **21 executed/passed, 4 opt-in cases skipped** in the general run | `play-integration-instrumentation-final.log` |
| Opt-in Android cases | Appearance seed/verify across app + host restart passed; release HTTP rejection and Play-only update UI passed; trusted HTTPS pairing/WSS and untrusted/removed-trust rejection passed. Together with the main run, **26 unique Android instrumentation tests passed**; reruns/seed phases are not counted twice | `play-integration-appearance-{seed,verify}.log`, `play-integration-release-policy-final.log`, `play-integration-trusted-tls.log`, `play-integration-untrusted-{before,after}.log` |
| Native unit checks | **48 input/signature assertions**, **42 update checks**, **21 port-settings assertions** passed; input unit checks do not inject desktop input | `play-integration-native-{input,updates,ports}.log` |
| Windows build | Bundled companion and installer compiled successfully | `play-integration-windows-build.log`, `play-integration-installer-build.log` |
| Packaged tray smoke | Passed server startup, URL/PIN readiness and shutdown using isolated test port/config | `play-integration-tray-smoke.log` |
| Real Windows smoke | Initial focus failure explained by Windows foreground eligibility; updated ordinary smoke passed, plus three explicitly controlled runs. Real phone/application acceptance remains open | `focus-smoke-normal-final.log`, `focus-smoke-controlled-1.log`; details in `WINDOWS_FOCUS_TEST.md` |
| Installer lifecycle | **BLOCKED**: existing WinDock installation/shortcut; script refused replacement before installing anything | `play-integration-installer-test.log` |
| Website regression | **64 checks passed**, including actual demo clipboard/picker/capture/signature flows, release downloads and responsive layouts | `play-integration-website-test.log` |
| Local privacy page | Phone-width layout, support link, zero scripts and policy-text parity with bundled offline asset checked; screenshots reviewed locally | `website/privacy.html`, `output/playwright/play-privacy-mobile.png` |
| Release checks | Actionlint passed; production npm audit reported **0 advisories**; signing opt-in/conflicting-mode negative checks passed; unsigned build ignored deliberately invalid inherited signing credentials | `play-integration-actionlint.log`, `play-integration-npm-audit.json`, `play-integration-signing-{negative,conflict}.log`, `play-integration-unsigned-build.log` |
| AAB inspection | bundletool validation passed, no signatures, no packaged `.so`, policy matches current offline/web copy; merged manifest non-debuggable, cleartext disabled and backup disabled | `play-integration-bundle-validation.log`, `play-integration-aab-manifest.xml`, `play-integration-artifact-check.json` |

The Android runs used the API 36.1 emulator with mocked PC providers. Initial
quick-boot/renderer and UI-harness failures were resolved by a cold software-rendered
emulator and synchronizing the harness with app state. The final runs above passed
without weakening application assertions. This does not substitute for OEM testing.
Only a temporary test CA was installed in the emulator; it was removed, raw runner
status confirmed the rejection test executed, and the owned fixtures/port forwarding
were cleaned up. A release-code APK was signed solely with an existing debug test
key for instrumentation. It is not a production artifact.

### Actual released APK and reverse host matrix

The four APKs were downloaded from their public releases and checked against
published hashes; they were not rebuilt or resigned. Reverse tests used host source
archived from each release target with an isolated mock provider, not historical
Windows installer binaries. Checks covered pairing, authenticated health/state,
live dock WebSocket, tile rendering and input lease. They did not exercise actual
Windows desktop control or a physical Wi-Fi/USB link.

| Release | Public Android APK → integrated HTTP host | Integrated preview → released HTTP host |
| --- | --- | --- |
| v0.2.2-preview.1 | Passed, six-digit current-host pairing | Passed, four-digit historical-host pairing |
| v0.2.4-preview.1 | Passed | Passed |
| v0.2.5-preview.3 | Passed | Passed |
| v0.2.6-preview.1 | Passed | Passed |

Evidence: `play-compatibility-releases.json`, `play-public-apk-matrix.json` and
`play-reverse-matrix.json`. Historical hosts only expose their original features;
the matrix does not imply that old hosts acquire newer clipboard/update APIs.
Separate current-host clipboard/editor/update instrumentation passed.

Public v0.2.6 code 9 → integrated preview code 10 also passed an in-place emulator
upgrade, preserving the existing authenticated session and a WebView storage
sentinel. The tested public/debug signing certificate matched. **This proves
preview-channel continuity, not migration to a new production signing identity.**
A fresh Play app-signing key cannot silently update the installed debug APK;
the owner must accept/document an uninstall/reinstall transition or approve a
different safe distribution strategy. Never promote a public debug key to production.

### Transport-specific coverage

The new secure-transport oracle exercises real HTTP/HTTPS, WS/WSS and UDP sockets:
untrusted/wrong-hostname TLS rejection; unknown Host rejection; separate PINs,
cookies and token stores; secure cookie flags; shared failure budget and local
recovery; existing sessions surviving a pairing pause; shared input ownership;
clipboard auth/CSRF/no-store rules; desktop update routes; v1/v2 discovery; and
HTTPS port fallback with accurate readiness output. Android JVM tests cover
secure endpoint filtering and UDP source rewriting relevant to USB tethering.
Release instrumentation confirms successful trusted TLS and WSS, wrong legacy
PIN rejection, real Android Back/recreation, no HTTP fallback, and trust removal.
These establish protocol behavior; physical Wi-Fi/USB confirmation remains open.

### Current inspection artifact

`artifacts/play/WinDock-inspection-only.aab` is **unsigned, inspection only**.

SHA-256: `ad7b6e027abc49c16e4c4861fe34d0a4c1edf2fdb3bb6b2db28aa48bb7265a76`

Package `com.windock.app`; code 10; minimum 24; target 36. Three application network
permissions remain: INTERNET, ACCESS_NETWORK_STATE and CHANGE_WIFI_MULTICAST_STATE.
No camera, microphone, location, broad storage, accessibility or Android screen
capture permission was added. AndroidX also merges a signature-protected receiver
permission; its exported ProfileInstaller receiver is protected by DUMP, and its
startup provider is not exported. No bundled native library needs ELF alignment
remediation, but 16 KB device execution remains a validation item.

## Open issues and release blockers

1. **Windows acceptance gate:** the focus failure reproduced on both v0.2.6 and
   the integration and was traced to Windows denying the background helper
   foreground eligibility. The ordinary native smoke now passed; three test-only
   debugger-positive-control runs also passed. No executable application focus
   logic changed. See `WINDOWS_FOCUS_TEST.md` for measurements and scope. Real
   phone-driven app switching, pointer input, typing and clipboard were later
   confirmed working by the user on their Huawei Mate 10 Pro (October 31).
   Capture acceptance remains open; these results do not remove the existing
   Windows policy limitation. See the local test kit's `TEST-RESULTS.md`.
2. **Installer and cross-platform coverage:** run fresh install, launch, upgrade,
   uninstall and config preservation in a clean Windows VM; this PC's existing
   installation was left intact. Linux Rust/package lifecycle tests could not run
   because Docker's Linux engine is unavailable; Linux JS oracles did pass. iOS
   native/Xcode tests are unrun on this Windows machine. Those implementations
   were not replaced, but shared host changes still warrant their release CI.
3. **Secure onboarding and physical devices:** the approved release needs an
   updated companion, manually provisioned matching-IP certificate and explicit
   Android trust. This is not zero-configuration. Verify setup, renewal, changing
   Wi-Fi/USB IPs, CA removal, OEM trust UI and understandable failure/recovery.
   The helper includes currently assigned private and 100.64/10 shared addresses;
   tethering must be active when issuing the certificate. On October 31, the user
   confirmed basic HTTPS Wi-Fi/USB operation, input (including voice dictation),
   clipboard, unplug/reconnect and switching back to Wi-Fi on their Huawei Mate
   10 Pro. Renewal/IP-change failures, CA removal, broader OEM coverage and
   longer-running behavior remain unverified; Android version is not recorded.
4. **Production signing/migration:** owner approval for key custody/generation,
   Play App Signing strategy, upload certificate, backups and preview migration
   is still required. Positive production-key signing and Play-generated split
   APK/upgrade tests have intentionally not run. Code 10 exceeds the reviewed
   public maximum 9; recheck Console/distribution maxima before any later release.
5. **Privacy/listing:** policy/support content is prepared locally, not published.
   Finalize hosting/support retention facts and Data Safety classification from
   the actual signed build. Local transfers, persistent signature files, clipboard
   text and host identifiers must be considered; absence of analytics does not
   automatically justify every “no collection” answer. Approve public privacy URL,
   reviewer companion/setup access, category/rating/audience and final screenshots.
6. **Play account/testing:** AliDevLab personal account exists, but no WinDock
   listing or production access is established. Complete required verification,
   app setup, closed testing and production access only after separate approval
   for Console/upload actions. The account requires at least 12 continuously
   opted-in testers for 14 days before applying for production access.

## Practical remaining validation plan

1. Review this uncommitted integration diff, especially transport/authentication,
   clipboard preservation, signing isolation and the documented Play-only host
   requirement. Use the documented native focus setup and separately test ordinary
   foreground eligibility in the intended interactive Windows session.
2. On a clean Windows VM, run the existing installer lifecycle script and real
   smoke suite; confirm tray startup/manual update checks, port conflicts, reboot,
   existing config/hostId preservation and install-over-v0.2.6 behavior.
3. With the owner's device model/Android version recorded, test Wi-Fi first, then
   USB tethering with mobile data both on and off where supported. Check v1/v2
   discovery, multiple PCs, manual addresses, pairing rejection/success/lockout,
   restart, reconnect, changing interface/IP, blocked multicast and saved-PC Forget.
   Record actual bound HTTP/HTTPS ports and certificate SAN/trust behavior.
4. Exercise real launch/focus/close, touchpad lease handoff, keyboard composition,
   emoji/password fields, clipboard browse/edit/explicit paste/clear-on-close,
   media/volume, signature save/insert, screenshot/recording stop, sleep/background,
   phone dim/rest, appearance persistence and update UI on both transports.
5. Cover minimum API 24/25, an intermediate Android release, API 34–37, a low-memory
   phone, tablet/foldable, a 16 KB device and more than one tethering OEM. Test
   untrusted, expired, wrong-IP and removed certificates on actual devices. Include
   Android 17 target-36 behavior; do not add target-37 permissions prematurely.
6. Review/finalize policy and store assets. Existing local assets: 512×512 icon,
   1024×500 feature graphic and three refreshed 1920×1080 release screenshots with
   fictional fixture apps. Add real setup/keyboard/clipboard/tablet coverage after
   acceptance; keep PINs and personal data out of screenshots.
7. After separate signing approval, prepare the documented upload key and build a
   verified signed candidate; record hashes/public certificates, inspect the exact
   manifest/bundle and rerun affected checks. No private material in repo/logs.
8. After separate upload/deployment approval, publish the approved policy, create
   the free listing, complete declarations/reviewer instructions, run internal and
   mandatory closed testing, examine pre-launch results, and apply for production
   access. A further explicit publication decision is still required.

## Final review checklist

- [x] Clean integration branch established without a `codex/` prefix.
- [x] Newer released implementation reviewed and preserved; prep backup retained.
- [x] Existing identifiers/minimum SDK retained; code 10 exceeds reviewed code 9.
- [x] Target API 36, release cleartext/debug/backup restrictions and AAB validated.
- [x] Existing HTTP clients retained; Play HTTPS-only boundary documented.
- [x] Actual public APK/released-host compatibility matrix and preview upgrade passed.
- [x] Repository, Android, native unit and website checks recorded with honest scope.
- [x] Privacy, support, signing and listing drafts prepared; app stays free.
- [x] Emulator trust/fixtures cleaned up; production keys and live services untouched.
- [x] Native focus failure explained on the release baseline; ordinary smoke and explicit positive control passed.
- [ ] Real phone-driven focus/input/capture accepted in the intended Windows session.
- [ ] Clean-VM installer and required platform CI checks completed.
- [ ] Physical Wi-Fi/USB, minimum API, tablet/OEM and certificate acceptance completed.
- [ ] Production signing/custody/migration approved and verified.
- [ ] Public policy, store declarations, reviewer setup and assets approved.
- [ ] Personal-account verification, 12-testers/14-days test and production access complete.
- [ ] Separate authorization received before commit/merge/push, deploy, upload or publish.

## Official requirements checked

- New submissions/updates require API 36 from 31 August 2026:
  [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878).
- Android 16 local-network restrictions are opt-in; Android 17 enforcement applies
  to apps targeting 37+. Target-36 behavior must still be device-tested:
  [Android local network protection](https://developer.android.com/privacy-and-security/local-network-permission).
- [Android app signing and update identity](https://developer.android.com/studio/publish/app-signing).
- [Personal-account closed testing and production access](https://support.google.com/googleplay/android-developer/answer/14151465).
- [Google Play user data policy](https://support.google.com/googleplay/android-developer/answer/10144311),
  [Data Safety declarations](https://support.google.com/googleplay/android-developer/answer/10787469),
  and [store preview assets](https://support.google.com/googleplay/android-developer/answer/9866151).

The policy links guide preparation; passing local checks is not a guarantee of
Google Play approval. Historical validation in other preparation documents must
not be used as evidence that the remaining gates above are complete.
