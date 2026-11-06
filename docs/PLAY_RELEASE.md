# Google Play preparation — local work only

The unpublished upcoming build includes [Files & Media](FILES_AND_MEDIA.md),
system file selection and authenticated HTTPS transfers. Dedicated native voice
recognition and its microphone permission were removed; keyboard voice typing
and the consolidated controls island remain. Review the updated privacy and
Data Safety drafts before publishing. No app version or production signing
configuration changed for this work.

**Release hold:** preparation is integrated on the v0.2.6 runtime baseline.
See [PLAY_INTEGRATION.md](PLAY_INTEGRATION.md) for current validation and remaining
gates. [PLAY_REVIEW.md](PLAY_REVIEW.md) records the earlier stale-baseline findings.
Historical test results below must not be substituted for current validation.

Branch: `play-store-integration-v0.2.6`. The app remains free, without ads, subscriptions,
in-app purchases or registration. Remote control has no cloud relay; desktop
update checks do contact the website. No script here uploads to Play.
Preparation is not approval to publish. Account ownership, signing, actual device
acceptance and listing declarations remain release gates.

Owner-confirmed: support email `alidevlab10@gmail.com`; AliDevLab personal account
created, dashboard accessible, no WinDock listing created. Production access and
remaining verification tasks are not established by the enabled Create App button.
The current managed pairing build has user-confirmed Huawei passes for native
QR pairing, app and device restart reconnection with retained tiles, Wi-Fi/USB
switching, and two-/ten-minute phone-lock recovery. Remaining physical feature,
edge-case and platform checks are tracked in [SECURE_CONNECTION_VALIDATION.md](SECURE_CONNECTION_VALIDATION.md).
No production private signing key
may be generated, overwritten, committed or exposed without explicit approval.
The [signing plan](PLAY_SIGNING.md) is documentation only; deployments and uploads
remain on hold.

## Current release status

New features are frozen as of 3 November 2026. Use
[PLAY_BLOCKERS.md](PLAY_BLOCKERS.md) for the ordered current release checklist
and exact candidate evidence. Earlier dated validation sections describe their
own artifacts and do not replace final-candidate or Play-distribution checks.

## Compatibility and transport

`com.windock.app` and Android 7/API 24 support are retained. Compile/target SDK is
36; version code 10 exceeds public 0.2.6's code 9. Debug builds keep v1
UDP discovery, HTTP connections and the released manual update behavior.
Release builds require HTTPS. Managed pairing adds v3 discovery; v2 remains for
existing manually provisioned HTTPS. There is no release HTTP fallback.

### Recommended setup: scan once

Start the updated companion. On Windows choose **Pair a phone securely** from
the tray menu; on Linux open the local pairing link displayed by `windock`.
On Android choose **Scan computer code** and scan the code shown on that PC.
Camera permission is optional; **Enter pairing text** provides an alternative.
Certificate setup and routine renewal are automatic. No Android system CA
installation is needed for this path. See [SECURE_CONNECTIONS.md](SECURE_CONNECTIONS.md)
for identity preservation, session revocation, migration and real-device checks.

Managed HTTPS uses automatic TCP/8621, or TCP/8622 alongside an explicitly
configured external certificate. Automatic port fallback remains supported;
`WINDOCK_MANAGED_TLS_PORT` selects an explicit port. Keep firewall rules limited
to trusted local networks. The application does not change firewall rules.

The updated desktop keeps HTTP/8620 and UDP/41234. The released automatic fallback
and saved explicit HTTP port are retained. When configured, it also serves
HTTPS/8621; automatic HTTPS also falls back if that port is unavailable, while an
explicit WINDOCK_TLS_PORT fails with a diagnostic if occupied. Discovery and the
tray show actual bound ports. Both transports use the same dock state, input lease,
capture worker and API routes. They use different PINs, token stores and cookie
names, with one shared host-wide pairing failure budget and PC-local recovery.
Both retain six-digit pairing, Host checks, clipboard history/paste and update
routes. HTTPS requires pairing even on loopback. The tray shows both sets of
connection details. The
0.3.0 desktop package includes `scripts/create-local-tls.ps1` and this guide;
the helper is included explicitly in the installer, never generated private keys.

### Existing manual HTTPS setup (optional compatibility path)

Preferred for managed networks: provision an RSA/ECDSA server certificate with
the LAN and USB IP addresses in its subjectAltName and a chain Android trusts.
Set `WINDOCK_TLS_CERT` (PEM leaf/chain), `WINDOCK_TLS_KEY` (PEM private key), and
optionally `WINDOCK_TLS_PORT` before starting WinDock. TLS >= 1.2 is required.
Missing/invalid partial configuration fails host startup, rather than pretending
that HTTPS is enabled. Never commit or distribute private keys.

For a private local installation, PowerShell 7.2+ can run:

```powershell
pwsh -File scripts/create-local-tls.ps1
$env:WINDOCK_TLS_CERT = "$env:LOCALAPPDATA\WinDock\tls\host.crt"
$env:WINDOCK_TLS_KEY = "$env:LOCALAPPDATA\WinDock\tls\host.key"
# Start WinDock from this environment (or configure these variables for its user).
```

