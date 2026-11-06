# Android local-address compatibility — 3 November 2026

## Confirmed cause

The Instagram reporter runs Android and Windows `0.2.6-preview.1`. Windows assigns its Wi-Fi adapter a non-RFC1918 address, and the companion advertises that same address. The phone browser reaches the companion's PIN page, but Android rejects the address before making a connection.

The public release and the preparation branch both restricted endpoints to RFC1918, loopback, localhost and RFC6598. Desktop address selection did not have the equivalent restriction. This is a real Android/desktop policy mismatch, not evidence of a typing error. Browser reachability establishes neither successful authentication nor the cause of the reporter's separate USB complaint.

## Implemented scope

- `android/app/src/main/java/com/windock/app/EndpointPolicy.kt`: retain strict numeric HTTP(S) URL parsing and all previously supported private/loopback/shared addresses. Other unicast IPv4 addresses require a matching active local broadcast subnet. Syntax-only canonicalization is separate from connection admission.
- `LocalNetwork.kt`: read IPv4 address, prefix and broadcast from OS interface metadata without recursively applying endpoint admission. The new exception requires consistent broadcast metadata, prefixes `/8` through `/30`, and a non-network/non-broadcast peer. Down, loopback, point-to-point and named cellular/VPN interfaces do not supply this exception. No hard-coded allowance for the reporter's subnet, arbitrary Internet hosts, DNS names, or IPv6 was added.
- `Discovery.kt`, `ManagedDiscovery.kt`, `PcScanner.kt`: apply the same admission to manual/remembered/discovered endpoints. Use the responding datagram's admitted source address rather than following an advertised address on another interface. Retain Wi-Fi/USB selection and HTTPS downgrade rejection.
- `KnownHosts.kt`, `ServerUrl.kt`, `SecurePairing.kt`: parse saved history and encrypted trust independently of the currently attached network. Leaving a network no longer makes a syntactically valid saved identity disappear. Loading a record does not authorize a connection.
- `SecureTransport.kt`, `FileConnection.kt`: recheck endpoint admission before HTTPS requests, including clients used for transfers. Keep certificate, stable hostname and authenticated-session checks. The managed DNS resolver also rechecks admission before resolving the numeric route.
- `MainActivity.kt`, `res/values/strings.xml`: distinguish a well-formed address that is not on a detectable local network from malformed address input.

No desktop implementation, network protocol, pairing format, dependency, permission, application identifier or version number was changed for this fix. The app remains free. The existing Play/release build remains HTTPS-only; the existing debug/legacy configuration retains HTTP/PIN compatibility.

The on-link exception relies on OS interface metadata; it does not authenticate a computer. PIN/session or managed TLS identity checks remain necessary. Previously supported private/VPN addresses retain their existing behavior. Devices that hide usable interface metadata fail closed for the new non-private exception; a physical test on the reporter's phone is still required.

