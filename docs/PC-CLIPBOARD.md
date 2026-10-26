# PC clipboard history in the touchpad

This feature is included in the combined `0.2.5-preview.2` testing candidate.
The earlier `0.2.5-preview.1` PC-switching candidate does not include it.

The **PC clipboard** control starts collapsed at the top of the touchpad. Open
it to read recent text copied on the connected PC. Choose an item to load its
complete text into the editor, make any changes, then choose **Paste to PC**.
Selecting or editing an item does not type on the PC. Paste uses the native
clipboard and Ctrl+V, preserving multiline text instead of sending Enter keys.
The selected text becomes the PC's current clipboard content.

Windows uses the existing Windows clipboard history. Enable it on the PC with
**Windows + V** if it is disabled; WinDock never enables it automatically.
Linux has no system clipboard history, so WinDock reads the history manager
the user already runs. It finds managers by their running processes, never by
distro or desktop, and uses the first one it finds in this order:

| Manager | Found by | Read with |
|---|---|---|
| Omarchy 4 clipboard | `wl-paste --watch …/shell/plugins/clipboard/capture.sh` | `~/.local/state/omarchy/clipboard-history.json` |
| Elephant (walker, Omarchy 3) | an `elephant` process | `elephant query --json "clipboard;;20"` |
| cliphist | `wl-paste --watch cliphist store` | `cliphist list`, then `cliphist decode` per entry |
| clipman | `wl-paste --watch clipman store` (not `-P`) | its `--histpath` file, default `~/.local/share/clipman.json` |
| CopyQ | a `copyq` process | one `copyq eval` script reading `text/plain` |
| Klipper (KDE) | a `klipper` or `plasmashell` process | `busctl --user --auto-start=no` → `getClipboardHistoryMenu` |

A manager that fails is skipped for the next one. A history file whose recorder
is not running is never read, so stale history is not shown. With no manager,
the panel offers only the PC's **current clipboard** (`wl-paste`, or `xclip` /
`xsel` on X11) and says so. A clipboard marked by a password manager
(`x-kde-passwordManagerHint`) is not read. GPaste is not supported yet; its
GNOME users get the current clipboard.

WinDock never starts, configures or writes to a clipboard manager, and only
reads files and commands that belong to the manager it found. Pasting uses
**wl-copy**, or `xclip`/`xsel` on an X11 session. Only text is supported;
images, files and rich formatting are outside this text-input feature.

Up to 20 recent text entries are shown, with a maximum of 32,768 UTF-16 units
per entry and 131,072 across a response. Oversized entries are skipped with a
notice. Reads have a four-second deadline and a two-MiB process-output limit.
Opening or refreshing the panel triggers one read; there is no polling or new
clipboard recorder. Closing, disconnecting, changing PCs or leaving the
touchpad clears its phone-side contents. History is never stored in browser
storage, service-worker caches, WinDock files, or logs.

History access requires the existing paired session and rejects cross-origin
requests. Paste uses the touchpad's single-owner connection and validates the
PC focus target before and after preparing the clipboard. Only one paste can
be in progress. A changed target or blocked native operation reports an error.

The existing Android wrapper can use the shared panel. Its native IME is hidden
while browsing history; editing uses the WebView text editor. Browsers use the
same panel. The editor follows the visible viewport so it and the Paste button
remain above the phone keyboard, including in landscape. Older hosts do not advertise the capability, so the control stays
hidden there. Update the host helper and frontend together.

## Checks

- `npm test`: history providers, authorization, output/Unicode bounds, large
  paste transport, concurrent paste rejection and existing host regressions.
- `dotnet run --project native/input-tests/WinDockInputTests.csproj -c Release`:
  simulated clipboard writes and key injection, including focus changes.
- Linux Docker build: native protocol, Unicode bounds and Ctrl+V regression tests.
- Run `scripts/clipboard-smoke-host.mjs`, then the Playwright CLI with
  `scripts/clipboard-browser-check.js` for fake clipboard history, phone/tablet
  layout, plain-text rendering, IME suppression and cleanup checks.
- Disposable Android emulator only: `com.windock.app.PcClipboardTest` against
  the same fixture. It uses no real PC clipboard or desktop actions.

Verified locally: all 25 host suites, 48 Windows input assertions, Windows
helper build and an actual history read (metadata only), 22 Linux native tests
and package build, 18 browser checks, and an Android WebView instrumentation
test that asserts the editor and Paste button are above the open software
keyboard. UI tests use synthetic history and simulated desktop input.

Before release, test Windows history, Omarchy 4's own clipboard, at least one
other Linux history manager, and a Linux PC with no manager running, paste multiline text into an ordinary editor, and verify keyboard,
touchpad, pairing and switching between PCs. A successful paste acknowledgement
means input was dispatched; applications may still reject a paste.

API references: [Windows clipboard history](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.datatransfer.clipboard.gethistoryitemsasync),
[Elephant query protocol](https://github.com/abenz1267/elephant/blob/master/pkg/pb/query.proto),
[Elephant clipboard provider](https://github.com/abenz1267/elephant/blob/master/internal/providers/clipboard/clipboard.go).
