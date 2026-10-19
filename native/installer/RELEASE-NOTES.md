## WinDock 0.2.2-preview.1

Connect your Android phone over USB and give its screen a rest when you step away.
Thanks to [@waly-git](https://github.com/waly-git) for suggesting [#6](https://github.com/aliihsaad/WinDock/issues/6).

- **USB connection:** use a data-capable cable and Android USB tethering. No USB debugging is required; the usual pairing PIN still protects your PC.
- **Clear connection choices:** Wi-Fi and USB remember their own PC addresses. Choose either on the connection screen. On startup, a disconnected USB link returns to Wi-Fi; an explicit USB connection attempt stays on USB.
- **Phone display:** configure idle dimming, dim brightness, timed screen rest, or keep-awake under **This phone**. The dock also has **Appearance → This phone · screen & sleep**.
- **Screen rest:** the dock goes black and allows Android to sleep. Android’s own screen timeout can add a delay. The first touch wakes the dock without activating a control; after the screen turns off, use the phone’s normal wake control.

### Update both apps

1. Quit WinDock from the Windows tray, then download and run **WinDockSetup.exe**. Your dock settings stay on the PC.
2. Download **WinDock-android-debug.apk** on your phone. **Previous public Android previews must be uninstalled first**, because this APK uses a different debug signing key. Install the new APK and pair again. Uninstalling resets phone-only preferences, not your PC’s dock. Recent local test builds signed with the same key can update directly.
3. Start WinDock on Windows and Android. Use the PIN from **Show connection info** in the Windows tray.

### Connect by USB or Wi-Fi

For USB, connect a data-capable cable, enable **USB tethering** in Android Settings, then select **Connect by USB → Find USB PC**. If Windows asks, allow WinDock on your trusted USB network. Tethering may also share mobile data with Windows; turn mobile data off if unwanted.

For wireless, connect the phone and PC to the same trusted network and select **Connect by Wi-Fi**. Press Android Back from the dock to return to connection choices (close any open sheet first).

### Preview status

USB pairing and PC app control were verified on a Huawei Mate 10 Pro with phone Wi-Fi off. Android display behavior and connection switching are checked in the emulator; Windows input, update checks and bundled-host startup are tested separately.

Windows is unsigned and Android remains debug-signed (version code 4). Dimming and rest reduce prolonged screen exposure; they cannot guarantee burn-in prevention. iOS remains in development with no installable public release.

Windows 0.2.1-preview.1 and newer can discover this release through **Check for updates** or a startup notification. Downloading and installing remain manual.

Download hashes are in **SHA256SUMS.txt**. See the full [version history](https://github.com/aliihsaad/WinDock/blob/main/CHANGELOG.md).
