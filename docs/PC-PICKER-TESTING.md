# Android PC discovery and switching (unreleased)

This branch builds on PR #20's validated, bounded saved-PC history. It adds live
discovery and an in-app picker; it does not change the dock's app icon layout or
the Windows/Linux control providers. Candidate packages use version 0.2.5-preview.1
(Android version code 6). It is not part of the published APK yet.

## Behavior

- Open **Switch PC** from the dock drawer, beside the connection status, or from
  the Android connection screen. Closing the picker leaves the current dock open.
- Opening the picker or tapping **Refresh** performs one bounded scan. There is
  no continuous background polling. Available hosts show their name, operating
  system, address and LAN/USB transport. The current address is highlighted.
- UDP discovery collects replies on local IPv4 interfaces for 1.2 seconds. Up to
  24 discovered addresses plus eight saved addresses are health-checked with at
  most four concurrent requests and a three-second collection budget. Late work
  is cancelled/ignored on refresh, dismissal and Activity destruction. An already
  running HTTP request may finish its bounded socket timeout after cancellation.
- Saved addresses are checked even when UDP broadcasts are blocked. A saved host
  that did not answer is shown as **Not found this scan**, with tap-to-retry.
  Selecting an unreachable host returns to the connection screen without silently
  selecting another PC. Manual entry and USB setup remain available there.
- At most eight reached PCs are saved. Discovery alone does not add history.
  Every selected address passes the existing local-address policy and a bounded
  `/health` identity check before opening. Pairing stays in the shared WebView;
  discovery names and identifiers never grant access.
- **Forget** removes the saved entry, matching last-used addresses, and suppresses
  automatic reconnection. It does not disconnect or revoke the existing pairing.
  A running forgotten PC remains discoverable and can be explicitly chosen again.
- Updated hosts publish a friendly name and a public UUID in `/health`. The UUID
  is stored next to the host configuration as `config.json.host-id`; ordinary dock
  edits preserve it. This groups a PC's addresses and extends Forget across address
  changes. When several addresses answer, the picker prefers the current address,
  then the saved address, then LAN. Manual/USB connection can select another path.
  The UUID is not a credential. Copying this file to another installation copies
  its identity; installations should keep their own file. If it is unreadable,
  malformed, or cannot be created, the host uses an identifier for that run only.

## Compatibility

The drawer entry needs both the updated Android wrapper and the updated host UI.
The native connection-screen picker works with older hosts. Older hosts lacking
the UUID are tracked by address; they can appear separately through multiple
interfaces, and Forget cannot recognize an unknown replacement address. Older
Android apps and regular browsers simply hide the native-only drawer entry.
The established automatic startup connection behavior remains available.

## Automated checks

From the repository root:

```powershell
npm ci
npm test
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
# Use your own SDK location if it is not the default Android Studio location.
if (-not $env:ANDROID_HOME) {
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
Push-Location android
.\gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest lintDebug --no-daemon --console=plain
Pop-Location
```

The JVM tests cover multi-reply UDP, source-address validation, saved fallback,
USB routing, bounded/concurrent scans, cancellation, history migration and host
identity deduplication. API tests cover metadata, persistent UUIDs, concurrent
initialization, configuration edits, malformed storage and storage failure.

Use a disposable Android emulator for instrumentation. `PcPickerTest` starts its
own HTTP/UDP hosts inside the emulator and suppresses unrelated discovered
addresses from automatic selection. It verifies live discovery, address grouping,
switching, cancellation, forgetting/restarting, explicit re-selection, failed
selection and manual recovery. It also validates health-response bounds and
legacy last-address migration. Do not run these fixtures on a personal device.

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
# Replace emulator-5554 only with the serial of your disposable emulator.
& $adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s emulator-5554 install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $adb -s emulator-5554 shell am instrument -w -e class com.windock.app.PcPickerTest com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
```

For shared-dock regression tests, start `node scripts/android-smoke-host.mjs` in
another terminal, then run the same instrumentation command with class
`com.windock.app.DockSmokeTest,com.windock.app.PhoneOptionsTest`. These use port
18622 and fake providers, including the real PIN flow and drawer-to-native bridge.

For browser checks, start `node scripts/pc-picker-smoke-hosts.mjs` in another
terminal. It starts isolated Windows/Linux fixtures on ports 18625/18626.

```powershell
New-Item -ItemType Directory -Force output/playwright
npx --yes --package @playwright/cli playwright-cli -s=pc-picker open http://127.0.0.1:18625 --browser webkit
npx --yes --package @playwright/cli playwright-cli -s=pc-picker run-code --filename=scripts/pc-picker-browser-check.js
npx --yes --package @playwright/cli playwright-cli -s=pc-picker close
```

The browser check exercises new/old/no Android bridges, phone/tablet drawer
layout, independent pairing on two hosts, and return-to-host session persistence.
Its native bridge is mocked; the emulator tests separately execute the real bridge.
Screenshots go to `output/playwright/` and emulator app external files.

## Physical acceptance before release

Use this branch's host and Android builds on a Windows PC, Linux PC, and Android
phone/tablet on the same trusted network. Leave both hosts running.

1. Open **Switch PC**. Both PCs should appear with distinct names/addresses. Switch
   between them and pair with each PC's own PIN when requested. The dock should
   display the chosen PC's apps, and cancelling the picker should retain it.
2. Stop one host. Refresh: it should move to the saved section. Selecting it must
   show connection recovery, not another PC's dock. Restart it and refresh.
3. Forget the current PC, close and reopen the Android app. It must not reconnect
   to that PC automatically, including through another discovered address. Choose
   it explicitly; it should be remembered again. Forget is separate from unpairing.
4. Try with Wi-Fi and USB tethering, then unplug USB. Confirm the selected route,
   manual entry and reconnection work. Check a network that blocks broadcasts;
   saved/manual addresses should still work when HTTP is reachable.
5. Check older hosts and an older Android wrapper for graceful compatibility.

Emulator and browser checks do not establish physical router broadcast behavior,
USB tethering compatibility, or old-device performance. Those remain device checks
before release. Nothing in this branch is merged or published by these commands.
