# Windows companion VM validation — 3 November 2026

Status: the third guest run passed the complete installer smoke test, confirmed
by the owner's 16:33 screenshot. The earlier custom-port startup bug and
PowerShell 5.1 process-status harness bug are resolved for this run. Interactive
setup, real paired-state upgrades and other checks below remain open under Play
blocker 2.

## Environment confirmed by owner screenshots

- Hyper-V VM `WinDock-Play-QA`, generation 2, new 80 GB dynamic virtual disk,
  4 GB static RAM, two virtual processors, Secure Boot and virtual TPM.
- The owner ran the VM creation helper in Administrator PowerShell. It recorded
  VM ID `af7e7d92-b59f-45a1-9eb3-f64e8b18b88e` under ignored
  `artifacts/vm-validation/vm-created.json`.
- Windows 11 Enterprise Evaluation installed with local user `WinDockTest`.
  The initial expired watermark was transient: a later screenshot shows
  Activation state Active and a 90-day evaluation. No activation key was changed.
  The second guest report records Windows 11 Enterprise Evaluation version
  `10.0.26300`, build `26300`, and PowerShell `5.1.26100.9444`. The older build
  shown in the desktop watermark is not used as the OS-version evidence.
- Owner shut down the guest and created/renamed the checkpoint
  `Clean Windows — before WinDock`; screenshot confirms it and VM state Off.
- Existing internal Default Switch used. No physical disk passthrough, external
  switch, host firewall change or shared host folders were configured. Basic
  VMConnect session is used; enhanced-session drive/clipboard sharing is avoided.
- The owner's installed companion is separate at
  `%LOCALAPPDATA%\Programs\WinDock\WinDockTray.exe` (PID 2004 observed before
  rebuilding). No installer, uninstall or tray test ran against that installation.
  The Home Assistant VM shown in Hyper-V Manager is unrelated and was untouched.

## Prepared artifacts and checks

Version: package `0.3.0`, application release `0.3.0-preview.1`; uncommitted
`play-store-integration-v0.2.6` working tree. These are local QA artifacts.

- `artifacts/installer/WinDockSetup.exe`
  SHA-256 `093D7A2F274CE53AFA5A350FA8AE145B65811124B5ABB1402508E609BEED4C86`.
- `artifacts/vm-validation/WinDock-Installer-QA.iso`, 122,699,776 bytes.
  SHA-256 `D59977A53577CA916C0070E5A647070D8C41FAB953A28A908BE9DA5D95073EF0`.
- Current native helper/tray Release publishes passed. Initial restricted build
  failed during npm packaging with `Exit handler never called`; retry with normal
  cache/network access passed. Inno Setup compilation passed.
- Previous staging retained at
  `artifacts/WinDock-win-x64-before-vm-20261103-153531`; new staging was created to
  avoid shipping stale source files. All 62 staged `src`/`public` files match the
  current source, with no extra source files. The bounded sensitive-filename scan
  found no `.key`, `.pfx`, `.p12`, `.jks`, `.keystore`, `.env`, or exact
  config/sessions/pairing JSON filenames in staging. This is not a full secret audit.
- DVD contains only installer, an unchanged copy of the existing installer smoke
  script, the VM-only launcher and command wrapper, README, and checksum manifest
  (six files). 7-Zip integrity/extraction checks passed and every payload hash
  matched. No personal configuration or generated certificates were copied.
- VM-only launcher was executed on the physical PC and refused before file-copy
  or installation actions. PowerShell syntax and attachment-helper plan checks
  passed. The attachment helper targets the recorded VM ID/name, requires it off,
  checks the clean checkpoint and disk location, verifies the disc hash, then
  changes only that VM's DVD and boot order. It does not apply checkpoints/start
  the VM or change other VMs.
- Installer is not Authenticode-signed. No production signing keys were generated,
  read or changed; no commit, push, deployment or public upload was performed.

Evidence: `artifacts/vm-validation/build-windows.log`,
`build-windows-retry.log`, `build-installer.log`, `package-inspection.json`,
`disc-test.log`, `disc-extract.log`, `test-disc.json` and `disc/manifest.json`.

## First guest result and startup fix

Owner screenshots at 16:00 and 16:05 on 3 November show:

