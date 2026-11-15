#!/usr/bin/env python3
"""Palette cleanup for every sprite in this repo.

Whatever produced a PNG (a procedural script, a model, a hand edit), run it
through this before it lands in game/assets:

  snap   PNG -> PNG   binary alpha, nearest-neighbor resize, snap colors to the palette
  check  PNG...       fail if any pixel is off-palette or semi-transparent
  pack   PNG... -> sheet + JSON manifest (frames on a fixed grid)
  swatch            write the palette as a PNG strip

Examples:
  art/tools/pixel_cleanup.py snap raw.png out.png --size 16x16
  art/tools/pixel_cleanup.py snap big_render.png hero.png --grid 16 --cells 2x2
  art/tools/pixel_cleanup.py pack sheet.png a.png b.png c.png --columns 8
  art/tools/pixel_cleanup.py check game/assets/tiles/terrain.png

Requires Pillow (python3-pil).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PALETTE = REPO / "art" / "palette" / "endesga-32.hex"
ALPHA_THRESHOLD = 128


def load_palette(path: Path = DEFAULT_PALETTE) -> list[tuple[int, int, int]]:
    colors = []
    for line in Path(path).read_text().splitlines():
        line = line.strip().lstrip("#")
        if not line or line.startswith(";"):
            continue
        colors.append(tuple(int(line[i : i + 2], 16) for i in (0, 2, 4)))
    if not 2 <= len(colors) <= 256:
        raise ValueError(f"palette {path} has {len(colors)} colors")
    return colors


def _palette_image(colors: list[tuple[int, int, int]]) -> Image.Image:
    flat = [c for rgb in colors for c in rgb]
    flat += list(colors[0]) * (256 - len(colors))
    img = Image.new("P", (1, 1))
    img.putpalette(flat)
    return img


def snap(img: Image.Image, colors: list[tuple[int, int, int]], size: tuple[int, int] | None = None) -> Image.Image:
    """Resize with nearest neighbor, binarize alpha, map every opaque pixel to the closest palette color."""
    img = img.convert("RGBA")
    if size and img.size != size:
        img = img.resize(size, Image.Resampling.NEAREST)
    alpha = img.getchannel("A").point(lambda a: 255 if a >= ALPHA_THRESHOLD else 0)
    quantized = img.convert("RGB").quantize(palette=_palette_image(colors), dither=Image.Dither.NONE)
    out = quantized.convert("RGBA")
    out.putalpha(alpha)
    clear = Image.new("RGBA", out.size, (0, 0, 0, 0))
    return Image.composite(out, clear, alpha)


def off_palette_pixels(img: Image.Image, colors: list[tuple[int, int, int]]) -> list[tuple[int, int, tuple]]:
    allowed = set(colors)
    bad = []
    img = img.convert("RGBA")
    width = img.width
    for i, (r, g, b, a) in enumerate(img.getdata()):
        if a == 0:
            continue
        if a != 255 or (r, g, b) not in allowed:
            bad.append((i % width, i // width, (r, g, b, a)))
    return bad


def pack(frames: list[tuple[str, Image.Image]], columns: int) -> tuple[Image.Image, dict]:
    """Pack same-size frames into a grid, left to right, top to bottom."""
    if not frames:
        raise ValueError("no frames to pack")
    cell = frames[0][1].size
    for name, frame in frames:
        if frame.size != cell:
            raise ValueError(f"{name} is {frame.size}, expected {cell}; snap frames to one size first")
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGBA", (cell[0] * columns, cell[1] * rows), (0, 0, 0, 0))
    manifest = {"cell": list(cell), "columns": columns, "rows": rows, "frames": {}}
    for i, (name, frame) in enumerate(frames):
        x, y = i % columns, i // columns
        sheet.paste(frame, (x * cell[0], y * cell[1]))
        manifest["frames"][name] = [x, y]
    return sheet, manifest


def _size(text: str) -> tuple[int, int]:
    w, _, h = text.lower().partition("x")
    return int(w), int(h or w)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--palette", type=Path, default=DEFAULT_PALETTE)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_snap = sub.add_parser("snap", help="clean one PNG")
    p_snap.add_argument("input", type=Path)
    p_snap.add_argument("output", type=Path)
    p_snap.add_argument("--size", type=_size, help="target pixel size, e.g. 16x16")
    p_snap.add_argument("--grid", type=int, help="tile size; with --cells sets --size")
    p_snap.add_argument("--cells", type=_size, default=(1, 1), help="sprite size in tiles, e.g. 2x1")

    p_check = sub.add_parser("check", help="verify PNGs are clean")
    p_check.add_argument("inputs", type=Path, nargs="+")

    p_pack = sub.add_parser("pack", help="pack frames into a sprite sheet")
    p_pack.add_argument("output", type=Path)
    p_pack.add_argument("inputs", type=Path, nargs="+")
    p_pack.add_argument("--columns", type=int, default=8)
    p_pack.add_argument("--manifest", type=Path, help="JSON manifest path (default: OUTPUT with .json)")

    p_swatch = sub.add_parser("swatch", help="write the palette as a PNG strip")
    p_swatch.add_argument("output", type=Path)
    p_swatch.add_argument("--scale", type=int, default=1)

    args = parser.parse_args(argv)
    colors = load_palette(args.palette)

    if args.cmd == "snap":
        size = args.size
        if args.grid:
            size = (args.grid * args.cells[0], args.grid * args.cells[1])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        snap(Image.open(args.input), colors, size).save(args.output)
        print(args.output)
        return 0

    if args.cmd == "check":
        failed = False
        for path in args.inputs:
            bad = off_palette_pixels(Image.open(path), colors)
            if bad:
                failed = True
                x, y, px = bad[0]
                print(f"{path}: {len(bad)} unclean pixels, first at ({x},{y}) = {px}", file=sys.stderr)
            else:
                print(f"{path}: ok")
        return 1 if failed else 0

    if args.cmd == "pack":
        frames = [(p.stem, snap(Image.open(p), colors)) for p in args.inputs]
        sheet, manifest = pack(frames, args.columns)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.output)
        manifest_path = args.manifest or args.output.with_suffix(".json")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(args.output, manifest_path)
        return 0

    if args.cmd == "swatch":
        strip = Image.new("RGBA", (len(colors), 1))
        strip.putdata([(*c, 255) for c in colors])
        if args.scale > 1:
            strip = strip.resize((len(colors) * args.scale, args.scale), Image.Resampling.NEAREST)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        strip.save(args.output)
        print(args.output)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
