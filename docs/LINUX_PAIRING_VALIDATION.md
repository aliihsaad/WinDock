# Linux discovery, switching and QR readability — 2 November 2026

## Findings

The owner confirmed that Linux was absent from nearby PCs, manual attempts could return to the Windows dock, and the camera could not read Linux's QR. The latest Connection navigation APK was installed. These are separate stages of connecting and should not be treated as one certificate failure.

1. **Secure discovery was missing from the picker.** `PcPicker.kt` used the legacy scanner and normal system-CA health probing. The managed companion advertises v3 discovery and uses its own pinned CA. A real UDP probe of the running Linux host received v1 and v3 replies, but no v2 reply. Its TCP 8620/8621 and UDP 41234 listeners were present. Its clock agreed with this PC. This is an Android discovery integration problem, not evidence that Linux was stopped.
2. **Manual selection did not resolve another saved secure identity.** `MainActivity.kt` now resolves an entered saved PC address to that PC's trust record. Picker selection uses the discovered route with the existing pinned identity. Scanning must never save/select a different PC as a side effect.
3. **A failed new pairing could retry the previous selected PC.** The prior `WinDock-connection-navigation-local-test.apk` reproduced this in a negative-control test: after a new, valid invitation targeted an offline fixture, the screen returned to “Reconnecting securely…” instead of retaining the new-PC error. Initial pairing failures now pause automatic retries and retain the previous pairing for an explicit Return action. This is an additional confirmed defect; it does not explain a camera failing to decode a QR.
4. **Linux's web QR needed a clearer presentation.** Its old inline SVG was constrained by the page. The revised page uses the existing GIF QR endpoint, decodes its bytes into a canvas under the unchanged strict CSP, and displays a focused dialog with integer physical-pixel module scaling. The four-module quiet zone, payload, expiry and single-use semantics are unchanged. Screenshot decoding is verified; the exact camera/monitor cause on the user's hardware is not proven until physical scanning is retested.

## Implementation and compatibility

- Android: `ManagedDiscovery.kt` parses bounded v3 hints, validates the host ID and HTTPS endpoint syntax, and uses the packet source as the route. `ManagedPcScanner.kt` combines these with the existing bounded legacy scan. Saved managed hosts are verified with their existing CA; unknown advertisements appear as **New PC — Scan its code to pair**. Discovery never establishes trust.
- `KnownHosts.kt` has a transient `requiresPairing` flag. Saved-host serialization is unchanged. `PcPicker.kt`, `MainActivity.kt` and strings integrate the new discovery and selection behavior.
- Web pairing: `public/pair.html`, `public/pair.css`, `public/pair.js`. QR generation uses the already-supported `{format: "gif"}` request; no backend or protocol changes were needed. Pairing text remains available after closing the QR dialog.
- No changes to production signing, permissions, dependency versions, desktop native binaries, authentication protocol, clipboard, keyboard, transfers or updater were needed for this task. HTTPS pinning remains mandatory for managed connections. The release configuration remains HTTPS-only; legacy HTTP behavior is checked with the debug compatibility configuration.
- The Connection button remains in its present position. The owner's request to find a better position later is deferred, not forgotten.

## Linux local-test installation

Only ten public UI files were updated in `/home/alidevlab/windock-local-tests/links-20261101`: app, dock, icons, index, native transport, pairing HTML/CSS/JS, style and service worker. These bring Linux's older shared UI up to the current local testing version as well as improving its QR display.

Pre/post hashes were checked. The before/after check confirmed **all 9 tiles and the host identity unchanged**. The host was not restarted; configuration, pairing state and private keys were not edited. The actual running local-test companion is `0.3.0-preview.1`; the older installed system package version is not the active service version.

Backup: `/home/alidevlab/windock-local-tests/links-20261101/backup/ui-2026-11-02T11-13-29-423Z`. Its `rollback.mjs` verifies the installed hashes before restoring only the replaced public files. Local evidence: `artifacts/linux-update/ui-install-result.txt`, `ui-update-manifest.json` and `before-20261102/public/`.

## Automated validation

| Check | Result / evidence |
| --- | --- |
| Node security, Windows/Linux provider and protocol regression suites | 35/35 passed; `artifacts/linux-pairing-node-tests.txt` |
| Android JVM | 43 debug + 43 release passed, zero failures/skips |
| Debug/release builds and lint | Passed; zero lint errors, 30 debug / 31 release warnings; `artifacts/linux-pairing-android-build.log` |
| Web QR | 25 checks passed across 1366×768 @1, 1024×600 @1.25 and 1920×1080 @2; `artifacts/linux-pairing-browser.txt` |
| QR screenshot decoding | All three rendered PNGs decoded with ZXing core 3.4.1, the decoder version used by Android; full dialog also visually checked |
| Exact final APK: discovery, two-PC switching, failed pairing, connection navigation, managed connection, policy/privacy | Passed; `artifacts/linux-pairing-final-apk-tests.txt` |
| Exact final APK: Files & Media | All four tests passed on unchanged rerun; `artifacts/linux-pairing-files-retest.txt` |
| Pairing across separate app processes | Seed and verify passed separately; `artifacts/linux-pairing-process-seed.txt` and `linux-pairing-process-verify.txt` |
| Legacy picker, dock and keyboard | All 8 passed after the test-setup corrections below; `artifacts/linux-pairing-legacy-final-tests.txt` |
| Signature/alignment, package and release policy | Verified; `artifacts/linux-pairing-apk-verification.txt` |
| Whitespace / syntax checks | `git diff --check` and pairing JavaScript syntax passed |