- PASS fresh installation, runtime files, Start menu entry and uninstall registration.
- PASS uninstall removes managed files, shortcut and registration.
- PASS personal dock configuration unchanged (fresh guest; no real pairing existed).
- Startup failed: `TRAY FAILED: Server exited with code 1`, `Cannot open TCP port
  18625`, `EADDRINUSE`. Tray stdout is empty. Reinstall was not reached.

The conflict reproduces with a fresh temporary config, mock provider and an
available custom HTTP port. It is a product startup bug exposed by the harness,
not evidence of another installed application occupying the guest port:
`serverPortChoice` defaulted its second argument to `process.env.PORT`.
Passing an unset `WINDOCK_MANAGED_TLS_PORT` therefore reused HTTP's custom port;
HTTP bound first and managed HTTPS collided with it. The external TLS listener
had the same unintended fallback. Default-port installations without `PORT`
were unaffected, explaining previous successful device tests.

The two-line fix makes environment input explicit in `src/server-port.js` and
passes `process.env.PORT` only for the HTTP call in `server.js`. HTTPS retains
its own environment variables, defaults and occupied-default-port fallback.
Authentication, certificates, pairing, saved state and protocols are unchanged.

Regression evidence under `artifacts/vm-validation`:

- `port-regression-before.log`: new custom-port regression fails with EADDRINUSE.
- `port-regression-after.log`: 75 assertions pass, including custom HTTP with
  managed HTTPS, external plus managed HTTPS, explicit TLS ports, validated TLS
  health requests and rejection of genuinely conflicting explicit settings.
- `suite-port-fix.log`: 36/36 Node suites pass, including secure transport,
  managed pairing/reconnection, discovery, input, clipboard, transfers, updates
  and Windows/Linux provider checks. These are not a substitute for VM or device tests.

The first wrapper also omitted its terminating error from `results.txt` because
its outer catch wrote only to the console. The revised wrapper saves the final
PASS/FAIL and guest OS/build, and uses a new `-port-fix` working directory. Original
ISO, installer, guest results and logs are retained. No checkpoint restore is
needed for the next run after the confirmed uninstall; existing-data guards remain.

Corrected local media:

- Installer `artifacts/installer-port-fix/WinDockSetup.exe`, SHA-256
  `22421166DCC322A6C587123E1F2E930993AC3954A74AF2459EB149B401A587E1`.
- Disc `artifacts/vm-validation/WinDock-Installer-QA-port-fix.iso`, SHA-256
  `3A4C4A90C08B3FFA80535EA535988B3793FE8934E25277592EECB4CFF92FBECC`.
- Inno Setup compile passed. Only the two changed JS files were refreshed in a
  separate copy of the previously built runtime; no native code changed. All 62
  staged source/assets match the repository and no extra source files were found.
- Six-file disc integrity/extraction and payload hashes passed. Original installer
  and ISO hashes still match. Attachment `-Revision port-fix -PlanOnly` passed;
  the owner subsequently attached and executed it (second result below). Launcher syntax
  and physical-PC refusal passed. An initial restricted check stopped at CIM
  access, so it was repeated with normal read access to verify the actual guard.
- Installer remains unsigned; production signing keys and installed host app were
  not modified. No Android code/build changed in this fix.

## Second guest result and process-status harness fix

Owner screenshots at 16:21 and 16:23 on 3 November show the revised report,
the same three installation/cleanup PASS lines, and:

- stdout: `TRAY OK: server started, URL and PIN received`.
- stderr: empty (zero bytes).
- The test still throws its generic process-status failure before the startup
  PASS line and reinstall step. It did not record the actual exit-code value.

An inert Windows GUI executable reproduces the failure on host Windows
PowerShell `5.1.26100.9711` without running an installer or WinDock. With the
same redirected `Start-Process -PassThru` and timed `WaitForExit` sequence,
`ExitCode` is null for both exit 0 and exit 7, even though `HasExited` is true.
PowerShell evaluates `$null -ne 0` as true. Retaining the process handle before
waiting makes both real codes available. This matches the second guest symptoms;
the third guest run below confirms exit code 0 and the complete smoke-test pass.

`scripts/test-installer.ps1` now retains the handle, finishes draining redirected
output after the timed wait, records the exit code, and rejects both nonzero and
unavailable codes. It still requires the success marker. No application code,
installer binary, signing configuration or personal installation changed in this
harness correction.

Regression evidence in `artifacts/vm-validation`:

- `process-regression-before.log`: the actual startup-check block extracted from
  the test script incorrectly rejects an inert fixture exiting 0.
