# Secure pairing and reconnection: implementation review

31 October 2026. Local work on `play-store-integration-v0.2.6`, based on HEAD
`80d4f6fc7878e1d0ecab715f760cc0be3d0b0a1e`, preserving the v0.2.6 runtime baseline
`24500ac3beb95a8758c4a54511479d6c499aca00` and the subsequent folder enhancement.
Changes are unstaged and uncommitted. This is a review candidate, not a production
release or a claim of completed physical-device acceptance.

## Previous implementation and problems

The pre-change audit is recorded in [SECURE_CONNECTIONS.md](SECURE_CONNECTIONS.md).
The optional desktop HTTPS listener loaded externally supplied certificate/key
files once. The setup script generated a local CA and an IP-bound leaf certificate.
Android trusted the platform's system/user CA store. There was no automatic
renewal, private per-computer Android trust, or durable HTTPS session store.
Desktop restarts lost sessions; changing IP addresses could invalidate the leaf
certificate and browser-origin cookie. WebSocket retries remained on the old
address. A public discovery UUID could identify a remembered PC but could not
authenticate it. Windows and Linux used the same server but lacked equivalent
automatic secure setup.

## Implemented behavior

An ordinary managed connection now starts with **Pair a phone securely** on the
computer and **Scan computer code** on Android. The user does not install a system
CA or compare fingerprints. An optional pairing-text path works without camera
permission. The code is a single-use, two-minute authorization displayed only
in the native Windows pairing window or the local browser pairing page.

The companion generates and protects a persistent per-installation CA. Its stable
signed hostname identifies the computer independently of its current IP/port.
Leaf certificates renew at startup or a six-hour maintenance check when 30 days
remain in their 90-day lifetime. Renewal replaces the TLS context for subsequent
connections without interrupting existing ones. The ten-year CA certificate can
renew with its existing key; Android accepts an authenticated refresh only with
the same public key and subject. This does not authorize identity replacement.

Android remembers trust and its session in Keystore-encrypted app storage. Secure
session hashes persist on the companion, retaining the existing 180-day maximum.
Foreground reconnection tries the saved endpoint and bounded discovery, verifies
the saved TLS identity, and uses a six-attempt exponential retry schedule. Resume,
network changes and explicit retry can start a fresh attempt. Backgrounding closes
native sockets and cancels retries; no new service, wake lock or idle scan loop was
added. Authentication, certificate, pairing, storage and connectivity failures
have separate recovery messages and diagnostic categories.

Legacy HTTP, manual HTTPS, PIN authentication, API payloads, input ownership,
clipboard, capture, folder shortcuts, appearance storage and update mechanisms
remain. The shared dock UI uses a small native HTTPS/WebSocket adapter only for
managed Android connections. Browsers and older Android clients keep their
existing transport. The optional manual TLS helper and externally configured
certificate files are not regenerated or replaced.

## Security decisions

| Decision | Reason and boundary |
| --- | --- |
| Explicit local QR authorization with a random 256-bit secret | Avoids network trust-on-first-use. Codes expire, are single-use and remain subject to the host's shared pairing failure limits. No private key is in a code. |
| Per-PC trust store and standard TLS verification | Android uses normal PKIX and hostname checks for the scanned authority. No permissive trust manager, hostname verifier or WebView SSL bypass was added. |
| Stable signed hostname; discovery is only a routing hint | A forged UDP UUID cannot authenticate an impersonating computer. Address changes do not change the trusted identity. |
| User-only private state and atomic, flushed writes | Windows uses current-user/SYSTEM directory ACLs with built-in PowerShell 5.1; Linux uses 0700 directories/0600 files. Private state is outside distributed binaries. |
| Missing/corrupt established identity fails closed | A public marker binds the saved CA key and host UUID. Restore matching state or explicitly pair a new identity; never silently replace it. |
| Native-only bearer session | Tokens are encrypted on Android and stored as hashes on the host. The adapter does not expose the cookie to page JavaScript. HTTP sessions remain isolated. |
| Local revocation and live-session revalidation | Forget paired phones invalidates secure tokens and invitations; existing state WebSockets recheck authorization. |
| Bounded requests, sockets, retries and input queue | Preserves the remote-input send limit and avoids unbounded network work or idle battery use. |
| Explicit compatibility boundary | Older HTTP clients retain access to HTTP; the Play build still requires HTTPS, as previously approved. No downgrade fallback is introduced. |

