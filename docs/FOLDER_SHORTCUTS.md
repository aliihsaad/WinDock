# Folder shortcuts — local preparation, 31 October 2026

In the dock, open **Apps / Add to your dock → Folders → Choose on PC**.
Select a local directory in the Windows folder dialog. Its tile opens that exact
directory in File Explorer. Long-press/edit to reorder or remove it like an app.
Removing a tile does not delete the folder. Cancelling the Windows dialog adds
nothing. Selecting an already pinned directory does not create a duplicate.

This feature needs the updated Windows companion; the current Android APK can
use it without reinstalling. The folders tab is offered only when the host
advertises support. Existing app/control tiles, HTTP/HTTPS pairing, discovery,
clipboard and update mechanisms keep their existing interfaces.

## Implementation and limits

- Folder tiles use the existing `kind: app` format, with a stable `folder:` ID
  derived from the normalized path. Old client tile serialization preserves them.
- The existing dock configuration holds the path. There is no secondary folder
  database. Removing the tile removes the saved path and its launch entry.
- The authenticated, same-origin `POST /api/folders/pick` accepts no paths or
  options from the phone. Only one native chooser can run at a time; it times out
  after two minutes. Close/cancel it on Windows if you change your mind.
- A standalone WinForms owner/message loop gives the chooser a visible taskbar
  window. The interactive helper is launched without the background hide flag.
- Launch uses the existing app-ID route, resolving the saved tile on the host.
  `open-folder` checks that the target is a directory before asking Windows Shell
  to open it. Client-supplied arguments or replacement paths cannot alter launch.
- Local drive paths up to 400 characters are supported, including spaces and
  Unicode. UNC/device paths, Shell URLs and executable/file targets are not
  supported folder shortcuts. Moved/deleted/unavailable folders report an error;
  remove the tile and add the folder again if its location changes.
- The feature sends the chosen name/path to the paired phone; it does not read
  file contents. Local privacy drafts were updated accordingly.

## Validation

See `artifacts/folder-shortcuts-repository-tests.log`,
`artifacts/folder-shortcuts-native-tests.log` and
`artifacts/folder-shortcuts-android-tests.log` for the final checks.
`scripts/verify-folders.mjs` covers selection/cancellation, duplicate identities,
legacy wire compatibility, disk reload, icon delivery, authentication/CSRF,
argument/path substitution, missing folders and removal.

The user selected LawYeah in the real Windows chooser during the isolated browser
test. The new tile appeared, survived reload and opened **LawYeah - File Explorer**.
The test used disposable dock configuration; it did not change the running
companion's dock. Native negative checks also rejected executable/file targets,
relative paths, Shell URLs and missing directories.

Final phone acceptance remains: start the new test companion with the existing
test certificates, reconnect the Huawei, add a folder, launch it over Wi-Fi and
USB, then verify reorder/remove. No new certificate or signing key is needed.
No commit, merge, push, deployment, upload or publication is part of this change.
