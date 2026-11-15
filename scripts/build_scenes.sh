#!/usr/bin/env bash
# Rebuilds generated resources and scenes by running every
# game/tools/scene_builders/build_*.gd in name order (see docs/scenes.md).
#   scripts/build_scenes.sh              all builders
#   scripts/build_scenes.sh main_scene   builders whose name contains "main_scene"
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILTER="${1:-}"
"$ROOT/scripts/import.sh" >/dev/null
for builder in "$ROOT"/game/tools/scene_builders/build_*.gd; do
  name="$(basename "$builder")"
  [[ -z "$FILTER" || "$name" == *"$FILTER"* ]] || continue
  echo "== $name"
  "$ROOT/scripts/godot.sh" --headless -s "res://tools/scene_builders/$name"
  "$ROOT/scripts/import.sh" >/dev/null
done
