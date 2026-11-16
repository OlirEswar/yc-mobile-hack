extends SceneTree
## Builds assets/tiles/terrain_tileset.tres from the atlas and manifest that
## art/tools/gen_terrain.py writes. Run through scripts/build_scenes.sh.

const SceneBuilder = preload("res://tools/scene_builders/scene_builder.gd")
const ATLAS := "res://assets/tiles/terrain.png"
const MANIFEST := "res://assets/tiles/terrain.json"
const OUT := "res://assets/tiles/terrain_tileset.tres"


func _initialize() -> void:
	var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
	var size := int(manifest.tile_size)

	var tile_set := TileSet.new()
	tile_set.tile_size = Vector2i(size, size)
	tile_set.add_custom_data_layer()
	tile_set.set_custom_data_layer_name(0, "terrain")
	tile_set.set_custom_data_layer_type(0, TYPE_STRING)
	tile_set.add_custom_data_layer()
	tile_set.set_custom_data_layer_name(1, "edge")
	tile_set.set_custom_data_layer_type(1, TYPE_INT)

	var source := TileSetAtlasSource.new()
	source.texture = load(ATLAS)
	source.texture_region_size = Vector2i(size, size)
	tile_set.add_source(source, 0)
	for tile: Dictionary in manifest.tiles:
		var coords := Vector2i(tile.atlas[0], tile.atlas[1])
		source.create_tile(coords)
		var data := source.get_tile_data(coords, 0)
		data.set_custom_data("terrain", tile.terrain)
		data.set_custom_data("edge", int(tile.edge))

	quit(0 if SceneBuilder.save_resource(tile_set, OUT) == OK else 1)