The helper creates an owner/SYSTEM-only directory, a per-PC CA, and a one-year
server certificate. It does not install trust or change firewall rules. Transfer
only `windock-ca.crt` over a trusted channel, verify its SHA-256 with the PC owner,
and explicitly install it as a CA certificate in Android settings. Android will
warn about this trust; a user CA can affect other connections, so understand the
scope before installation. Never send `windock-ca.key` or `host.key` to the phone.
The release app accepts system and explicitly installed user CAs, validates the
certificate and IP, and never overrides TLS errors. Remove the CA when no longer
needed. Enable USB tethering before issuing the certificate so its IP is included.
Rerunning the helper reuses the CA and renews the leaf for current IPs; restart
the host afterwards. Plan CA replacement before its five-year expiry.

This older setup remains supported and its files are never overwritten by the
managed certificate lifecycle. The owner previously installed a test CA on the
Huawei phone; that older test is separate from the subsequent managed QR and
reconnection acceptance recorded above. Remaining device and release gates
still apply before publication.

## Build and upload signing

SDK Platform 36, Build Tools 36.1.0, JDK 17/21, AGP 8.10.1, Gradle 8.11.1.
The Gradle download is checksum-verified. Runtime SDKs were not broadly upgraded.

```powershell
# Local inspection bundle; deliberately not a publication candidate:
pwsh -File scripts/build-play-bundle.ps1 -Unsigned
# With a dedicated upload key supplied privately in the environment:
pwsh -File scripts/build-play-bundle.ps1
```

Signing inputs: `WINDOCK_UPLOAD_STORE_FILE`, `WINDOCK_UPLOAD_STORE_PASSWORD`,
`WINDOCK_UPLOAD_KEY_ALIAS`, `WINDOCK_UPLOAD_KEY_PASSWORD`, and owner-approved public
`WINDOCK_UPLOAD_CERT_SHA256`. Never put passwords in
command arguments, source files, logs or a PR. Use a dedicated upload key, not an
Android Debug certificate. `signedReleaseBundle -PwindockUploadSigning=true` fails
if signing is incomplete, expired, debug-signed or mismatches that fingerprint.
Ordinary builds do not open upload keys. `-Unsigned` passes
`-PwindockUnsigned=true` and rejects signatures in its output, even if upload
variables are inherited. Conflicting signing modes fail immediately.
The existing GitHub workflow still distributes debug previews and now also checks
release lint and bundle generation; it does not distribute a production bundle.

Before generating a permanent key, confirm AliDevLab account/package ownership,
the highest distributed version code, Play App Signing setup, recovery custody and
who holds the upload key, then obtain explicit approval. No production key has
been created in this work. See PLAY_SIGNING.md for custody and migration details.
Preview APKs have used different debug keys. Do not promise an in-place upgrade
to production signing: users may need to uninstall the preview, losing phone
preferences/pairing but retaining their separately stored PC dock and files.

## Privacy and listing

`android/app/src/main/assets/privacy.txt` is accessible offline before pairing.
`website/privacy.html` is its prepared public webpage, not a deployed URL.
Support contact is `alidevlab10@gmail.com`; the optional issue tracker is public,
so do not post personal data there. The draft describes the integrated clipboard,
saved-PC identity, storage, transport and update behavior; see PRIVACY_REVIEW.md.
Publish the policy only with approval, then verify worldwide access and record
its real URL. `docs/PLAY_LISTING.md` contains local metadata and declaration drafts.

## Validation and publication gates

- Run `npm test` (mock desktop, real HTTP/HTTPS/WebSocket and discovery checks).
  TLS tests require OpenSSL; Git for Windows supplies it, or set `OPENSSL`.
- Run Gradle debug and release JVM tests, lint, bundles and instrumentation build.
- Run `DockSmokeTest`, keyboard, phone-options, performance and now-playing tests
  against their isolated fixtures. Test real system Back on API 36, including IME.
- Inspect final release manifest/permissions, debuggability, signing certificate,
  dependencies and absence of `.so`; validate the AAB with bundletool.
- Test signed release on API 24/25, intermediate Android, 34–37, a 16 KB device,
  low-memory phone, tablet/foldable, and multiple USB-tethering OEMs.
- Test trusted/untrusted/expired/wrong-IP certs, revoked trust, no HTTP fallback,
  malformed v2 discovery and credential separation; then real HTTPS pairing,
  launch/focus, input, media, signatures and capture on a Windows test machine.
- Test background/resume, rest, disconnect, changing IP, rotation, split screen,
  keyboard composition/emoji, host restart and Play-to-Play upgrades.
- Confirm free listing, developer verification, package registration, ads=no,
  rating/audience, Data Safety, support email, privacy URL and reviewer access.
- Prepare real screenshots, 512px store icon and 1024x500 feature graphic.
  Local draft assets are already in `docs/play-assets/`; review them and extend
  screenshots to physical devices and tablet layouts before submission.
