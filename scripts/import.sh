#!/usr/bin/env bash
# Imports game/ assets headlessly (creates game/.godot). Every other script runs this first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/godot.sh" --headless --import 2>&1 | grep -vE '^\s*$' | tail -n 20
