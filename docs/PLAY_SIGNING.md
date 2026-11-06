# WinDock production signing plan — no key operations authorized

Prepared 30 October 2026 for AliDevLab. Support: alidevlab10@gmail.com.
The personal Play account exists; the owner reports dashboard access and an
enabled Create App button. No WinDock listing exists. This does not establish
production access or completion of every account verification requirement.

**Hold:** do not generate, replace, read out, export or commit private signing
keys without the owner's explicit approval. Do not create a Play listing, enroll
signing, upload a bundle, publish or deploy as part of this preparation. No key
operation is needed to review this plan. TLS certificates for local networking
and Android app-signing keys are separate credentials and must never be reused.

## Recommended custody model

Use Play App Signing with a Google-managed app-signing key, and a distinct
AliDevLab-controlled upload key. The app-signing key signs APKs delivered by Play;
the upload key authenticates submitted AABs. Losing an upload key can be addressed
through Play's reset process without changing the app-signing identity.
If identical signing across other stores is required, decide the app-signing-key
strategy before enrollment; a Google-generated private key cannot be downloaded.
See [Android's signing guide](https://developer.android.com/studio/publish/app-signing).

Keep `com.windock.app`. Public 0.2.6 already uses version code 9. The eventual
candidate must exceed all previously distributed codes (at least 10 based on the
release reviewed), even though this is the first Play listing. The integrated candidate uses code 10; see PLAY_INTEGRATION.md. Do not treat the historical code-9 inspection bundle as a publication candidate.

The existing public APK is debug-signed. A fresh production app-signing identity
will not silently update that installed APK. Plan and document the transition:
users may need to uninstall the debug app, losing phone-local settings/pairing;
their separately stored PC files/settings remain. Preserve preview signing for
the existing GitHub distribution while that channel remains supported. Never
promote the public debug key to production or promise an in-place migration
without a certificate-compatible, tested route.

## After explicit key-generation approval

1. Record the approved account/package, key owner, backup custodian and storage
   location. Use a dedicated encrypted location outside the repository, build
   outputs, website tree and ordinary synchronization folders. Restrict access
   to the owner and required build identity. Do not weaken ACLs on existing files.
2. Check the chosen destination does not already exist. Abort rather than
   overwrite or silently rotate any keystore. Keep an existing production key
   unchanged unless a separately approved migration/reset procedure applies.
3. Generate a dedicated upload key locally with JDK keytool/Android Studio after
   approval: RSA 3072, SHA-256 signature, validity 10,000 days, descriptive upload
   alias, and a long unique password stored in a password manager. Prompt for
   passwords locally; never pass them in command arguments, chat or shell history.
   No generation command is run or embedded in an automatic build hook here.
4. Back up the encrypted keystore independently. Document access and recovery;
   verify the backup can be opened without disclosing its contents. Retain public
   certificate SHA-256 fingerprint, alias, algorithm, validity and custody record.
   A public certificate/fingerprint can be shared; the private key cannot.
5. Only after separate Console authorization, enroll Play App Signing and register
   the upload certificate. Record both upload and app-signing certificate
   fingerprints; they are expected to differ. Enable strong account authentication
   and retain recovery access. No Console changes are authorized now.

## Build wiring already present

`android/app/build.gradle` reads these process environment variables:

| Variable | Value held locally |
| --- | --- |
| `WINDOCK_UPLOAD_STORE_FILE` | Absolute path to the approved keystore |
| `WINDOCK_UPLOAD_STORE_PASSWORD` | Keystore password |
| `WINDOCK_UPLOAD_KEY_ALIAS` | Approved upload alias |
| `WINDOCK_UPLOAD_KEY_PASSWORD` | Key password |
| `WINDOCK_UPLOAD_CERT_SHA256` | Owner-approved public upload certificate fingerprint |

Populate them only in a short-lived trusted build process using local secure
prompts or a secret manager, not persistent user/machine environment settings.
Clear them in a `finally` block when the process ends. The child Gradle process
needs plaintext values in memory; environment variables are not a substitute
for an encrypted keystore or host access controls. Never print the environment,
enable secret-bearing diagnostic logs, or add credentials to gradle.properties.

`signedReleaseBundle -PwindockUploadSigning=true` requires explicit opt-in, all
four credential values, an existing keystore, a non-debug valid X.509 certificate
and a matching owner-approved SHA-256 fingerprint. These checks run before the
release build can use the key. The script also verifies the resulting AAB with
jarsigner and rejects Android Debug certificates before copying a candidate.

Ordinary Gradle builds do not load upload keys. `build-play-bundle.ps1 -Unsigned`
sets `-PwindockUnsigned=true`, ignores inherited signing credentials, and checks
that no signature files exist in the inspection AAB. Selecting both unsigned
and upload-signing modes is an error. No production signing build is authorized
in this preparation. `.gitignore` is a secondary safeguard, not proof that an
artifact or staged file is free of secrets.

## Candidate verification, once approved

- Confirm release code incorporates published security/features and the version
  code exceeds the public/Console maximum. Preserve package identity and minSdk.
- Check certificate identity against the approved public SHA-256 fingerprint,
  validity dates, key algorithm and recovery record. Reject any debug/test signer.
- Verify AAB signature with jarsigner and structure with bundletool. Confirm
  non-debuggable manifest, HTTPS-only release policy and expected permissions.
- Inspect the bundle and desktop package for private keys/passwords, and record
  hashes without recording secrets. Generate a new artifact after any source or
  policy change; existing artifacts are historical inspection evidence only.
- Keep test-only APK signing separate. A locally upload-key-signed APK is not
  equivalent to a Play-distributed APK signed by the app-signing key.
- Test Play-generated split APKs and Play-to-Play upgrades only after separate
  upload approval. Run the personal-account closed test and production-access
  process before a production release; an enabled Create App button is insufficient.

The current signing task's missing-credential rejection was tested previously.
Production key generation, signed release creation, backup recovery and Play
certificate verification remain unperformed and require the specified approvals.
