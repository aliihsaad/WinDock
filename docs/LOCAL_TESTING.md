# WinDock local Wi-Fi and USB testing

Prepared 31 October 2026. These are free local test builds, not production or
Google Play uploads. No installed Windows application was replaced by preparation.

## Files and installation

The kit is in `artifacts/local-testing-20261031/`:

| File | Use |
| --- | --- |
| `WinDock-Android-HTTPS-test.apk` | **Primary test APK.** Release behavior: HTTPS required, not debuggable, Play-only Android update UI. Signed with the existing Android Debug test key solely for installation. |
| `WinDock-Android-legacy-preview.apk` | Optional compatibility test: debug build retaining HTTP and preview updates. |
| `WinDock-Windows-local-test.zip` | Portable Windows x64 companion; includes its runtime, TLS helper, test launcher and guides. Extract before running. |
| `SHA256SUMS.txt` / `TEST-RESULTS.md` | Exact artifact hashes and completed automated checks. |

Both APKs are `com.windock.app`, version `0.3.0-preview.1`, code **10**, minimum
Android 7/API 24, target API 36. They replace one another; they cannot be installed
side-by-side. Their signer matches the tested public v0.2.6 preview. An existing
installation with a different signer cannot be upgraded in place: stop and record
the error instead of uninstalling automatically. Uninstalling erases phone settings
and pairing. This is not a production-signing migration test.

1. Record phone model, Android version, Windows version and whether WinDock is
   already installed. Keep the previous APK/installer available for later rollback.
