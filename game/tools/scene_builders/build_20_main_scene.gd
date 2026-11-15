extends SceneTree
## Builds scenes/main.tscn: a generated island on a TerrainMap and a TouchCamera
## that stays inside it. Run through scripts/build_scenes.sh.

const SceneBuilder = preload("res://tools/scene_builders/scene_builder.gd")
const TerrainMapScript = preload("res://scripts/world/terrain_map.gd")
const TouchCameraScript = preload("res://scripts/camera/touch_camera.gd")


func _initialize() -> void:
	var root := Node2D.new()
	root.name = "Main"

	var terrain: TileMapLayer = TerrainMapScript.new()
	terrain.name = "Terrain"
	terrain.tile_set = load("res://assets/tiles/terrain_tileset.tres")
	terrain.map_size = Vector2i(96, 64)
	terrain.map_seed = 1337
	root.add_child(terrain)

	var world := Rect2(Vector2.ZERO, Vector2(terrain.map_size * terrain.tile_set.tile_size))
	var camera: Camera2D = TouchCameraScript.new()
	camera.name = "Camera"
	camera.bounds = world
	camera.position = world.get_center()
	root.add_child(camera)

	quit(0 if SceneBuilder.save_scene(root, "res://scenes/main.tscn") == OK else 1)
