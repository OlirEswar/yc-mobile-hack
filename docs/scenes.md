# Adding a scene

Scenes (`.tscn`) and generated resources (`.tres`) are built by scripts, never
written by hand. A builder is a GDScript that extends `SceneTree`, builds a node
tree in code, and saves it with `SceneBuilder` (which wraps `PackedScene.pack`
and `ResourceSaver.save`). `scripts/build_scenes.sh` runs every builder headlessly.

## Steps

1. Put runtime behavior in a script under `game/scripts/` (give it a
   `class_name` if tests or other scripts refer to it).
2. Add a builder `game/tools/scene_builders/build_NN_<name>.gd`. Builders run in
   name order, so pick `NN` after anything it loads (the terrain TileSet is
   `10`, the main scene `20`).
3. Run `scripts/build_scenes.sh <name>` (or no argument for all builders).
4. Look at it: `scripts/render.sh res://scenes/<name>.tscn renders/<name>.png`.
5. Add or extend a test in `game/tests/` and run `scripts/test.sh`.
6. Commit the builder and the generated `.tscn` together. CI rebuilds every
   scene and fails if the committed file differs from what the builder writes.

## Template

```gdscript
extends SceneTree
## Builds scenes/village.tscn. Run through scripts/build_scenes.sh.

const SceneBuilder = preload("res://tools/scene_builders/scene_builder.gd")
const TerrainMapScript = preload("res://scripts/world/terrain_map.gd")


func _initialize() -> void:
	var root := Node2D.new()
	root.name = "Village"

	var terrain: TileMapLayer = TerrainMapScript.new()   # a node with its script attached
	terrain.name = "Terrain"
	terrain.tile_set = load("res://assets/tiles/terrain_tileset.tres")
	terrain.map_size = Vector2i(32, 24)
	root.add_child(terrain)

	var label := Label.new()                             # any built-in node works too
	label.name = "Title"
	label.text = "Village"
	root.add_child(label)

	# Reuse an existing scene as a child:
	# root.add_child(load("res://scenes/house.tscn").instantiate())

	quit(0 if SceneBuilder.save_scene(root, "res://scenes/village.tscn") == OK else 1)
```

## Rules that keep this working

- `save_scene` sets `owner` on every descendant before packing; nodes without an
  owner would silently drop out of the file.
- Set exported script properties after attaching the script (`Script.new()` does
  both). Values equal to the script's defaults are not written to the file.
- A builder must not depend on `_ready`: nodes are never added to the tree while
  building. Procedural content (like the map) is generated at runtime in `_ready`.
- Godot gives every node a random `unique_id` on each save. `SceneBuilder`
  keeps the old file when that is the only difference, so rebuilding is a no-op
  in git.
- Art goes through `art/tools/pixel_cleanup.py` first (see `art/STYLE.md`);
  builders only load PNGs that are already clean.
- Something that is not a scene (a TileSet, Theme, material) uses
  `SceneBuilder.save_resource(resource, path)`, as
  `build_10_terrain_tileset.gd` does.
