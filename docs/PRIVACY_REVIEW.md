# Privacy draft evidence — 31 October 2026

The local website page and Android offline policy contain the same text and the
owner-supplied contact `alidevlab10@gmail.com`. Neither is published. The policy
now describes the preparation integrated with the v0.2.6 runtime baseline,
including restored clipboard history, public host identity, saved PCs/appearance
and update checks. Runtime source references below were inspected during integration.

| Statement/data flow | Implementation inspected |
| --- | --- |
| Network permissions plus optional camera for QR pairing ; no location/shared-storage request | `AndroidManifest.xml`, `MainActivity.kt`; ZXing CaptureActivity requests camera only when scanning. Frames are not saved/uploaded; pairing text is a permission-free alternative. |
| Local UDP discovery, network-interface selection, USB routing | `Discovery.kt`, `LocalNetwork.kt`, `MainActivity.kt`; desktop `src/discovery.js`. |
| Release HTTPS, app-private per-computer trust for managed pairing; user/system trust retained for explicit manual HTTPS; no certificate bypass | `SecurePairing.kt`, `SecureTransport.kt`, release manifest/network security resource, `EndpointPolicy.kt`, `MainActivity.kt`. Debug/main source set deliberately differs. |
| Pairing sessions, max 180 days; HTTPS token hashes persist on PC, legacy HTTP sessions remain memory-only | `src/secure-sessions.js`, `src/private-store.js`; Android `SecurePairing.kt` uses Android Keystore encryption. Existing browser cookie pairing remains supported. |
| PC app names, identifiers, executable paths, window titles, icons, dock/media/status information | `server.js` routes and `dockState`; `src/platform/windows.js`; PC inventory is distinct from phone-installed-app inventory. |
| Keyboard/text/password input forwarded, focus metadata returned | `RemoteKeyboardEditor.kt`, `MainActivity.kt` bridge, `public/remote-keyboard.js`, `src/input.js`, `src/input-hub.js`, `native/win/RemoteKeyboard.cs`. |
| Signature strokes sent on save/insert, PNG persisted and clipboard/paste on insert | `public/input-pad.js`, `src/platform/input.js`, `native/win/Signature.cs`. |
| PC screenshot/recording, no phone MediaProjection, local files and metadata returned | `src/platform/capture.js`, `native/win/ScreenCapture.cs`, `server.js`; app manifest has no projection service. |
| Phone-local settings/WebView storage and backup exclusions | `ServerUrl.kt`, `PhonePreferences.kt`, WebView settings; manifest and `res/xml/data_extraction_rules.xml`. |
| PC dock configuration persisted locally | `src/config.js`; default under APPDATA or configured WINDOCK_CONFIG. |
| Selected folder name/path sent to paired phone and saved as a dock tile; no file-content transfer or separate folder registry | `native/win/FolderShortcut.cs`, `src/folders.js`, authenticated `server.js` picker/launch routes and existing `src/config.js`; removing the tile removes its saved path. Added October 31, 2026; Windows recent locations and phone cache have separate retention. |
| Automatic desktop startup update check and manual checks, installed version in user-agent | `native/tray/Program.cs` 8-second startup timer and menu; `UpdateChecker.cs` HTTPS downloads.json request. This was missing from the first policy draft. |
| Optional main-site analytics, consent storage, URL query/fragment removal | `website/analytics.js`. The standalone privacy page imports no analytics script. |
| Support address and mailbox | User supplied the Gmail address. Sending support email is optional and outside the app's remote-control transport. No email has been sent by this task. |

## Integrated release data flows

- `public/pc-clipboard.js`, `src/platform/clipboard.js`, `native/win/ClipboardHistory.cs`,
  `/api/clipboard/history` and input `paste` messages retain on-demand text history
  (up to 20 items), local draft editing, explicit paste, and clearing panel state on
  close/reset. Windows controls history retention; WinDock does not erase it.
- `src/host-identity.js`, `KnownHosts.kt`, `ServerUrl.kt` and `AppearancePreferences.kt`
  retain random public host identity, remembered/forgotten PCs, connection times
  and per-PC appearance persistence. Forget deletes that PC's managed Android
  trust/session locally; it does not revoke other devices or legacy browser cookies.
  The computer's Forget paired phones action revokes secure sessions and invitations.
- `AppUpdates.kt` preserves the preview updater, while the Play release opens Play
  for Android updates. `src/updates.js`, `public/updates.js` and the Windows tray
  retain desktop feed checks, including the automatic startup check.
- CGNAT/Tailscale manual endpoints remain supported. The TLS helper includes
  assigned shared IPv4 addresses; it neither creates a VPN nor bypasses trust.
- Optional QR scanning adds CAMERA. OkHttp supplies native HTTPS/WebSocket transport and ZXing supplies offline QR decoding; neither is configured for telemetry or advertising. Recheck the final merged manifest and dependency tree.

Final owner review remains necessary for website/mailbox operations and their
retention practices, which application source alone cannot establish. Keep the
policy as an unpublished review draft until the final artifact and operations
are accepted. Data Safety answers must follow the final data flows, including
phone-to-PC transfers; absence of a developer relay alone is insufficient.

## Files & Media and voice removal — 31 October 2026

Dedicated NativeVoice/SpeechRecognizer, its bridge/UI/protocol, and RECORD_AUDIO
permission were removed after owner testing. Keyboard voice typing remains an
IME feature; WinDock receives committed text without accessing the microphone.

Files & Media uses system Photo Picker on API33+ and ACTION_OPEN_DOCUMENT
otherwise, including documents/general files on every supported API24+ device.
ACTION_SEND/SEND_MULTIPLE accept granted content URIs only. No broad media/storage,
MANAGE_EXTERNAL_STORAGE, notification, or foreground-service permission is added.
Users review selections and explicitly send. Cloud document providers may retrieve
selected content through their own networks before returning a stream.

Selected files stream over authenticated HTTPS to the paired PC. Partial files
stay in staging until verified, then use atomic no-overwrite publication. The PC
keeps bounded 24-hour completion receipts, including names, sizes, hashes and a
hash of the authorization session. Received files remain until manually deleted.
No relay, developer upload, file-content logs, automatic opening or execution.
Only PC controls change destination or receiving policy. Foreground-only; no
automatic retries/resumption. See FILES_AND_MEDIA.md for limits and tests.

Data Safety review must consider user-selected Photos, Videos, Files and docs
(and Audio files when selected), purposes App functionality, secure transfer,
recipient retention and the user-initiated transfer exceptions. Do not assert a
blanket no-data answer from the absence of an AliDevLab backend. Assess the actual
Console definitions and app scope before final owner-approved declarations.
Keyboard/provider audio processing is separate from WinDock microphone access.
The two privacy-policy drafts reflect these distinctions; neither is published.

References: [Photo picker](https://developer.android.com/training/data-storage/shared/photo-picker),
[Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files),
[Receiving shared content](https://developer.android.com/training/sharing/receive),
[Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469).

## Website shortcuts — 1 November 2026

User-selected names and full URLs persist in the PC dock configuration and are visible to authorized paired clients. No title/favicon prefetch or developer service is involved. Opening a tile delegates to the computer’s default browser. Added matching disclosures to the local website and Android policy drafts. Data Safety review should include user-provided URLs, the existing direct device-to-device transfer scope, and browser-initiated website requests; no new Android permissions or SDKs are added. Evidence: `src/links.js`, `src/config.js`, link routes in `server.js`, `openLink` in Windows/Linux providers, native `OpenLink`. Publication remains on hold.
