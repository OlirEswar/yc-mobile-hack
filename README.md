# yc-mobile-hack

A pixel-art civ sim in Godot 4, built for iOS and Android. This repo is set up
so agents can author art and scenes headlessly, look at the result, and ship it
to a phone.

| Path | What |
| --- | --- |
| `game/` | The Godot project (Compatibility renderer, 640x360 pixel-art base, touch input) |
| `game/GODOT_VERSION` | The one Godot version pin, read by Setup, CI, and the mobile builds |
| `art/` | Style guide, palette, cleanup and generator scripts |
| `scripts/` | Command-line entry points (render, test, build scenes, orientation) |
| `docs/` | How to add scenes and how to build for phones |

## Everyday commands

```bash
scripts/render.sh res://scenes/main.tscn renders/main.png 2400x1080   # scene -> PNG (xvfb + Mesa)
ZOOM=0.5 scripts/render.sh                                             # same, zoomed out
scripts/test.sh                                                        # GUT suite, headless
scripts/build_scenes.sh                                                # rerun scene builders
python3 art/tools/gen_terrain.py                                       # regenerate terrain tiles
python3 art/tools/pixel_cleanup.py check game/assets/tiles/terrain.png # palette check
scripts/set_orientation.py portrait                                    # flip orientation
```

`scripts/godot.sh` runs the pinned Godot against `game/` and installs it
first if it is missing (`game/tools/install_godot.sh`).

- Adding a scene: [docs/scenes.md](docs/scenes.md)
- Phone builds: [docs/mobile-build.md](docs/mobile-build.md)
- Art rules: [art/STYLE.md](art/STYLE.md)

## Project settings worth knowing

- Base resolution 640x360, stretch mode `viewport`, aspect `expand`, integer
  scaling, so the visible area grows to the phone's aspect (800x360 on a Pixel 7).
- Nearest texture filtering by default; 2D transforms and vertices snap to pixels.
- Touch input with `emulate_mouse_from_touch` (and `emulate_touch_from_mouse`
  so desktop clicks test touch code).
- Orientation is sensor landscape; `scripts/set_orientation.py` flips it.
