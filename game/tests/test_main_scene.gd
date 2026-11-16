extends GutTest
## Smoke test: the generated main scene loads, fills its map, and the touch
## camera pans, pinch-zooms, and double-tap zooms.

const MAIN := "res://scenes/main.tscn"

var main: Node
var terrain: TerrainMap
var camera: TouchCamera


func before_each() -> void:
	main = (load(MAIN) as PackedScene).instantiate()
	add_child_autofree(main)
	terrain = main.get_node("Terrain")
	camera = main.get_node("Camera")
	await wait_process_frames(1)


func test_map_fills_every_cell() -> void:
	var expected := terrain.map_size.x * terrain.map_size.y
	assert_eq(terrain.get_used_cells().size(), expected, "every map cell has a tile")
	assert_eq(terrain.terrain.size(), expected)


func test_map_has_varied_terrain() -> void:
	for kind in ["water", "sand", "grass", "forest", "mountain"]:
		assert_gt(terrain.count_of(kind), 0, "map contains %s" % kind)
	assert_gt(terrain.count_of("water"), terrain.terrain.size() / 5, "island is surrounded by water")


func test_map_uses_edge_tiles() -> void:
	var edges := 0
	for cell in terrain.get_used_cells():
		if int(terrain.get_cell_tile_data(cell).get_custom_data("edge")) > 0:
			edges += 1
	assert_gt(edges, 0, "shore and beach edge tiles are placed")


func test_map_is_deterministic() -> void:
	var first := terrain.terrain.duplicate()
	terrain.generate()
	assert_eq(terrain.terrain, first, "same seed gives the same map")


func test_one_finger_drag_pans() -> void:
	var start := camera.position
	_touch(0, Vector2(300, 180), true)
	_drag(0, Vector2(260, 160), Vector2(-40, -20))
	_touch(0, Vector2(260, 160), false)
	assert_eq(camera.position, start + Vector2(40, 20) / camera.zoom)


func test_pinch_zooms_in() -> void:
	var start_zoom := camera.zoom.x
	_touch(0, Vector2(280, 180), true)
	_touch(1, Vector2(360, 180), true)
	_drag(1, Vector2(440, 180), Vector2(80, 0))
	assert_almost_eq(camera.zoom.x, start_zoom * 2.0, 0.001, "spreading two fingers to twice the distance doubles zoom")
	_touch(1, Vector2(440, 180), false)
	_touch(0, Vector2(280, 180), false)


func test_double_tap_zooms_in_then_resets() -> void:
	camera.zoom = Vector2.ONE
	_double_tap(Vector2(320, 180))
	assert_almost_eq(camera.zoom.x, 2.0, 0.001)
	_double_tap(Vector2(320, 180))
	assert_almost_eq(camera.zoom.x, 4.0, 0.001)
	_double_tap(Vector2(320, 180))
	assert_almost_eq(camera.zoom.x, 1.0, 0.001, "double tap past max_zoom resets")


func test_view_stays_inside_map() -> void:
	camera.pan(Vector2(100000, 100000))
	var half := camera.get_viewport_rect().size / 2.0 / camera.zoom
	assert_almost_eq(camera.position.x, half.x, 0.01)
	assert_almost_eq(camera.position.y, half.y, 0.01)


func _touch(index: int, position: Vector2, pressed: bool) -> void:
	var event := InputEventScreenTouch.new()
	event.index = index
	event.position = position
	event.pressed = pressed
	camera._unhandled_input(event)


func _double_tap(position: Vector2) -> void:
	var event := InputEventScreenTouch.new()
	event.position = position
	event.pressed = true
	event.double_tap = true
	camera._unhandled_input(event)
	_touch(0, position, false)


func _drag(index: int, position: Vector2, relative: Vector2) -> void:
	var event := InputEventScreenDrag.new()
	event.index = index
	event.position = position
	event.relative = relative
	camera._unhandled_input(event)
