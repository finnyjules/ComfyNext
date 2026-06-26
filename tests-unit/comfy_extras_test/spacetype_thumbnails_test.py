import importlib
nt = importlib.import_module("comfy_extras.nodes_timeline")

def test_scene_thumbnails_dir_under_bridge():
    d = nt._scene_thumbnails_dir()
    assert d.endswith("scene_thumbnails")
    assert "comfynext_bridge" in d

def test_thumbnails_reuse_effect_id_validator():
    assert nt._valid_effect_id("ribbon")
    assert not nt._valid_effect_id("../x")
