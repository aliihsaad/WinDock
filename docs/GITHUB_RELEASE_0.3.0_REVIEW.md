# GitHub 0.3.0 final preparation review — November 6, 2026

## Publication correction

The fresh publication CI run exposed a missed Windows tray metadata mismatch:
`InformationalVersion` still said `0.3.0-preview.1`. The review below describes
the earlier preparation and does not supersede this finding. The tray metadata
and its update-check fallback were corrected to `0.3.0`; the Windows installer
was rebuilt from the previously tested package with the corrected tray.
The rebuilt executable reports stable `0.3.0`, isolated tray startup passes,
42 native update checks pass, and all 36 source suites pass. Android and Linux
binaries are unchanged. The Windows checksum and download feed are refreshed.

## Original preparation review

The prepared stable GitHub release is ready for the owner's publication decision.
No new release-blocking finding was identified in this release-focused review.
No commit, push, tag, upload, GitHub draft, publication or deployment was performed.

## Evidence and scope

- All four release binaries match the previously verified SHA-256 checksums.
  Windows setup, GitHub Android APK, Debian package and Arch package retain the
  identities tested during preparation. The current runtime source matches all
  corresponding files in the 404-file build snapshot after LF normalization.
  Later differences are release/QA documentation only; no runtime rebuild or
  repeat device test is required for those changes.
- The final Windows QA gate is PASS: fresh standard guest, cancelled Node
  firewall prompt, working local help, known-route remote denial, guest-only
  Private rule, verified HTTPS QR pairing, authenticated saved tile, successful
  remote launch and owner-confirmed Calculator appearance. The remote client was
  a native Node client on the main PC; this does not claim another Android UI run.
- Reused prior public-to-candidate VM upgrade/autostart acceptance, real Windows
  paired-upgrade acceptance, physical Android/Omarchy checks, Android compatibility,
  signer and update checks, Linux package checks and the 16 website/demo assertions.
  None of those full matrices was rerun during this review.
- Release-critical source review covered transport/session separation, local-only
  pairing and management routes, certificate and hostname validation, protected
  persistent identity/session storage, transfer authorization/path/size/commit
  boundaries, scoped firewall command generation, shortcut validation, installer
  privileges and payload allowlist, Android update-channel selection and WebView
  restrictions. This is a release review, not an independent security certification.
- Website and staged feeds agree on all four asset URLs, sizes and hashes.
  Android is 0.3.0/code 10, uses the established GitHub certificate, checks the
  public download feed and opens GitHub. Play delivery remains a separate variant.
- Read-only GitHub inspection found no v0.3.0 release. Latest published release
  among the five returned entries is v0.2.6-preview.1. An unrelated older draft
  remains untouched. Issues #9 and #52 remain open and are disclosed as not fixed.

## Publication decisions and constraints

1. Retain the disclosed Galaxy S4 automatic Performance mode limitation (#9;
   manual On workaround) and Omen brightness/error-report discrepancy (#52).
   The release does not promise those reports are resolved.
2. Windows remains unsigned and Android retains its established debug signing
   certificate/configuration. Stable version numbering does not change either.
3. Use the prepared local APK. A fresh CI debug signer cannot update existing
   users; the packaging guard intentionally rejects it. Do not dispatch the CI
   draft-release path as a substitute or bypass that guard.
4. Stage only the explicit reviewed source list. Exclude .codex-attachments,
   .codex-remote-attachments, the unrelated root image, QA screenshots, artifacts,
   local toolchains, logs, credentials and signing keys. The build snapshot is
   historical provenance; final documentation can be committed alongside the
   matching runtime without rebuilding binaries.
5. After explicit authorization, bind the reviewed source to a commit/tag and
   publish the verified GitHub assets. Verify public downloads before deploying
   the website/feed; a main-branch push may trigger Vercel automatically. Use the
   release branch for the initial source push so the feed cannot deploy early.
6. Verify public feed/version/URLs after publication. These checks cannot be
   completed while publication is intentionally on hold.

Local evidence: artifacts/github-0.3.0/final-review-integrity.json,
vm-firewall-remote-result.json, release/RELEASE-NOTES.md and READINESS.md.
No further owner-operated device check is currently identified.
