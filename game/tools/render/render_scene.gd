extends SceneTree
## Renders a scene to PNG. Use scripts/render.sh rather than calling this directly.
##
##   godot --path game --rendering-driver opengl3 --resolution 2400x1080 \
##     -s res://tools/render/render_scene.gd -- --scene=res://scenes/main.tscn --out=/abs/out.png
##
## Options after --: --scene, --out, --frames (frames to wait, default 10),
## --native (save the base-resolution viewport instead of the upscaled screen),
## --zoom=Z (set the active Camera2D's zoom first, e.g. 0.5 for an overview).

func _initialize() -> void:
	var opts := {"scene": "res://scenes/main.tscn", "out": "render.png", "frames": "10", "native": "", "zoom": ""}
	for arg in OS.get_cmdline_user_args():
		var parts := arg.trim_prefix("--").split("=", true, 1)
		opts[parts[0]] = parts[1] if parts.size() > 1 else "true"
	var packed := load(opts.scene) as PackedScene
	if packed == null:
		push_error("cannot load scene %s" % opts.scene)
		quit(1)
		return
	root.add_child(packed.instantiate())
	_capture(int(opts.frames), opts.out, opts.native == "true", float(opts.zoom))


func _capture(frames: int, out: String, native: bool, zoom: float) -> void:
	await process_frame
	var camera := root.get_camera_2d()
	if zoom > 0.0 and camera:
		camera.zoom = Vector2(zoom, zoom)
		if camera.has_method("clamp_to_bounds"):
			camera.clamp_to_bounds()
	for i in frames:
		await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	if not native:
		image = _to_screen(image, DisplayServer.window_get_size())
	var err := image.save_png(out)
	if err != OK:
		push_error("cannot write %s: %s" % [out, error_string(err)])
	else:
		print("rendered %s (%dx%d)" % [out, image.get_width(), image.get_height()])
	quit(0 if err == OK else 1)


## Upscales the base viewport the way integer stretch does on a device screen.
func _to_screen(image: Image, screen: Vector2i) -> Image:
	var scale := maxi(1, mini(screen.x / image.get_width(), screen.y / image.get_height()))
	image.resize(image.get_width() * scale, image.get_height() * scale, Image.INTERPOLATE_NEAREST)
	var canvas := Image.create(screen.x, screen.y, false, image.get_format())
	canvas.fill(ProjectSettings.get_setting("rendering/environment/defaults/default_clear_color"))
	canvas.blit_rect(image, Rect2i(Vector2i.ZERO, image.get_size()), (screen - image.get_size()) / 2)
	return canvas
