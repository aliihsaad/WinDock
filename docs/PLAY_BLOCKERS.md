# Google Play release blockers — feature freeze, 3 November 2026

The owner froze new features on 3 November. Work now covers reproducible bugs,
compatibility/security checks, packaging, documentation and Play prerequisites.
Keep existing Windows/Linux functionality and older-client compatibility.
Do not commit, merge, push, deploy, upload, publish or create/modify production
signing keys without explicit approval. Existing local test keys are separate.

This is the current checklist. Older dated reports remain evidence of their own
builds; their unresolved checklists are not automatically the current state.
In particular, managed QR pairing no longer requires manual CA installation.

**November 6 GitHub update:** the owner chose a separate stable GitHub 0.3.0
release. Its fresh standard-account Windows firewall-denial/help/admin-recovery
and secure remote launch acceptance is now passed, as are the prepared Linux
package installation/upgrade/removal checks. Reuse the November 1 real Windows
paired-upgrade evidence. These later results supersede the corresponding open
companion-test gaps in the historical row below; see GITHUB_RELEASE_0.3.0.md and
WINDOWS_VM_VALIDATION.md. They do not satisfy Play signing, Play-distributed
testing, Console declarations or production-access requirements.

| Order | Blocker | Current status / evidence needed to close |
| --- | --- | --- |
| 1 | Final candidate validation | Local automated validation passed after the Android 7 font-resource fix: 51 debug + 51 release JVM tests; release bundle/lint inspection; 15 executed Android 7 tests with updated WebView; 16 executed tests on the 16 KB image; and two pairing-persistence/update phases on each image. Previous 36 Node suites and legacy 0.2.6 compatibility evidence remain applicable to unchanged desktop/protocol code. Owner's Windows/Omarchy acceptance covers the pre-font-fix APK below. Exact production-signed delivery and device acceptance remain gate 5. See PLAY_CANDIDATE_VALIDATION.md for skips, initial failures and runtime limits. |
| 2 | Clean companion installation and reviewer package | In progress. Owner's 16:33 screenshot confirms the full Hyper-V installer smoke PASS on Windows build 26300 / PowerShell 5.1: fresh install, bundled-server startup (exit 0), same-version reinstall sentinel preservation, uninstall and unchanged fresh-guest personal config. Owner also reports interactive installation/HTTP first use, automatic tray startup, synthetic tile retention after a guest restart, same-version interactive reinstall and uninstall/reinstall PASS; the fresh HTTP browser PIN is expected. The custom HTTP/HTTPS port fix passes 75 assertions and all 36 Node suites; the corrected process-status harness accepts exit 0 and rejects exit 7 in PowerShell 5.1 and 7. Owner reports a fresh dock, working shortcut, tray and browser in the new account, but recalls a skipped password prompt and a blank guest administrator password. The 17:17 screenshot verifies that the actual new account, Ali-VM, belongs only to Users. Owner subsequently confirms that rerunning the installer normally under Ali-VM requested no administrator credentials and opened the browser successfully: standard-account installer rerun/launch PASS. The 18:16 screenshot also confirms the native QR pairing window renders without an error under that account; phone pairing is not established by this image. A checksum-verified public v0.2.6-preview.1-to-candidate upgrade DVD is prepared; the owner has begun baseline setup and the 4 November 00:50 screenshot confirms a connected local dock at 127.0.0.1:8620 without a PIN, as expected from the public baseline loopback trust. At 01:12 the owner confirmed version 0.2.6-preview.1 and Calculator tile launch; the screenshot shows Calculator open inside the guest. At 01:15 the owner confirmed the same-account candidate upgrade retained the Calculator tile and it still launches; the screenshot supports tile/Calculator presence and includes the owner report of no administrator prompt. The 4 November 00:43 screenshot identifies Windows Firewall UAC requesting guest administrator WinDockTest credentials during this walkthrough. The owner says it matches the earlier skipped prompt. This identifies the current prompt directly and the earlier one by owner report; it does not establish installer elevation, a fully clean no-elevation first-install trace or firewall-denial recovery. Installed apps screenshot now shows one WinDock 0.3.0 entry. Owner subsequently confirms the newer interface appears at loopback too; temporary shell caching is likely but not proven. LAN PIN is expected. Owner confirms QR rendering, automatic tray startup after guest restart, shortcut opening and saved Calculator launch. Public-to-candidate Windows VM upgrade walkthrough: owner-reported PASS. No raw backend-version response was supplied. Real HTTPS pairing preservation through reinstall/upgrade, clean first-install/no-elevation trace, firewall/admin-denial recovery and clean Linux installation remain open. See WINDOWS_VM_VALIDATION.md. Do not test by removing the owner's real installation. |
| 3 | Production signing and preview migration | Pending explicit owner approval. Plan in `PLAY_SIGNING.md`; production upload key/custody/recovery and Play App Signing not configured by this work. Public debug-signed installs cannot directly upgrade to a different production signer; document the transition without losing PC data. |
| 4 | Final privacy, listing and reviewer access | Drafts exist. Reconcile against frozen behavior, refresh screenshots for current UI and Windows/Linux scope, finish Data Safety/rating/audience/free/no-ads declarations, provide companion access/instructions, and verify account tasks. Privacy/support/setup pages require approved public hosting. |
| 5 | Signed bundle and Play-distributed test build | Pending signing and upload authorization. Validate the signed AAB and generated splits; perform internal Play install/upgrade and pre-launch checks. Local debug-signed APK tests do not establish Play signing or delivery. |
| 6 | Required closed test and production access | Not started in Console. Newly created personal account: at least 12 opted-in testers continuously for 14 days before applying for production access. Recruit testers able to exercise WinDock with a supported companion. Record actual use, feedback and fixes. Sideloaded tests do not count toward the Play closed-test period. |
| 7 | Final production review and publication | On hold. Resolve review feedback and obtain explicit owner approval before release. Passing tests does not guarantee Play approval. |

