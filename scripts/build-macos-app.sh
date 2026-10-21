#!/bin/sh
# Build WinDock.app (the macOS menu bar companion) into artifacts/.
# The bundle records where this repository lives, so the app can start server.js.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/package.json').version")
APP="$ROOT/artifacts/WinDock.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/WinDock" "$ROOT"/native/macos-app/*.swift
sed "s/__VERSION__/$VERSION/g" "$ROOT/native/macos-app/Info.plist" > "$APP/Contents/Info.plist"
ICONSET=$(mktemp -d)/WinDock.iconset
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ROOT/public/icon-512.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ROOT/public/icon-512.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/WinDock.icns"
rm -rf "$(dirname "$ICONSET")"
printf '%s' "$ROOT" > "$APP/Contents/Resources/host-root"
# Ad hoc signature: unsigned bundles lose their permission grants when rebuilt.
codesign --force --sign - "$APP"
echo "built $APP"
