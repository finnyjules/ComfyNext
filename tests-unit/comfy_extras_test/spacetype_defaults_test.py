import importlib
nt = importlib.import_module("comfy_extras.nodes_timeline")

def test_valid_effect_id_accepts_lowercase_alnum():
    assert nt._valid_effect_id("ribbon")
    assert nt._valid_effect_id("sliceglitch")

def test_valid_effect_id_rejects_traversal_and_caps():
    assert not nt._valid_effect_id("../etc")
    assert not nt._valid_effect_id("a/b")
    assert not nt._valid_effect_id("Ribbon")
    assert not nt._valid_effect_id("")

def test_scene_defaults_dir_is_under_bridge(tmp_path, monkeypatch):
    d = nt._scene_defaults_dir()
    assert d.endswith("scene_defaults")
    assert "comfynext_bridge" in d
