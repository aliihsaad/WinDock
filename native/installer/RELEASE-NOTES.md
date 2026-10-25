## WinDock 0.2.4-preview.1

Smoother controls for older phones and stronger pairing security, bundled for
Windows, Android and Linux.

- **Performance mode:** open **Appearance → Performance mode** and choose Auto,
  On or Off. On reduces blur, shadows and touch effects, and makes paging instant.
  Auto uses the updated Android companion's low-RAM hint. Your manual preference
  is remembered; Off restores the selected glass style and background.
- **Safer pairing:** six-digit PINs, per-device limits and a host-wide pause make
  guessing harder. Host checks protect HTTP and both WebSocket channels against
  DNS rebinding. Existing paired devices remain usable during a host-wide pause.
- **Clear recovery:** the phone explains which limit applies and how long to wait.
  Windows users can choose **Allow pairing now** in the tray to clear a host-wide
  pause. Individual device lockouts still apply. Older four-digit pages receive
  instructions to reopen the app without using up the attempt budget.
- **Host stability:** malformed request addresses return an error without
  crashing WinDock or clearing paired sessions.

Thanks to [@ojaseminem](https://github.com/ojaseminem) for the security contribution
in [#10](https://github.com/aliihsaad/WinDock/pull/10), and
[@waly-git](https://github.com/waly-git) for the older-phone report and prototype
findings in [#9](https://github.com/aliihsaad/WinDock/issues/9).
Performance mode is tracked in [#27](https://github.com/aliihsaad/WinDock/pull/27).

### Update both apps

1. Quit WinDock on your PC and install the new Windows installer or Linux package.
   Your PC dock configuration and captures are preserved.
2. Install **WinDock-android-debug.apk** (version code 5) for automatic low-RAM
   detection. It uses the same signing certificate as public 0.2.2/0.2.3 builds,
   so those update in place and keep phone settings. Older public builds or
   locally built APKs with another key must be uninstalled first.
3. Close and reopen the phone app, then enter the PC's new six-digit PIN.
   Existing browser/Android clients can select Performance mode On manually.

Windows 0.2.1-preview.1 and newer can discover this release through **Check for
updates** or a startup notification. Downloading and installing remain manual.

### Preview status

Windows is unsigned, Android is debug-signed, and Linux packages are unsigned.
iOS remains in development, with no installable public release. Physical Galaxy
S4 performance feedback is still needed; no measured FPS improvement is claimed.

Release checks cover application/security regressions, native Windows helpers,
Android unit tests and lint, and Windows/Linux installer lifecycle checks.
The combined pairing and performance flow is also checked in an Android emulator.

Windows/Android hashes are in **SHA256SUMS.txt**; Linux hashes are in
**SHA256SUMS-linux.txt**. See the full
[version history](https://github.com/aliihsaad/WinDock/blob/main/CHANGELOG.md).
