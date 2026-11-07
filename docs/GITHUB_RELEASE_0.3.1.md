# GitHub release 0.3.1

Stable release source: `71f74e827fd144dcad26f9454515261a29269a8a` (PR #57).
This includes PR #46, which routes update actions to the official website download section.

## Build provenance

- Windows and Linux packages: successful workflow `42328989020`, source `a3a83584cb3aac5a98545856ee70dc41d128e1cc`.
- The tested source tree is identical to the merged release source tree.
- Android: local GitHub-channel build from the same source, version 0.3.1/code 11,
  using the established signing certificate, not the disposable CI debug key.
- Certificate SHA-256: `488186d4c2e70bd171bafd8fe7a11b8cce7d0fa7863113f334e07f66f57f83c1`.

## Completed validation

- 38 JavaScript test groups and 42 native update checks passed.
- Android build, JVM tests, lint, package identity and signing checks passed.
- Windows installer install, launch, upgrade and uninstall checks passed.
- Debian 12, Ubuntu 24.04 and Arch package installation, ordinary-user startup,
  upgrade and uninstall checks passed.
- Required CI passed on the integrated source and merged release commit.
- Earlier recorded manual 0.3.0 pairing, firewall recovery and upgrade checks
  remain in the 0.3.0 validation records; they were not repeated unnecessarily.

Final package hashes are published in `website/downloads.json` and the release
checksum assets. Local publication evidence is retained under
`artifacts/github-0.3.1/`, including the full public-asset hash verification.

## Scope

The originally reported tablet keyboard behavior still needs confirmation on
that device. Windows packages are unsigned and Android retains its existing
GitHub debug signing identity. Google Play and an installable iOS release are
outside this release.