- `process-regression-after-ps51.log` and `process-regression-after-ps7.log`:
  that block accepts exit 0 and rejects exit 7 under PowerShell 5.1 and 7.6.5.
  The failing fixture deliberately prints `TRAY OK`; a success marker cannot
  hide a real nonzero exit. These are harness tests, not installed-app passes.
- PowerShell syntax and targeted `git diff --check` passed. Application code is
  unchanged from the preceding 75 port assertions / 36-suite validation.

Third-run media:

- `artifacts/vm-validation/WinDock-Installer-QA-process-fix.iso`, SHA-256
  `26C9E5A4D5EF99C3C60DF5C2E9F1689F237842E8C281426B6EC87F6BBA761B4B`.
- Installer is byte-for-byte identical to the port-fix installer above.
- Test-script SHA-256:
  `063FAD63C9F1D9EE4924D5BE29E0C28FF7E26F5EF50E8CF07030665FE8334DA2`.
- Six-file DVD integrity/extraction and payload hashes passed. Both preceding
  ISO and installer hashes are unchanged. Original guest logs are retained.
- New guest working directory ends in `-process-fix`; all VM/user/existing-data
  guards remain. Attachment plan verification passed. The owner subsequently
  attached and executed this revision; the third guest result is recorded below.

## Third guest result — complete installer smoke pass

The owner's screenshot `WinDock-2026-11-03-163340-163-907aff.png` shows the
`-process-fix` run finishing in `WinDock-Play-QA` with:

- Windows 11 Enterprise Evaluation `10.0.26300`, build `26300`, PowerShell
  `5.1.26100.9444`.
- PASS fresh installation, runtime files, Start menu entry and uninstall registration.
- Installed tray exit code: `0`.
- PASS installed app launches its bundled server, receives URL/PIN and exits.
- PASS reinstall/upgrade preserves existing data (same-version sentinel check).
- PASS uninstall removes managed files, shortcut and registration.
- PASS personal dock configuration unchanged (fresh guest with no real pairing).
- Final result: `INSTALLER SMOKE CHECKS PASSED`; the tested installation was
  uninstalled by the test.

This is owner-supplied visual evidence, not a direct retrieval of the guest log.
The console identifies the guest result file as
`C:\Users\WinDockTest\AppData\Local\WinDock-Installer-QA-20261103-process-fix\results.txt`.
Original failed-run logs and the clean checkpoint remain available separately.

The completed smoke test covers fresh silent install, bundled runtime files,
shortcut/registration, installed tray/server startup, same-version reinstall
with an unrelated sentinel, uninstall and unchanged personal config. It cleans
up its own guest installation. It does not prove an older-version upgrade or
real authenticated pairing/identity preservation. The wrapper rejects a physical
PC, a user other than WinDockTest, an elevated token, existing WinDock data or a
previous QA directory. The copied test retains its own installation guards.

## Interactive setup, first launch and restart

Owner follow-up: after interactive installation, the companion runs in the guest
and its Browser / preview address opens the PIN page in Edge inside the VM.
The phone reports that the computer is not responding. The guest uses the
internal Default Switch NAT network; no physical-LAN route or inbound mapping
has been configured for the phone. Local browser success confirms HTTP page
availability only, not HTTPS pairing or remote reachability. Keep the phone
connection test pending rather than treating this as an application failure or
a secure-pairing pass.

1. Keep using Basic Session in `WinDock-Play-QA`, signed in as `WinDockTest`.
   Close the completed test console; do not rerun the smoke wrapper.
2. Inside the guest, open `This PC` → `WINDOCK_QA` DVD → `artifacts` →
   `installer` → `WinDockSetup.exe`. Run normally, without elevation.
3. Exercise the optional desktop shortcut and start-at-sign-in choices. Finish
   with `Open WinDock` selected, then inspect the tray menu and
   `Pair a phone securely` window. Record any warning/error before proceeding.
4. Confirm that the QR window opens. A later guest sign-out/sign-in checks
   autostart; installation alone does not establish it.

This step checks the guest GUI and first-launch experience. It does not assume
that a physical phone can reach a guest behind Default Switch NAT. Do not change
host networking, import the owner's pairing state or share host drives for it.

Restart-check procedure: sign into the guest's browser with the guest companion's PIN,
create one synthetic tile, then restart only the guest and sign in as
`WinDockTest`. If start-at-sign-in was selected during installation, verify the
tray appears automatically before launching anything manually. Reopen the guest
browser address and check that the tile remains. This does not establish Android
pairing persistence, an older-version upgrade, or a real standard-user install.

