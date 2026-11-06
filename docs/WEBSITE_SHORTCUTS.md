# Website shortcuts

Implemented locally for issue #51. No commit or publication has been performed.

Open Add to your dock, choose Links, enter an optional name and an explicit
HTTP(S) website address, then choose Add link. Tap the tile to ask the paired
computer to open that page in its default browser. Brave is supported when it
is the default browser. Browser-specific pages such as brave:// and selecting
a specific browser/profile are outside this version.

Links use the existing app-tile wire format with a reserved `link:` identifier.
Existing clients connected to the updated host can retain, reorder, remove and
launch them through existing APIs. No Android permissions, transport changes,
or dependency additions are required. Updated UI hides Links when the host does
not advertise support. An older desktop host cannot launch these new shortcuts;
this feature does not retrofit old host binaries. Existing apps, folders and
controls continue using their existing behavior.

The canonical URL is limited to 2048 characters and the name to 80. Duplicate
URLs are detected after normalization; query strings and fragments remain part
of identity. Links reject credentials, control characters, whitespace, backslashes
and non-HTTP(S) schemes. The server launches only a validated saved tile, ignoring
caller-supplied launch targets/arguments. Windows uses a dedicated ShellExecute
helper operation; Linux uses `xdg-open` with a separate URL argument. No command
shell, website prefetch, favicon download or browser executable path is accepted.
Default-browser launch errors are reported without native diagnostics. A successful
handoff does not prove the website loaded; the browser reports website/network errors.

Names and full URLs are stored in the PC dock configuration and visible to paired
clients. Website and Android privacy drafts describe this and browser-side history.

## Validation

- `node scripts/verify-links.mjs`: 56 checks covering normalization, rejection,
  deduplication, legacy serialization, long URL retention, disk reload, remove/
  reorder, escaped labels, optional capabilities, both OS launch adapters,
  authentication, cross-origin rejection, saved-ID-only launch and error handling.
- Full repository suite: 35/35 passed, including managed HTTPS, pairing,
  discovery, input, clipboard, transfers, updates and Linux provider suites.
- Windows helper Release build passed. Four unsafe URL cases were run against
  the actual helper and returned rejection exit code 1.
- Isolated Chromium at 740x360: named/unnamed add, duplicates, invalid URL errors,
  launch request, reload persistence, no horizontal overflow or JavaScript errors.
  Browser launches were mocked in this fixture. Screenshots are under
  `output/playwright/link-*.png`.

## Physical-device checklist

1. Quit the old tray companion and launch the new local-test companion with
   `Start-SecureTest.ps1`. It reuses the existing test configuration and pairing.
2. Reopen the installed Android app. Add a named YouTube URL using Links.
3. Tap the tile and confirm the PC's default browser opens the exact video,
   including any playlist, time query parameters and fragment.
4. Try a second website without a name; confirm its hostname is the label.
5. Add the same URL again; it should report already on the dock.
6. Restart the phone app and companion; verify link and existing tiles remain.
   Reorder/remove a link and verify persistence after another restart.
7. Repeat link launch over USB tethering; check an app/folder tile, keyboard,
   clipboard and Files & Media still work.
8. On a Linux graphical session with `xdg-open` and a configured default browser,
   repeat add/launch/restart and check the browser handoff. Native Linux testing
   and actual default-browser opening on Windows remain manual validation.

No production signing keys, uploads or deployments are involved.

## Omarchy test update — 1 November 2026

Installed a reversible per-user test build on the owner's Omarchy x86_64 PC via
fingerprint-verified SSH. The system package remains 0.2.5-2. Its user service
and app-menu entry now use `/home/alidevlab/windock-local-tests/links-20261101`.
The previous configuration is backed up there under `backup/config`; all eight
existing tiles and the configuration checksum were preserved. Roll back using
`bash ~/windock-local-tests/links-20261101/rollback.sh` on Omarchy.

On that actual Linux machine, all 35 repository suites and all 23 native Rust
tests passed. Native checks in the desktop session confirmed Hyprland, AT-SPI,
uinput, clipboard and keyboard tools. The real Linux link handler successfully
handed the local pairing page to the default browser. Phone-to-Linux website
tile acceptance, including Wi-Fi/USB, remains for the owner to confirm.
