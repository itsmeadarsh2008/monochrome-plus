#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"
DESKTOP_DIST="$ROOT_DIR/desktop-dist"
ARTIFACT_DIR="$ROOT_DIR/release-artifacts"

mkdir -p "$ARTIFACT_DIR"

APP_DIR="$(find "$DESKTOP_DIST" -type f -name 'resources.neu' -print | head -n1 | xargs -r dirname)"
if [[ -z "${APP_DIR}" ]]; then
    echo "Unable to locate Neutralino app directory containing resources.neu under $DESKTOP_DIST"
    exit 1
fi

APP_EXE="$(find "$APP_DIR" -maxdepth 1 -type f -perm -u+x ! -name '*.neu' ! -name '*.dylib' | head -n1 || true)"
if [[ -z "${APP_EXE}" ]]; then
    APP_EXE="$(find "$APP_DIR" -maxdepth 1 -type f | grep -E 'monochrome|neutralino' | head -n1 || true)"
fi

if [[ -z "${APP_EXE}" ]]; then
    echo "Unable to locate macOS executable in $APP_DIR"
    exit 1
fi

APP_VERSION="${GITHUB_REF_NAME:-}"
APP_VERSION="${APP_VERSION#v}"
if [[ -z "$APP_VERSION" ]]; then
    APP_VERSION="$(node -p "require('./package.json').version")"
fi

APP_BUNDLE="$ARTIFACT_DIR/Monochrome+.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

cp -a "$APP_DIR"/. "$APP_BUNDLE/Contents/MacOS"/
chmod +x "$APP_BUNDLE/Contents/MacOS/$(basename "$APP_EXE")" || true
cp "$ROOT_DIR/buildAssets/appIcon.png" "$APP_BUNDLE/Contents/Resources/appIcon.png" || true

cat >"$APP_BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Monochrome+</string>
    <key>CFBundleDisplayName</key>
    <string>Monochrome+</string>
    <key>CFBundleIdentifier</key>
    <string>network.appwrite.monochromeplus</string>
    <key>CFBundleVersion</key>
    <string>${APP_VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${APP_VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>$(basename "$APP_EXE")</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15.0</string>
</dict>
</plist>
EOF

DMG_PATH="$ARTIFACT_DIR/MonochromePlus-${APP_VERSION}-macOS.dmg"
ZIP_PATH="$ARTIFACT_DIR/MonochromePlus-${APP_VERSION}-macOS.zip"

hdiutil create -volname "Monochrome+" -srcfolder "$APP_BUNDLE" -ov -format UDZO "$DMG_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_PATH"

echo "macOS installers generated in $ARTIFACT_DIR"
ls -lah "$ARTIFACT_DIR"