Owner result after the guest restart: the tray icon appeared automatically and
the synthetic tile remained after entering the new PIN. Record interactive
installation/HTTP first use, start-at-sign-in and tile persistence across a guest
restart as owner-reported PASS. Optional desktop shortcut behavior was not
separately confirmed.

The fresh browser PIN prompt is expected for this HTTP test. `server.js` creates
a new PIN and `createSessionStore()` at startup; `src/auth.js` keeps those legacy
HTTP sessions in memory. Managed HTTPS uses the separate durable store in
`src/secure-sessions.js`. The browser reauthentication does not demonstrate a
secure Android pairing regression, nor does this VM check establish HTTPS
pairing preservation.

Same-version reinstall procedure: quit only the guest's WinDock from its tray, rerun the same
`WinDockSetup.exe` from the test DVD interactively, retain the chosen installer
options and open WinDock. Sign into the guest browser if prompted and verify the
same tile. This exercises real synthetic dock state during same-version reinstall;
it is separate from the smoke test's sentinel check and an older-version upgrade.

Owner confirmed this interactive reinstall check passed: the companion reopened
and the synthetic tile remained. Record same-version interactive reinstall with
actual synthetic dock state as owner-reported PASS. This does not establish
older-version upgrade or authenticated HTTPS pairing preservation.

Uninstall/reinstall procedure: quit the guest companion, uninstall WinDock through the guest's
Installed apps, then reinstall from the same test DVD. Do not manually remove
application data or restore the clean checkpoint. Open the companion and its
HTTP address in the guest browser, authenticate if prompted, and check the
synthetic tile.

Owner confirmed this uninstall/reinstall check passed: the companion reopened
and the same synthetic tile remained. Record interactive uninstall/reinstall
with synthetic dock retention as owner-reported PASS. No real HTTPS pairing was
established in this guest, so its preservation is still unverified here.

Next guest check: create a separate local Standard User named `WinDockStandard`
inside the VM, retaining the existing `WinDockTest` administrator account and its
test data. Fully sign out of `WinDockTest` before signing into the new account to
avoid two companion sessions competing for the same ports. Run only the DVD's
`artifacts/installer/WinDockSetup.exe` normally, select the optional desktop
shortcut and verify installation, shortcut and browser first use without
administrator credentials. Do not run the smoke wrapper, which is restricted
to the original test user. Record any installation or firewall prompt separately.
Owner reports a fresh dock in the new account and that everything worked,
including the shortcut, tray and browser checks asked about. However, the owner
recalls a password prompt that was skipped and says the guest administrator also
has no password. Record functional success as owner-reported; do not yet mark
installation without elevation or firewall-denial recovery as PASS. The prompt's
source remains unverified. A blank
administrator password does not establish that an operation was unelevated.
Verify only inside the guest; no host account or network changes are required.

Owner clarified that the new guest account is actually `Ali-VM`, not the suggested
`WinDockStandard`. The 17:17 screenshot of `net user ali-vm` shows local group
membership `Users` only and no global groups. Standard-account membership is now
verified by the supplied screenshot; fresh dock, shortcut, tray and browser
behavior remain owner-reported functional passes. This does not identify the
earlier skipped password prompt or independently establish installer elevation.

Follow-up under `Ali-VM`: after quitting the guest companion and rerunning the
same DVD installer normally, the owner reports that no administrator/password
prompt appeared and WinDock opened successfully in the browser. Record the
same-version installer rerun and browser launch from a verified standard account
without administrator approval as owner-reported PASS. This confirms the rerun,
not a separately observed first installation with no previous application state.
The earlier skipped prompt remains unidentified; do not treat it as evidence of
firewall denial or remote-network recovery.

The owner's 18:16 screenshot shows the native `Pair your phone` window under
the same standard-account test, with a rendered QR code, expiry countdown and
no visible error. Record native pairing-window/QR rendering as screenshot-
confirmed PASS. Do not retain or decode the invitation. This is UI/startup
evidence, not a completed phone pairing or a test of guest network reachability.

## Public-release upgrade test — owner walkthrough passed

