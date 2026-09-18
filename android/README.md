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

Transfer the APK to the phone, open it and allow installation from the chosen
browser/file manager if Android asks. Alternatively, enable USB debugging,
approve the PC on the phone, then use the SDK's `adb install -r` with the APK.

Open WinDock, use the same LAN as the PC, and enter the PIN from the PC tray.
If discovery misses the PC, enter its full tray URL or IPv4 address/port and tap
Connect. A bare IP defaults to port 8620. Back closes an open sheet; a second
Back returns to the connection screen. Android's first fullscreen prompt needs
one tap on Got it. System-edge swipes can temporarily reveal navigation bars.

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
adb shell am instrument -w com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
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
