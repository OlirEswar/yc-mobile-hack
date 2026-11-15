#!/usr/bin/env python3
"""App icon: a tiny island built from the terrain atlas, upscaled 16x with
nearest neighbor to 1024x1024 (game/icon.png). Run after gen_terrain.py."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pixel_cleanup  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TILES = REPO / "game" / "assets" / "tiles"
OUT = REPO / "game" / "icon.png"
LAYOUT = [
    ["shore_00", "shore_04", "shore_04", "shore_00"],
    ["shore_02", "mountain_0", "forest_0", "shore_08"],
    ["shore_02", "forest_1", "beach_01", "shore_08"],
    ["shore_00", "shore_01", "shore_01", "shore_00"],
]


def main() -> int:
    manifest = json.loads((TILES / "terrain.json").read_text())
    atlas = Image.open(TILES / "terrain.png").convert("RGBA")
    size = manifest["tile_size"]
    where = {t["name"]: t["atlas"] for t in manifest["tiles"]}
    icon = Image.new("RGBA", (size * 4, size * 4))
    for row, names in enumerate(LAYOUT):
        for col, name in enumerate(names):
            x, y = where[name]
            icon.paste(atlas.crop((x * size, y * size, (x + 1) * size, (y + 1) * size)), (col * size, row * size))
    icon = pixel_cleanup.snap(icon, pixel_cleanup.load_palette(), (1024, 1024))
    icon.save(OUT)
    print(OUT.relative_to(REPO))
    return 0


if __name__ == "__main__":
    sys.exit(main())
