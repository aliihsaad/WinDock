# Secure connection lifecycle

Implemented locally on `play-store-integration-v0.2.6`. Publication and production Android signing remain on hold. See the validation report for the exact checks completed.

## Audit before implementation — 31 October 2026

* `scripts/create-local-tls.ps1` manually creates a five-year RSA CA, preserves that CA on reruns, but generates a new one-year leaf/key on every invocation. The leaf contains the current private IPv4 addresses. New addresses require another invocation and host restart. Missing half of a CA pair is rejected; upcoming CA expiry is rejected. No scheduled renewal exists. The dedicated directory receives a current-user/SYSTEM Windows ACL.
* `server.js` only enables HTTPS when both `WINDOCK_TLS_CERT` and `WINDOCK_TLS_KEY` are supplied. It reads the files once, uses TLS 1.2 or later, and serves HTTP and HTTPS with separate PINs/session stores and a shared failure budget. There is no certificate reload or expiration check. Explicit user-managed certificates must remain supported and untouched.
* `src/auth.js` stores opaque sessions in memory for up to 180 days. Every desktop restart loses them. Browser cookies are scoped to an IP origin, so an address change also loses access to an otherwise valid session.
* `src/host-identity.js` persists a public UUID beside the dock configuration. This is a discovery label, not cryptographic proof. Its fallback to a new in-memory UUID on read errors is unsuitable as the root of secure trust.
* Android `HostProbe.kt` and `MainActivity.kt` use platform HTTPS/WebView trust. Release `network_security_config.xml` trusts system and explicitly installed user CAs. No per-host certificate trust record exists. Certificate installation and IP subject-alternative-name matching explain the difficult phone setup. TLS verification is currently not bypassed.
* `ServerUrl.kt`/`KnownHosts.kt` remember endpoints and public host IDs, not credentials or keys. `Discovery.kt` supports legacy v1 and HTTPS v2 discovery, checks private addresses, and accounts for USB interfaces. Discovery replies alone cannot authenticate a host.
* `MainActivity.kt` connects at startup and on explicit actions. Resume resumes the WebView but does not rediscover a moved PC. `public/app.js` retries a WebSocket every two seconds against its original origin. This cannot recover from an IP change and lacks exponential backoff.
* Windows tray parses endpoint/PIN output and exposes connection information. Linux runs the same Node server, but its service publishes only HTTP information in its private runtime status file. There is no equivalent managed certificate setup on either platform. Linux intentionally keeps pairing PINs out of the system journal.
* Desktop config is outside application binaries, so ordinary updates can preserve identity, but manually configured certificate paths are external prerequisites. Removing app data removes identity; it must never be treated as a trusted renewal by Android. Android backups are disabled in `AndroidManifest.xml`.

## Implementation design

Keep legacy HTTP, PIN pairing, existing explicitly configured HTTPS, the shared dock UI, and all application/control protocols. Add a managed HTTPS path and an Android native transport adapter for that same UI. WebView SSL errors are never ignored.

The desktop stores a private, per-installation CA and server identity beside its user configuration. A short-lived, single-use QR invitation shown locally contains only the public CA, public host ID, connection hints and a random pairing authorization. The phone explicitly scans that invitation, validates the TLS chain and stable host name, and stores trust and its session privately. No private key is transferred and no global Android trust-store change is required. Discovery supplies address hints; only authenticated TLS can establish that the PC is the remembered one.

Routine server certificate renewal retains the established CA. Changing a PC's IP only changes routing, not its TLS name. External certificate files remain user-managed. Unexpected identity loss/corruption fails closed with recovery guidance rather than generating a silent replacement.

