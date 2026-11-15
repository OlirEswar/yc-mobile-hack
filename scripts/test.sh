#!/usr/bin/env bash
# Runs the GUT suite in game/tests headlessly. Extra args go to GUT, e.g. -gselect=test_main_scene.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/import.sh" >/dev/null
"$ROOT/scripts/godot.sh" --headless -s res://addons/gut/gut_cmdln.gd -gconfig=res://.gutconfig.json "$@"
