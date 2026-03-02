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

APP_EXE="$(find "$APP_DIR" -maxdepth 1 -type f -perm -u+x ! -name '*.neu' ! -name '*.dll' ! -name '*.so' | head -n1 || true)"
if [[ -z "${APP_EXE}" ]]; then
    APP_EXE="$(find "$APP_DIR" -maxdepth 1 -type f | grep -E 'monochrome|neutralino' | head -n1 || true)"
fi

if [[ -z "${APP_EXE}" ]]; then
    echo "Unable to locate Linux executable in $APP_DIR"
    exit 1
fi

APP_VERSION="${GITHUB_REF_NAME:-}"
APP_VERSION="${APP_VERSION#v}"
if [[ -z "$APP_VERSION" ]]; then
    APP_VERSION="$(node -p "require('./package.json').version")"
fi

if ! command -v fpm >/dev/null 2>&1; then
    echo "fpm is required but not installed"
    exit 1
fi

STAGE_DIR="$(mktemp -d)"
INSTALL_DIR="$STAGE_DIR/usr/share/monochrome-plus"
mkdir -p "$INSTALL_DIR" "$STAGE_DIR/usr/bin"

cp -a "$APP_DIR"/. "$INSTALL_DIR"/
chmod +x "$INSTALL_DIR/$(basename "$APP_EXE")" || true

cat >"$STAGE_DIR/usr/bin/monochrome-plus" <<EOF
#!/usr/bin/env bash
exec /usr/share/monochrome-plus/$(basename "$APP_EXE") "\$@"
EOF
chmod +x "$STAGE_DIR/usr/bin/monochrome-plus"

COMMON_ARGS=(
    -s dir
    -n monochrome-plus
    -v "$APP_VERSION"
    --vendor "Monochrome+ Team"
    --maintainer "Monochrome+ Team"
    --description "Hyper-fast, privacy-respecting, high-fidelity desktop music experience."
    --url "https://github.com/monochrome-music/monochrome"
    --license "ISC"
    --prefix /
    -C "$STAGE_DIR"
)

fpm -t deb "${COMMON_ARGS[@]}" -p "$ARTIFACT_DIR/monochrome-plus-${APP_VERSION}-linux-amd64.deb" usr
fpm -t rpm "${COMMON_ARGS[@]}" -p "$ARTIFACT_DIR/monochrome-plus-${APP_VERSION}-linux-x86_64.rpm" usr

tar -C "$APP_DIR" -czf "$ARTIFACT_DIR/monochrome-plus-${APP_VERSION}-linux-portable.tar.gz" .

echo "Linux installers generated in $ARTIFACT_DIR"
ls -lah "$ARTIFACT_DIR"
