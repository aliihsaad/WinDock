# GitHub 0.3.0 release preparation

Publication update: stable v0.3.0 and its website went live on November 6.
Post-push CI exposed an overlooked Windows tray preview version label. The
tray metadata and fallback were corrected to stable `0.3.0`; the Windows
installer and checksum were refreshed. Its isolated startup, 42 native update
checks and all 36 source suites passed. Android and Linux package identities
are unchanged. See GITHUB_RELEASE_0.3.0_REVIEW.md for the correction record.

Owner chose stable **v0.3.0** on 6 November 2026 and subsequently authorized
publication with “Go ahead” after the final review. This covers the source commit,
GitHub tag/release and verified assets, followed by the website/demo/download feed.
Google Play publication and its separate signing/testing requirements are out of scope.

The previously deferred Windows firewall acceptance check passed on November 6,
including owner-confirmed Calculator launch from a securely paired remote client.
No further owner-operated device test is currently identified by this checklist.
Final release-focused source/package review is complete; see
GITHUB_RELEASE_0.3.0_REVIEW.md. No new blocker was identified. Publication is
authorized; disclosed issues #9 and #52 are not claimed fixed.

## Reuse these completed checks

- Nov 4 QA VM: public Windows 0.2.6 to candidate upgrade, retained Calculator
  tile and launch, no installer administrator prompt, one Installed apps entry,
  QR window, desktop shortcut, reboot/autostart and tile launch. Owner confirmed.
- Nov 1 actual installed Windows update: 19 tiles, real TLS identity and paired
  session retained; owner confirmed phone reconnect. Vault vm_HHbMHPGWAIOxif0p.
- Physical Huawei/Omarchy checks: secure pairing, restarts, lock recovery,
  Wi-Fi/USB switching, apps, input, clipboard, media and files. Nov 3 Linux USB
  firewall recovery and return to Wi-Fi were explicitly confirmed.
- Existing Android API 24 and 16 KB emulator checks, 51 JVM tests per variant,
  legacy-host compatibility, and the later Windows port/installer harness fixes.
  See PLAY_CANDIDATE_VALIDATION.md, LOCAL_ADDRESS_COMPATIBILITY.md,
  WINDOWS_VM_VALIDATION.md and NETWORK_SETUP.md. Do not repeat their full matrix.

## This preparation

- Stable version metadata: desktop releaseVersion 0.3.0; Android name 0.3.0,
  code 10. The GitHub APK is the existing debug variant, with manual feed/GitHub
  updates and old HTTP-host compatibility. The separate Play release variant
  remains HTTPS-only and directs updates to Play.
- APK certificate verified against the established public SHA-256 fingerprint
  `488186d4c2e70bd171bafd8fe7a11b8cce7d0fa7863113f334e07f66f57f83c1`.
  The final APK passed two focused updater tests, including the live feed. It
  upgraded the specifically verified public 0.2.6 code-9 archive and retained
  app-private test data on the dedicated emulator. No physical phone was changed.
- Packaging now rejects an unexpected APK signer, wrong version/code, or the
  Play release-config test APK. Positive and negative checks passed. The generic
  previous-public-release folder held an older incompatible certificate; Android
  rejected it without uninstalling or clearing data. The correct baseline is
  artifacts/play-compatibility-apks/v0.2.6-preview.1.apk.
- Windows installer rebuilt from an isolated package directory; packaged tray
  startup passed with separate test config and ports. No host installation changed.
- Linux 0.3.0-1 .deb and Arch packages built from an LF-normalized source copy.
  Debian 12, Ubuntu 24.04 and Arch disposable-container checks passed installation,
  ordinary-user startup, package revision upgrade and removal. They checked
  local pairing/help assets, current version, private CA permissions and TLS
  identity retention across the package upgrade. Containers do not prove a real
  compositor, systemd session, hardware input or firewall prompt; retain the
  already completed physical Linux evidence separately.
- Release notes, changelog, setup instructions, website and isolated demo updated
  locally. The staged download feed contains actual artifact hashes and future
  v0.3.0 asset URLs. Never deploy this feed before those assets exist publicly.
- Website verification: 16 targeted browser assertions passed for stable download
  URLs, sample transfers, folder/link tiles, release history, mobile widths and
  isolation from real device APIs. Screenshots are in output/playwright/release030-*.
- Embedded and website privacy text now describe GitHub 0.3.0 and its optional
  legacy HTTP channel accurately. The final APK differs from the updater/upgrade
  test APK only in assets/privacy.txt and signature metadata; all code and
  resources are byte-identical. Its privacy-screen check passed separately.

Evidence logs and artifact identity: `artifacts/github-0.3.0/`.
The reviewable upload set is assembled in `artifacts/github-0.3.0/release/`.
The LF-normalized source snapshot is provenance for this local build, not a Git
commit. A reviewed source commit and matching tag remain part of eventual release.