2. Copy the **HTTPS test APK** to the phone using USB File Transfer, then open it
   in the phone's Files app. If prompted, allow that app to install this APK; revoke
   that permission after installation. Leave Play Protect enabled. Android's USB
   file-transfer instructions are [here](https://support.google.com/android/answer/9064445).
3. Extract the Windows ZIP into a new local folder. Do not copy it over the normal
   installed WinDock folder. The Windows executable is a local unsigned build;
   verify its source/checksums if Windows displays a publisher warning.
4. Quit the normal WinDock from its tray menu before starting the test copy. Do not
   uninstall it. The test launcher refuses to start if another tray is running.
5. Use PowerShell **7.2 or later** (`pwsh`) for the commands below, with the current
   directory set to the extracted folder containing `WinDockTray.exe`.

## One-time HTTPS setup on the test PC

The app validates the PC certificate and its IP address. There is no certificate
error bypass or HTTP fallback in the primary APK. The TLS credentials created in
this section are **local network test credentials**, unrelated to Android signing.
They are not included in the distributed test ZIP.

1. Connect the PC to the trusted home Wi-Fi/LAN. Connect the phone by a data-capable
   USB cable and temporarily enable **USB tethering** too, so the certificate can
   include both PC interface addresses. USB debugging is unnecessary. On phones
   that cannot retain both connections, provision Wi-Fi first and renew the same
   test certificate with USB active before the USB test.
2. In PowerShell 7, run these commands explicitly when ready:

   ```powershell
   $testState = Join-Path $env:LOCALAPPDATA 'WinDock-LocalTest-20261031'
   ./scripts/create-local-tls.ps1 -OutputDirectory (Join-Path $testState 'tls')
   ```

   The helper creates a private test CA and host certificate in this dedicated
   directory, restricts access, and prints covered IPs plus the **public CA
   fingerprint**. It does not install trust or alter firewall settings. If rerun
   against this test directory, it retains the CA and renews the host key/certificate
   for currently connected interfaces. Do not point it at production credentials.
3. Transfer **only** `windock-ca.crt` from that `tls` directory to the phone through
   a trusted channel. Never copy `host.key` or `windock-ca.key` to the phone, ZIP,
   support message or repository. File Transfer and tethering may require switching
   USB modes temporarily; re-enable tethering afterward.
4. In Android Settings, find **Install a certificate → CA certificate** (often under
   Security & privacy → More security settings → Encryption & credentials). OEM
   menus vary. This is a user **CA** for HTTPS trust, not an enterprise Wi-Fi client
   credential. Compare its SHA-256 certificate fingerprint with the helper's output
   and confirm only this test CA. Android may require a screen lock and shows a
   trust warning. Installing a CA can affect other applications' trust too; remove
   this specific CA when testing ends. See [Android certificate settings](https://support.google.com/pixelphone/answer/2844832).
5. Start the portable companion using its launcher:

   ```powershell
   ./Start-LocalTest.ps1
   ```

   It uses separate dock configuration/host identity in `$testState`, keeps TLS
   environment values scoped to the launched process, and generates no keys.
   Existing tray port/update settings are still shared with normal WinDock; leave
   those settings unchanged. Captures/signatures still use the normal Pictures/
   Videos WinDock folders, so use clearly labelled disposable test content.
6. Open **Show connection info** in the test tray. Record the HTTPS address/port
   and identify its **secure six-digit PIN**. The legacy HTTP endpoint uses a
   different PIN. Do not include either PIN in test reports or screenshots.
   If 8621 is occupied or conflicts with a saved HTTP port, quit the failed test
   tray and run `./Start-LocalTest.ps1 -SecurePort 18621`; use that port on the phone.

   If clicking **Show connection info** opens nothing, quit the test tray and
   rerun the corrected `Start-LocalTest.ps1`. An earlier copy launched the GUI
   with `-WindowStyle Hidden`, which can hide the first form. The launcher now
   uses `Normal`; the tray itself still starts without an open window and its
   Node child has no console. Keep the existing test certificates. Restarting
   creates new pairing PINs, so read the secure PIN from the reopened window.
   See [Windows startup window state](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow).
7. If Windows Firewall prompts, allow this extracted companion's `node.exe` only
   on the trusted network used for testing. For troubleshooting, check inbound
   TCP **8621** (or the actual secure port) and UDP **41234** for discovery, scoped
   to the trusted local subnet/interface. Do not disable the firewall or expose
   ports on the router. USB networks may have a different firewall profile.

## Wi-Fi checklist

1. Turn USB tethering off or unplug USB so this run proves Wi-Fi behavior. Keep the
   phone and PC on the same reachable LAN; avoid guest/client-isolated Wi-Fi.
   Windows may be connected by Ethernet to the same LAN.
2. Open the HTTPS APK and choose **Connect by Wi-Fi**. Confirm discovery finds the
   correct PC, select it and record whether discovery or manual entry was used.
3. If discovery fails, choose **Enter address** / **Use this address** with the
   actual `https://<PC-LAN-IPv4>:<secure-port>` from the tray. A working manual
   connection with failed discovery is a separate discovery issue, not a pass
   for discovery. If multiple adapters exist, use `ipconfig` to identify the PC's
   LAN address and confirm it was covered by the certificate helper.
4. Enter one incorrect PIN; expect rejection. Then enter the tray's **secure** PIN;
   expect the live dock. Do not repeatedly guess and trigger the shared lockout.
5. Perform every functional check in the table below. Keep the phone connected
   for at least 10 minutes; record latency, disconnects and any repeated action.
6. Background/restore the app, lock/unlock the phone, and reopen it. Check saved PC,
   appearance and phone preferences. Restart the companion and re-pair as needed:
   host restart invalidates its session tokens. Confirm the saved PC identity does
   not multiply after a restart.
7. Turn Wi-Fi off/on, reconnect, and test **Switch PC → Refresh**. With a second
   host if available, verify explicit switching. Test Forget on the test entry:
   it stops automatic reconnection but does not revoke the active session, and a
   running forgotten PC can still appear for explicit selection.

## USB tethering checklist

1. Connect the data-capable USB cable. In Android Settings enable **USB tethering**
   (usually Network & internet → Hotspot & tethering). Confirm Windows adds a
   tethering/Ethernet adapter with an IPv4 address. Google documents the feature
   [here](https://support.google.com/android/answer/9059108).
2. Record the **PC's USB-adapter IPv4**, not the phone's gateway address. Do not assume
   `192.168.42.x`; OEMs use different subnets. Confirm this IP appears among the
   certificate's covered addresses. If it changed or was absent, quit the test tray,
   rerun the TLS helper against the **same test directory**, then relaunch. The same
   CA remains trusted; the new host certificate is loaded on restart.
3. Turn off the phone's Wi-Fi for this run. Choose **Connect by USB → Find USB PC**
   in WinDock and select the PC. If needed, enter
   `https://<PC-USB-IPv4>:<secure-port>` manually. USB mode should not silently use
   Wi-Fi. Apply a narrowly scoped firewall allowance for the trusted USB interface
   if discovery/control is blocked.
4. Pair with the secure PIN if asked. Repeat all functional checks below. Leave the
   connection running for 10 minutes; include phone background/resume and idle rest.
5. Disable mobile data if your phone permits USB tethering without it, and confirm
   local control still works. Record an OEM/carrier restriction instead of assuming
   failure in WinDock. Tethering can share cellular data with Windows; the app's
   local control does not need internet, but desktop update checks do.
6. Unplug the cable during a harmless interaction; expect a disconnected state,
   never replayed input. Plug it back in, re-enable tethering if Android turned it
   off, recheck the PC's USB IP/certificate, and reconnect.
7. Reopen without USB, enable Wi-Fi, and choose Wi-Fi. Confirm normal Wi-Fi discovery
   still works. Record whether this OEM required manual transport switching.

## Functional checks — run once over each transport

| Check | Expected result | Wi-Fi | USB |
| --- | --- | --- | --- |
| Discovery and manual address | Correct PC/HTTPS endpoint; record each separately | [ ] | [ ] |
| Wrong/correct PIN | Rejected once, then successful authenticated dock | [ ] | [ ] |
| Dock editing | Pin/reorder a disposable test app; changes survive host restart | [ ] | [ ] |
| Launch/focus/close | Use a harmless unsaved test window; close remains polite | [ ] | [ ] |
| Touchpad and keyboard | Movement/click/scroll, Unicode/emoji/composition; no stuck input | [ ] | [ ] |
| Clipboard | Copy a non-sensitive sample on PC; open/refresh Recent clipboard, edit locally, explicitly Paste to PC; closing clears the panel draft | [ ] | [ ] |
| Clipboard unavailable | With Windows history disabled/unavailable, show a usable empty/error state | [ ] | [ ] |
| Media/volume | Supported playback controls work; restore original volume afterward | [ ] | [ ] |
| Signature | Save/insert disposable mark; verify PC PNG and insertion | [ ] | [ ] |
| Capture | Screenshot and short silent recording; stop explicitly, including from tray | [ ] | [ ] |
| Phone display | Dim/rest and wake behave correctly; PC display unchanged | [ ] | [ ] |
| Appearance/performance | Per-PC settings survive app and host restart | [ ] | [ ] |
| Updates | Play-build Updates offers Google Play; desktop check still works | [ ] | [ ] |
| Disconnect/reconnect | No stale input or silent HTTP fallback | [ ] | [ ] |

Windows clipboard history must be enabled separately to test stored items. Clearing
the WinDock panel does not clear Windows' clipboard/history. Use no passwords,
private keys, personal signatures or sensitive windows in these tests.

Native focus can be denied by Windows foreground policy even on v0.2.6. Record the
target app and whether another app was active; do not change the foreground-lock
timeout or use the debugger-positive-control mode as phone acceptance. Details are
in `docs/WINDOWS_FOCUS_TEST.md` in the Windows package.

The Play listing does not exist yet, so **Open Google Play** may show an unavailable
listing. That is expected here; verify that the Play-style APK does not offer an
external Android APK update. Do not download/install a desktop update over this
test kit while testing update checks.

## Security and backwards compatibility

1. In the HTTPS APK, manually enter the legacy `http://` endpoint. It must reject
   it. Previously saved HTTP PCs may remain listed, but must not connect silently.
2. After successful HTTPS tests, remove only the identified **test CA**, fully stop
   the Android app in Settings, reopen it and reconnect. HTTPS must fail. Restore
   that verified CA only if continuing tests. Do not use Clear all credentials.
3. Optional: install `WinDock-Android-legacy-preview.apk` over the HTTPS test APK
   (same package/code/signer). Use the host's **HTTP address and legacy PIN** to
   confirm legacy behavior, then reinstall the HTTPS test APK. Record any installer
   restrictions; do not erase app data automatically.
4. If a second device still has a released Android client, connect it to the new
   test companion's HTTP endpoint and verify its existing features. Separately
   test the new preview against a previous host if available. The HTTPS/Play APK
   intentionally requires the updated secure companion.

## Finish and report

1. Stop recordings and quit the test tray. Reopen your normal installed companion
   from its existing shortcut. Leave its install directory and dock configuration
   intact. Test tray port/update settings were shared; restore any you changed.
2. Remove only the test CA from the phone and revoke temporary APK-install
   permission. Disable USB tethering when finished and restore normal Wi-Fi/data
   settings. Remove disposable PC captures/signatures/clipboard samples yourself.
3. Keep the local test directory while retesting. It contains sensitive local TLS
   keys; never attach it to a bug report. Do not silently delete phone app data or
   downgrade to the old code-9 APK; Android may refuse a downgrade.
4. Fill in the result record below and send only non-sensitive observations.

```text
Phone model / Android version / Android System WebView version:
Windows version / network adapter / cable:
APK filename and SHA-256 / Windows ZIP SHA-256:
Wi-Fi discovery: PASS / FAIL / NOT RUN
Wi-Fi manual HTTPS + pairing: PASS / FAIL / NOT RUN
USB discovery: PASS / FAIL / NOT RUN
USB manual HTTPS + pairing: PASS / FAIL / NOT RUN
Functional table: passed rows and exceptions
HTTP rejection / removed-CA rejection:
Restart, saved PCs, clipboard, updates:
Duration / disconnects / steps to reproduce / exact non-sensitive error:
```

No phone-device result is claimed by the preparation build. Automated results are
listed separately in the kit's `TEST-RESULTS.md`. Production signing, publishing,
Console uploads and deployments remain on hold.
