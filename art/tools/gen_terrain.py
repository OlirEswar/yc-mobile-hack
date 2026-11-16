#!/usr/bin/env python3
"""Procedural 16x16 terrain tiles for the sample map.

Draws grass, sand, water, forest, and mountain tiles (four variants each) plus
edge variants keyed by a 4-bit neighbor mask (N=1, E=2, S=4, W=8):
  shore  water tiles with foam on the sides that touch land
  beach  sand tiles with a grass lip on the sides that touch grass, forest, or mountain

Every tile goes through pixel_cleanup.snap, then pixel_cleanup.pack builds the
sheet. Outputs:
  game/assets/tiles/terrain.png    the atlas
  game/assets/tiles/terrain.json   manifest the TileSet builder reads

  python3 art/tools/gen_terrain.py [--seed 7]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pixel_cleanup  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
RAW_DIR = REPO / "art" / ".build" / "terrain"
OUT_PNG = REPO / "game" / "assets" / "tiles" / "terrain.png"
OUT_JSON = OUT_PNG.with_suffix(".json")
T = 16
COLUMNS = 16
VARIANTS = 4

# Endesga 32 ramps (see art/STYLE.md).
OUTLINE = "181425"
GREEN_DD, GREEN_D, GREEN, GREEN_L = "193c3e", "265c42", "3e8948", "63c74d"
SAND_L, SAND, SAND_D, SAND_DD = "ead4aa", "e4a672", "c28569", "b86f50"
WATER_DD, WATER_D, WATER, FOAM, WHITE = "262b44", "124e89", "0099db", "2ce8f5", "ffffff"
STONE_DD, STONE_D, STONE, STONE_L = "3a4466", "5a6988", "8b9bb4", "c0cbdc"
BARK, BARK_D = "733e39", "3e2731"

N, E, S, W = 1, 2, 4, 8


class Tile:
    def __init__(self, fill: str):
        self.img = Image.new("RGBA", (T, T), _rgba(fill))

    def px(self, x: int, y: int, color: str) -> None:
        if 0 <= x < T and 0 <= y < T:
            self.img.putpixel((x, y), _rgba(color))

    def get(self, x: int, y: int) -> tuple:
        return self.img.getpixel((x, y))


def _rgba(color: str) -> tuple[int, int, int, int]:
    return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16), 255)


def speckle(tile: Tile, rng: random.Random, colors: list[str], count: int, margin: int = 0) -> None:
    for _ in range(count):
        tile.px(rng.randint(margin, T - 1 - margin), rng.randint(margin, T - 1 - margin), rng.choice(colors))


def grass(rng: random.Random) -> Tile:
    tile = Tile(GREEN)
    speckle(tile, rng, [GREEN_D], 10)
    for _ in range(rng.randint(3, 5)):
        x, y = rng.randint(1, T - 2), rng.randint(2, T - 1)
        tile.px(x, y, GREEN_D)
        tile.px(x - 1, y - 1, GREEN_L)
        tile.px(x + 1, y - 1, GREEN_L)
    if rng.random() < 0.35:
        x, y = rng.randint(2, T - 3), rng.randint(2, T - 3)
        tile.px(x, y, rng.choice(["fee761", "f6757a", WHITE]))
    return tile


def sand(rng: random.Random) -> Tile:
    tile = Tile(SAND_L)
    speckle(tile, rng, [SAND], 14)
    speckle(tile, rng, [SAND_D], 3, margin=1)
    return tile


def water(rng: random.Random) -> Tile:
    tile = Tile(WATER_D)
    for _ in range(rng.randint(2, 3)):
        x, y = rng.randint(0, T - 5), rng.randint(1, T - 2)
        for dx in range(rng.randint(3, 4)):
            tile.px(x + dx, y, WATER)
        tile.px(x + 1, y - 1, WATER)
    if rng.random() < 0.5:
        tile.px(rng.randint(1, T - 2), rng.randint(1, T - 2), FOAM)
    return tile


def blob(cx: float, cy: float, rx: float, ry: float, rng: random.Random, wobble: float = 0.25) -> set[tuple[int, int]]:
    cells = set()
    for y in range(T):
        for x in range(T):
            d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
            if d <= 1.0 + rng.uniform(-wobble, wobble) * (d > 0.6):
                cells.add((x, y))
    return cells


def outline_of(cells: set[tuple[int, int]]) -> set[tuple[int, int]]:
    ring = set()
    for x, y in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in cells and 0 <= n[0] < T and 0 <= n[1] < T:
                ring.add(n)
    return ring


def tree(tile: Tile, rng: random.Random, cx: float, top: float, radius: float) -> None:
    trunk_h = max(2, int(radius * 0.6))
    canopy_cy = top + radius
    base_y = int(canopy_cy + radius) + trunk_h - 1
    for dx in range(-int(radius * 0.8), int(radius * 0.8) + 1):
        tile.px(int(cx) + dx, base_y + 1, GREEN_D)
    tx = int(cx) - 1
    for y in range(int(canopy_cy), base_y + 1):
        tile.px(tx, y, BARK)
        tile.px(tx + 1, y, BARK_D)
    tile.px(tx - 1, base_y, OUTLINE)
    tile.px(tx + 2, base_y, OUTLINE)
    canopy = blob(cx, canopy_cy, radius, radius * 0.95, rng)
    for x, y in outline_of(canopy):
        tile.px(x, y, GREEN_DD)
    for x, y in canopy:
        lx, ly = (x + 0.5 - cx) / radius, (y + 0.5 - canopy_cy) / radius
        color = GREEN_D
        if lx + ly < -0.5:
            color = GREEN
        if lx + ly < -1.0:
            color = GREEN_L
        tile.px(x, y, color)
    speckle_cells = [c for c in canopy if (c[0] + 0.5 - cx) + (c[1] + 0.5 - canopy_cy) > 0]
    for x, y in rng.sample(speckle_cells, k=min(3, len(speckle_cells))):
        tile.px(x, y, GREEN_DD)


def forest(rng: random.Random, variant: int) -> Tile:
    tile = grass(rng)
    if variant == 0:
        tree(tile, rng, 8, 1, 5.5)
    elif variant == 1:
        tree(tile, rng, 4.5, 0, 3.8)
        tree(tile, rng, 11.5, 4, 4.0)
    elif variant == 2:
        tree(tile, rng, 11, 0, 3.8)
        tree(tile, rng, 5, 4, 4.2)
    else:
        tree(tile, rng, 7.5, 2, 5.0)
    return tile


def peak(tile: Tile, rng: random.Random, cx: int, top: int, half_width: int, base: int) -> None:
    rows = base - top
    cells = set()
    for i, y in enumerate(range(top, base + 1)):
        half = round(half_width * (i / rows)) if rows else half_width
        for x in range(cx - half, cx + half + 1):
            if 0 <= x < T:
                cells.add((x, y))
    for x, y in outline_of(cells):
        if y <= base:
            tile.px(x, y, STONE_DD)
    snow_line = top + max(2, rows // 3)
    for x, y in cells:
        if y <= snow_line - (1 if x > cx else 0) + rng.randint(-1, 0):
            color = WHITE if x <= cx else STONE_L
        elif x < cx:
            color = STONE
        elif x == cx:
            color = STONE_D
        else:
            color = STONE_D if (x + y) % 5 else STONE_DD
        tile.px(x, y, color)
    for x in range(cx - half_width, cx + half_width + 1):
        tile.px(x, base + 1, STONE_DD)


def mountain(rng: random.Random, variant: int) -> Tile:
    tile = grass(rng)
    if variant == 0:
        peak(tile, rng, 8, 1, 7, 13)
    elif variant == 1:
        peak(tile, rng, 11, 4, 4, 13)
        peak(tile, rng, 6, 1, 6, 13)
    elif variant == 2:
        peak(tile, rng, 5, 5, 4, 13)
        peak(tile, rng, 10, 2, 5, 13)
    else:
        peak(tile, rng, 7, 2, 6, 13)
    return tile


def shore(rng: random.Random, mask: int) -> Tile:
    tile = water(rng)
    sides = {
        N: [(x, 0) for x in range(T)],
        S: [(x, T - 1) for x in range(T)],
        W: [(0, y) for y in range(T)],
        E: [(T - 1, y) for y in range(T)],
    }
    inward = {N: (0, 1), S: (0, -1), W: (1, 0), E: (-1, 0)}
    for side, edge in sides.items():
        if not mask & side:
            continue
        dx, dy = inward[side]
        for i, (x, y) in enumerate(edge):
            tile.px(x, y, WHITE if rng.random() < 0.3 else FOAM)
            tile.px(x + dx, y + dy, FOAM if (i + rng.randint(0, 1)) % 3 == 0 else WATER)
            if rng.random() < 0.4:
                tile.px(x + 2 * dx, y + 2 * dy, WATER)
    return tile


def beach(rng: random.Random, mask: int) -> Tile:
    tile = sand(rng)
    for side in (N, E, S, W):
        if not mask & side:
            continue
        depth = [rng.choice((1, 2, 2, 3)) for _ in range(T)]
        for i in range(T):
            for d in range(depth[i]):
                x, y = {N: (i, d), S: (i, T - 1 - d), W: (d, i), E: (T - 1 - d, i)}[side]
                tile.px(x, y, GREEN_L if d == depth[i] - 1 else GREEN)
            d = depth[i]
            x, y = {N: (i, d), S: (i, T - 1 - d), W: (d, i), E: (T - 1 - d, i)}[side]
            tile.px(x, y, SAND)
    return tile


def build(seed: int) -> list[dict]:
    """Return tile records in atlas order, with None entries as row padding."""
    tiles: list[dict | None] = []

    def add(name, terrain, edge, tile):
        tiles.append({"name": name, "terrain": terrain, "edge": edge, "tile": tile})

    def rng_for(name: str) -> random.Random:
        return random.Random(f"{seed}:{name}")

    for terrain, fn in (("grass", grass), ("sand", sand), ("water", water)):
        for v in range(VARIANTS):
            add(f"{terrain}_{v}", terrain, -1, fn(rng_for(f"{terrain}_{v}")))
    for v in range(VARIANTS):
        add(f"forest_{v}", "forest", -1, forest(rng_for(f"forest_{v}"), v))
    for v in range(VARIANTS):
        add(f"mountain_{v}", "mountain", -1, mountain(rng_for(f"mountain_{v}"), v))
    tiles.extend([None] * (COLUMNS - len(tiles) % COLUMNS))
    for mask in range(16):
        add(f"shore_{mask:02d}", "water", mask, shore(rng_for(f"shore_{mask}"), mask) if mask else water(rng_for("shore_0")))
    for mask in range(16):
        add(f"beach_{mask:02d}", "sand", mask, beach(rng_for(f"beach_{mask}"), mask) if mask else sand(rng_for("beach_0")))
    return tiles


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    palette = pixel_cleanup.load_palette()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    blank = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    frames, records = [], []
    for i, rec in enumerate(build(args.seed)):
        if rec is None:
            frames.append((f"_pad{i}", blank))
            continue
        raw = RAW_DIR / f"{rec['name']}.png"
        rec["tile"].img.save(raw)
        frames.append((rec["name"], pixel_cleanup.snap(Image.open(raw), palette, (T, T))))
        records.append(rec)

    sheet, packed = pixel_cleanup.pack(frames, COLUMNS)
    bad = pixel_cleanup.off_palette_pixels(sheet, palette)
    if bad:
        raise SystemExit(f"terrain sheet has {len(bad)} off-palette pixels")
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PNG)
    manifest = {
        "tile_size": T,
        "columns": COLUMNS,
        "edge_bits": {"N": N, "E": E, "S": S, "W": W},
        "tiles": [
            {"name": r["name"], "atlas": packed["frames"][r["name"]], "terrain": r["terrain"], "edge": r["edge"]}
            for r in records
        ],
    }
    OUT_JSON.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{OUT_PNG.relative_to(REPO)}: {len(records)} tiles, {sheet.width}x{sheet.height}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
