"""Pure-logic tests for the Seedream layerize node.

The fal endpoint returns a `layers` array (NOT `images`), each layer an RGBA PNG
with a [left,top,right,bottom] bounding box and z_index; the base layer has
z_index 0 and no bounding box. These tests pin the input payload shape and the
result parsing that the node's I/O wraps.
"""
from comfy_api_nodes.seedream_layerize import seedream_layerize_input, parse_seedream_layers

SAMPLE = {
    "images": [{"url": "http://x/flat.png", "width": 1024, "height": 768}],
    "layers": [
        {"image": {"url": "http://x/bg.png", "width": 1024, "height": 768}, "z_index": 0},
        {"image": {"url": "http://x/flower.png", "width": 200, "height": 150},
         "z_index": 2, "bounding_box": {"absolute": [100, 80, 300, 230],
         "normalized": [98, 104, 293, 299]}, "name": "flower", "description": "a red flower"},
    ],
}


def test_input_has_required_fal_fields():
    inp = seedream_layerize_input("split it", "data:image/png;base64,x", "auto")
    assert inp["image_url"] == "data:image/png;base64,x"
    assert inp["prompt"] == "split it"
    assert inp["image_size"] == "auto"


def test_input_image_size_falls_back_to_auto_for_bad_value():
    assert seedream_layerize_input("", "data:...", "huge")["image_size"] == "auto"
    assert seedream_layerize_input("", "data:...", "auto_2K")["image_size"] == "auto_2K"


def test_parse_returns_base_dimensions():
    layers, w, h = parse_seedream_layers(SAMPLE)
    assert (w, h) == (1024, 768)


def test_parse_base_layer_has_no_box():
    layers, _, _ = parse_seedream_layers(SAMPLE)
    base = next(l for l in layers if l["z_index"] == 0)
    assert base["box"] is None
    assert base["url"] == "http://x/bg.png"


def test_parse_element_layer_carries_absolute_box_and_name():
    layers, _, _ = parse_seedream_layers(SAMPLE)
    el = next(l for l in layers if l["z_index"] == 2)
    assert el["box"] == [100, 80, 300, 230]
    assert el["name"] == "flower"
    assert el["url"] == "http://x/flower.png"


def test_parse_empty_result_is_empty_not_crash():
    assert parse_seedream_layers({}) == ([], 0, 0)