Endpoint privacy checks retain the existing supported private IPv4/loopback/shared
address policy. This change does not add arbitrary public endpoints, IPv6 support,
a VPN, remote relay, or a cloud account. The app remains free. Third-party
libraries added here are OkHttp 4.12.0, ZXing Embedded 4.3.0,
`@peculiar/x509` 2.2.0, `reflect-metadata` 0.2.2 and `qrcode-generator` 2.0.4.

## Files changed in this phase

This list separates the secure-connection work from the already-uncommitted Play
integration and folder feature. `git status` also contains those earlier changes
and unrelated user images; they were not discarded.

| Area | Files |
| --- | --- |
| Host identity, sessions, pairing | `src/managed-tls.js`, `src/private-store.js`, `src/secure-sessions.js`, `src/pairing-invites.js`, `server.js` |
| Discovery and live authentication | `src/discovery.js`, `src/sync.js` |
| Local desktop pairing UI | `public/pair.html`, `public/pair.css`, `public/pair.js`, `native/tray/Program.cs` |
| Linux status and instructions | `src/platform/linux-cli.js`, `src/platform/linux-service.js` |
| Android private trust/transport | `SecurePairing.kt`, `SecureTransport.kt`, `SecureWebBridge.kt`, `ManagedDiscovery.kt`, `ReconnectPolicy.kt` under `android/app/src/main/java/com/windock/app/` |
| Android lifecycle and UI | `MainActivity.kt`, `ServerUrl.kt`, `android/app/src/main/AndroidManifest.xml`, `res/layout/activity_main.xml`, `res/values/strings.xml`, `android/app/build.gradle` |
| Shared web transport | `public/native-transport.js`, `public/app.js`, `public/sw.js`, `scripts/build-website-demo.mjs` |
| Packaging and dependencies | `package.json`, `package-lock.json`, `scripts/build-windows.ps1`, `scripts/build-installer.ps1` |
| Tests | `scripts/verify-managed-connections.mjs`, `scripts/secure-android-smoke-host.mjs`, `scripts/smoke-windows.mjs`, `test/run.mjs`, `ReconnectPolicyTest.kt`, `ManagedConnectionTest.kt`, `DockSmokeTest.kt`, `ReleasePolicyTest.kt` |
| User/developer/policy drafts | `docs/SECURE_CONNECTIONS.md`, this report, `docs/PLAY_RELEASE.md`, `docs/PLAY_LISTING.md`, `docs/PRIVACY_REVIEW.md`, `android/README.md`, `android/app/src/main/assets/privacy.txt`, `website/privacy.html` |

Production signing configuration was not changed in this phase. The release AAB
is unsigned. A local release-behavior APK uses only the pre-existing Android debug
test key; it is not a production upload artifact.

## Automated validation

Evidence is local under `artifacts/`, unless a full path is given. Tests use mock
desktop providers where stated; they do not prove physical Wi-Fi/USB behavior.

