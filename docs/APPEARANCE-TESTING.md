# Appearance persistence and automatic performance mode

Use an Android emulator and `node scripts/android-smoke-host.mjs`. The fixture
performs no real PC actions and uses PIN `864213`. Build/install both debug APKs
with `assembleDebug assembleDebugAndroidTest`. Never clear data on a personal phone.

The normal checks are `npm test`, Android `testDebugUnitTest lintDebug`, and
instrumentation classes `AppearancePreferencesTest` and `PerformanceModeTest`.
They cover first-use migration, per-PC isolation, bridge input limits, browser and
old-companion fallback, memory-only website preview, Auto boundaries, manual
overrides, paging and input. The native preferences test uses a separate test store.

For process restart coverage, run these instrumentation phases separately:

```sh
adb -s emulator-5554 shell am instrument -w -e class com.windock.app.AppearancePersistenceTest -e appearancePhase seed com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
adb -s emulator-5554 shell am force-stop com.windock.app
adb -s emulator-5554 shell am instrument -w -e class com.windock.app.AppearancePersistenceTest -e appearancePhase verify com.windock.app.test/androidx.test.runner.AndroidJUnitRunner
```

The seed phase uses the real settings handlers to choose On, Frost, eight icons
and visible labels. Verify never reselects these settings. Restart the fixture
without deleting `artifacts/android-smoke` (which holds its stable host ID), then
force-stop and verify again. The test skips ordinary suite runs without a phase.

Start another fixture with `WINDOCK_SMOKE_PORT=18623` in the same checkout and add
`-e appearanceEndpoint http://10.0.2.2:18623` to verify. This exercises a new web
origin for the same physical PC. The original app fails this case with Auto in
place of On. With the fix, performance, layout, labels and theme all restore.

Add `-e appearanceClearWeb true` to seed to remove only the web appearance values
after checking them. Force-stop and verify to exercise native recovery when web
storage is absent. Unit-style instrumentation separately checks that a different
host ID at the same address starts with defaults and cannot inherit old values.

For the RAM fallback, cold-boot an emulator with `-memory 1536`, then run
`PerformanceModeTest` with `-e expectedAuto true`. The test requires the ROM
low-RAM flag to be false and checks the actual startup hint in WebView. Repeat on
a normal larger-memory emulator with `-e expectedAuto false`. Boundary and unknown
RAM values are covered by `PerformancePolicyTest`.

These checks do not establish performance or lifecycle behavior on a physical
Galaxy S4/LineageOS device. Ask the reporter to retest both updated components.
