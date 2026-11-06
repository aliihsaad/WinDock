# Guided connection and firewall setup — local changes, 2 November 2026

The Linux phone-pairing failure was caused by a firewall allowing HTTP/discovery but blocking managed HTTPS. A successful QR scan or discovery reply cannot establish that HTTPS is reachable. This change makes the required ports and recovery steps available on the computer, without weakening authentication or changing firewall rules automatically.

## User flow

- Linux: open WinDock, then run `windock network`. The launcher and package-install messages point to it. The connection window now leads with QR pairing when supported, while retaining the PIN for older clients.
- Windows: **Pair a phone securely → Connection help and paired phones** opens the local tools page. The installer finish message explains Private-network permission and this recovery path.
- On the local pairing page, expand **Phone finds this PC but cannot connect? → Check connection**. It reports the current server listener ports, discovery port and available private networks. Choose the network shared with the phone; review and copy only the needed commands.
- UFW commands restrict inbound access to the selected interface/subnet. firewalld instructions use the interface's existing zone and selected source subnet, with separate runtime/permanent commands; they do not reload or replace the configuration. Zone rules also apply to other interfaces sharing that zone.
- Windows commands restrict access to the running Node executable, selected local address/source subnet, actual port and Private profile. No rule for Public networks is generated. USB tethering may require marking the owner's trusted tether network Private and reviewing its separate subnet.
- Rule execution is an explicit administrator action in the OS terminal. WinDock does not request a password, elevate, apply commands, disable a firewall or forward router ports. Browser/older-client access is labeled optional.

