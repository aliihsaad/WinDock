# WinDock website

A standalone static landing page. No framework, build dependency, tracking,
external fonts, or connection to the user's live dock. Bundled app icons are
extracted from Windows; those product marks belong to their owners. The desk
scene is an AI-generated product illustration, shared with the root README.

The visual direction uses an ivory canvas, blue and sage accents, large type,
a floating navigation bar, and numbered sections. The hero uses WinDock's own
SVG mark inside a clear glass tile. Pointer movement shifts the tile by at most
five pixels in each direction, without rotation; reduced-motion and touch devices keep it still. The
interactive phone preview retains the actual application's dark interface.

## Local review

From the repository root:

```powershell
npm run package:downloads
npm run website
```

Open http://127.0.0.1:4173. The server binds only to loopback, serves this
directory, and maps three allowlisted download files from ignored
`artifacts/website-downloads`. It never starts the Windows provider or launches
apps. On startup it generates the hero preview from the shipping `public/`
interface, so the drawer and full **Your space** settings stay in sync with the
app. Layout, labels, backgrounds, glass styles, pages, and arranging apps use
the real UI. A preview adapter supplies sample apps and keeps edits in memory;
reloading resets them. Launch and control actions show a preview-only message.
The Capture panel simulates screenshot feedback and the recording timer/Stop
flow in memory, with explicit demo labels. It never reads the screen, writes
media, or contacts the Windows host. **Try capture** opens it directly below
the phone. Run `npm run build:website-demo` after changing the shipping UI while
the local website server is already running, then reload the website.
The preview registers no service worker and its CSP blocks network connections.

`package:downloads` requires `artifacts/installer/WinDockSetup.exe` and the
Android APK. Build the Windows runtime with `npm run build:windows`, then run
`npm run build:installer` using Inno Setup 7. The installer bundles an allowlist
of runtime files, excludes configuration/debug symbols/logs, and adds a Start
menu entry, optional desktop shortcut/autostart, and a Windows uninstaller.
Neither personal dock settings nor pairing credentials are included. The
download command copies the EXE/APK and produces SHA-256 hashes.

The website reads `downloads.json`. The committed manifest points directly to
the tested Windows and Android assets in a public GitHub Release. The local
preview server substitutes its generated manifest to serve local builds.
The Windows button downloads one setup EXE. Users do not extract an archive.

## Vercel deployment

The root `vercel.json` builds the preview and publishes only `website/` as a
static site. `.vercelignore` excludes local toolchains, packaged applications,
native/Android sources, and personal configuration from CLI uploads. Use the
linked WinDock project and its default Vercel domain; no custom domain is needed.
The app host itself continues to run locally on Windows.

Production: [windock.vercel.app](https://windock.vercel.app). The Vercel project
is connected to this repository, so pushes to `main` deploy the website.

`.github/workflows/build-release.yml` builds and tests Windows/Android on GitHub.
Pushes to main produce build artifacts. Its manual **Create a draft GitHub
release** option also produces `WinDockSetup.exe`, the APK, checksums, and a
manifest with direct tagged release links. It never publishes a draft or changes
repository visibility. Publish tested installers as public GitHub Release
assets, then commit the generated direct-download manifest to `website/downloads.json`.

For a static host, run `npm run build:website-demo` and upload the HTML, CSS,
JavaScript, and assets in this directory, including the generated `demo/` folder.
That folder is ignored by Git because it is rebuilt from the app sources.
Replace `downloads.json` with the release manifest after publishing the assets
to an accessible release location. Verify the direct EXE, APK, and checksum URLs
before deploying the manifest. Binary downloads stay outside Git history.

The page describes the current artifacts as early previews: an unsigned Windows
x64 installer and debug-signed Android 7+. It does not claim Google Play
availability, signed production builds, or completed focus/hardware acceptance.
