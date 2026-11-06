# Play preparation compatibility review — 30 October 2026

Historical review of the old preparation branch. The owner subsequently approved
integration with v0.2.6. Current changes and validation are recorded separately in
[PLAY_INTEGRATION.md](PLAY_INTEGRATION.md); the original findings below are retained
as evidence of why the integration was necessary.

**Decision: not ready for release; full released-version compatibility cannot
be confirmed.** This corrects the earlier broad compatibility statement.

The preparation branch is `play-store-preparation`, based on `4bd6234` (the older
performance-mode branch). The review covers all 50 preparation files present at
its start: 31 tracked modifications and 19 new files. The pre-existing image and
`.codex-remote-attachments/` are outside this change and were left alone.

The public [0.2.6 release](https://github.com/aliihsaad/WinDock/releases/tag/v0.2.6-preview.1)
was published on 29 October 2026, targets `24500ac`, and uses Android version code
9. Local release preparation commit `c247264` and `origin/main` at `80d4f6f` contain
features absent from this branch. The comparison is against actual released
source and release metadata, not a future proposal.

## Blocking findings

| Severity | Finding and evidence | Required resolution |
| --- | --- | --- |
| P1 | Released pairing security is missing. `src/auth.js:13` still selects four digits; `server.js:175` has no released Host-header check. Released `src/auth.js` adds six digits, strict loopback Host validation and a global failure budget; released server checks both HTTP and WS. A fresh loopback mock probe returned authenticated state with an unrecognized Host and no cookie. | Reapply TLS on the released security implementation, retaining all Host checks, pairing limits/recovery and HTTP/WS authentication. HTTPS alone does not repair the retained HTTP listener. |
| P1 | Published API/features are missing: `/api/clipboard/history`, `/api/updates`, `/api/updates/check`, host identity in `/health`, clipboard `paste` input, and corresponding helpers/UI. Current mock probes return 404 for clipboard/updates and reject `paste`. | Preserve the released routes, payloads and capabilities on both transports. Test actual released APKs against the updated companion. |
| P1 | Android predates published PC picker/Forget semantics, per-PC appearance persistence, expanded low-memory Auto detection, update checks and manual CGNAT/Tailscale addresses. `MainActivity.kt`, `EndpointPolicy.kt`, `ServerUrl.kt` and `PerformancePolicy.kt` lack these release changes. | Integrate the Play shell changes into the released Android implementation, retain stored-data migrations and published behavior, and decide the Play-compliant update presentation without installing external APKs through Play. |
| P1 | Desktop startup predates the released default-port fallback and saved port setting; `server.js:start` directly binds 8620. | Preserve `src/server-port.js` and tray settings. Allocate HTTPS without colliding with a fallback HTTP port, and advertise the actual bound endpoints. |
| P1 | `android/app/build.gradle:21` uses code 9, already public in 0.2.6. Existing APK is debug-signed and future production signing will differ. | Select a code greater than all releases (at least 10 based on current evidence), preserve the application ID and provide a truthful signing/data migration plan. |
| P1 | The first policy draft omitted desktop internet update requests and did not delimit its older codebase. It cannot describe released clipboard/history/update functionality absent from this branch. | The local draft is corrected and explicitly scoped. Reconcile it again after restoring the released features; use PRIVACY_REVIEW.md. No publication yet. |
| P2 | `build-play-bundle.ps1 -Unsigned` does not disable Gradle's environment-driven signing. Signed-candidate checks do not compare against an approved signer fingerprint. | Use an environment with all upload variables absent for inspection; add explicit unsigned-mode enforcement and approved-fingerprint verification before production use. No production key operation is authorized. |
| P2 | Manual user-CA installation affects device trust beyond this app, and current provisioning excludes published CGNAT addresses. LAN/USB IP changes require certificate renewal. | Validate the real-device onboarding, scope certificate SANs to supported addresses, and document renewal/removal. Never bypass certificate validation. |

These findings are not evidence that every old Android APK fails basic pairing:
the shell loads its dock UI from the host, so the host can supply its own PIN UI.
They are evidence that this branch is a functional/security regression relative
to released WinDock and cannot be certified as a compatible upgrade.

## What the preparation changes do preserve

Against their own older baseline, HTTP and UDP v1 remain available with the same
probe/reply strings, port defaults, `windock_session` cookie, four-digit pairing,
API route bodies and WS snapshot format. The HTTPS listener adds v2 discovery,
an independent secure PIN/token store and a Secure `__Host-` cookie. Both listeners
share dock state, the input lease and capture provider. The changes to
`src/sync.js` and `src/input-hub.js` attach the existing handlers to both servers.
The Android package ID and minSdk 24 are unchanged. Installer AppId is unchanged.

Fresh read-only probes against a mock PC confirmed v1 discovery, health, legacy
pairing/cookie, `/api/state` and a real HTTP WebSocket snapshot. See local
`artifacts/play-compatibility-review.json`. The same probes independently expose
the missing released protections/capabilities above. No real desktop actions or
private-key generation were involved.

| Combination | Evidence and limit |
| --- | --- |
| Older-baseline HTTP clients → preparation host | Protocol preservation supported by diff and mock probes; actual public APK matrix not yet run. |
| 0.2.4–0.2.6 clients → preparation host | Full compatibility not accepted: released security, API and feature parity is missing. |
| Play release → old HTTP-only host | Rejected intentionally under the approved secure-companion plan. |
| Play release → preparation HTTPS mock | Passed prior API 36.1 emulator pairing, WSS dock/input, Back and recreation tests; not acceptance of the real Windows provider or the current released feature set. |

## Automated tests completed and their limits

The existing reports were inspected; the earlier suites were not presented as
new runs in this review. Policy text changes made during review are not yet in
the historical built AAB/APK/installer.

| Check | Recorded result | Scope |
| --- | --- | --- |
| Repository suite | 21/21 | Preparation branch's older test inventory; newer release has additional tests absent here. |
| Android JVM | 14 debug + 14 release, zero failures | URL/discovery/keyboard/USB/idle/performance logic present in this branch. |
| Android instrumentation | 11 unique tests passed | API 36.1 emulator: dock/keyboard 4, privacy/options/performance 4, release HTTP rejection 1, trusted TLS flow 1, removed trust rejection 1. TLS test used a mock PC and a test-only debug-signed release APK. |
| Release lint | 0 errors, 17 warnings | Warnings reviewed previously, not suppressed wholesale. |
| AAB | Built and validated with bundletool 1.18.3 | Unsigned historical inspection artifact, no native `.so`, package/minSdk/target inspected. Not a production release. |
| Signing guard | Missing upload variables rejected | No production key or production-signed bundle created. |
| Desktop | Companion/installer compiled; 42 update checks | Installer not installed during preparation; no real-device acceptance of HTTPS. |
| Other | actionlint passed; npm production audit had no known advisories | Recorded point-in-time results. |
| This review's fresh probes | Legacy baseline checks pass; release-parity blockers reproduced | Mock HTTP/WS only; report distinguishes successful old contracts from missing new contracts. |

Pending: apply changes onto current released code; run its complete tests plus
the TLS tests; actual 0.2.2/0.2.4/0.2.5/0.2.6 APK compatibility; native clipboard,
input, media and capture over HTTPS; Windows upgrade/config preservation; physical
Wi-Fi/USB and certificate onboarding; API 24/25, representative newer Android,
tablet/foldable and 16 KB devices; denied/expired/wrong-address certificates;
network changes, lifecycle, saved-PC/appearance migration; production-signed
bundle checks and Play-generated APK/upgrade tests after separate authorization.

## Google Play and owner prerequisites

- AliDevLab is a newly created personal account; no WinDock listing exists.
  Dashboard access/Create App availability does not establish production access.
  For personal accounts created after 13 November 2023, Google requires at least
  12 opted-in testers continuously for 14 days before applying for production
  access. [Official requirement](https://support.google.com/googleplay/android-developer/answer/14151465).
- Support email is now supplied: `alidevlab10@gmail.com`. No email was sent.
- Policy page is prepared at `website/privacy.html` for the existing site, with
  matching Android text. Public hosting is expressly on hold, and the policy is
  not final until release behavior and hosting/support retention are reviewed.
- Production signing/custody and migration are planned in PLAY_SIGNING.md.
  Generating/replacing any private signing key needs explicit approval.
- Complete Console setup/verification, Data Safety, rating/audience, free/no-ads
  settings, final assets and reviewer access to a usable secure Windows companion.
  Do not select "no collection" solely because there is no developer relay;
  phone-to-PC transfers and restored clipboard features need classification.
- All uploads (including internal/closed tests), publication and production
  deployments remain on hold. No Console or deployed website changes occurred.

## Next implementation sequence

1. Preserve this uncommitted preparation diff and keep unrelated user files out.
   Establish the current released/main source as the integration baseline on the
   dedicated preparation branch; review the integration before accepting it.
2. Reapply the additive TLS listener/discovery and release Android restrictions
   without replacing published authentication, routes, port fallback or settings.
3. Retain current stored-data migrations/features; resolve secure port selection,
   certificates and Play update behavior. Increase the Android version code.
4. Enforce genuinely unsigned inspection builds and approved upload-certificate
   identity. Do not generate a production key as part of integration.
5. Reconcile policy/Data Safety against the integrated code, refresh local assets,
   then rebuild and run the complete combined regression suite and APK matrix.
6. Complete owner physical-device acceptance and only then seek the separately
   required key/Console/deployment approvals with concrete artifacts to review.

## File-by-file preparation inventory reviewed

Paths are repository-relative. M = modified tracked file; A = new preparation file.

| File | Review result |
| --- | --- |
| M `.github/workflows/build-release.yml` | SDK/build checks and draft tag changed; retains old workflow baseline; no workflow run triggered. |
| M `.gitignore` | Key-format exclusions added; no substitute for staged-secret inspection. |
| M `android/README.md` | Preparation instructions; compatibility/version caveats need review notice. |
| M `android/app/build.gradle` | SDK36/min24/release flags/signing; code9 collision and unsigned-mode caveat. |
| M `android/app/src/main/java/com/windock/app/Discovery.kt` | v1 default retained, release v2 added; missing released multi-PC scan. |
| M `android/app/src/main/java/com/windock/app/EndpointPolicy.kt` | HTTPS predicate added; released CGNAT range absent. |
| M `android/app/src/main/java/com/windock/app/MainActivity.kt` | Insets/Back/HTTPS/privacy/bridge checks; released picker/appearance/update changes absent. |
| M `android/app/src/main/res/layout/activity_main.xml` | Responsive address field/privacy button; integrate with released screen controls. |
| M `android/app/src/main/res/values/strings.xml` | Privacy and secure-host explanation added. |
| M `android/app/src/test/java/com/windock/app/EndpointPolicyTest.kt` | Downgrade checks added; released tests must also be retained. |
| M `android/build.gradle` | AGP update only. |
| M `android/gradle/wrapper/gradle-wrapper.properties` | Gradle update with verified checksum. |
| M `native/installer/WinDock.iss` | AliDevLab publisher and explicit helper/guide allowlist; AppId retained. |
| M `native/tray/Program.cs` | Additional HTTPS banner/display; released recovery/port features absent. |
| M `native/tray/UpdateChecker.cs` | Fallback version only; internet feed is privacy-relevant. |
| M `native/tray/WinDockTray.csproj` | Version only; no application protocol change. |
| M `package-lock.json` | Root version only; dependency lock entries unchanged by this preparation. |
| M `package.json` | Version only; app remains free. |
| M `public/app.js` | Secure-PIN hint on HTTPS; current released UI features absent. |
| M `public/style.css` | Removes portrait blocker at >=600px; real tablet acceptance still needed. |
| M `scripts/android-smoke-host.mjs` | Optional loopback-only TLS mock fixture; no real PC input. |
| M `scripts/build-android.ps1` | SDK/build-tools paths updated; still debug preview output. |
| M `scripts/build-installer.ps1` | Requires bundled guide/helper; no install triggered by the script. |
| M `scripts/build-windows.ps1` | Copies public setup helper/guide, not generated keys. |
| M `server.js` | Additive TLS/shared handler; old baseline omits released security/API/port behavior. |
| M `src/auth.js` | Independent secure cookie selection; released six-digit/global/Host protections absent. |
| M `src/discovery.js` | v1 wire constants retained; optional v2 added. |
| M `src/input-hub.js` | Shared lease across listeners; released paste handling absent. |
| M `src/sync.js` | Same snapshot handler on both listeners. |
| M `test/run.mjs` | Adds TLS test; newer release test inventory absent. |
| M `website/index.html` | Local privacy link; website baseline also older than production. |
| A `android/app/src/androidTest/java/com/windock/app/PrivacyTest.kt` | Offline dialog/Back test; not evidence of data-flow correctness. |
| A `android/app/src/androidTest/java/com/windock/app/ReleasePolicyTest.kt` | Opt-in non-debuggable/cleartext-denial test. |
| A `android/app/src/androidTest/java/com/windock/app/SecureDockTest.kt` | Opt-in trusted/revoked CA mock tests; no production signer. |
| A `android/app/src/main/assets/privacy.txt` | Reviewed and corrected during this review; final release scope unresolved. |
| A `android/app/src/release/AndroidManifest.xml` | Release cleartext override; no added permissions/components. |
| A `android/app/src/release/res/values/strings.xml` | HTTPS address examples. |
| A `android/app/src/release/res/xml/network_security_config.xml` | Cleartext denied; system/user CAs trusted with normal TLS checks. |
| A `docs/PLAY_LISTING.md` | Local metadata/asset draft; not final Data Safety answers. |
| A `docs/PLAY_RELEASE.md` | Earlier validation retained as historical evidence; corrected by this review. |
| A `docs/play-assets/feature-graphic.png` | Local 1024x500 RGB draft using existing mark. |
| A `docs/play-assets/store-icon.png` | Local 512x512 RGBA draft using existing mark. |
| A `docs/play-assets/release-dock.png` | Actual 1920x1080 mock-data release screenshot; older UI only. |
| A `docs/play-assets/release-touchpad.png` | Actual 1920x1080 screenshot; missing released clipboard panel. |
| A `docs/play-assets/release-signature.png` | Actual 1920x1080 blank-canvas screenshot; no real signature. |
| A `scripts/build-play-assets.ps1` | Local vector-to-PNG rendering; no upload. |
| A `scripts/build-play-bundle.ps1` | Local candidate generation/verification; unsigned/signature-identity caveats above. |
| A `scripts/create-local-tls.ps1` | Explicit local CA/leaf generation, ACLs and renewal; separate from app signing. Not run in this review. |
| A `scripts/verify-secure-transport.mjs` | Ephemeral test TLS/WS credential-separation checks; no published-APK matrix. Not rerun in this review. |
| A `website/privacy.html` | Standalone local policy page; no analytics scripts; not deployed. |