| Check | Result and evidence |
| --- | --- |
| Repository regression suite | **33/33 oracles passed**, including legacy security, protocols, discovery, folders, clipboard, capture, input, updates and Linux adapters. `secure-connection-repository-tests.log` |
| Managed HTTPS oracle | **34 checks passed**: persisted identity/session, real TLS rejection, invitation expiry/single use, HTTP/HTTPS isolation, live renewal, expired leaf recovery, same-key CA renewal, restart, revocation, corrupt/missing identity. `secure-connection-managed-tests.log` |
| Android JVM tests | **40 debug + 40 release passed**, zero failures/errors. `android/app/build/test-results/test{Debug,Release}UnitTest/` |
| Android builds | Debug APK, release APK, debug test APK and unsigned release AAB built. `secure-connection-final-android.log` |
| Android lint | **Zero errors**, 27 debug / 28 release warnings. Warnings include deliberate user-CA compatibility, main/debug cleartext configuration, existing style/KTX suggestions and tooling version notices. `android/app/build/reports/lint-results-{debug,release}.xml` |
| Android managed instrumentation | **2/2 passed** in the final rerun: native TLS/session/renewal/moved-endpoint and actual shared WebView launch/input/restart/resume/recreation. `secure-connection-managed-final.log` |
| Android process death | Separate pairing seed and verify processes passed across Android force-stop and host restart. `secure-connection-process-{seed,verify}.log` |
| Release-mode policy | **5 executed passed, 1 separately orchestrated process-death case skipped**, zero failures, in the final release-code APK rerun using the debug test key. Covers managed transport, HTTP rejection, Play update behavior and offline privacy. `secure-connection-release-instrumentation-final.log` |
| Windows companion build | Passed; local output refreshed without installing or restarting the user's companion. `secure-connection-windows-build.log` |
| Native Windows smoke | Passed ordinary focus, launch/enumeration/polite close, same-value Core Audio, now-playing and bundled tray/Node lifecycle. `secure-connection-native-tests.log` |
| Native unit checks | **111 assertions passed**: 48 input/signature, 21 port settings, 42 updates. `secure-connection-{input,port,update}-tests.log` |
| Website | **64 checks passed** against the local demo, including existing clipboard/picker/capture/signature flows. `secure-connection-website-test.log` |
| Production npm dependencies | Audit reported **0 known advisories** at validation time. This is not a security certification. `secure-connection-npm-audit.json` |
| AAB inspection | bundletool validation passed; **zero signatures, zero native `.so` libraries**. App ID `com.windock.app`, code **10**, min **24**, target **36**, release non-debuggable, cleartext/backup disabled. `secure-connection-bundle-validation.log`, `secure-connection-aab-manifest.xml` |

The final full Android instrumentation run passed **21 executed tests**, with
**8 opt-in cases skipped** and zero failures (`secure-connection-all-instrumentation-final.log`).
The runner's `OK (29 tests)` includes those skips; the dedicated managed and
release runs above exercise the relevant opt-in cases. Process death uses its
separate seed/verify runs. These runs used the API 36.1 emulator, not a physical phone.

The final compatibility matrix passed **four released APKs against the current
host, four current preview-client checks against old host source fixtures, and
the same-signer v0.2.6 code 9 to code 10 in-place upgrade**. Releases covered were
v0.2.2-preview.1, v0.2.4-preview.1, v0.2.5-preview.3 and v0.2.6-preview.1.
Fixtures mock desktop actions; these are protocol/UI checks, not tests of all old
native installers. Evidence: `secure-connection-public-apk-matrix.log` and
`secure-connection-reverse-matrix.log`.

Final local artifacts:

* `artifacts/secure-connection/WinDock-secure-local-test.apk`: release behavior,
  debug test signature; SHA-256
  `654EA4E6DD2BF7EFEA1F152B20AED3EA3ABAD00200E35781BFF675650EF06E00`.
* `artifacts/play/WinDock-inspection-only.aab`: unsigned inspection bundle;
  SHA-256 `CAB7C1F30B944706A76C7E1773B06ECABEF54D832CDD4B9CC7C7BA1E225D9EBD`.
* `artifacts/WinDock-win-x64/`: rebuilt Windows companion, not installed or
  substituted for the user's running folder-test companion.

### Issues discovered and corrected during validation

* Closing TLS connections on Android's UI thread could write TLS `close_notify`.
  Cleanup now runs on a dedicated background executor; lifecycle tests pass.
