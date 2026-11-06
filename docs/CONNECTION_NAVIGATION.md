# Connection navigation — local testing, 2 November 2026

The connection screen is now an explicit destination. Opening it must never erase a saved PC, its trust record, or its dock. The change builds on the media/reconnection fix documented in `SECURE_CONNECTION_VALIDATION.md`.

## User flow

1. Tap **Connection** at the top-left of the Android dock or PIN page. There is no dependency on a system-edge gesture. Close any open modal first.
2. Use the visible **Use another address** field, **Saved & nearby PCs**, or **Scan computer code**. Wi-Fi and USB setup stay available.
3. Reconnection pauses while intentionally viewing this page, including across app background/resume and activity recreation. An address draft survives recreation.
4. **Return to saved PC** reconnects using the retained identity. An unsuccessful attempt at another address does not delete the previous trust record; returning selects that existing identity again.
5. **Change connection** cancels an in-progress attempt. Generation checks prevent its late completion from taking over navigation.
6. **More options** contains pairing text, Files & Media, phone settings, updates and privacy. Connection help remains visible.

The new Android bridge replaces the duplicate drawer Switch PC entry with the single top-level action. Older Android clients still see the existing drawer entry; browser clients do not receive an unsupported native action. Older desktop UIs can still use their existing picker and its Enter address action with the updated APK.

## Findings and implementation

The previous Back and picker-manual paths treated intentional navigation as a connection failure. Network callbacks and foreground resume could then reconnect a saved managed host and leave the page. The old UI also buried address entry behind the drawer picker or a device-dependent Back gesture. These are verified code paths; the precise Huawei/Samsung gesture difference has not been reproduced on physical hardware.

`MainActivity.kt` now tracks intentional connection editing separately from failures, saves it in activity state, closes the active transport, invalidates pending attempts, and suppresses automatic retries until an explicit connection action. Selected pairing data remains encrypted in the existing store. Back still closes the remote keyboard or an open web sheet first. From the dock it opens Connection; from that intentional destination it returns to a saved PC. A pending attempt can be cancelled by Back or the labeled button.

