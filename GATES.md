# Gates: WinDock v1 foundation

OWNS: src/**, public/**, scripts/**, test/**, native/**, server.js, package.json

Scope: A Windows-hosted remote app dock. A Node host serves a PWA and syncs over
WebSocket; a phone on the same LAN launches and focuses Windows apps and drives
system/media control. This ledger covers the host, the platform provider layer,
the Windows provider logic, the PWA, and the security boundary. Compiling the C#
helpers, running real Win32 calls, and building the Android APK are recorded as
explicit handoffs because this machine has no .NET SDK, no Android SDK, and no
Windows.

- [x] G0: this ledger states outcomes that can fail
  CHECK: node /home/aliihsaad/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=361d81a841bbccc63b4d7ae04c094e685fb18334b464e7b41c20ca818536c3bd; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G1: every platform provider implements the whole provider contract with correct arities
  CHECK: node scripts/verify-contract.mjs
  EXPECT: contract verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=01881388b046208357bfd43185fb10fc5660866dafe70e3b5126546a50ede850; exit=0; EXPECT=matched; output-sha256=b653026b8c0b845aaa3a346fcca17fcc3e02467dffcda613bd90d1d920faea3e; output-bytes=43; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G2: Windows installed-app inventory is parsed from Start Menu and registry fixtures
  CHECK: node scripts/verify-inventory.mjs
  EXPECT: inventory verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=8671b5620fda50282b58b4ffe47e7aee048f5c2e48cc554094a72a0e98b51f5a; exit=0; EXPECT=matched; output-sha256=7342c2f2dc93a193537886e7435a717a415035d4d02558720c6b664b2cb7b744; output-bytes=44; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G3: Windows running-window enumeration is parsed into stable app identities
  CHECK: node scripts/verify-running.mjs
  EXPECT: running verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=e7e7c174a2a208ef138084277812edbafb5a3b6250739127c4b8b3ff69ee83d8; exit=0; EXPECT=matched; output-sha256=66fb23fd2a8d89770cfebde7e97162cefcccc0501f73b67adb528e84eddcb578; output-bytes=42; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G4: launch and focus build exact argv that never reaches a shell
  CHECK: node scripts/verify-launch.mjs
  EXPECT: launch verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=9afe3f122353311f9357e85364342058737079334c8703bf1ea1ed2c5e7a7026; exit=0; EXPECT=matched; output-sha256=18f2ade93603717f3cf256013b6ef0b0790b7450ebcec7e2d847503113b85677; output-bytes=41; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G5: every system and media control action maps to a declared native verb
  CHECK: node scripts/verify-control.mjs
  EXPECT: control verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=324ef426f2b8e85c05c66825cb5be525f6802dfd4c1d87fef0c5b6844c828559; exit=0; EXPECT=matched; output-sha256=e45d6d87d95eb652c93f775ff6b0afeacf2a97631ba18e7a000a599f738e51d8; output-bytes=43; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G6: PIN auth admits the right code, rejects wrong codes, and locks out brute force
  CHECK: node scripts/verify-auth.mjs
  EXPECT: auth verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=1fad473f2dc546d961f6e43e8165dc75049bab53b6124ce5450890611530061b; exit=0; EXPECT=matched; output-sha256=91ccec5e78e978f797f15edb6d2a91a9af68b3ff9353c52ca733a87bfe7f45aa; output-bytes=39; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G7: hostile input is rejected by the injection negative control
  CHECK: node scripts/verify-injection.mjs
  EXPECT: injection verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=cde917357ab7c19685c20fd8aa3c56099bdc9df56a5189346177d4c388e6f527; exit=0; EXPECT=matched; output-sha256=5c439fe22ec67308a61854c4ec2deb6e6c049170b45c9d2663c78c37f8370642; output-bytes=44; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G8: UDP discovery answers only a valid probe and ignores malformed traffic
  CHECK: node scripts/verify-discovery.mjs
  EXPECT: discovery verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=668e38b85503f542f00315035189aa2603678ef1c043cfa34a947474ac273f06; exit=0; EXPECT=matched; output-sha256=be70dc6f4ec05e2d5beb2ca85348f8e0120b21db687fec2cee2a6a826932ff09; output-bytes=44; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G9: the HTTP API serves its documented routes under a live server
  CHECK: node scripts/verify-api.mjs
  EXPECT: api verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=5b801ee0bbc76c461cad5db2a2fa1b67a9d5a4d076d1f36ff6482186082346ee; exit=0; EXPECT=matched; output-sha256=aafede4389fc951fbc6ff369caa47bc285bd270d2ecb296ffe694f96bad27e67; output-bytes=38; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G10: WebSocket clients receive dock state and live updates after pairing
  CHECK: node scripts/verify-sync.mjs
  EXPECT: sync verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=d8eb3a70ddf8188e7b25c35e539e51ece1444a0824fc2a95043198c349b10159; exit=0; EXPECT=matched; output-sha256=4e8ccb496495c65eada1da4cf44c1c6502f88c2e6d86c6bc45f600671ee8676c; output-bytes=39; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G11: the PWA ships a valid manifest and its dock logic renders tiles headlessly
  CHECK: node scripts/verify-pwa.mjs
  EXPECT: pwa verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6626723123114cd41297c7074ba42ca0dd4d12d84574517e0d4f997e18bb8a8; exit=0; EXPECT=matched; output-sha256=f7591d47c6532d516a00b0c247cb55aa81c82a7e0c4678dc9bd32cbe43aafc4a; output-bytes=38; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G12: the repository test suite passes end to end
  CHECK: npm test
  EXPECT: SUITE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=e0dad5c19654f09610cc4a8ebc3bb346555490b0e81c5d1e5ba8d852a4e2ae8c; exit=0; EXPECT=matched; output-sha256=0dfb0b16b1f5198eceaa3debfddf91be9aa75d1e1721c18c83d63c16896c3700; output-bytes=851; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G15: control tiles and app tiles can be added, removed and reordered from the dock UI
  CHECK: node scripts/verify-editing.mjs
  EXPECT: editing verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=f5eec30ccedd862785d82c7ec48c661ecf8f35ad00547e8b1ba818533a1645ab; exit=0; EXPECT=matched; output-sha256=201558dfc6cf43684eb4950f7383722c5392b181bd404b00cec8a85ea0307a42; output-bytes=42; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G16: the PWA registers a service worker and serves an installable offline shell
  CHECK: node scripts/verify-offline.mjs
  EXPECT: offline verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=21f19cd3bbe58b8b15151d80cbf3c2c8d19b77db3196f1bfe2a070b45836d8a4; exit=0; EXPECT=matched; output-sha256=30947b977dd6f2f91cc42e41bd54a55bdd4ea0261f8d8f6766bffb340a8a7812; output-bytes=42; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [x] G17: the Android wrapper source agrees with the host discovery and API contract
  CHECK: node scripts/verify-android.mjs
  EXPECT: android verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=7a4c5bd32a170d3a456ac7a69936fbcf8d2229241b47c793371a34e5ce9d5fd7; exit=0; EXPECT=matched; output-sha256=6f12790208b6f2b57a0336613af32782a963aaf65e1443c8afeb7b8c7681963a; output-bytes=42; shell=/bin/sh; cwd=/home/aliihsaad/Projects/WinDock; path=35711f0c9bd2/13 entries

- [ ] G13: C# native helpers compile into a runnable Windows tray host
  EVIDENCE: pending

- [ ] G14: a real Android device launches and focuses an app on a real Windows PC
  EVIDENCE: pending

ABANDON: G13 no .NET SDK on this machine (dotnet runtime 10.0.11 present, `dotnet --list-sdks` empty) and no Windows host; C# sources are delivered unbuilt for compilation on a Windows box with the .NET SDK.
ABANDON: G14 no Android SDK, no JDK, no adb, and no Windows PC available here; end-to-end device verification is handed off to hardware.
