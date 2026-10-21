#!/bin/sh
# Copy the built WinDock.app into ~/Applications, where a login item can find it.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOURCE="$ROOT/artifacts/WinDock.app"
TARGET="$HOME/Applications/WinDock.app"
[ -d "$SOURCE" ] || { echo "Build it first: npm run build:macos-app" >&2; exit 1; }
mkdir -p "$HOME/Applications"
rm -rf "$TARGET"
cp -R "$SOURCE" "$TARGET"
echo "installed $TARGET"
echo "Open it from Finder or with: open \"$TARGET\""