The activity explicitly enables its existing Android 13+ Back callback, retaining the older `onBackPressed` handler. See [Android's supported Back APIs](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture). There are no new dependencies, permissions, transport protocols or server authentication changes.

UI files: `public/index.html`, `public/app.js`, `public/style.css`, `public/sw.js`; native layout, strings and styles in `android/app/src/main/res`; navigation in `MainActivity.kt`. The new service-worker shell version is `windock-v28-connection-navigation`.

## Validation

- Node regression suite: 35/35 suites passed, including Linux provider/CLI/input/download and security checks.
- Android JVM tests: 43 debug and 43 release tests passed.
- Android debug/release build and lint passed. Lint has zero errors; existing/general warnings remain.
- Browser: 11 new navigation checks and 31 existing panel/HDR checks passed. Tested 844×390, 640×320 and 568×320 viewports, classic and immersive layouts, PIN-page access, older Android bridge fallback and browser behavior.
- Real Android emulator navigation test exercises tapping Connection, draft preservation, retry/network-event suppression, background/resume, recreation, chooser cancellation, return without re-pairing, Android Back, cancellation of an in-flight secure probe, and manual address reconnect.
- Legacy PC picker tests passed (four), including Windows/Linux fixture switching and forgetting. Keyboard bridge/editor tests passed (three). The legacy dock test initially expected the intentionally removed drawer button; its navigation was updated, and the PIN/dock/swipe/action retest passed.
- Exact final HTTPS release-configuration APK: 12 executed tests passed across navigation, managed connection, files, release policy and privacy. The runner reports 13 because the separate-process pairing phase is skipped in the combined invocation. Both pairing seed/verify phases then passed separately. Outputs: `artifacts/connection-navigation-final-apk-tests.txt`, `artifacts/connection-navigation-pairing-seed.txt`, `artifacts/connection-navigation-pairing-verify.txt` and `artifacts/connection-navigation-apk-verification.txt`.
- Final APK SHA-256: `09CEAE6E354745344A83298C856EB77BF665E8302AAB5710EA7D9DFD03C3C765`. Signature matches the existing local test certificate; alignment and HTTPS/non-debuggable release-policy checks passed.

No native Windows/Linux binaries were changed in this task. Native Linux GUI testing and OEM-specific Back gestures were not exercised here.

## Local installation and device acceptance

This PC's four shared UI files were backed up and updated without restarting the host. The live before/after check confirmed all 19 tiles, their contents/order and the host identity were unchanged. Configuration, pairing stores and keys were not touched. Backup and verification: `artifacts/connection-navigation-ui-install-result.json`.

Install `artifacts/WinDock-connection-navigation-local-test.apk` over the existing local testing app. It uses the same existing debug test certificate, package `com.windock.app`, version code 10, minimum API 24 and target API 36. The APK uses the HTTPS-only, non-debuggable release configuration. It is not a production-signed Play artifact. Do not uninstall or clear app data.

Physical-device acceptance still required on Huawei and Samsung:

- Open the updated app and tap Connection without swiping Back.
- Edit the address, switch away from WinDock and return: the draft and page must remain.
- Tap Return to saved PC: reconnect without scanning a code; tiles stay intact.
- Try a deliberately unused local address, then Return to saved PC; it must recover without re-pairing.
- Cancel a connection attempt, open Saved & nearby PCs, and verify More options remains accessible.
- Leave the connected dock open on Wi-Fi for several minutes, then check lock/unlock and USB tethering. Confirm the previously reported reconnect loop does not return.
- Send a photo and check keyboard/keyboard voice typing after returning from Connection.

No commit, merge, push, upload, publishing or production deployment was performed. Production signing keys were not accessed or changed.

## Separate tester report: rejected 50.50.50.241 address

While finishing this task, the owner supplied screenshots of a tester entering `http://50.50.50.241:8620` and receiving the native IPv4 validation error. This is a valid IPv4 literal, but it is outside the private/loopback/shared IPv4 ranges permitted by `EndpointPolicy.isAllowedHost`; rejection occurs before any network request. The screenshots do not establish why discovery or USB also failed.

The current desktop `src/discovery.js:primaryAddress` ranks private interfaces preferentially but also accepts non-private interface addresses. A synthetic Ethernet interface with `50.50.50.241` reproduced the function choosing that address. `server.js` uses it in the endpoint printed to stdout, and the Windows tray displays that endpoint. Thus a desktop/Android policy mismatch is real; the tester's claim that this exact address came from their PC still needs their connection-info screenshot.

Next diagnostics: PC WinDock connection info with the PIN hidden; IPv4 address and default gateway for the active Wi-Fi/Ethernet adapter; whether a VPN or virtual adapter is involved; installed phone/desktop versions. Do not assume the address is a public router WAN address or a typo: a nonstandard local network may assign it too. Do not relax HTTPS, pairing or address checks based on the screenshot alone. No message was sent to the tester and no policy change was made for this separate report.
# Instagram address-rejection report: evidence received 3 November 2026

The reporter supplied screenshots of Android app information, Windows `ipconfig`, and the WinDock connection window. Both apps report `0.2.6-preview.1`. The active Wi-Fi adapter shows IPv4 `50.50.50.241` and gateway `50.50.50.1`; its subnet mask is redacted. WinDock displays exactly `http://50.50.50.241:8620`. Thus the rejected input matches both the companion's advertised address and Windows' Wi-Fi adapter. Do not describe this as a typing error or assume the address is from a VPN. The reporter previously said no VPN. The phone's own address/routing and end-to-end reachability remain unverified.

Source comparison against public tag commit `24500ac3beb95a8758c4a54511479d6c499aca00` confirms that `EndpointPolicy.isAllowedHost` accepts only localhost, loopback, RFC1918 and RFC6598 numeric addresses, in both that release and the current working copy. `50.50.50.241` is valid IPv4 but outside these allowed ranges. `MainActivity` rejects it with `invalid_address` before any connection attempt; adding or removing `http://` cannot fix that. Desktop `primaryAddress` accepts this real adapter address. Current `LocalNetwork.available` also filters local interface addresses through this policy, and legacy/managed discovery reuse the policy: this is an address-policy consistency problem that is still present in the current source, not merely an old-version symptom. It does not by itself explain the separately reported USB failure.

Local diagnostic: `artifacts/instagram-address-diagnostic/CheckEndpoint.java`, run against the existing compiled debug EndpointPolicy and Kotlin stdlib, confirmed rejection of the bare address, HTTP URL and HTTPS URL, while an RFC1918 control was accepted. An independent Node fixture invoking the actual current desktop `primaryAddress` selected the reporter's supplied Wi-Fi address. Both diagnostics passed; neither contacted the reporter's address or changed app/network state. Public/current source inspection establishes that the relevant allowlist is unchanged; this was not a new full APK build or physical-device test.

Android's app-information page saying no permissions required / notifications blocked does not explain this pre-network validation error. The released manifest includes normal INTERNET and network-state permissions. See [Android networking permissions](https://developer.android.com/develop/connectivity/network-ops/connecting) and [RFC1918 address ranges](https://www.rfc-editor.org/rfc/rfc1918.html). An address outside RFC1918 is not proof that the computer is reachable from the public internet; these screenshots do not establish the router's policy or why this range was assigned.

Next diagnostic: while the phone is on the same Wi-Fi, open the exact address shown by the PC in its browser and report only whether the WinDock PIN page appears. Do not enter or share the PIN, send full network logs, alter the router or disable the firewall. This separates application validation from actual reachability. A potential fix must reconcile manual entry, discovery, saved connections and secure pairing with verified local-network routes, preserving strict numeric URL validation and TLS/identity checks; do not globally allow arbitrary public addresses or hard-code this reporter's range. No application code, signing, publication or external message changed during this investigation.

## Reporter confirms browser reachability

The owner subsequently supplied the reporter's reply, “Yeah it appears,” and a phone-browser screenshot showing the WinDock PIN page at `50.50.50.241:8620`. Together with the matching desktop/adapter screenshots and deterministic Android-policy rejection, this confirms the address-validation mismatch as the cause of the native app's invalid-address error. The HTTP route is reachable from that phone at the time of this test. The screenshot does not establish successful PIN authentication, remote controls, USB behavior, or HTTPS reachability. The reporter reasonably prefers using the Android app; treat browser access as a diagnostic/temporary alternative, not completion of the app fix.

No more browser-page evidence is needed for this failure. At the time of that confirmation, the native compatibility fix was unimplemented. The owner subsequently authorized it; see [Local address compatibility](LOCAL_ADDRESS_COMPATIBILITY.md) for the implementation, validation, artifacts and remaining physical-device checks. Do not hand the reporter an HTTPS-only Play test APK as an assumed drop-in replacement for their HTTP-only 0.2.6 companion. No build was sent or message posted.
