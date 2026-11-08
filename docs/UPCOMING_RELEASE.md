# WinDock 0.3.2 — local release preparation

Full glass, eight rendered backgrounds, live quick controls, Windows song artwork,
and an expanded now-playing notch. The website demo includes three silent sample
tracks with cover art and a Music shortcut.

The user confirmed artwork, the expanded notch and playback controls on their
physical Android phone with the rebuilt Windows host on November 8, 2026.
The JavaScript suite (41 groups), native artwork tests (24 assertions), media
browser checks (21), panel/gesture regressions (74), and website music checks (29)
passed before the version bump. Final package validation is recorded separately
in [GITHUB_RELEASE_0.3.2.md](GITHUB_RELEASE_0.3.2.md).

Version 0.3.2 uses Android version code 12 with the established GitHub signing
certificate. Windows, Android and Linux packages must carry the same release
version. Existing unsigned Windows and GitHub Android signing policies continue.

This preparation is unpublished. Publish the new download feed, website demo and
release page together after the versioned packages and CI pass. The current public
download links remain on 0.3.1 until then. No installable iPhone or macOS release
is included.
