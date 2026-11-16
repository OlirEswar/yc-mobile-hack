#!/usr/bin/env bash
# Builds the Android debug APK. Runs on Revyl's Android runner through
# tools.mobile.build (Ubuntu arm64, JDK 17, Android SDK in $ANDROID_HOME);
# see docs/mobile-build.md. Output: build/android/civ-sim-debug.apk
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

tools/install_godot.sh --templates android
GODOT="${GODOT_BIN_DIR:-$HOME/.local/bin}/godot"

# A committed debug keystore with the standard public debug credentials (not a
# secret), so every debug build has the same signature and installs over the last.
KEYSTORE="$PWD/tools/mobile/debug.keystore"
mkdir -p build/android
export GODOT_ANDROID_KEYSTORE_DEBUG_PATH="$KEYSTORE"
export GODOT_ANDROID_KEYSTORE_DEBUG_USER=androiddebugkey
export GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD=android

"$GODOT" --headless --import
"$GODOT" --headless --export-debug Android build/android/civ-sim-debug.apk
ls -la build/android/civ-sim-debug.apk