The combined secure run reported 16 tests, including one phase-gated process-persistence skip. One file-transfer test initially raised an EOF reading the separate fixture-control socket on port 18625, before its product assertion. The unchanged full four-test transfer rerun passed on the same APK. The fixture was still running and had no stderr; the exact reason for that transient control-socket closure remains unproven. This was not an observed failure on the authenticated file-transfer HTTPS path.

The first legacy run inherited secure fixture credentials from the release APK run. Clearing only the owned emulator's app data restored the legacy picker and keyboard tests. A subsequent dock test queried JavaScript while Return to saved PC was navigating away from the old document; the callback was discarded. Its harness now waits for the new WebView to become visible after page completion before querying it. These test-setup corrections do not change the application APK or user data.

## APK for physical testing

`artifacts/WinDock-linux-pairing-local-test.apk`

- Package `com.windock.app`; version code **10**; version `0.3.0-preview.1`; min API 24; target API 36.
- HTTPS-only, non-debuggable release configuration, signed with the **existing local Android debug test key**, not a production upload key. The existing key file was verified unchanged.
- APK SHA-256: `98ECBEDF75CF49F35316C1EA230EA061514EBD280AACDE10C3ABD29BA92A701C`.
- Install over the existing local test app. Do not uninstall or clear its data. Windows' installed companion and pairings were not changed in this task.

## Remaining physical-device checks

1. Install the APK over the current app on Huawei/Samsung.
2. **On Linux**, reload `http://127.0.0.1:8620/pair` and choose **Show pairing code**. Scan the enlarged fresh code from phone **Connection → Scan computer code**. Do not reuse a screenshot or expired code. No manual CA installation is needed for this managed pairing flow.
3. Confirm the Linux dock has its existing 9 tiles. Before initial trust is established, nearby discovery may call it **New PC** at `192.168.178.119`.
4. Open **Saved & nearby PCs**, switch Linux → Windows → Linux, then reopen the phone app. It should retain the deliberately selected PC and not require rescanning.
5. Repeat on Wi-Fi and USB tethering; confirm connection editing stays open if the chosen PC is unavailable. Confirm scanning cancellation does not resume the previous PC behind the connection screen.
6. Send a photo; test keyboard/keyboard voice typing, clipboard and one tile on each host. Check lock/unlock and host/phone restart reconnection.

An emulator cannot establish real Huawei/Samsung camera readability, LAN broadcast delivery, monitor scaling, or USB behavior. Those remain acceptance checks. The unrelated reporter's rejected `50.50.50.241` address remains under investigation; this change does not relax the address policy. Production signing, Play account/listing/privacy publication and store testing gates remain outside this local-testing task. Nothing was committed, merged, pushed or publicly published; no production signing key was accessed or modified.

## Physical retest: discovery and QR succeed; Linux firewall blocks secure TCP

Later on 2 November the owner supplied a phone screenshot showing both the saved Windows PC and **New PC at 192.168.178.119:8621**, confirming real-device discovery. They explicitly confirmed the camera successfully decoded the fresh Linux QR, followed by **Your computer isn't responding**. QR readability is therefore verified for this retest; successful authenticated pairing is still pending.

Read-only checks of the active Linux service found:

- The service was restarted by the owner at 12:50:36 CET; PID 3086696 still runs the expected local-test root, with 9 tiles.
- HTTP 8620 and HTTPS 8621 listen on all interfaces; UDP 41234 is present.
- From Windows over the LAN, HTTP health returns 200; TCP 8621 times out before TLS starts.
- UFW is active and enabled with default inbound DROP. Its saved WinDock rules allow TCP 8620 and UDP 41234 from `192.168.178.0/24`, but have no TCP 8621 allow rule.
- A local HTTPS health check with the public CA and correct stable hostname verifies the certificate and host identity. Diagnostic: `artifacts/linux-update/check-local-tls.mjs`; result: `local-tls-check.txt`. No private key or pairing invitation was read or generated.

The missing secure-port firewall rule is the remaining network blocker. The old Windows address in the phone's form is retained until successful pairing; it does not establish that the failed QR attempt targeted Windows.

The owner must run this administrator command **on Linux** because unattended sudo requires a password. No firewall change was made by the assistant:

```sh
sudo ufw allow in on eno1 from 192.168.178.0/24 to any port 8621 proto tcp comment 'WinDock secure LAN'
```

This is limited to the current wired LAN interface and home subnet. After adding it, verify remote TCP/TLS reachability and scan a newly generated QR. Do not disable UFW, reset pairing, reinstall the APK, install a CA globally, or open router ports. USB tethering may use a different interface/subnet and needs its own scoped check; this LAN rule does not establish USB acceptance.

### Resolved after owner applied the firewall change

The owner subsequently confirmed **“it works.”** A repeat HTTPS probe from Windows to `192.168.178.119:8621` returned health 200 with certificate verification and matching host identity; evidence: `artifacts/linux-update/lan-tls-check.txt`. This confirms the missing UFW rule caused the post-scan connection failure. Real-device discovery, QR decoding and Linux pairing are now confirmed. Linux ↔ Windows switching, selected-PC persistence after reopening, and Linux USB tethering remain separate acceptance checks.