API references: [Android NetworkInterface](https://developer.android.com/reference/java/net/NetworkInterface), [Android InterfaceAddress](https://developer.android.com/reference/java/net/InterfaceAddress), [RFC1918](https://www.rfc-editor.org/rfc/rfc1918.html).

## Automated validation

- Debug and release JVM suites: **51 tests each, zero failures**. Seven new tests cover non-private subnet admission, malformed/unsafe inputs, incorrect subnet metadata, same-origin enforcement, source-address discovery, saved-history retention, and Wi-Fi/USB separation.
- Android debug/release APK builds, instrumentation build and release lint passed. Lint reports **zero errors and 31 warnings**; these are not a claim of a warning-free release.
- Node regression suite: **36/36 suites passed**, including security, transfer, Windows-facing behavior and Linux provider/CLI/network/input checks. No native desktop code changed in this fix; native Windows/Linux binary builds were not repeated.
- Exact legacy APK: local policy, PC picker, dock, keyboard and performance emulator checks passed. Clipboard passed after starting its required fixture and correcting a stale test assertion for the already-replaced drawer Switch PC entry. The app's existing Connection button is now asserted instead.
- Archived desktop baseline `24500ac3beb95a8758c4a54511479d6c499aca00` (`v0.2.6-preview.1`): extracted into an ignored artifact directory, using an isolated loopback test server and fake desktop actions. Wrong PIN rejected; correct PIN accepted; live tile launch reflected through the dock; reopening retained the session. **One baseline test plus one current clipboard test passed.** This is protocol/WebView compatibility testing, not a test of a real Windows desktop executable or the reporter's network.
- Archived public Android APK upgraded in place from code **9** to code **10**, with an app-private marker retained. Its certificate matches the existing local debug test key. This establishes compatibility with the archived APK; differently re-signed APKs cannot be assumed compatible.
- Exact final HTTPS-only APK: **17 executed tests passed** for managed discovery, off-network encrypted trust retention/admission rejection, authentication, certificate renewal and mismatch rejection, port changes, session revocation, slow media/stale-read recovery, PC switching, connection navigation, Android sharing/selection and file transfers, privacy, and release policy. The runner reports 18 because the separate-process persistence test is gated in this combined invocation. Its **seed and verify phases then each passed** in separate instrumented processes. The release build is non-debuggable and rejects remembered HTTP hosts without sending credentials.

Harness notes: the first UI run was obstructed by an emulator Bluetooth crash dialog, and the clipboard test's separate server was missing. Bluetooth was disabled only in the owned disposable emulator and the fixture was started. The first secure run then encountered a fixture port conflict: the secure port-move test uses `18627`, also used by the clipboard fixture. Stop the clipboard fixture before secure tests. These failures and reruns are retained in the artifact logs; no production service or firewall was altered.

Evidence (all under `artifacts/`): `local-address-android-build.log`, `local-address-node-tests.txt`, `local-address-legacy-tests-rerun.txt`, `local-address-baseline-and-clipboard-tests.txt`, `local-address-secure-tests-rerun.txt`, `local-address-pairing-seed.txt`, `local-address-pairing-verify.txt`, `local-address-apk-verification.txt`. Android UI/transport checks used the owned API 36.1 emulator. No physical phone was modified.

## Local test APKs

Both APKs use `com.windock.app`, version code `10`, version name `0.3.0-preview.1`, min SDK 24 and target SDK 36. They were signed with the **already-existing local debug key**, whose bytes were verified unchanged. No production signing key was generated, read or modified. They are local test artifacts, not approved releases or Play upload candidates.

| Artifact | Intended companion | SHA-256 |
| --- | --- | --- |
| `artifacts/WinDock-local-address-legacy-test.apk` | Public 0.2.6 HTTP/PIN companion, or development companion; debuggable local build | `0B101202DDFB962E3A86CB711EB7D7F6A1109CC37EC5C61E89CDD81163B740FE` |
| `artifacts/WinDock-local-address-secure-test.apk` | Current HTTPS companion; non-debuggable release configuration with a local test signature | `FF8F08018FD8487A4340557E3CD7F873BA685393B7E973421685CD8DA1FAE465` |

They share the same package identifier: installing one replaces the other. Use the legacy APK for this reporter's HTTP-only 0.2.6 desktop; use the secure APK for the owner's managed-HTTPS testing. Do not weaken the Play build to accommodate an older HTTP-only companion.

## Physical-device validation still required

1. On the reporter's phone, install the legacy test APK as an update after the owner approves sharing it. Keep the existing desktop 0.2.6 installation. Do not uninstall the app to work around a signature mismatch; report that error instead.
2. Keep phone and PC on the same Wi-Fi. Enter the exact address from the companion's connection-info window. Confirm the invalid-address message is gone and the PIN page opens **inside WinDock**. Enter the PIN privately; never share a PIN, pairing QR or session token.
3. Authenticate, launch one tile, type a short message and reopen WinDock. Confirm reconnection works. Check Saved & nearby PCs as a separate discovery check; UDP discovery may still depend on the network/firewall.
4. Turn Wi-Fi off and confirm a non-private saved Wi-Fi address is not reused over an unrelated network. Restore Wi-Fi and confirm the saved connection is retained. Synthetic subnet tests cover this logic; the reporter's physical route must still be verified.
5. Test USB tethering separately with Wi-Fi off and the USB address. This address-validation fix does not establish the cause or resolution of the earlier USB complaint.
6. With the secure test APK and current companion, repeat Wi-Fi/USB reconnect, restart/unlock, keyboard, clipboard and Files & Media checks on Huawei/Samsung. The earlier hardware passes predate this APK.

The reporter's exact subnet mask and phone-side interface metadata remain unknown. Non-private networks with unsupported masks, missing broadcast metadata, routed-only access or interface-enumeration restrictions may still require further investigation. Do not change the router or disable a firewall just to test this fix.

Nothing was committed, pushed, uploaded, published or sent to the reporter. Production deployment and Google Play release/signing actions remain on hold.
