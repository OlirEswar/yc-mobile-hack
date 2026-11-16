#!/usr/bin/env bash
# Runs the pinned Godot against game/, installing it first if needed.
#   scripts/godot.sh --headless --import
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WANT="$(tr -d '[:space:]' < "$ROOT/game/GODOT_VERSION")"
GODOT="${GODOT:-$(command -v godot || true)}"
if [[ -z "$GODOT" ]] || [[ "$("$GODOT" --version 2>/dev/null)" != "${WANT/-/.}"* ]]; then
  "$ROOT/game/tools/install_godot.sh" >&2
  GODOT="${GODOT_BIN_DIR:-$HOME/.local/bin}/godot"
fi
exec "$GODOT" --path "$ROOT/game" "$@"
