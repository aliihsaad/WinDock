# WinDock Android test app

The Android app displays the PC's existing dock in a fullscreen landscape
WebView. Keep the Windows tray running; this app needs a connection to the PC.

## Build and install

On Windows, install Android Studio with SDK Platform 34 and Build Tools 34.0.0,
then run `npm run build:android` from the repository root. The script discovers
Android Studio's JDK and the usual SDK directory; `JAVA_HOME` and `ANDROID_HOME`
override them. Java 21, Gradle 8.9 and the included SDK 34 setup were verified.
The wrapper can also be run directly with `bash android/gradlew -p android
assembleDebug` on Linux with those prerequisites.

Output: `artifacts/WinDock-android-debug.apk`. It supports Android 7/API 24 and
newer, targets API 34, and uses a local debug signing key. Updating requires the
same signing key. Production signing and Play Store preparation are separate.
The current development APK identifies as `0.2.2-preview.1` (version code 4);
it has not yet replaced the public download.

Transfer the APK to the phone, open it and allow installation from the chosen
browser/file manager if Android asks. Alternatively, enable USB debugging,
approve the PC on the phone, then use the SDK's `adb install -r` with the APK.

Open WinDock, use the same LAN as the PC, and enter the PIN from the PC tray.
If discovery misses the PC, enter its full tray URL or IPv4 address/port and tap
Connect. A bare IP defaults to port 8620. Back closes an open sheet; a second
Back returns to the connection screen. Android's first fullscreen prompt needs
one tap on Got it. System-edge swipes can temporarily reveal navigation bars.

## USB connection (development build)

The new Android build supports USB networking through **USB tethering**. This
uses the existing Windows host and PIN pairing; USB debugging and developer
options are not required. A charging-only cable will not work.

1. Connect the phone to the PC with a data-capable USB cable.
2. Enable **USB tethering** in Android Settings (often under Hotspot & tethering).
3. Keep WinDock running on Windows. In the Android connection screen, select
   **Connect by USB → Find USB PC**. Back from the dock returns to that screen.
4. Pair using the PIN in the Windows tray. If discovery is blocked, enter the
   PC's IPv4 address on its USB network adapter, rather than its Wi-Fi address.

Allow WinDock through Windows Firewall on the trusted USB connection when
prompted. Tethering may also share mobile data with Windows; turn mobile data
off if that is unwanted. Some phones or carrier configurations restrict USB
tethering. The USB choice is remembered and only searches wired interfaces;
it does not silently fall back to Wi-Fi during an explicit USB attempt.
**Connect by Wi-Fi** returns to wireless, using its own remembered PC address.
On startup, if the wired link is gone, WinDock returns to Wi-Fi automatically.
The connection screen always shows which mode is selected. If you unplug while
the dock is open, return to this screen and choose Wi-Fi, or reopen the app.

Discovery binds probes to each local interface and uses the responder's source
address, avoiding a stale Wi-Fi address advertised by a PC with several network
adapters. Host identity and local-address validation still apply. USB discovery,
PIN pairing, and PC app control were verified on a Huawei Mate 10 Pro with Wi-Fi
disabled on October 19, 2026. Other Android OEM interface names and Windows
firewall configurations still need device-specific verification.

## Phone display options (development build)

Open **This phone** on the connection screen, or **Appearance → This phone ·
screen & sleep** in the updated shared dock. These preferences stay on this
phone and do not change the PC's brightness or power settings.

- **Dim after inactivity:** never, 15 seconds, 30 seconds (default), 1 or 2 minutes.
- **Dim brightness:** 5%, 10% (default), or 20%; never raises an already lower brightness.
- **Screen off:** use the phone's normal timeout (default), or rest after 1, 2,
  5 or 10 minutes idle. An explicit stay-awake option lasts only while the dock
  is visible in the foreground.

At a timed limit the app draws black, lowers window brightness, and releases
its keep-awake flag so Android can turn the screen off. Android's configured
timeout may add a delay. No device-admin, accessibility service, or global
settings permission is used. The first gesture on a dimmed or resting dock only
wakes it; after Android turns off the screen, use the phone's normal wake control.
Leaving the app restores brightness and releases keep-awake. Live PC updates
do not reset the idle timer. Lower brightness and screen breaks reduce prolonged
display exposure but cannot guarantee prevention of OLED burn-in.

## Verification

`npm run build:android` includes Kotlin unit tests, lint and signature validation.
`npm test` includes the cross-language protocol check. The Kotlin tests execute
the real URL/discovery parser and same-origin request policy.

