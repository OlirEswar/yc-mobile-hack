#!/usr/bin/env bash
# Renders a scene to PNG under a virtual X display with the Compatibility
# renderer on Mesa's software GL, at a phone-like resolution.
#
#   scripts/render.sh [scene] [out.png] [WIDTHxHEIGHT] [frames]
#   scripts/render.sh res://scenes/main.tscn renders/main.png 2400x1080
#
# Defaults: res://scenes/main.tscn, renders/<scene>.png, 2400x1080 (Pixel 7
# landscape), 10 frames. NATIVE=1 also writes <out>.native.png at the base
# viewport resolution. ZOOM=0.5 sets the scene's Camera2D zoom before capture.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENE="${1:-res://scenes/main.tscn}"
[[ "$SCENE" == res://* ]] || SCENE="res://${SCENE#game/}"
NAME="$(basename "${SCENE%.*}")"
OUT="${2:-$ROOT/renders/$NAME.png}"
SIZE="${3:-2400x1080}"
FRAMES="${4:-10}"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

"$ROOT/scripts/import.sh" >/dev/null
run() {
  LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 ${SIZE}x24" \
    "$ROOT/scripts/godot.sh" --rendering-driver opengl3 --display-driver x11 \
    --resolution "$SIZE" --position 0,0 -s res://tools/render/render_scene.gd -- \
    --scene="$SCENE" --frames="$FRAMES" --zoom="${ZOOM:-0}" "$@"
}
run --out="$OUT"
if [[ "${NATIVE:-}" == 1 ]]; then run --out="${OUT%.png}.native.png" --native; fi
