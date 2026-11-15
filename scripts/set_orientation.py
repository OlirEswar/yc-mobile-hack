#!/usr/bin/env python3
"""Flips the game between landscape and portrait.

  scripts/set_orientation.py landscape   640x360, sensor landscape (default)
  scripts/set_orientation.py portrait    360x640, sensor portrait

Edits game/project.godot in place: the base viewport size and the handheld
orientation. Rebuild scenes afterwards if any builder depends on the size.
"""
import re
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1] / "game" / "project.godot"
MODES = {
    "landscape": {"window/size/viewport_width": "640", "window/size/viewport_height": "360",
                  "window/size/window_width_override": "1280", "window/size/window_height_override": "720",
                  "window/handheld/orientation": "4"},
    "portrait": {"window/size/viewport_width": "360", "window/size/viewport_height": "640",
                 "window/size/window_width_override": "720", "window/size/window_height_override": "1280",
                 "window/handheld/orientation": "5"},
}

if len(sys.argv) != 2 or sys.argv[1] not in MODES:
    sys.exit(__doc__)
text = PROJECT.read_text()
for key, value in MODES[sys.argv[1]].items():
    text, n = re.subn(rf"^{re.escape(key)}=.*$", f"{key}={value}", text, flags=re.M)
    if n != 1:
        sys.exit(f"{key} not found in {PROJECT}")
PROJECT.write_text(text)
print(f"{PROJECT.name}: {sys.argv[1]}")
