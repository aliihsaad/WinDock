# GitHub release 0.3.2 — preparation

Source: `claude/full-glass` release candidate based on PR #59 at
`b1da2180c45d829decefe36b5a50dda14d26b23e`, plus media artwork, expanded notch,
website music demo and version 0.3.2 preparation. Publication is pending final CI.

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
- Windows self-contained build and installer compilation passed. Installer and
  tray metadata both report 0.3.2. An isolated smoke run started the bundled host,
  received its ready signal and exited; packaged media files match the source.
- Android debug build, JVM tests and lint passed. The APK reports 0.3.2/code 12
  and its certificate matches the established GitHub identity above.
- Release workflow syntax passed actionlint.
- Linux final packages are pending. Local Docker Desktop failed before the build
  started because its inference-manager socket could not be accessed. No Docker
  reset or data deletion was attempted. Use repository CI for the final Linux
  build and Debian/Ubuntu/Arch installation checks, or repair Docker separately.
- Fresh Windows installation/upgrade/uninstall checks remain for clean CI. The
  developer machine already has WinDock installed; the package smoke run used a
  separate port and configuration without replacing that installation.

Prepared local assets are in `artifacts/release-0.3.2/`. Its unpublished manifest
currently contains Windows and Android only; add the verified Linux assets before
promoting it to the website. Public `website/downloads.json` remains at 0.3.1.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| WinDockSetup.exe | 123068903 | `6b7d84eb3c31837549d736bf31d75146acb6fe268ccd1e0e84d9835bc006decc` |
| WinDock-android-debug.apk | 3110218 | `9cde96449b12171ec2f66d1b14fdcb8114f85d317f439a7e4ab97a35951aaf61` |

## Publication checklist

- Commit and push the allowlisted release changes; pass CI on that source.
- Verify final Windows, Android and Linux packages and record their hashes.
- Merge the reviewed release source and publish the matching GitHub assets.
- Update the website download feed and release history, README download links,
  and changelog date; deploy the website demo with the release.

Windows remains unsigned. Android retains its existing debug signing identity.
Linux song metadata uses its existing provider; Windows artwork is the newly
implemented provider feature. No installable iPhone release is included.