* Managed WebView uses a stable virtual origin. Its appearance bridge now maps
  back to the authenticated PC's existing preference scope; recreation/reconnect
  retains settings. Explicitly selecting a legacy PC clears managed selection
  without deleting its saved trust record.
* The native input adapter now preserves the existing bounded send queue.
* Windows smoke used a fixed port that returned `EADDRINUSE`; it now allocates
  actual free ports. The ordinary focus assertion was retained and passed.
* The managed emulator control reader previously relied on a truncated socket
  read. It now reads the exact HTTP Content-Length and never includes invitation
  data in assertion output. Fixture pairing state is cleaned between scenarios.
* The dock smoke assumed default page size and hidden labels despite persistent
  preferences from other tests. It now establishes its required layout through
  the real settings handlers before checking gestures. Product defaults were not
  changed to accommodate the test.
* The legacy upgrade harness initially force-stopped WebView before its new HTTP
  cookie reached disk. The same loss reproduced on the unchanged released
  v0.2.6 APK without any upgrade. Allowing WebView to settle before force-stop
  made the upgrade pass with preserved pairing and storage markers. The disposable
  harness now allows a 35-second settling interval. This is baseline/harness
  timing, not an introduced TLS or upgrade regression; immediate process killing
  after fresh legacy pairing is not claimed to be fixed. Managed session storage
  commits explicitly and passed its separate process-death test.

## Compatibility assessment

HTTP v1 discovery, manual HTTPS v2 discovery, six-digit current PINs, legacy
cookies, API schemas and desktop update paths remain. Managed v3 discovery is
additive. Managed HTTPS normally uses 8621; when manual HTTPS is configured it
uses 8622. Existing automatic port fallback is preserved. Both HTTPS listeners
share secure sessions and control state, while HTTP authentication stays separate.

Previously released Android APKs can use the updated host's HTTP listener. The
updated preview/debug APK can use old HTTP hosts. The Play/release build deliberately
requires a newer HTTPS companion; it cannot connect to HTTP-only old companions.
Explicit manual HTTPS remains supported. Files from the old certificate workflow
are neither modified nor automatically imported into the new private trust store.
An existing manual-CA user can scan once to adopt the managed flow.

The unchanged package identifier and code 10 preserve version ordering over the
reviewed public v0.2.6 code 9. Same-signer preview upgrade is a separate test from
production migration: a new Play signing identity cannot update an installed
debug-signed APK in place. No production key was generated, opened or modified.

Windows and Linux share the same managed identity/session implementation. Linux
adapter tests passed on this Windows environment with mocks. Actual Linux/Hyprland
runtime, permission behavior, service restart and USB routing are not certified.

## Remaining acceptance and Google Play gates