The UFW command form follows its [official manual](https://manpages.ubuntu.com/manpages/jammy/man8/ufw.8.html). firewalld uses [source-scoped rich rules](https://firewalld.org/documentation/man-pages/firewalld.richlanguage.html). Windows scoping follows [New-NetFirewallRule](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule?view=windowsdefender).

## Implementation and boundaries

`src/network-setup.js` provides read-only backend detection and command generation. Calls use `execFile` with fixed read-only arguments, time/output limits and no shell. CIDRs must match a real private IPv4 interface; invalid masks, public/loopback addresses, ranges extending outside private space and known VM/VPN adapters do not get automatic rule suggestions. Unknown or conflicting firewall managers produce guidance rather than guessed changes. UFW status requiring administrator access is explicitly reported as unverified, never as an open port.

`server.js` exposes `GET /api/pairing/network` only under the existing local recovery and same-origin checks. It uses actual bound TCP ports, so managed TLS alongside external TLS and automatic port fallback do not rely on a fixed 8621 assumption. The response contains no invitations, session tokens, PINs or CA/key material. It cannot prove end-to-end phone reachability; the final step remains a real phone connection.

`public/pair.*` renders the report using text-only DOM operations, with scoped command fields and explicit Copy buttons. `src/platform/linux-cli.js` opens the page through loopback at the active status-file port, never the remote advertised address. The Windows installer still uses per-user privileges and the OS firewall prompt; it does not silently create elevated rules. Existing OS block rules or organization policy may take precedence over a suggested allow rule.

Android now distinguishes a matching discovery reply followed by an unreachable secure connection. It suggests checking the firewall/network and the companion's Connection help. TLS identity/expiry/authentication errors retain their specific messages. Reconnection remains bounded and initial failed pairing remains on the connection screen. During a secure attempt the address field shows that attempt's destination rather than the previous Windows address. Pairing formats, trust storage, TLS validation and legacy networking are unchanged.

Website `setup.html` and Linux packaging notes explain the updated preview's connection tools, Wi-Fi/USB differences and administrator approval. They remain local and unpublished.

## Validation

- Full Node regression suite: **36/36 passed**. Targeted diagnostics and Linux CLI tests rerun after final refinements. Coverage includes custom listener ports, cross-origin/remote rejection, restricted subnets, shell-sensitive names, Windows path quoting, unsupported/conflicting backends and administrator-unavailable states.
- Android debug/release builds and **44 unit tests per variant** passed; lint has zero errors. On the exact final APK, the combined emulator run passed 11 executed tests (runner reports 16, including four gated transfer skips and one process-phase skip). All four transfer tests then passed with their flag enabled; separate pairing seed/verify processes each passed. Evidence: `artifacts/network-setup-final-apk-tests.txt`, `network-setup-files-tests.txt` and `network-setup-process-*.txt`.
- Windows tray build: zero warnings/errors. Native pairing: **31 checks passed** via the existing fixture-generating script. An initial direct test invocation lacked its fixture argument; rerunning through the proper script passed.
- Connection-help browser checks: 9 assertions; website guide: 6 assertions across desktop/mobile widths. Screenshots inspected. The deliberate HTTP 503 test and missing favicon are the only browser resource errors. A repeated browser run initially retained its intentional 503 route; the harness now clears that route before each run.
- Real Linux: ran the new module read-only over the verified SSH connection. It identified UFW, current secure port 8621 and the Ethernet subnet, while accurately reporting that effective rule inspection needs administrator permission. Generated Linux/Windows commands were parsed without execution.
- Sandbox initially prevented temporary fixture file operations; the isolated regression suite passed outside that restriction. No installed companion, firewall configuration, production signing key or website deployment was modified.

## Local-test artifact and remaining acceptance

`artifacts/WinDock-connection-help-local-test.apk` uses the HTTPS-only, non-debuggable release configuration and existing debug test certificate. Package `com.windock.app`, version code 10, minimum API 24 and target API 36 are unchanged. SHA-256: `71E9590B801952AA5E3DCAB0343A5DE42E6EE165B46A0E2D38219D155C401649`. The existing key file was verified unchanged. This is not a production-signed Play artifact.

Before release, test fresh installation and the actual administrator workflow on clean UFW, firewalld and Windows systems, including administrator denial, explicit block rules, custom/fallback ports, DHCP changes and USB tethering. Verify the new Android message on physical Huawei/Samsung devices. The current PC/Linux installation was intentionally not replaced during implementation. Public release, deployment, Play signing/upload and store testing gates remain pending approval. No commits, merges or pushes were made.

## Owner's Linux test update, staged but not activated

The owner asked how to test the changes. A six-file local update is staged at `/home/alidevlab/windock-local-tests/connection-help-20261102`. Preflight passed: 6 expected files, 9 existing tiles, no changes applied. The current service still runs the previous files. The updater requires explicit `--apply`, checks original/staged hashes, backs up application files, restarts only the user service, checks tiles and identity afterward, and restores previous application files on failure. It never edits saved data or firewall rules. Local copy: `artifacts/network-help-linux-test/`.

On Linux, activate it with:

```sh
cd ~/windock-local-tests/connection-help-20261102
../links-20261101/node install.mjs --apply
```

Then install `WinDock-connection-help-local-test.apk` over the existing phone app. Open the `pairUrl` printed by the updater on Linux (normally `http://127.0.0.1:8620/pair#network`) and click Check connection. Expect secure port 8621/TCP, discovery 41234/UDP, and the Ethernet network `192.168.178.0/24`. UFW may say administrator access is needed to inspect effective rules; that is an honest permissions limitation, not a failed connectivity test. Review the suggested commands only: this PC's working firewall rule is already present. Confirm the phone reconnects without another QR, retains the 9 Linux tiles and can switch to Windows and back.

The machine's `/usr/bin/windock` still belongs to its older system package. For this staged local-test installation, use the printed browser link, or explicitly run `../links-20261101/node ../links-20261101/src/platform/linux-cli.js network` from the staging folder. A future packaged install will expose the new `windock network` command normally. Do not remove the working firewall rule to test a failure; blocked-port testing belongs in an isolated acceptance environment.

### Owner activated the Linux update

The owner supplied a screenshot of the live UFW connection-help page. Read-only verification confirmed the updater receipt: `updated: true`, all **9 tiles unchanged**, identity unchanged and firewall unchanged. The service is active (PID 3149019), with HTTP 8620 and managed HTTPS 8621. Backup: `/home/alidevlab/windock-local-tests/links-20261101/backup/connection-help-2026-11-02T12-45-55-655Z`. The screenshot confirms correct LAN/subnet and port guidance. Phone APK installation, reconnection and switching after this particular update still await the owner's confirmation.

The owner then replied **“working”** to the updated-APK/reconnect/9-tiles/Windows-to-Linux switching checklist. Record that device acceptance as user-confirmed, rather than independently observed. The local testing walkthrough is complete. Fresh-machine administrator/firewall workflows, including USB-specific firewall behavior, remain separate release checks.

### Linux USB retest — 3 November 2026, unresolved

The owner tested with phone Wi-Fi off and Connect by USB, receiving “Your computer isn't responding.” Read-only SSH checks confirmed the user service active, TCP 8620/8621 listening on all interfaces and UDP 41234 bound. Linux initially had USB interface `enp0s20f0u5`, address `10.147.219.82/24`, and phone gateway `10.147.219.29`. NetworkManager recorded successful USB DHCP activation.

UFW's service is active and its configuration has default inbound DROP. Saved WinDock rules allow HTTP/discovery from `192.168.178.0/24` and secure TCP 8621 on `eno1` from that same home subnet. No saved USB allow rules exist for TCP 8621 or UDP 41234. The live connection-help endpoint correctly listed the USB interface and generated scoped commands for `10.147.219.0/24`. This is evidence of a missing USB firewall configuration, not evidence that the companion stopped. Effective kernel rules could not be inspected because noninteractive sudo requires the owner's password; no password was requested or collected and no firewall changes were made.

During diagnosis the USB adapter disappeared. NetworkManager recorded the link being removed and its DHCP lease cancelled at 10:33:20; a fresh interface listing confirmed only loopback, Ethernet and Tailscale remained. The cause of that removal (tether toggle, cable or device behavior) is not established. Asked the owner to reconnect and keep tethering enabled. Before issuing firewall commands, recheck the live USB interface/subnet, because a new tether session can change them. Then have the owner allow only secure TCP and discovery UDP for that USB scope, and retry with the existing Linux pairing. No APK/code change, re-pairing, or firewall reset is justified by these findings yet. USB acceptance remains open.

The owner then confirmed tethering enabled. A fresh read found **`enp0s20f0u4`**, `10.147.219.247/24`, gateway `10.147.219.29`; the interface changed from the initial snapshot. The live help endpoint immediately reflected this new interface. Supplied the owner the following narrowly scoped commands to run locally (sudo requires their password), then retry selecting the saved Linux PC with Wi-Fi off. These commands have not been executed by the assistant; await the owner's result. Recheck rather than reuse these values if the port or tether subnet changes again.

```sh
sudo ufw allow in on enp0s20f0u4 from 10.147.219.0/24 to any port 8621 proto tcp comment 'WinDock USB secure'
sudo ufw allow in on enp0s20f0u4 from 10.147.219.0/24 to any port 41234 proto udp comment 'WinDock USB discovery'
```

### Linux USB connection confirmed by owner

On 3 November the owner replied **“it works”** after receiving the two scoped USB firewall commands and the instruction to select Linux with phone Wi-Fi off. Record this as user-confirmed Linux USB connection acceptance: the missing USB-scope firewall permissions caused the observed connection failure. The assistant did not execute the commands or independently observe the phone. This confirmation does not establish USB app-launch/file-transfer checks or a subsequent switch back to Wi-Fi; those remain to be explicitly confirmed. Clean-install administrator workflows on Windows, UFW and firewalld remain release checks. No application code, production signing keys or publication state changed during this diagnosis.

The owner subsequently confirmed **“all steps are done and worked”** for the three follow-up checks: launching an application from a Linux tile over USB, sending a photo to Linux over USB, and reconnecting to Linux over Wi-Fi after disabling USB tethering without scanning again. These are user-confirmed passes, completing this Linux USB/Wi-Fi device checklist. They do not replace fresh-install firewall/admin acceptance on Windows, UFW and firewalld or testing different USB ports/subnets.
