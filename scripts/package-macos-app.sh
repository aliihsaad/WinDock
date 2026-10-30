#!/bin/sh
# Package WinDock.app with its own host and Node runtime, then wrap it in a DMG.
# The result runs on a Mac without Node or this repository. It is signed ad hoc,
# not notarized: see README, "macOS preview", for the release signing steps.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/package.json').version")
NODE=${WINDOCK_PACKAGE_NODE:-$(node -p "process.execPath")}
[ -x "$NODE" ] || { echo "Node runtime not found at $NODE" >&2; exit 1; }
[ -x "$ROOT/windock-input" ] || { echo "Build the input helper first: npm run build:macos" >&2; exit 1; }
# The bundled runtime must stand on its own: a Node that links libraries from
# Homebrew or another prefix would fail on a Mac without them.
FOREIGN=$(otool -L "$NODE" | tail -n +2 | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/Library/)' || true)
if [ -n "$FOREIGN" ]; then
  echo "This Node links libraries outside the system: $FOREIGN" >&2
  echo "Package with a self-contained Node (the nodejs.org installer or an nvm build): WINDOCK_PACKAGE_NODE=/path/to/node npm run package:macos" >&2
  exit 1
fi
sh "$ROOT/scripts/build-macos-app.sh"
APP="$ROOT/artifacts/WinDock.app"
HOST="$APP/Contents/Resources/host"
rm -rf "$HOST"
mkdir -p "$HOST/node_modules"
cp "$ROOT/server.js" "$ROOT/package.json" "$HOST/"
cp -R "$ROOT/public" "$ROOT/src" "$HOST/"
cp -R "$ROOT/node_modules/ws" "$HOST/node_modules/"
cp "$ROOT/windock-input" "$HOST/windock-input"
cp "$NODE" "$HOST/node"
rm -f "$APP/Contents/Resources/host-root" # the bundled host wins over the repository
codesign --force --deep --sign - "$APP"
STAGE=$(mktemp -d)/WinDock
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$ROOT/artifacts/WinDock-macos-$VERSION.dmg"
rm -f "$DMG"
hdiutil create -quiet -volname "WinDock $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$(dirname "$STAGE")"
(cd "$ROOT/artifacts" && shasum -a 256 "$(basename "$DMG")" > "SHA256SUMS-macos.txt")
echo "packaged $DMG"