1. **Real-device acceptance for this new flow:** use the checklist in
   [SECURE_CONNECTIONS.md](SECURE_CONNECTIONS.md#real-device-release-checklist).
   On 31 October 2026 the user confirmed native Windows QR pairing, automatic
   reconnection after restarting both apps and both devices, retained tiles,
   Wi-Fi/USB switching in both directions, and recovery after two- and ten-minute
   phone locks on the Huawei. Still verify camera denial/pairing-text fallback,
   physical USB unplug/replug, controlled DHCP changes, measured background
   behavior, long offline periods, explicit revocation and identity recovery.
   The user subsequently reported the requested feature pass working, including
   typing/emoji/voice, clipboard, app launch/focus and saved folders, media and
   capture. Retain extended composition, folder add/remove and per-PC appearance
   checks; see the acceptance follow-up below for the evidence scope.
   Earlier broad Huawei acceptance predates these changes and is not reused as
   a pass for the remaining managed-connection scenarios.
2. **Platform coverage:** minimum API 24, current physical Android/WebView,
   additional OEM/tethering behavior, clean Windows installer/firewall/update,
   and real Linux/Hyprland. Test package updates with preserved private config.
   Discovery can still be blocked by AP isolation, VPN routing or firewall rules;
   the app must show useful recovery instead of weakening trust.
3. **Security/release review:** review this uncommitted trust and transport code,
   preferably independently, and validate the exact eventual signed artifacts.
   Review optional CAMERA disclosure, dependency licenses and final Data Safety
   answers against actual phone-to-PC flows. No analytics or advertising SDK was
   introduced, but absence of a relay alone does not settle Data Safety answers.
4. **Signing and migration:** owner approval of key custody/setup and the
   debug/GitHub-to-Play transition remains required. Follow
   [PLAY_SIGNING.md](PLAY_SIGNING.md). The inspection AAB is not uploadable as a
   production candidate. Do not reuse a public debug key for production.
5. **Public assets and review access:** approve and separately publish the privacy
   page, supply the updated companion download, refresh setup screenshots and
   reviewer instructions, and complete the free store listing/content rating and
   declarations. Contact remains `alidevlab10@gmail.com`; drafts are local only.
6. **Personal-account testing and access:** complete required account/device
   verification, the applicable closed test with at least 12 continuously opted-in
   testers for 14 days, pre-launch review and production-access application.
7. **Separate authorization:** commits, merges, pushes, deployments, uploads,
   Console changes and publication remain on hold. Nothing in this report
   authorizes them.

Current policy references: [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
(API 36 for current submissions), [personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465),
[Android local network protection](https://developer.android.com/privacy-and-security/local-network-permission),
[app signing](https://developer.android.com/studio/publish/app-signing),
[Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469).
These were checked against official documentation; local test success does not
replace Google Play review or physical-device acceptance.

## Native Windows QR window — 31 October 2026 follow-up

User request: display the QR in the PC application instead of opening a browser.
The tray action and a new button in the connection-info window now open a native
WinForms pairing window. It creates a code, counts down its two-minute lifetime,
clears expired images, supports refresh and explicit copying, and cancels an
unfinished request when closed. A separate link preserves access to the existing
browser-based diagnostics and phone revocation tools.

The additive local invitation request `{ "format": "gif" }` returns a bitmap
from the existing QR encoder. The default SVG response, invitation contents,
HTTPS claim endpoint, authentication, expiry, discovery, certificate identity,
session persistence and Android transport are unchanged. No new dependency or
Android build is required for this window change.

Validation completed on the updated source:

| Check | Result |
| --- | --- |
| `node test/run.mjs` | 33/33 repository oracles passed, including expanded managed pairing checks and input, clipboard, folders, discovery and update regressions |
| `scripts/test-native-pairing.ps1` | 31 native assertions passed: bounded response/image parsing, loopback endpoint restriction, actual WinForms rendering, expiry, refresh, no automatic browser opening, cancellation on close |
| Android ZXing core 3.4.1 decoding | Both the synthetic raw GIF and the native window's rendered PNG decoded to the exact original invitation |
| Desktop port settings / update tests | 21 + 42 assertions passed |
| Windows tray publish | Release win-x64 self-contained package built successfully |
| Packaged tray smoke | Bundled Node startup from a different working directory, banner receipt and child shutdown passed with disposable state and separate ports |
| Local launcher/package | Existing local-test configuration found; no private keys, signing stores or secure identity/session files bundled |

The first isolated tray fixture supplied `WINDOCK_HOST=127.0.0.1`, which the
existing LAN-adapter validation intentionally rejects. The fixture was corrected
to use the normal host binding; the rerun passed. No application networking
restriction was weakened. A sandboxed launcher preflight also could not see the
real local app-data directory; the same read-only preflight passed with access
to that directory.

The prepared folder is `artifacts/WinDock-native-pairing`. Its
`Start-SecureTest.ps1` reuses `%LOCALAPPDATA%\WinDock-LocalTest-20261031\config.json`
and the existing certificate identity. It refuses to start while another
WinDock tray is running. The user's current `artifacts/WinDock-win-x64` process
was left running; no binaries in that folder were replaced.

New `WinDockTray.exe` SHA-256:
`AB57E9FCFE7E7463D4023D1F19239B74D13CB6AE1F0FAF6A217804E2EB9101C6`.
The last installed Android APK remains unchanged. Test-window captures contain
synthetic, unusable pairing credentials, not an invitation from the user's host.

User acceptance, 31 October 2026: the user explicitly confirmed that the QR
appears in the PC window and the phone connects. This records the native pairing
flow as a real-device pass on the same Huawei test phone.

Further user acceptance, 31 October 2026: after following the companion restart
and Android force-stop/reopen walkthrough, the user confirmed automatic
reconnection without scanning the QR again. This passes application-restart
pairing persistence; full PC/phone reboot recovery was tested separately below.

Further user acceptance, 31 October 2026: the user reported success after the
Wi-Fi to USB tethering walkthrough (phone Wi-Fi disabled), followed by returning
to Wi-Fi and checking automatic reconnection without another QR or PIN. Record
this as user-reported network-switching acceptance in both directions. Physical
USB cable unplug/replug was not part of that walkthrough and remains separate.

Further user acceptance, 31 October 2026: the user explicitly confirmed both
the two-minute and ten-minute phone-lock checks. In each case, WinDock connected
automatically after unlocking the phone and opening the app. This passes
foreground recovery after those lock durations; it does not measure background
network activity, battery usage or wake locks.

Further user acceptance, 31 October 2026: the user explicitly confirmed that
both full restart checks passed. The phone reconnects automatically after
restarting the phone and PC without scanning again, and the user's tiles remain.
This passes full-device restart persistence with the local-test launcher; it
does not certify installer/autostart/update behavior on a clean Windows system.

Further user acceptance, 31 October 2026: the user reported that everything in
the four requested feature groups was tested and working. The message itself
demonstrated typed text and emoji, voice-keyboard dictation, a successful Teams
launch and pasted clipboard text. Clipboard directions, focus/folder, media and
capture subchecks are recorded as covered by the user's overall confirmation,
not as separately observed automated results. No further copy of clipboard
content is stored in this report.

The user then requested a swipe-down controls curtain. Its scoped implementation
and validation are in [QUICK_CONTROLS.md](QUICK_CONTROLS.md). This new UI needs
its own phone gesture acceptance; the previous reconnect results stay valid
for the tested build and must not be rewritten as tests of untried UI changes.
Remaining edge cases, extended features, platform coverage, security/release
review and Google Play gates above remain open.
No commit, push, deployment, upload, publication or production signing-key
operation was performed.

## Repeated native reconnects with a slow Windows media provider — 2 November 2026

The owner supplied a recording of the blank dock background alternating with the
native "Your computer isn't responding" screen over Wi-Fi. They confirmed it
occurred both before and after the Photos/Send fix, and that PIN-based connections
could work when the native QR-paired connection looped. The connection options
screen is normal when a native connection is unavailable; repeatedly falling back
to it after a successful secure probe is not normal.

Read-only checks on the installed companion found matching application assets,
healthy HTTP/HTTPS listeners and a small `/api/state` response (8,557 bytes, roughly
0.5 seconds). Three `/api/nowplaying` requests took **20,083 / 20,026 / 20,016 ms**
and returned an empty media result. The desktop helper already has a 20-second
execution limit. Android instead had an 8-second read timeout and 12-second call
timeout, and `SecureWebBridge` treated that optional request failure as a full
connection failure. `public/app.js` also awaited media before showing the dock and
opening its primary socket. This explains why the native path could repeatedly
fail while web/PIN clients, whose media polling allows 25 seconds, could connect.

An isolated emulator fixture reproduced the failure on the unchanged
`WinDock-files-reconnect-local-test.apk`. A longer test also exposed a subsequent
`/api/capture` read failing with `unexpected end of stream` when a pooled HTTPS
connection had closed. All automatic connection recovery had been disabled to
avoid replaying actions, so that safe read unnecessarily restarted the dock too.
Temporary diagnostic logging was removed after establishing these causes.

The fix is limited to the existing transport and startup flow:

- Load dock state and open the main connection without awaiting optional media
  and capture telemetry. Their normal polling/display remains available.
- Allow 25 seconds only for native `GET /api/nowplaying`, with a 30-second bridge
  response deadline. The existing PC media deadline remains 20 seconds.
- Keep a failed/timed-out media read local to media polling. Authentication and
  certificate failures still fail closed; actual main-socket loss still reconnects.
- Recover stale pooled connections for **GET only**, sharing the existing trusted
  client configuration, pool and dispatcher. POST/PUT, pairing claims, controls and
  file transfers retain their no-replay behavior. A fault-injection test asserts
  that a lost read response is recovered and a lost control response produces
  exactly one control request.
- Bump the browser shell cache to `windock-v27-media-reconnect`. No protocol,
  package ID, permission, desktop binary, pairing storage or certificate changes.

The real reason Windows' media API is slow on this PC is not established. Disposable
STA and MTA probes both exceeded six seconds; this does not establish an apartment
threading bug. No Windows services or media applications were reset. Now Playing
may remain empty while the OS/provider is unresponsive, but it must not prevent
use of the dock. The existing 20-second desktop limit is retained.

Local companion update: backed up and atomically replaced only `public/app.js`,
`public/native-transport.js`, and `public/sw.js` under the installed WinDock folder.
Backup: `artifacts/media-reconnect-ui-backup-20261102-100716`. No host restart was
needed; exact contents/order of all **19 tiles** and the live host identity were
verified unchanged. Pairing/configuration files were not touched.

Android test APK: `artifacts/WinDock-connection-stability-local-test.apk`, SHA-256
`7C5B378BB6445C5124A884A42A22E5DAE2BD802FE96AFDFA31C556212403740F`.
This is the non-debuggable HTTPS release configuration signed with the same
existing **debug test certificate** as the owner's previous local APK. Package
`com.windock.app`, code 10, min API 24 and target API 36 are unchanged. Install it
over the current app without uninstalling; no new QR scan should be necessary.
No production signing keys were generated, read or changed.

Validation completed before packaging: 35/35 repository suites; 43 JVM tests per
Android variant; debug/unsigned release builds; debug/release lint with zero errors
and the existing 31/32 warnings. The slow/stalled media and GET-versus-control
fault tests passed on the debug emulator. Legacy PIN/dock and native keyboard
regressions passed (4 tests). Final packaged-APK results are recorded below.

Final HTTPS APK: **10 executed tests passed** (4 Files & Media, 4 managed
connection/security tests, 2 release-policy tests). The runner reports 11 because
the separately gated process-restart case is skipped in that combined invocation.
Its seed and verify phases subsequently passed in separate app processes too.
The long-running test explicitly observed a stalled media request time out while
the original page and authenticated primary connection remained alive. Actual
host restart/reconnection, certificate renewal, endpoint changes, authentication
rejection, Photos/Share and the previous selection-preservation fix remain covered.

Evidence: `artifacts/media-reconnect-before.txt`, `media-reconnect-after.txt`,
`media-reconnect-debug-log.txt`, `media-reconnect-node-regression.log`,
`media-reconnect-android-build.log`, `media-reconnect-legacy-keyboard.txt`,
`media-reconnect-final-apk-tests.txt`, `media-reconnect-apk-verification.txt`, and
`media-reconnect-ui-install-result.json`. The recording was inspected locally.

Physical acceptance is still required on the previously looping device: install
the APK over the existing app, keep it open on Wi-Fi for at least two minutes,
use tiles/typing/clipboard, and repeat over USB. Confirm Photos still sends and
phone/PC restarts retain pairing. Prior device acceptance does not certify this
new build. Existing Google Play publication gates remain; nothing was committed,
merged, pushed, uploaded or published.

Primary implementation reference: [OkHttp 4.12 client sharing and connection-retry
semantics](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/OkHttpClient.kt).
