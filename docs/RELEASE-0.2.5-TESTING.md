# Combined 0.2.5 candidate testing

Candidate: **0.2.5-preview.2**, Android code **7**, Linux **0.2.5-2**.
The earlier preview.1 installers do not include update checks, Tailscale or clipboard.
Install both the host and Android candidate. Preserve app data and existing pairing
settings. Re-pair with each PC's six-digit PIN if its host restarted.

## Acceptance checklist

1. **Upgrade:** install over public 0.2.4 or the previous candidate. Confirm dock
   layout, saved PCs, appearance and phone display settings remain intact.
2. **Discovery:** leave Windows and Omarchy running. Open Switch PC, switch both
   ways, Forget one PC, restart Android and confirm it is not auto-selected.
   Refresh and explicitly select it again. Check an offline saved PC and manual recovery.
3. **Updates:** open Updates from the drawer and Appearance; check both PC and
   Android versions. Also test Android's connection-screen entry and Windows'
   connection window. With internet, the unpublished candidate should report current
   against the older public feed. Without internet, expect a clear failed check and
   successful retry. Do not expect this draft to appear as an available public update.
4. **Clipboard on Windows:** enable history using Windows + V. Copy ordinary text,
   multiline text and emoji. In Touch & sign, expand PC clipboard, select/edit text,
   focus a PC text field, and tap Paste to PC. Browsing alone must not type anything.
   Confirm the editor and Paste button remain above the Android keyboard. Collapse
   and reopen; then switch PCs and confirm only the new PC's history is shown.
5. **Clipboard on Omarchy:** repeat with Elephant running. It needs the JSON query
   interface; an unsupported/unavailable manager should show guidance, not break the
   touchpad. Paste changes the PC's current clipboard and sends Ctrl+V. A terminal
   or application that uses a different paste shortcut may not accept it.
6. **Tailscale:** with both devices connected to your own tailnet, enter the PC's
   numeric 100.x address manually, pair and use the dock. Restart/reconnect. Check
   switching between the remembered VPN endpoint and a LAN PC. Discovery is LAN-only.
7. **Regression:** app icons/layout, launch/focus, media, volume, touchpad, phone
   keyboard, signatures, captures, performance mode and Wi-Fi/USB reconnect.

Report the platform, installed version, steps, expected/actual behavior and any
visible error. Do not include private clipboard text or pairing PINs.

## Publication boundary

Keep the release draft and website downloads on the current public version until
physical checks pass. Build artifacts must all identify the same release branch
commit. Verify Android certificate continuity and the staged SHA-256 manifests.
Do not substitute the CI-generated debug APK: a fresh runner has a different key.
