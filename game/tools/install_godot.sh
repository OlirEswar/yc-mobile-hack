#!/usr/bin/env bash
# Installs the Godot version pinned in game/GODOT_VERSION and links it as `godot`.
# Works on Linux (x86_64, arm64) and macOS. Used by the Capy Setup, CI, and the
# Revyl mobile build scripts, so the pin lives in exactly one file.
#
#   install_godot.sh                      editor binary only
#   install_godot.sh --templates android  also export templates (android, ios, linux, all)
#
# Env: GODOT_CACHE (download cache), GODOT_BIN_DIR (where `godot` is linked).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(tr -d '[:space:]' < "$HERE/../GODOT_VERSION")"
TEMPLATE_DIR_NAME="${VERSION/-/.}"
BASE_URL="https://github.com/godotengine/godot/releases/download/$VERSION"
CACHE="${GODOT_CACHE:-$HOME/.cache/godot-dl/$VERSION}"
BIN_DIR="${GODOT_BIN_DIR:-$HOME/.local/bin}"

TEMPLATES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --templates) TEMPLATES="${2:?--templates needs android|ios|linux|all}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) EDITOR_ZIP="Godot_v${VERSION}_linux.x86_64.zip"; EDITOR_BIN="Godot_v${VERSION}_linux.x86_64"
    TEMPLATE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/godot/export_templates" ;;
  Linux-aarch64|Linux-arm64) EDITOR_ZIP="Godot_v${VERSION}_linux.arm64.zip"; EDITOR_BIN="Godot_v${VERSION}_linux.arm64"
    TEMPLATE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/godot/export_templates" ;;
  Darwin-*) EDITOR_ZIP="Godot_v${VERSION}_macos.universal.zip"; EDITOR_BIN="Godot.app/Contents/MacOS/Godot"
    TEMPLATE_ROOT="$HOME/Library/Application Support/Godot/export_templates" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

sha512() { if command -v sha512sum >/dev/null; then sha512sum "$1"; else shasum -a 512 "$1"; fi | awk '{print $1}'; }

fetch() {
  local name="$1"
  mkdir -p "$CACHE"
  [[ -s "$CACHE/SHA512-SUMS.txt" ]] || curl -fsSL --retry 3 -o "$CACHE/SHA512-SUMS.txt" "$BASE_URL/SHA512-SUMS.txt"
  local want; want="$(awk -v f="$name" '$2==f {print $1}' "$CACHE/SHA512-SUMS.txt")"
  [[ -n "$want" ]] || { echo "$name not listed in SHA512-SUMS.txt" >&2; exit 1; }
  if [[ ! -s "$CACHE/$name" ]] || [[ "$(sha512 "$CACHE/$name")" != "$want" ]]; then
    echo "downloading $name" >&2
    curl -fSL --retry 3 -o "$CACHE/$name.part" "$BASE_URL/$name"
    mv "$CACHE/$name.part" "$CACHE/$name"
    [[ "$(sha512 "$CACHE/$name")" == "$want" ]] || { echo "checksum mismatch for $name" >&2; exit 1; }
  fi
}

INSTALL_DIR="$CACHE/editor"
if [[ ! -x "$INSTALL_DIR/$EDITOR_BIN" ]]; then
  fetch "$EDITOR_ZIP"
  rm -rf "$INSTALL_DIR" && mkdir -p "$INSTALL_DIR"
  unzip -q "$CACHE/$EDITOR_ZIP" -d "$INSTALL_DIR"
fi
mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/$EDITOR_BIN" "$BIN_DIR/godot"

if [[ -n "$TEMPLATES" ]]; then
  case "$TEMPLATES" in
    android) PATTERNS=("templates/android_*" "templates/version.txt") ;;
    ios) PATTERNS=("templates/ios.zip" "templates/version.txt") ;;
    linux) PATTERNS=("templates/linux_*" "templates/version.txt") ;;
    mobile) PATTERNS=("templates/android_*" "templates/ios.zip" "templates/version.txt") ;;
    all) PATTERNS=("templates/*") ;;
    *) echo "unknown template set: $TEMPLATES" >&2; exit 2 ;;
  esac
  DEST="$TEMPLATE_ROOT/$TEMPLATE_DIR_NAME"
  STAMP="$DEST/.installed-$TEMPLATES"
  if [[ ! -f "$STAMP" ]]; then
    fetch "Godot_v${VERSION}_export_templates.tpz"
    TMP="$(mktemp -d)"
    unzip -q -o "$CACHE/Godot_v${VERSION}_export_templates.tpz" "${PATTERNS[@]}" -d "$TMP"
    mkdir -p "$DEST"
    cp -R "$TMP/templates/." "$DEST/"
    rm -rf "$TMP"
    touch "$STAMP"
    [[ -n "${GODOT_KEEP_DOWNLOADS:-}" ]] || rm -f "$CACHE/Godot_v${VERSION}_export_templates.tpz"
  fi
  echo "templates ($TEMPLATES) in $DEST" >&2
fi

"$BIN_DIR/godot" --version