References used: [Android WebViewClient SSL handling](https://developer.android.com/reference/android/webkit/WebViewClient#onReceivedSslError(android.webkit.WebView,android.webkit.SslErrorHandler,android.net.http.SslError)), [OkHttp 4.12.0 handshake certificates](https://github.com/lysine-dev/okhttp/blob/parent-4.12.0/okhttp-tls/src/main/kotlin/okhttp3/tls/HandshakeCertificates.kt), [Peculiar X.509](https://peculiarventures.github.io/x509/), [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded).

## Pairing and everyday use

1. Start the updated companion on your computer. On Windows open its tray menu and choose **Pair a phone securely**, or use that button in **Show connection info**. The QR appears directly in a WinDock window. On Linux open the local pairing link shown by `windock`.
2. Put the phone and computer on the same Wi-Fi, or connect USB and enable USB tethering.
3. Windows creates a code when the pairing window opens; use **Show a new code** after expiration. On Linux click **Show pairing code** in the local page. In Android WinDock choose **Scan computer code**. Allow camera access if desired; alternatively use **Copy pairing text** on Windows and **Enter pairing text** on Android. Only use a code displayed on your own computer.
4. WinDock remembers this computer. Normal restarts and updates do not require pairing again. A code expires after two minutes and can pair only one device.
5. If disconnected, foreground WinDock and allow it to reconnect. To change computers or enter an address, tap **Connection** at the top-left of the dock. The native page offers **Saved & nearby PCs**, **Scan computer code**, Wi-Fi/USB and a visible address field. **Change connection** cancels a pending attempt; automatic reconnection pauses while intentionally editing this page. **Return to saved PC** keeps the saved identity. **More options → Enter pairing text** remains available without camera permission. Older Android clients retain their drawer's **Switch PC** action.

No private key or system CA installation is involved in this setup. No cloud account, fee or relay is introduced.

The Windows pairing window renders the host's QR as a bitmap without an embedded browser or an additional QR dependency. Closing it leaves already paired phones connected. **Paired phones and diagnostics…** explicitly opens the existing local management page for diagnostics and **Forget paired phones**. Normal QR pairing does not open a browser. Linux and direct browser access retain the original SVG pairing page and protocol.

## Identity, renewal and storage

The shared Node host handles this on Windows and Linux. `src/managed-tls.js` creates ECDSA P-256 keys and a per-installation CA using WebCrypto and X.509 certificate generation. Its leaf certificate is valid for 90 days and renews with 30 days remaining. A ten-year CA certificate renews with 180 days remaining using the **same CA key**. Renewal checks run at startup and every six hours while the host is running; they do not scan the network. `setSecureContext` updates future TLS handshakes without closing established connections.

The identity is the CA public key plus the stable host ID and signed DNS name `host-<UUID>.windock.invalid`. This name is resolved only by the Android per-computer transport to the discovered private address; it does not use public DNS. Normal PKIX chain and hostname verification remain enabled. Authenticated health responses may update a stored CA certificate only if its public key and subject remain identical. A phone offline beyond an entire CA lifetime may require explicit pairing again if its platform rejects the expired trust anchor.

State follows the desktop configuration path (`WINDOCK_CONFIG`, otherwise the existing per-user default):

| File | Contents / protection |
| --- | --- |
| `<config>.host-id` | Existing public discovery UUID |
| `<config>.secure-identity` | Public identity digest and UUID; prevents accidental silent identity recreation |
| `<config>.secure/identity.json` | CA and leaf certificates and their private keys; never distribute |
| `<config>.secure/sessions.json` | SHA-256 hashes of secure session tokens, with expiration times |

The private directory is owner-only (`0700`, files `0600`) on Linux, and current-user/SYSTEM only on Windows. Writes replace complete files atomically. Initial generation uses a directory lock. An interrupted setup may leave `identity.lock`; close all hosts and investigate before removing that empty lock. Corrupt, mismatched or missing established identity files cause startup to fail instead of silently generating a replacement. Keep any identity backup private and restore the matching files together. Never put them in a release ZIP, repository or support ticket.

Normal application updates replace binaries, not this state. Reinstalling while preserving user data preserves identity. Removing that data or moving to a new computer requires explicit pairing. To deliberately replace a lost identity, stop the host, archive its secure directory, public marker and host-ID file privately, then start a fresh installation and scan a new code on each phone. This is an explicit recovery procedure, not automatic renewal.

Android stores public trust records and bearer sessions encrypted using a non-exportable Android Keystore AES-GCM key. App backup/device transfer remains disabled. An Android app update preserves its data when signing identity is compatible; clearing storage or uninstalling requires pairing again. A broken Keystore record offers **Connection help → Reset pairings** with confirmation. Forgetting a PC deletes its managed trust record locally. **Forget paired phones** on the computer revokes all HTTPS sessions and outstanding invitations; legacy HTTP pairing remains separate.

## Reconnection and diagnosis

Managed Android watches network changes while foregrounded, retries after failures with delays of 1, 2, 4, 8, 16 and 30 seconds, and then stops until a user action, resume or network event. Discovery is bounded; public v3 host IDs only filter candidates. Every candidate still needs the saved TLS identity and a valid session. Backgrounding closes native sockets and cancels retries. There is no new service, wake lock or idle scan loop. Existing web clients retain their transport path.

Failures distinguish an unavailable connection, an expired certificate, an unexpected identity, an expired/revoked session, pairing lockout and unreadable saved trust. Raw network errors and credentials are not displayed. **Connection help** shows a diagnostic category. The computer pairing page's **Connection diagnostics** shows public certificate dates, identity digest and actual managed port; it contains no PIN, invitation secret, token or private key.

An exhausted/expired session needs a fresh pairing invitation; host-side expiry remains 180 days. Existing per-client and host-wide failed-pairing limits also apply to QR claims. A stolen invitation is a short-lived authorization, so do not send it to someone else or include it in a screenshot/log.

## Compatibility and migration

* `com.windock.app`, minimum API 24, target API 36 and unpublished version code 10 are retained. The debug/GitHub path still supports legacy HTTP; Play requires HTTPS.
* HTTP PIN authentication, API routes, v1 discovery and legacy cookies are preserved. Existing explicit TLS files, secure PINs and v2 discovery remain supported without modification.
* Managed pairing adds v3 discovery on the same UDP port 41234 and HTTPS on automatic TCP 8621. With externally configured HTTPS, managed pairing uses automatic TCP 8622 instead; both listeners share the same controls and HTTPS session store. Explicit managed-port configuration uses `WINDOCK_MANAGED_TLS_PORT`. Automatic port fallback is preserved.
* Android's native adapter transports the same shared UI, JSON API and two WebSocket channels. It keeps credentials out of page JavaScript, checks origin, bounds queues/messages, and preserves remote input, composition, clipboard, app/folder launching, capture and per-PC appearance storage. The website demo keeps its simulated transport.
* Windows and Linux use the same identity, session and renewal implementation. Linux prints a local pairing link and keeps PINs out of the system journal. Firewall acceptance, Linux/Hyprland runtime behavior and actual USB routing still require platform testing.
* Users of the earlier manual certificate test can scan once into managed pairing while their existing manual HTTPS continues to work. Remove the old Android user CA only after confirming nothing still needs it. If any private test CA key was copied to the phone during earlier setup, remove that copy and retire that manual test CA; it is not reused by managed pairing.

## Real-device release checklist

- [x] Initial managed QR connection on the Huawei reported working by the user on 31 October 2026, using the browser pairing page.
- [x] Native Windows QR display and successful phone connection reported by the user on 31 October 2026 (same Huawei test phone).
- [ ] Verify camera denial and pairing-text fallback.
- [x] User reported all four requested feature groups working on the managed build on 31 October 2026: typing/emoji/voice, clipboard both ways, app launch/focus and saved folder opening, media/capture. The chat explicitly demonstrated text, emoji, dictation, Teams launch and clipboard paste; remaining actions were covered by the user's overall confirmation rather than individually observed.
- [ ] Complete extended physical checks for composition edge cases, folder add/remove and per-PC appearance preferences on the managed transport.
- [x] Restart the companion through the same local-test launcher and force-stop/reopen Android: user confirmed automatic reconnection without scanning the QR again on 31 October 2026.
- [x] Full phone and Windows restarts: user explicitly confirmed automatic reconnection without rescanning and retained tiles on 31 October 2026.
- [x] Phone locked for two minutes and ten minutes: user explicitly confirmed automatic reconnection after unlocking and opening WinDock for both durations on 31 October 2026.
- [ ] Measure background network/service/wake-lock behavior on the physical phone; successful foreground recovery alone does not verify resource usage.
- [x] Wi-Fi to USB tethering with phone Wi-Fi disabled, then back to Wi-Fi: user reported the walkthrough works on 31 October 2026, including automatic reconnection without another QR or PIN.
- [ ] Physically unplug/replug the USB cable and verify recovery.
- [ ] Change the PC's DHCP address or active adapter in a controlled test. Confirm discovery finds the original identity automatically.
- [ ] Verify wrong/expired invitations, explicit session revocation, temporarily blocked pairing, unexpected host identity and restoration from a protected identity backup.
- [ ] Test a clean Windows installation/firewall prompt, Linux/Hyprland startup/update/config permissions, Android API 24, and a current physical Android device/WebView.
- [ ] Confirm same-signature app upgrades retain saved trust. Resolve debug/GitHub-to-Play signing migration separately before release.

The earlier Huawei feature tests predate this flow. Native managed QR pairing, automatic reconnection after restarting both apps and both devices (with tiles retained), Wi-Fi/USB tethering switching in both directions, recovery after two- and ten-minute phone locks, and the subsequent four-group feature pass are now user-confirmed. Extended feature edge cases, physical cable reconnection, renewed certificates, measured background resource usage and the remaining recovery scenarios still need physical-device verification. The newly added quick-controls curtain has separate pending phone acceptance in [QUICK_CONTROLS.md](QUICK_CONTROLS.md).