## Candidate under validation

- Branch `play-store-integration-v0.2.6`; changes remain uncommitted.
- Android application ID `com.windock.app`, code 10, version `0.3.0-preview.1`,
  minimum API 24, target API 36. Freeze is a validation checkpoint, not a final
  public version assignment. Recheck the highest distributed/Console code before upload.
- Owner's HTTPS APK: `artifacts/WinDock-local-address-secure-test.apk`.
  SHA-256 `FF8F08018FD8487A4340557E3CD7F873BA685393B7E973421685CD8DA1FAE465`.
- Legacy-compatible APK for the Instagram tester's HTTP-only 0.2.6 companion:
  `artifacts/WinDock-local-address-legacy-test.apk`. Its physical non-private-LAN
  acceptance is pending; do not send it without the owner's approval.
- Fresh unsigned inspection bundle: `artifacts/play/WinDock-inspection-only.aab`.
  SHA-256 `5903DB62726DCC90589F5BF6AB049A56120ACBC6FDA06B3D3A80BD5D376C6AA8`.
  This is not an upload candidate. No production signing was performed.
- Post-fix local test APK generated from that bundle:
  `artifacts/WinDock-play-validation-secure-test.apk`, SHA-256
  `F6F7AD5CCA80484C40404BEB86870F6FDA843D464F3D83ABA93F8DADDB86939D`.
  Uses only the existing debug test certificate; release behavior is HTTPS-only
  and non-debuggable. The owner's already-tested APK was retained separately.
- Bundletool validation passed. Manifest retains HTTPS-only release policy,
  non-debuggable application, backups disabled, optional camera and the existing
  network permissions. No microphone, broad storage or accessibility permission.
  Bundle has zero native `.so` libraries, signature files, private-key text markers
  or keystore/key filenames in the inspected categories. Bundled privacy text
  matches source. These bounded checks are not a general guarantee of no secrets.
- Production npm dependency audit: zero reported advisories on 3 November.
  Release lint: zero errors, 31 warnings. Warning disposition remains part of
  final artifact review; passing lint is not a claim of zero warnings.

Current evidence: `artifacts/play-freeze-final-bundle-build.log`,
`play-freeze-final-bundle-validation.txt`, `play-freeze-final-manifest.xml`,
`play-freeze-final-bundle-inspection.json`, `play-freeze-dependency-audit.json`,
[candidate validation](PLAY_CANDIDATE_VALIDATION.md), and the earlier test
evidence in `LOCAL_ADDRESS_COMPATIBILITY.md`.

## Physical acceptance reported by owner

After installing the exact secure APK listed above, the owner confirmed "in my
test every thing pass" for Wi-Fi, USB with Wi-Fi off, reopening without rescanning,
typing, clipboard and sending a photo. They then confirmed Windows and Omarchy
Linux and supplied device settings screenshots:

| Tested device | Software visible in supplied screenshot |
| --- | --- |
| Xiaomi Pad 6 | Android 14; HyperOS 2.0.14.0.UMZEUXM |
| Samsung Galaxy S24 Ultra (SM-S928B/DS) | Android version not shown on the supplied About phone page |
| Huawei Mate 10 Pro (BLA-L09) | EMUI 12.0.0, build 12.0.0.226(C432E4R1P1); underlying Android version not shown |

These are user-confirmed passes, not independently observed test runs or a
claim that every device/host combination was separately measured. Do not infer
Android 12 from EMUI 12. The later font-resource compatibility patch is separate
from this exact APK's acceptance; retain its automated validation and final
artifact identity separately. Earlier hardware passes remain historical evidence.

The Instagram reporter's successful browser PIN page established reachability,
not final native-app acceptance. See `LOCAL_ADDRESS_COMPATIBILITY.md` for the
scoped fix and non-private subnet limitations. The brightness report on public
0.2.6 is a separate hardware/reporting issue; do not label it fixed merely because
the development build is newer. Triage any reproducible candidate issue before
closing final acceptance.

## Required approvals later

Prepare concrete, reviewable artifacts before requesting the corresponding
approval. Signing-key creation, account/Console actions, public companion/site
deployment, test-track uploads and production publication remain separate holds.
The feature freeze does not authorize any of them.

Official requirements checked 3 November 2026:
[target API](https://support.google.com/googleplay/android-developer/answer/11926878),
[closed testing](https://support.google.com/googleplay/android-developer/answer/14151465),
[app content/privacy and review access](https://support.google.com/googleplay/android-developer/answer/9859455),
[signing](https://developer.android.com/studio/publish/app-signing).
