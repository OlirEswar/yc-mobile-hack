## Helpers for headless scene builders (see docs/scenes.md).
##
##   const SceneBuilder = preload("res://tools/scene_builders/scene_builder.gd")
##   SceneBuilder.save_scene(root, "res://scenes/foo.tscn")


## Packs root and every descendant into a PackedScene and saves it.
## Returns OK or the first error; frees root either way.
static func save_scene(root: Node, path: String) -> Error:
	_own(root, root)
	var packed := PackedScene.new()
	var err := packed.pack(root)
	root.free()
	if err != OK:
		push_error("could not pack %s: %s" % [path, error_string(err)])
		return err
	return save_resource(packed, path)


## Saves any Resource (TileSet, Theme, material...) to path. When the result
## differs from the file on disk only in the random node unique_ids Godot assigns
## on every save, the old file is kept so rebuilding leaves git clean.
static func save_resource(resource: Resource, path: String) -> Error:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
	var previous := FileAccess.get_file_as_string(path) if FileAccess.file_exists(path) else ""
	var err := ResourceSaver.save(resource, path)
	if err != OK:
		push_error("could not save %s: %s" % [path, error_string(err)])
		return err
	var ids := RegEx.create_from_string(" unique_id=\\d+")
	if previous and ids.sub(previous, "", true) == ids.sub(FileAccess.get_file_as_string(path), "", true):
		FileAccess.open(path, FileAccess.WRITE).store_string(previous)
		print("unchanged ", path)
	else:
		print("saved ", path)
	return OK


static func _own(node: Node, owner: Node) -> void:
	for child in node.get_children():
		child.owner = owner
		_own(child, owner)
