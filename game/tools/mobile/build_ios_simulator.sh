#!/usr/bin/env bash
# Builds an iOS Simulator .app (arm64). Runs on Revyl's macOS runner through
# tools.mobile.build (Xcode 27, Apple silicon); see docs/mobile-build.md.
# Output: build/ios/CivSim.app
#
# 1. Godot exports the Xcode project only (export_project_only in the iOS preset).
# 2. Godot's official ios.zip ships the simulator slice of libgodot.a with
#    x86_64 objects only (checked for 4.7.2), and the cloud simulators need
#    arm64, so this compiles the arm64 simulator template from the pinned
#    Godot source (GLES3 only, about 10-15 minutes) and swaps it in.
# 3. xcodebuild compiles the project for the simulator without code signing.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
GAME="$PWD"
VERSION="$(tr -d '[:space:]' < GODOT_VERSION)"

tools/install_godot.sh --templates ios
GODOT="${GODOT_BIN_DIR:-$HOME/.local/bin}/godot"

rm -rf build/ios && mkdir -p build/ios
"$GODOT" --headless --import
"$GODOT" --headless --export-debug iOS build/ios/CivSim.ipa

SRC="${GODOT_SRC_DIR:-$HOME/godot-src}"
LIB="$SRC/godot-$VERSION/bin/libgodot.ios.template_debug.arm64.simulator.a"
if [[ ! -f "$LIB" ]]; then
  mkdir -p "$SRC"
  curl -fsSL --retry 3 "https://github.com/godotengine/godot/releases/download/$VERSION/godot-$VERSION.tar.xz" | tar -xJ -C "$SRC"
  python3 -m venv "$SRC/venv"
  "$SRC/venv/bin/pip" install -q scons
  (cd "$SRC/godot-$VERSION" && "$SRC/venv/bin/scons" platform=ios target=template_debug arch=arm64 simulator=yes \
    vulkan=no metal=no -j"$(sysctl -n hw.ncpu)")
fi
find build/ios -path '*simulator*' -name 'libgodot.a' -print | while read -r slice; do
  echo "replacing $slice with the arm64 simulator template"
  cp "$LIB" "$slice"
done

cd "$GAME"
set -o pipefail
xcodebuild -project build/ios/CivSim.xcodeproj -scheme CivSim -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios/DerivedData ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" \
  build | grep -vE '^ld: warning|ignoring file' | tail -n 40
cp -R build/ios/DerivedData/Build/Products/Debug-iphonesimulator/CivSim.app build/ios/CivSim.app
lipo -info build/ios/CivSim.app/CivSim