The actual public baseline is `v0.2.6-preview.1`, not a release tagged `v0.2.6`.
Its `WinDockSetup.exe` was downloaded from the repository's public GitHub release;
its SHA-256 matches both the release asset digest and `SHA256SUMS.txt`:
`DFFBCE5D810ED2D64D9EF772E0275AB9B28EADAC9EA4703E5FC3596D9CEF9B7E`
(123,360,249 bytes; PE product version 0.2.6). No installer was run on the host.

A separate, manually operated DVD is prepared:

- `artifacts/vm-validation/WinDock-Installer-QA-upgrade.iso`, label
  `WINDOCK_UPGRADE`, 246,046,720 bytes.
- ISO SHA-256: `11BB6AFA826877B450682017FC0774E8BE827E0F0789733488888EA36B8FA7B4`.
- `01-Public-0.2.6/WinDockSetup.exe`: the verified public baseline.
- `02-Candidate/WinDockSetup.exe`: existing unpublished candidate, unchanged
  SHA-256 `22421166DCC322A6C587123E1F2E930993AC3954A74AF2459EB149B401A587E1`.
- The other two files are manual instructions and a provenance/checksum manifest.
  ISO integrity, extraction, four-file allowlist and all payload hashes passed.
- Windows PowerShell 5.1 disc creation and attachment `-Revision upgrade
  -PlanOnly` passed. The owner subsequently began the guest baseline-install
  walkthrough; the baseline functional check and candidate upgrade remain pending.

After shutting down only the guest, the owner can run `Attach-TestDisc.ps1
-Revision upgrade` from an administrator PowerShell on the host. Its existing
guards require the exact powered-off QA VM, expected virtual disk and clean
checkpoint. Only the guest DVD/boot order are changed; checkpoints are retained.

Use a new guest Standard User named `WinDockUpgrade`, retaining the existing
accounts and results. Fully sign out of other guest accounts to stop their
companions. Install the public baseline normally, create and launch a synthetic
Calculator tile, then quit its tray and install the candidate under that same
account without uninstalling or clearing data. Check tile/layout retention,
launching, the native QR window, shortcut, autostart after a guest restart and
one Installed apps entry. Record any elevation/security prompt separately.
Do not downgrade the existing `Ali-VM` candidate installation.

The full instructions are on the DVD. Authenticate if prompted; loopback HTTP does not require a PIN by default;
this HTTP-baseline upgrade cannot establish preservation of a preexisting HTTPS
phone pairing. Default Switch NAT reachability limitations still apply.

### Firewall prompt identified — 4 November, 00:43

During the public-baseline setup walkthrough, the supplied screenshot shows a
guest UAC prompt for **Windows Firewall**, verified publisher Microsoft Windows,
requesting the guest administrator `WinDockTest` credentials. It is not a request
to create a password for the new standard account. The owner says this matches
the prompt previously skipped under `Ali-VM`, and reports that the new account
also has no password. The first `Ali-VM` prompt is therefore owner-identified as
the same firewall prompt, rather than independently captured at that earlier run.
Both the public-baseline and candidate installer source declare
`PrivilegesRequired=lowest`; this screenshot does not demonstrate installer
elevation or a completed upgrade.

### Loopback first use confirmed — 4 November, 00:50

The owner reports that the dock opened without entering a PIN. The supplied
00:50 screenshot shows Edge inside `WinDock-Play-QA` at `127.0.0.1:8620`, with
an empty dock and Connected status. Record local-browser first use as confirmed;
the screenshot does not independently establish the installed version or the
firewall prompt's final disposition.

Correction to the earlier walkthrough: the public baseline defaults
`trustLoopback = true` in `server.js`; `src/auth.js` authorizes a loopback client
with a loopback Host header without a PIN. Therefore no PIN prompt is expected
at this address. This is separate from remote-phone authentication. Earlier
HTTP PIN observations on other test addresses remain their own evidence.

Owner confirmation at 01:12 on 4 November: version `0.2.6-preview.1` and Calculator tile launch passed. The supplied screenshot shows Calculator open inside the QA VM; version and tile-triggered launch are owner-reported. The upgrade was performed in the following checkpoint.

Original baseline procedure: confirm the guest companion reports `0.2.6-preview.1`, then add and
launch a synthetic Calculator tile inside the guest. After that passes, quit
the guest tray and install `02-Candidate/WinDockSetup.exe` from `WINDOCK_UPGRADE`
under the same guest account without uninstalling or clearing data. Check tile
retention and launch before proceeding through the remaining upgrade checks.
Local-browser success does not establish inbound phone access or firewall
recovery. Keep the host's firewall, installation, dock and pairing unchanged.

