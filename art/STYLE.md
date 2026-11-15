# Art style guide (placeholder)

This is the starting point for every sprite, tile, and UI element in the game.
It is deliberately small; Olir will refine it once reference images are in.
Whatever produced an image (a script, a model, a hand edit), it goes through
`art/tools/pixel_cleanup.py` before it lands in `game/assets/`.

## Palette

**Endesga 32** by ENDESGA, released CC0 (public domain).
Source: <https://lospec.com/palette-list/endesga-32>. Hex values live in
[`palette/endesga-32.hex`](palette/endesga-32.hex), the single source the
cleanup script reads. Use only these 32 colors; no anti-aliasing against
arbitrary colors, no gradients, no partial transparency (alpha is 0 or 255).

| Ramp | Colors (dark to light) | Use |
| --- | --- | --- |
| Outline / night | `181425` `262b44` `3a4466` | outlines, deep shadow |
| Stone | `3a4466` `5a6988` `8b9bb4` `c0cbdc` `ffffff` | rock, mountains, snow, metal |
| Foliage | `193c3e` `265c42` `3e8948` `63c74d` | grass, trees, crops |
| Water | `262b44` `124e89` `0099db` `2ce8f5` `ffffff` | sea, rivers, foam |
| Sand / earth | `733e39` `b86f50` `c28569` `e4a672` `ead4aa` | beaches, roads, wood |
| Wood / dark earth | `3e2731` `733e39` `b86f50` | trunks, buildings |
| Skin | `733e39` `c28569` `e8b796` `ead4aa` | people |
| Accent | `a22633` `e43b44` `f77622` `feae34` `fee761` `68386c` `b55088` `f6757a` `ff0044` | factions, UI, flowers, fire |

## Grid and scale

- **Base tile: 16x16 px.** Terrain tiles are exactly one tile. Units fit in one
  tile; buildings are whole multiples (16x16, 32x32, 32x48...).
- The game renders at a 640x360 base resolution (expanded to the screen's
  aspect) and scales by whole numbers only, so one art pixel is always an
  integer number of screen pixels. Never scale art by fractions.
- Sprite sheets are packed on a fixed grid with
  `pixel_cleanup.py pack`, which writes a JSON manifest of frame positions.

## Light and outline rule

- Light comes from the **top left**. Lighter shade on top-left faces,
  darker on bottom-right.
- **Objects get a 1 px outline** (trees, rocks, units, buildings, props):
  use the darkest color of the object's own ramp (`193c3e` for foliage,
  `3a4466`/`262b44` for stone, `3e2731` for wood), or `181425` when the
  object has no dark ramp. Never pure black `000000` (not in the palette).
- **Ground tiles get no outline** (grass, sand, water). Their edges come from
  edge variants instead (foam on shores, grass lip on beaches).
- No pillow shading, no single-pixel noise on large flat areas beyond light
  speckle (2 to 4 percent of pixels).

## Edge variants

Terrain transitions use a 4-bit neighbor mask, `N=1, E=2, S=4, W=8`: bit set
means the neighbor on that side is a different terrain. See
`art/tools/gen_terrain.py` for the current shore (water next to land) and
beach (sand next to grass) sets.

## Pipeline

```bash
# Clean one image: snap to palette, binary alpha, nearest resize to the grid
python3 art/tools/pixel_cleanup.py snap raw.png game/assets/units/settler.png --grid 16 --cells 1x1
# Verify files are clean (non-zero exit when not)
python3 art/tools/pixel_cleanup.py check game/assets/**/*.png
# Pack frames into a sheet + manifest
python3 art/tools/pixel_cleanup.py pack game/assets/units/settler_walk.png frames/*.png --columns 4
# Regenerate terrain, icon, TileSet, and scenes
python3 art/tools/gen_terrain.py && python3 art/tools/gen_icon.py && scripts/build_scenes.sh
```

## Reference images

<!-- REFERENCE IMAGES: Olir adds reference images below this line. -->
<!-- Put files in art/reference/ and link them here with a sentence on what to take from each. -->

_None yet._
