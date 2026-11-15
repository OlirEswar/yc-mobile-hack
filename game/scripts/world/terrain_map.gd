class_name TerrainMap
extends TileMapLayer
## Procedurally generated island painted with the terrain TileSet.
##
## The TileSet carries two custom data layers written by
## tools/scene_builders/build_terrain_tileset.gd: "terrain" (grass, sand, water,
## forest, mountain) and "edge" (-1 for a base tile, else a 4-bit mask of the
## sides that touch a different terrain: N=1, E=2, S=4, W=8). Water picks a
## shore tile from its land neighbors, sand picks a beach tile from its green
## neighbors, everything else picks a variant by cell hash.

signal generated

const SIDES := {1: Vector2i.UP, 2: Vector2i.RIGHT, 4: Vector2i.DOWN, 8: Vector2i.LEFT}
const GREEN := ["grass", "forest", "mountain"]

@export var map_size := Vector2i(96, 64)
@export var map_seed := 1337
@export var generate_on_ready := true

## Cell (Vector2i) -> terrain name, filled by generate().
var terrain: Dictionary = {}

var _tiles: Dictionary = {}
var _source_id := -1


func _ready() -> void:
	if generate_on_ready:
		generate()


func generate() -> void:
	clear()
	_index_tiles()
	terrain = _classify()
	for cell: Vector2i in terrain:
		set_cell(cell, _source_id, _pick_tile(cell))
	generated.emit()


func count_of(kind: String) -> int:
	return terrain.values().count(kind)


func world_rect() -> Rect2:
	return Rect2(Vector2.ZERO, Vector2(map_size * tile_set.tile_size))


func _index_tiles() -> void:
	_tiles.clear()
	_source_id = tile_set.get_source_id(0)
	var source := tile_set.get_source(_source_id) as TileSetAtlasSource
	for i in source.get_tiles_count():
		var coords := source.get_tile_id(i)
		var data := source.get_tile_data(coords, 0)
		var by_edge: Dictionary = _tiles.get_or_add(data.get_custom_data("terrain"), {})
		by_edge.get_or_add(int(data.get_custom_data("edge")), []).append(coords)


func _classify() -> Dictionary:
	var height := FastNoiseLite.new()
	height.seed = map_seed
	height.frequency = 0.05
	height.fractal_octaves = 4
	var moisture := FastNoiseLite.new()
	moisture.seed = map_seed + 101
	moisture.frequency = 0.07

	var center := Vector2(map_size) / 2.0
	var result := {}
	for y in map_size.y:
		for x in map_size.x:
			var falloff := ((Vector2(x, y) - center) / center).length()
			var h := 0.56 + height.get_noise_2d(x, y) * 0.75 - pow(falloff, 2.2) * 0.7
			var kind := "grass"
			if h < 0.3:
				kind = "water"
			elif h < 0.36:
				kind = "sand"
			elif h > 0.8:
				kind = "mountain"
			elif moisture.get_noise_2d(x, y) > 0.12:
				kind = "forest"
			result[Vector2i(x, y)] = kind

	for cell: Vector2i in result:
		if result[cell] in GREEN and _side_mask(result, cell, ["water"]) != 0:
			result[cell] = "sand"
	return result


func _pick_tile(cell: Vector2i) -> Vector2i:
	var kind: String = terrain[cell]
	var edge := -1
	if kind == "water":
		edge = _side_mask(terrain, cell, ["sand"] + GREEN)
	elif kind == "sand":
		edge = _side_mask(terrain, cell, GREEN)
	var by_edge: Dictionary = _tiles[kind]
	var choices: Array = by_edge.get(edge, by_edge[-1]) if edge > 0 else by_edge[-1]
	return choices[absi(cell.x * 73856093 ^ cell.y * 19349663 ^ map_seed) % choices.size()]


func _side_mask(grid: Dictionary, cell: Vector2i, kinds: Array) -> int:
	var mask := 0
	for bit: int in SIDES:
		if grid.get(cell + SIDES[bit], "water") in kinds:
			mask |= bit
	return mask
