# WinDock — local Play listing preparation

Not submitted. Store identity: AliDevLab. Price: free. No ads or purchases.

Review hold: preparation is integrated on the v0.2.6 baseline; see
PLAY_INTEGRATION.md for validation and remaining gates. Screenshots were refreshed
from this build and remain local review drafts. AliDevLab's personal account exists; no app listing has been
created. All Console uploads/actions and production deployments remain on hold.

**Name:** WinDock

**Short description:** Control your Windows PC with a phone dock, touchpad and keyboard.

**Full description draft:**

Turn your Android phone into a companion for your Windows PC. Keep your favorite
apps within reach, control playback and volume, and use your phone as a touchpad
and keyboard. Draw a signature and save or insert it into a compatible PC app.
Choose between saved PCs, keep appearance settings for each PC, and view or edit
recent PC clipboard text before explicitly pasting it into a PC field.
Take PC screenshots or start and stop silent PC screen recordings. Captures and
signatures stay in your PC's WinDock folders.
Send selected photos, videos and documents securely to your paired PC. Choose
files inside WinDock or use another Android app's Share menu. Review the selection,
keep WinDock open, and follow progress. Received files go to Downloads/WinDock
unless you change the folder on the computer. Cancel from either device.

WinDock is free, with no ads, subscriptions or account registration. It requires
the WinDock Windows companion and a local network connection. The Play version
requires the updated companion's secure connection. Choose Pair a phone securely
on the computer and scan its code in WinDock. Camera permission is optional;
pairing text is also supported. USB connectivity
uses Android USB tethering and a data-capable cable. Availability depends on your
phone, carrier and Windows network configuration. It does not require USB debugging.

Customize the dock, choose a performance mode for older phones, and adjust this
phone's idle dimming and screen-rest settings. PC hardware and applications may
limit some controls. WinDock is for your own PC, not internet remote access.

**Support website:** https://github.com/aliihsaad/WinDock

**Support email:** [alidevlab10@gmail.com](mailto:alidevlab10@gmail.com).

**Privacy page:** `website/privacy.html`, prepared for the existing WinDock site.
Do not publish it yet. Finalize the actual release data flows, then obtain
deployment approval and verify the real public URL before entering it in Console.

## Data Safety worksheet — not final form answers

Review the exact signed build and supported desktop versions. No developer
analytics/ad/crash SDK or cloud storage was found. This does not automatically
mean no data collection: text, signatures and pairing information leave the phone
for the selected PC. Assess optional user content, image/signature data, session
identifiers, host/app/media metadata and user-initiated transfers against Google's
current taxonomy. Signature files are persistent, not ephemeral. Capture pixels
stay on the PC, while capture status/file metadata reaches the phone. Phone-only
preferences remain local. HTTPS release traffic is encrypted, but supported legacy
clients still use cleartext; accurately scope any encryption declaration. Retention,
deletion and third-party keyboard/receiving-app behavior are described in the policy.
No app account exists, so do not claim an account-deletion feature is implemented.
The integrated branch retains on-demand PC clipboard history, local editing and
explicit paste, plus persistent public host identity and per-PC preferences.
Play Android updates open Google Play; previews retain manual website checks.
Classify these final flows and distinguish local control from desktop internet
update checks, website operations and optional support correspondence before
submitting the Data Safety form.
Files & Media also transfers selected Photos, Videos, Files/docs and optionally
Audio files directly to the paired computer. Providers may retrieve cloud files.
Bounded 24-hour receive receipts and saved PC files are persistent, not ephemeral;
see FILES_AND_MEDIA.md and the revised policy for retention and deletion. Assess
user-initiated-transfer exceptions against the actual Console definitions. The
dedicated voice recognizer and microphone permission have been removed; keyboard
voice typing is provided by the user's keyboard application.

## Reviewer instructions draft

Install the provided updated Windows companion on a Windows test PC. Put both
devices on the same reachable network (or use USB tethering). Choose Pair a phone
securely in the Windows tray, show a code, and select Scan computer code in the
Android app. No system CA installation is required. Confirm expired-code
rejection and successful pairing. Launch/focus a harmless test app, try the touchpad
and keyboard, save a test signature, and capture a non-sensitive desktop. Stop
recording from Android or the PC tray. The connection screen's privacy policy
works without the PC. Provide a working companion download and review support
contact before submission. Do not expose a personal PC or disable authentication.
For Files & Media, use a non-sensitive sample photo and document. Test the system
picker and Gallery/Files → Share → WinDock, including multiple files. Explicitly
send and verify progress, completion, duplicate-name handling and cancellation.
The computer's Files & Media controls can disable receiving or change destination.
Keep the Android app open; this release intentionally does not transfer in the background.

## Prepared assets and remaining screenshots

`docs/play-assets/` contains a 512x512 store icon, 1024x500 feature graphic and
three real 1920x1080 release-emulator screenshots. The graphics use the existing
WinDock vector mark; regenerate them with `scripts/build-play-assets.ps1`.
The screenshots show the HTTPS smoke fixture with fake apps and no personal data.
They are local review drafts, not submitted assets. The dock intentionally shows
fallback icons because the fixture does not extract real installed applications.

Screenshot alt text:
- `release-dock.png`: "WinDock app dock with five app tiles and a running-app indicator."
- `release-touchpad.png`: "Touchpad with mouse buttons, keyboard access, signature shortcut and pointer speed controls."
- `release-signature.png`: "Blank signature canvas with ink selection, save to PC and insert into PC controls."

Add connection/setup, keyboard and display-settings screenshots after physical
device acceptance, plus tested tablet layouts. Prefer four or more screenshots
for store promotion. Do not expose PINs or sensitive PC/app/document names.
Existing website renders are not app screenshots. Requirements were checked
against [Google's preview asset guidance](https://support.google.com/googleplay/android-developer/answer/9866151).
Confirm category (likely Tools), content rating and target audience with the owner.