- For this newly created personal account, complete 12 testers/14 consecutive days and request production
  access. Run Play pre-launch checks only after separate upload approval.

No upload or publishing action is authorized by this document.

### Reproducing the emulator HTTPS checks

Use an isolated emulator and the non-debuggable release APK signed with a
test-only key matching the instrumentation APK, never production credentials.
Generate a CA/leaf into an ignored test folder with `create-local-tls.ps1`, then
set `WINDOCK_SMOKE_TLS_CERT` and `WINDOCK_SMOKE_TLS_KEY` to the leaf PEM files.
Start `node scripts/android-smoke-host.mjs`; it exposes only a mock PC on loopback
HTTP/18622 and HTTPS/18623. On the emulator, install only that CA's public `.crt`
through Android Settings after comparing its fingerprint. Reverse TCP/18623
with adb; the test uses `https://127.0.0.1:18623`, which the leaf covers.

Run `SecureDockTest#releasePairsOverTrustedTlsAndUsesLiveDockAndInput` with
`-e verifySecure true`. Remove that specific CA through Settings, then run
`SecureDockTest#releaseRejectsRemovedCertificateTrust` with
`-e verifyUntrusted true`. Both flags default off to avoid touching unrelated
test setups. For store-size screenshots, use emulator size 1080x1920 before
the first test; restore the prior display size, remove the reverse mapping,
stop the fixture and remove the temporary CA afterward.

## Historical verification before v0.2.6 integration (superseded)

These results and hashes describe the discarded old-baseline build. Current results
are exclusively in PLAY_INTEGRATION.md; do not distribute these historical artifacts.

- Full repository suite: 21/21 checks, including real TLS/WebSocket tests using
  an ephemeral certificate and a mock PC. npm production audit: no known advisories.
- API 36 debug/release builds, both JVM suites (14 tests each), release lint and
  unsigned AAB generation passed. Release lint has 0 errors and 17 warnings;
  user-CA trust and legacy source-set cleartext warnings are intentional reviewed
  boundaries, not blanket suppressions. The final release manifest disallows
  cleartext, has no debuggable flag and preserves minSdk 24. AAB has no `.so` files.
- Android 16/API 36.1 emulator: dock and keyboard 4 tests; privacy, phone options
  and performance 4 tests; release transport policy 1 test; trusted HTTPS dock/input
  and removed-certificate-trust rejection 2 tests, all passing (11 unique tests).
  `ReleasePolicyTest` is opt-in with `-e verifyRelease true`; run it only against
  a non-debuggable release APK test-signed with the same key as instrumentation.
- The release-policy APK was signed with the existing Android Debug key only
  for emulator testing. It is named `release-test-only.apk` and is NOT a Play
  artifact. The inspection AAB is unsigned. Production signing was not performed.
- Missing upload credentials correctly fail `signedReleaseBundle`.
- Windows companion and installer builds passed; 42 desktop update checks and
  workflow syntax validation passed. The installer was not installed on this PC.
  Local CA/leaf provisioning and
  chain/IP verification passed in an ignored artifact directory, without trust
  installation on real devices. On the emulator only, the public test CA was
  installed through Android Settings; release HTTPS pairing, legacy-PIN rejection,
  authenticated WSS dock/input, Back and recreation passed. The CA was removed
  through Settings afterward and the release rejected that certificate. Physical
  phone/USB and real Windows-provider HTTPS acceptance remain pending.
- `bundletool` 1.18.3 validated the final inspection AAB. SHA-256:
  `660780FB0A869B83605EE8228D1E58A027BBDDEF8A803143F7378F90E141FBE0`.
- Store drafts: 512px 32-bit PNG icon; 1024x500 24-bit PNG feature graphic;
  three actual 1920x1080 24-bit PNG release screenshots using fake fixture data.
- The initial code-9 selection exceeded the code-8 emulator build. The later
  compatibility review found public 0.2.6 already uses code 9; this is not a
  valid next release code. No WinDock listing has been created in Console.

Current remaining gates are in PLAY_INTEGRATION.md. Before upload approval:
finalize and approve public policy hosting, AliDevLab Console setup/verification,
approved permanent upload key custody, signing migration,
real-device HTTPS/certificate onboarding and desktop acceptance, final approval
and expansion of store drafts, final Data Safety/reviewer instructions. No uploads,
deployments, public releases or changes to the user's running desktop host occurred.

## Official references checked 2026-10-30

- https://support.google.com/googleplay/android-developer/answer/11926878
- https://developer.android.com/build/releases/agp-8-10-0-release-notes
- https://developer.android.com/privacy-and-security/local-network-permission
- https://developer.android.com/about/versions/16/behavior-changes-16
- https://support.google.com/googleplay/android-developer/answer/10144311
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://developer.android.com/studio/publish/app-signing
- https://support.google.com/googleplay/android-developer/answer/9866151
- https://support.google.com/googleplay/android-developer/answer/14151465
