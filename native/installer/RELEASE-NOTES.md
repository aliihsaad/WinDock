## WinDock 0.2.5-preview.1 — testing candidate

This candidate adds live PC discovery and an Android **Switch PC** picker.
It is being tested before publication. Website downloads remain on 0.2.4-preview.1.

- **Choose a running PC:** open **Switch PC** beside the connection status in the
  dock drawer, or from the Android connection screen. The picker scans your local
  network and checks saved addresses, showing PC names, platforms and availability.
- **Keep your current dock:** closing the picker leaves the current PC selected.
  The existing app icons and seven drawer actions keep their layout.
- **Reliable Forget:** forgetting removes the saved PC and prevents automatic
  reconnection, including after an Android restart or a PC address change. A running
  forgotten PC stays available for explicit selection; this does not revoke pairing.
- **One entry per PC:** updated hosts publish a persistent public identifier so
  multiple network addresses can be grouped. It is separate from pairing credentials.
- **Recovery:** an unreachable selection returns to the connection screen. Saved
  addresses, manual entry and USB setup remain available. Scans run on demand with
  bounded work; they do not poll continuously in the background.

Built on the saved-PC history contribution from Foxtrot Kreators / @ghustanov
in [#20](https://github.com/aliihsaad/WinDock/pull/20), with live discovery,
address grouping, persistent Forget and additional regression coverage.

### Install the testing packages

1. Quit WinDock on the PC and install the candidate Windows installer or Linux
   package. Keep the existing personal configuration and host identity file.
2. Install the candidate **WinDock-android-debug.apk** (version code 6). The testing
   APK must use the same signing certificate as public 0.2.4 so it updates in place
   and preserves settings. The release packaging step verifies this match; an APK
   built on a fresh CI runner uses a different debug key and is not the testing APK.
3. Restart both apps. Leave two PC hosts running and open **Switch PC** on Android.
   Pair with each PC's own six-digit PIN when asked.

Both the updated host UI and APK are needed for the drawer entry. The Android
connection-screen picker also works with older hosts, which are identified by
address if they do not provide the new identifier. Browser clients and older
Android wrappers hide the native-only drawer entry.

### Test before publication

Check discovery with both Windows and Linux running, switching in both directions,
forget followed by Android restart, explicit re-selection, an offline saved PC,
manual recovery, and Wi-Fi/USB reconnect. Confirm normal app launching, media and
input still work. See [the full testing instructions](https://github.com/aliihsaad/WinDock/blob/main/docs/PC-PICKER-TESTING.md).

Automated checks cover host/API behavior, Android unit tests and lint, emulator
switching/forget/upgrade behavior, browser compatibility and pairing, plus installer
lifecycle checks. Physical network and tablet testing is still required for this
candidate before publishing it or changing the website download links.

Windows and Linux packages are unsigned previews; Android is debug-signed. iOS
remains separate work with no installable public release. Windows/Android checksums
are in **SHA256SUMS.txt**, and Linux checksums are in **SHA256SUMS-linux.txt**.
