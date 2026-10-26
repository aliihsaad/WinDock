## WinDock 0.2.5-preview.3 — combined testing candidate

This candidate bundles PC switching, visible update checks, Android Tailscale
connections, and PC clipboard history. Test it before public release or changing
the website downloads. The earlier preview.1 candidate contains only PC switching.
Preview.3 also includes Linux clipboard-manager support and the background host;
the older preview.2 release files did not contain those fixes.

- **Switch PC:** discover running PCs, choose one by name, and keep your current
  connection while browsing. Forget persists across Android restarts; a forgotten
  running PC remains available for explicit selection.
- **Updates:** check from the dock drawer or Appearance, the Windows connection
  window, and Android's connection screen. See installed/current/available/failed
  states. Downloads and installation remain manual; Android checks its own APK.
- **Tailscale:** Android accepts numeric addresses in 100.64.0.0/10. Both devices
  must already be on your Tailscale network. Automatic discovery stays LAN-only.
- **PC clipboard:** expand the touchpad panel for recent text, choose an item,
  edit it, then explicitly Paste to PC. The editor stays above Android's keyboard.
  Windows uses existing Windows + V history. Linux reads the history manager
  already running (Omarchy's own, Elephant, cliphist, clipman, CopyQ or Klipper)
  and otherwise offers the current clipboard; paste uses wl-copy. Text only;
  images/files are not shown. No background recorder or stored phone history is
  added.
- **Linux background host:** close the connection window and stay connected.
  Reopen WinDock to see the same running host. Press S or run `windock stop` to
  stop it. Apps launched from the phone remain open. Requires a systemd user
  session; the foreground fallback still needs its window open.

Built on the saved-PC contribution by Foxtrot Kreators / @ghustanov in PR #20.
Integration retains PR #30 update checks, #31 Tailscale, merged #32 PC discovery,
and #33 clipboard history. The experimental macOS work and undecided community
PRs are not included. iOS source remains separate; no installable iPhone release.

### Install and test

1. Quit WinDock on the PC. Install the new Windows EXE, or use
   `sudo pacman -U ./WinDock-linux-x64.pkg.tar.zst` on Omarchy. Linux packages
   are 0.2.5-3 so they upgrade the earlier 0.2.5-1 and 0.2.5-2 candidates.
2. Install the Android APK (0.2.5-preview.3, version code 8) over the existing
   app. It must have the same signing certificate as public 0.2.4 and preview.1;
   the distributed candidate is verified against those APKs. Keep app data.
3. Restart the host and Android app, pair if asked, and follow
   [the combined checklist](https://github.com/aliihsaad/WinDock/blob/release-0.2.5/docs/RELEASE-0.2.5-TESTING.md).

Both the updated PC host and APK are needed to test the complete bundle. An
unpublished candidate will not appear as a public update. The current feed is
still 0.2.4, so this candidate should report up to date during testing.

Windows/Linux packages are unsigned; Android uses the existing debug signing
certificate. Verify SHA256SUMS.txt and SHA256SUMS-linux.txt beside the downloads.
