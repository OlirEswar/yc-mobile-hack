class_name TouchCamera
extends Camera2D
## Touch camera: one-finger drag pans, two-finger pinch zooms around the pinch
## midpoint (and pans with it), double tap zooms in 2x around the tap and resets
## once past max_zoom. Mouse wheel and trackpad gestures do the same on desktop. Event positions arrive in base-viewport pixels because the project
## uses the viewport stretch mode.

@export var min_zoom := 0.5
@export var max_zoom := 4.0
## World rectangle the view stays inside. Empty means unbounded.
@export var bounds := Rect2()

var _touches: Dictionary = {}
var _pinch_distance := 0.0
var _pinch_zoom := 1.0
var _pinch_mid := Vector2.ZERO


func _ready() -> void:
	clamp_to_bounds()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
			if event.double_tap and _touches.size() == 1:
				zoom_at(zoom.x * 2.0 if zoom.x * 2.0 <= max_zoom else 1.0, event.position)
		else:
			_touches.erase(event.index)
		_begin_pinch()
	elif event is InputEventScreenDrag:
		_touches[event.index] = event.position
		if _touches.size() == 1:
			pan(event.relative)
		elif _touches.size() >= 2:
			_update_pinch()
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_at(zoom.x * 1.25, event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_at(zoom.x / 1.25, event.position)
	elif event is InputEventMagnifyGesture:
		zoom_at(zoom.x * event.factor, event.position)
	elif event is InputEventPanGesture:
		pan(-event.delta * 4.0)


## Moves the view so the world follows a finger that moved by screen_delta.
func pan(screen_delta: Vector2) -> void:
	position -= screen_delta / zoom
	clamp_to_bounds()


## Sets the zoom, keeping the world point under screen_point fixed.
func zoom_at(target: float, screen_point: Vector2) -> void:
	var before := screen_to_world(screen_point)
	var z := clampf(target, min_zoom, max_zoom)
	zoom = Vector2(z, z)
	position += before - screen_to_world(screen_point)
	clamp_to_bounds()


func screen_to_world(screen_point: Vector2) -> Vector2:
	return position + (screen_point - get_viewport_rect().size / 2.0) / zoom


func clamp_to_bounds() -> void:
	if not bounds.has_area():
		return
	var half := get_viewport_rect().size / 2.0 / zoom
	var lo := bounds.position + half
	var hi := bounds.end - half
	position.x = clampf(position.x, lo.x, hi.x) if lo.x <= hi.x else bounds.get_center().x
	position.y = clampf(position.y, lo.y, hi.y) if lo.y <= hi.y else bounds.get_center().y


func _begin_pinch() -> void:
	if _touches.size() < 2:
		return
	var points := _touches.values()
	_pinch_distance = maxf(points[0].distance_to(points[1]), 1.0)
	_pinch_zoom = zoom.x
	_pinch_mid = (points[0] + points[1]) / 2.0


func _update_pinch() -> void:
	var points := _touches.values()
	var mid: Vector2 = (points[0] + points[1]) / 2.0
	pan(mid - _pinch_mid)
	_pinch_mid = mid
	zoom_at(_pinch_zoom * points[0].distance_to(points[1]) / _pinch_distance, mid)
