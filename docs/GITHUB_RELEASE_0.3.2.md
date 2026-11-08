# GitHub release 0.3.2

Release source is tracked in [PR #59](https://github.com/aliihsaad/WinDock/pull/59)
and the `v0.3.2` tag. Windows and Linux assets were built and tested by workflow
[`42500722815`](https://github.com/aliihsaad/WinDock/actions/runs/42500722815)
from `96c45ff25845948a56c0afd957c42ec6fec9f34c`. Subsequent changes cover the
website/release records, an Android test wait and the wallpaper generator guard;
the packaged application source is unchanged.

## Confirmed on device

On November 8, 2026, the user confirmed song artwork, the expanded notch and
playback controls work on their physical Android phone with the rebuilt Windows
host. This covers the feature implementation before the release version bump.

## Package identity

- Host and installer: 0.3.2.
- Android: 0.3.2, version code 12, existing GitHub debug channel.
- Required Android signing certificate SHA-256:
  `488186d4c2e70bd171bafd8fe7a11b8cce7d0fa7863113f334e07f66f57f83c1`.
- Linux packages: 0.3.2-1, x86-64 Hyprland.

## Final validation

- JavaScript regression suite: 41/41 groups passed after the version bump.
- Native artwork tests: 24 assertions passed; native update tests: 42 passed.
- Windows self-contained build, installer compilation, fresh installation,
  packaged startup, upgrade and uninstall passed in clean CI. A local isolated
  smoke run also verified version 0.3.2 and the packaged media files.
- Android debug build, JVM tests and lint passed. The APK reports 0.3.2/code 12
  and its certificate matches the established GitHub identity above.
- Linux builds and ordinary-user installation, startup, upgrade and uninstall
  passed in Debian 12, Ubuntu 24.04 and Arch containers in CI.
- Website music checks passed (29), as did release/download checks (21) at widths
  from 320 to 1440 pixels. Earlier media/panel/gesture browser checks also passed.
- The Android instrumented-test wait now includes its final accessibility state
  and compiles. Reduced-scale wallpaper rendering rejects the bundled-art folder;
  an explicit preview output succeeds without modifying shipped images.
- Release workflow syntax passed actionlint. Required source checks passed on
  Windows, macOS and Linux; the PR records checks for each subsequent commit.

Final assets and checksums are in `artifacts/release-0.3.2/`. The website manifest
contains all four packages. Android is the verified local build with the existing
certificate, not the disposable CI debug APK.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| WinDockSetup.exe | 124177673 | `97c0122792c916e4612121a6437e1c3ccbd021de03bd8b5e57c160a1187815fe` |
| WinDock-android-debug.apk | 3110218 | `9cde96449b12171ec2f66d1b14fdcb8114f85d317f439a7e4ab97a35951aaf61` |
| WinDock-linux-amd64.deb | 31891084 | `02ca601a68b212de113349c72d8ded396a3b3bcbac22bdf7b6f169e76a7a5d04` |
| WinDock-linux-x64.pkg.tar.zst | 44855182 | `fc6d1c8eaefd720fb79341a2d85e380940f2b72ae41e6017c3ba770810c5d66b` |

## Publication

Publish only after the PR checks pass, using the assets above. Promote the matching
website deployment with the GitHub release, preserving older release-history
entries and existing user data. Verify public asset hashes and the live feed.

Windows remains unsigned. Android retains its existing debug signing identity.
Linux song metadata uses its existing provider; Windows artwork is the newly
implemented provider feature. No installable iPhone release is included.
