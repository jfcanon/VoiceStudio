#!/usr/bin/env bash
# Seed Tauri's AppImage tool cache with VoiceStudio's launcher.
#
# Tauri copies target/.tauri/AppRun-<arch> into the AppDir after
# beforeBundleCommand returns.  Replacing an AppDir/AppRun here cannot work:
# the AppDir does not exist until the bundler runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APPRUN_SRC="$REPO_ROOT/frontend/src-tauri/appimage/AppRun"

# beforeBundleCommand also runs for macOS and Windows bundles.
case "${OSTYPE:-}" in
  linux*) ;;
  *) exit 0 ;;
esac

if [ ! -f "$APPRUN_SRC" ]; then
  echo "inject-apprun: source not found: $APPRUN_SRC" >&2
  exit 1
fi

ARCH="${OMNIVOICE_TARGET_ARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  armv7l|armhf) ARCH=armhf ;;
  *)
    echo "inject-apprun: unsupported Linux architecture: $ARCH" >&2
    exit 1
    ;;
esac

# AppRun → the bundler's AppRun tools dir. Under `tauri build --target
# <triple>` that is target/<triple>/.tauri (the bundler derives it from the
# cargo target dir); a plain `tauri build` uses target/.tauri. The release
# workflow sets OMNIVOICE_TAURI_TOOLS_DIR to the target-specific path.
APPRUN_DIR="${OMNIVOICE_TAURI_TOOLS_DIR:-$REPO_ROOT/frontend/src-tauri/target/.tauri}"
mkdir -p "$APPRUN_DIR"
install -m 755 "$APPRUN_SRC" "$APPRUN_DIR/AppRun-$ARCH"

# WebKitGTK version marker → the TOP-LEVEL target/.tauri dir, because
# tauri.conf.json's bundle.linux.appimage.files copies
# `target/.tauri/bundled-webkitgtk-version` (resolved relative to
# frontend/src-tauri) into usr/lib/.bundled-webkitgtk-version. That config
# path is target-agnostic, so the marker must land there regardless of the
# AppRun tools dir above.
MARKER_DIR="$REPO_ROOT/frontend/src-tauri/target/.tauri"
WK_VERSION="${OMNIVOICE_WEBKIT_VERSION:-$(pkg-config --modversion webkit2gtk-4.1 2>/dev/null \
  || pkg-config --modversion webkit2gtk-4.0 2>/dev/null || true)}"
if [ -z "$WK_VERSION" ]; then
  echo "inject-apprun: bundled WebKitGTK version is unavailable" >&2
  exit 1
fi
mkdir -p "$MARKER_DIR"
printf '%s\n' "$WK_VERSION" > "$MARKER_DIR/bundled-webkitgtk-version"

echo "inject-apprun: seeded AppRun-$ARCH -> $APPRUN_DIR (WebKitGTK $WK_VERSION)"