### Public-to-candidate upgrade — 4 November, 01:15

After the same-account upgrade instructions, the owner confirmed the Calculator
tile remained and launched. The 01:15 screenshot shows the retained Calculator
tile and Calculator open inside the VM. The accompanying visible owner report
says no administrator prompt appeared. Record in-place upgrade, synthetic tile
retention and launch as owner-reported PASS, supported by the screenshot.

Still verify the running candidate version, native pairing window, desktop
shortcut, a single Installed apps entry, and autostart/tile launch after a guest
restart under the same account. No real HTTPS phone pairing existed in this
baseline test, so this result does not establish pairing preservation.

### Address/version discrepancy reported — 4 November, 01:20

The owner reports that the loopback tab appears to remain on the old version,
while opening the installed app's address in another tab shows 0.3.0 with the
same Calculator tile and asks for a PIN. Screenshots show HTTP addresses
`127.0.0.1:8620` and `172.19.139.213:8620`; both display the top controls island
and Calculator tile. The Installed apps screenshot shows one WinDock 0.3.0
entry under account WinDockUpgrade. It does not show a version readout in either
browser tab, and the native pairing window's contents are obscured.

The PIN difference is explained by the source: HTTP loopback peer plus loopback
Host is trusted; the LAN-address request requires authentication. The owner
subsequently confirmed the newer interface also appears at loopback. Temporary
shell caching is a likely explanation, not a reproduced or proven cause. No
raw `/api/updates` response was supplied; do not claim independent backend-version
verification. The installed 0.3.0 entry and owner confirmation remain the evidence.

### Final owner confirmation — 4 November

The owner explicitly confirmed all remaining requested checks: native pairing QR
renders, tray starts automatically after restarting the VM and signing into the
same account, desktop shortcut opens WinDock, and the saved Calculator tile still
launches. Together with the earlier installation, no-administrator-prompt and
single Installed apps entry evidence, mark the public v0.2.6-preview.1 to candidate
0.3.0 Windows VM walkthrough as owner-reported PASS.

This completes the interactive upgrade checklist for the synthetic guest dock.
It does not establish real HTTPS phone pairing/TLS identity/session persistence,
remote firewall-denial recovery, clean Linux installation or Play delivery.

## November 6 final GitHub candidate acceptance

The owner installed the final WINDOCK_030 candidate under the new standard guest
account WinDockFirewall. Installation completed without reported installer
elevation; a screenshot separately identifies the Node.js Windows Firewall
prompt. The owner cancelled it. Local dock and connection help worked, while
main-PC checks over an established on-link route timed out on both ports.

The owner used the guest WinDockTest administrator to change Ethernet from Public
to Private and apply the help page's generated rule for this account's bundled
node.exe, TCP 8621, guest address 172.19.130.151 and subnet 172.19.128.0/20.
Public-only block rules were retained. Remote 8621 then connected; 8620 remained
unreachable. A native main-PC HTTPS client verified the QR-supplied CA and TLS
hostname, confirmed unauthenticated access was rejected, paired successfully,
read the saved Calculator tile and requested its launch. The owner explicitly
confirmed Calculator appeared in the guest. This fresh-account/firewall recovery
and secure remote action gate is **PASS**. No host firewall/app changes occurred.

Full evidence is in GITHUB_RELEASE_0.3.0.md and
artifacts/github-0.3.0/vm-firewall-remote-result.json. The remote client was a Node
protocol test, not another Android UI run. Prior physical Android passes stand.

## Scope outside this completed GitHub VM gate

- Real guest pairing persistence through upgrade was not tested here. Reuse the
  November 1 actual installed Windows upgrade evidence (19 tiles, real TLS
  identity/session and owner-confirmed phone reconnect); do not relabel it as VM evidence.
- Actual Linux package install/upgrade/remove checks now passed in disposable
  Debian 12, Ubuntu 24.04 and Arch containers; existing Omarchy physical passes
  remain separate. See GITHUB_RELEASE_0.3.0.md for their scope.
- Final signed delivery/Play review gates remain in PLAY_BLOCKERS.md and are
  separate from the requested GitHub release.

Default Switch NAT VM tests do not establish physical Wi-Fi discovery, USB
tethering passthrough, hardware brightness or native input across all desktop
sessions. Retain the owner's real-device evidence and identify any untested paths.