## Windows firewall acceptance — completed November 6

Use **WinDock-Play-QA only**, never the host's firewall or installed WinDock.
Do not repeat the successful upgrade, reboot, autostart or tile checklist.

1. Keep the existing guest accounts and saved dock. For an unambiguous fresh
   install trace, use a new disposable standard guest account, with other guest
   WinDock instances signed out. Install the final candidate under that account.
   Record installer prompts separately from a Microsoft Windows Firewall prompt.
2. If Windows asks to allow the bundled runtime, decline/cancel for this test.
   Record that choice. Verify local first use works and open **Pair a phone
   securely → Connection help and paired phones → Check connection**.
3. Record the actual listener port, executable path, guest address and network
   profile. Use a client with a route to the guest to show the remote connection
   fails while local access works. Hyper-V Default Switch NAT is not proof of
   physical-phone reachability: establish the client route first. If there is no
   route, report the test blocked rather than changing the host network.
4. Review the generated command in the guest. Under the guest administrator,
   apply only the needed Private-network rule scoped to the test client/subnet,
   actual guest address, listener port and bundled executable. Do not disable the
   firewall. A previously created explicit block can override an allow rule;
   identify and remove only that test-created guest rule if necessary.
5. Retry from the same remote client, complete secure pairing privately and
   launch one synthetic tile. Record denial, help, administrator recovery and
   successful remote use. Keep real PINs, QR invitations and tokens out of logs.

### November 6 VM firewall progress

The owner installed the final WINDOCK_030 DVD candidate under the fresh standard
guest account WinDockFirewall, cancelled the Node.js Windows Firewall prompt,
and opened local pairing/help successfully. The VM address is 172.19.130.151;
the main PC has an on-link route through 172.19.128.1/20. Initial main-PC TCP
checks to 8620 and 8621 timed out.

Screenshots confirm the guest Ethernet profile was Public, then changed to
Private using the guest WinDockTest administrator. The four listed enabled
node.exe block rules apply to Public only and were left intact. The owner copied
the generated secure-port command from the help page and applied it in the guest:
Private inbound Allow, TCP 8621, guest address 172.19.130.151, remote subnet
172.19.128.0/20, executable
`C:\Users\WinDockFirewall\AppData\Local\Programs\WinDock\node.exe`.
The resulting rule is enabled and stored persistently.

After that change, a native main-PC TCP check connected to 8621 successfully;
8620 still timed out. An initial sandbox check was denied by the tool sandbox
and is not VM evidence; the native retry supplied the result above. No host
firewall or installed WinDock changes were made.

Firewall denial/help/scoped administrator recovery and remote secure-port
reachability are verified. A native Node HTTPS client on the main PC then decoded
the owner's fresh QA QR, verified its CA and TLS hostname, received HTTP 401 for
unauthenticated state, successfully claimed the invitation (200), read the saved
Calculator tile through authenticated state (200), and invoked its launch (200,
ok=true). TLS verification remained enabled. Credentials stayed in process memory
and were not logged. Evidence: `artifacts/github-0.3.0/vm-firewall-remote-result.json`.
This is an actual host-to-guest secure protocol/action check, not an Android UI
test; retain the prior physical Android evidence separately. The QR reader and
client needed tooling fixes (QR decoder and DER-to-PEM CA conversion); those
failures were not WinDock failures. The first invitation expired before use.

The owner then explicitly confirmed Calculator appeared in the guest. Record
this final-candidate fresh standard-account/firewall denial/help/scoped guest
administrator recovery/secure remote action acceptance gate as **PASS**.

## Eventual publication sequence — requires explicit authorization

1. Review the full pre-existing implementation diff plus this preparation. The
   Windows firewall check is passed. Decide explicitly how to handle remaining
   device-specific issues (#9, #52); do not claim they are fixed.
2. Commit the reviewed source and bind v0.3.0 to that revision. Rebuild only if
   runtime inputs change; documentation-only changes do not invalidate device tests.
3. Use the verified local GitHub APK. CI's fresh runner generates another debug
   key: its APK is a test artifact, not an upgrade for existing users. The draft
   packaging guard intentionally rejects it. Do not bypass the check or replace
   the established signing key. A future controlled CI signing setup is separate.
4. Review the local release folder and notes, then obtain publishing authorization.
   Publish the GitHub assets first; verify public bytes and checksums, then deploy
   the prepared website/feed. Main-branch pushes can trigger Vercel deployment,
   so coordinate that order rather than pushing the new feed prematurely.
5. Verify the public feed advertises code 10/0.3.0 and opens the correct GitHub
   release. The local live-feed test still sees the currently published release;
   it cannot prove future production URLs before publication.