For the emulator flow, start `node scripts/android-smoke-host.mjs` in another
terminal. It listens only on loopback port 18622 and provides five fake apps,
test PIN 8642, and an action log in `artifacts/android-smoke/events.json`.
It never calls a Windows provider or reads the user's saved dock.

With an Android emulator running, use the SDK's adb (specify `-s SERIAL` if
more than one device is attached):

```powershell
cd android
.\gradlew.bat assembleDebug assembleDebugAndroidTest
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb install -r app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
adb shell am instrument -w -e class com.windock.app.DockSmokeTest com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
```

Expected: `OK (1 test)`. The test targets the emulator's host alias
`http://10.0.2.2:18622`; do not run this fixture test against a physical phone.
It verifies pairing errors/success, WebSocket sync, icon-only landscape layout,
two pages, real injected touch swipes, long press, dialog Back handling,
launch/focus requests, failed manual address recovery and Activity recreation.
Screenshots are in the app's external files directory. The first-run Android
fullscreen explanation is dismissed using UI Automator on the English emulator.

The emulator flow passed on Android 16/API 36.1. It does not establish physical
LAN broadcast reachability or real Windows app activation. G14 remains pending
until those actions succeed on the user's phone and PC.

### USB discovery and idle display regression

The Kotlin unit suite also checks actual UDP request/reply exchange, rejects
malformed replies, corrects stale advertised addresses, and verifies USB-only
selection and idle deadlines. It does not emulate a physical USB cable.

With the smoke host above running, install the app and instrumentation APKs,
then run on the emulator:

```powershell
adb -s emulator-5554 shell am instrument -w -e class com.windock.app.PhoneOptionsTest com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
```

The two tests cover native settings through the WebView bridge, saved preferences
after Activity recreation, timed dimming, consumption of the first wake gesture,
black rest mode, keyboard dismissal, keep-awake release, background cleanup,
and remembered USB mode with a return to LAN. They require about 90 seconds.
The JVM tests separately verify that USB mode refuses remembered Wi-Fi hosts;
recent emulators also expose a virtual Ethernet link on their Wi-Fi subnet.

To also verify Android actually powers down the emulator display, first record
its `system screen_off_timeout` and `global stay_on_while_plugged_in` values with
`adb shell settings get`. Set them to `15000` and `0` respectively, add
`-e verifySleep true` to the test command, and restore both original settings
afterward. Change these settings only on the test emulator, never a personal
phone. For each additional physical device, verify discovery, PIN pairing, and
an app action through USB tethering with the phone's Wi-Fi disabled.

### Automatic now-playing regression

Start `node scripts/now-playing-smoke-host.mjs` from the repository root. It runs
an isolated host on loopback port 18623 and a test-only media control endpoint
on 18624. Keep other clients disconnected from this fixture during the Android
test so its background polling count is isolated. After building/installing the
debug and instrumentation APKs as above, run:

```powershell
adb shell am instrument -w -e class com.windock.app.NowPlayingSmokeTest com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
```

Expected: `OK (1 test)`. The test changes the host's simulated track, artist,
playback state and active media session, checks the actual Android WebView updates
without tapping Refresh, and checks polling pauses in the background and resumes
on return. It uses the emulator host alias `10.0.2.2`; do not run on a physical phone.

The same fixture supports a browser regression. Open `http://127.0.0.1:18623` in
Playwright CLI, then run `run-code --filename=scripts/browser/now-playing.js`
from the repository root. It also checks HTTP error recovery, slow requests,
playback controls, focus preservation and zero Refresh clicks/page reloads.
Create `output/playwright/` first for the screenshot. `npm test` includes the
poller's automatic-update, inactive-state, timeout and concurrency regression.

## Transport and build decisions

Android's network security XML matches domains, not private IP subnets. The
transport allows HTTP, while `EndpointPolicy` limits selected hosts to private
or loopback IPv4 addresses (plus localhost). Health checks reject redirects,
limit response size/time and require WinDock's identity. The WebView permits
only the selected origin, disables file/content access, and never overrides
TLS certificate errors. PIN/session handling stays in the shared web UI.
This is LAN HTTP, not encrypted transport. Android HTTP does not enable the
PWA's secure-origin-only service worker/offline support.

Reference documentation: [Android network security](https://developer.android.com/privacy-and-security/security-config),
[immersive system bars](https://developer.android.com/develop/ui/views/layout/immersive),
[AGP 8.5 compatibility](https://developer.android.com/build/releases/agp-8-5-0-release-notes),
and [Gradle wrapper checksums](https://docs.gradle.org/current/userguide/gradle_wrapper.html).
