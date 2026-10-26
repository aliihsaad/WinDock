# WinDock website

A static product website with a small public download-count endpoint. No framework,
external fonts, or connection to a visitor's PC. The published site is
https://windock.vercel.app; pushes to `main` deploy through the existing Vercel integration.

## Structure and design

- `index.html`: the product introduction, interactive demo, current release highlights,
  downloads, and a short setup overview.
- `setup.html`: platform installation guides and the complete FAQ.
- `releases.html`: the latest release stays visible; all earlier releases collapse,
  including their full notes and contributor attribution.
- `style.css`: the shared ivory/charcoal, blue and sage identity, glass surfaces,
  typography, responsive layouts and accessible focus states.
- `symbols.js`, `theme.js`, `navigation.js`: shared page controls. Desktop navigation
  expands from the compact WinDock icon on hover or keyboard focus, then collapses
  when leaving. Mobile uses a native modal with scroll locking and focus return.
- `demo.js`: parent-side demo controls and the readable PC picker overlay.
- `downloads.js`: validates the existing release manifest and displays public counts.
- `community.js`: loads Giscus only after the community disclosure is opened and
  synchronizes the embed with the website's light/dark appearance.

`/#history` and `/#candidate-release` bookmarks redirect to the release page.

## Community feedback

The homepage has one collapsed-by-default Giscus section. No Giscus script or iframe
is requested until it opens. Closing/reopening retains the iframe and any draft.
The website's light/dark switch updates Giscus without reloading it. A failed load
offers a retry and the public GitHub link; JavaScript-disabled visitors can use
that link directly. This feature does not change analytics consent.

Giscus is free and open source. Comments, replies and reactions are stored publicly
in GitHub Discussions; contributing requires GitHub sign-in. We do not maintain a
review database, invent a rating score, or collect a separate WinDock login.

Repository setup is `aliihsaad/WinDock` (`R_kgDOUfO7Ig`), Announcements category
(`DIC_kwDOUfO7Is4DJr27`). Discussions must be enabled and the official Giscus GitHub
App installed for this repository. Both were verified during implementation.
The `number` mapping points to the existing [discussion #39](https://github.com/aliihsaad/WinDock/discussions/39),
`WinDock community feedback`, which already contains the maintainer's welcome comment.
Localhost, preview deployments and production share this conversation. Its backlink
is always the production community section, and the fallback link opens the same
discussion even when Giscus cannot load.

`giscus.json` at the repository root restricts allowed origins to production, the
local preview and this project's Vercel previews, and shows newest comments first.
Giscus reads this configuration from the default branch, so these restrictions
take effect when the PR is merged. The repository/category IDs are public metadata,
not credentials. The embed uses Giscus's borderless light/transparent dark themes
inside the site's glass panel, with source/origin checks on incoming messages.
The iframe supports both CSS color schemes so its transparent background remains
transparent even when the system appearance and saved website theme differ.

Reference: https://giscus.app/ and https://github.com/giscus/giscus/blob/main/ADVANCED-USAGE.md.
The theme follows the device until the visitor chooses one; that choice is saved
in `windock-website-theme`. `theme.js` applies it before styles load.

## Local review

```powershell
npm run website
```

Open http://127.0.0.1:4173. The server binds only to loopback and defaults to the
tracked `website/downloads.json`, so the preview uses the published installers.
Use `node scripts/website-server.mjs --local-downloads` only when deliberately
reviewing the ignored `artifacts/website-downloads` manifest and packaged files.
The server never starts the PC host or launches applications.

The startup build copies the shipping `public/` interface into ignored
`website/demo/`. Run `npm run build:website-demo` after changing that source while
the preview server is running. Do not edit generated demo files directly.

## Demo isolation and PC switching

`preview-transport.js` replaces fetch, WebSocket and storage with in-memory
implementations. The iframe's CSP blocks outgoing connections and its service
worker is disabled. Real app layout, arranging, backgrounds, drawer and input
controls are reused. Capture, typing, signatures, clipboard and updates are
explicit simulations; they do not read devices or create files.

Android's Switch PC picker is native, so copying the dock alone does not include
it. `build-website-demo.mjs` supplies a narrowly scoped `showPcPicker` bridge.
The parent renders that picker outside the scaled dock, keeping it readable on
phones. `preview-pcs.js` provides fictional Windows/Linux hosts and documentation
addresses; they are never probed. Switching updates the demo's actual host and
app tiles. Each sample host retains its own tiles for the current page visit.

Forget removes a saved choice without disconnecting the current PC. A running
forgotten PC remains available for explicit selection; Refresh does not save it
again. Saved offline PCs can be forgotten and do not reappear on Refresh. Reload
resets all sample state. Both sides check the message source and origin.

Run browser verification through Playwright CLI with the local server running:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=website-check open http://127.0.0.1:4173
npx --yes --package @playwright/cli playwright-cli -s=website-check run-code --filename scripts/website-release-browser-check.js
npx --yes --package @playwright/cli playwright-cli -s=website-check run-code --filename scripts/website-community-browser-check.js
npx --yes --package @playwright/cli playwright-cli -s=website-check close
```

Checks cover picker actions, existing clipboard/update simulations, download
links, narrow layouts, navigation, theme/consent continuity and network isolation.
Community checks additionally cover deferred loading, real Giscus rendering and
theme changes, trusted messages, retry recovery, OAuth return handling and the
JavaScript-disabled fallback. Rendered-pixel checks cover all four system/website
appearance combinations. They never sign in, post comments or add reactions.
Screenshots go to ignored `output/playwright/`.

## Optional analytics

`analytics.js` asks before loading Vercel Web Analytics. **Allow analytics** and
**No thanks** have equal prominence; neither is preselected. The choice is saved
in `windock-website-analytics-v1`. **Analytics preferences** in every footer lets
visitors change it. Storage failures keep the choice in memory for the page only.

Only `windock.vercel.app` loads the analytics script; local and preview deployments
show the controls without collecting visits. The `beforeSend` hook checks consent
for every event, stops future events after withdrawal (including another tab),
and strips query strings and fragments. Analytics does not instrument the dock,
PC picker, Windows app or Android app.

## Downloads and publication

`downloads.json` is the verified public release manifest. Installer URLs, sizes
and SHA-256 hashes must match published GitHub release assets before changing it.
This design refresh does not change that feed or any installer.

`/api/download-stats` serves cached public GitHub asset counts. These are download
counts, not users or visits, and include repeats across releases. Loading and
unavailable values remain dashes. The compact summary honors reduced motion.

The bundled app icons are product marks belonging to their owners. The existing
AI-generated desk illustration is retained as a repository asset but is no longer
loaded by the homepage.
