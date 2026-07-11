import importlib

sl = importlib.import_module("comfy_extras.nodes_smart_layout")


def _refs_socket(elements, key):
    """True when some element renders the given layer socket."""
    token = "props." + key
    return any(
        e.get("id") == key or token in str(e.get("content", ""))
        for e in elements
    )


def test_v2_autopopulate_seeds_empty_template():
    t = {"version": 2, "elements": []}
    sl._autopopulate_elements_v2(t, {"image_layer_1": "/view?x"})
    assert _refs_socket(t["elements"], "image_layer_1")


def test_wired_image_gets_element_even_when_template_has_other_elements():
    """Regression: wiring an image into a layout that already has a text
    element must still create an image element for that socket, or the
    render silently drops the wired image."""
    t = {
        "version": 2,
        "elements": [
            {
                "id": "text_wgxt2t",
                "type": "text",
                "region": {"col": 2, "colSpan": 14, "row": 2, "rowSpan": 14},
                "content": "A new kind of skincare",
            }
        ],
    }
    sl._autopopulate_elements_v2(t, {"image_layer_1": "/view?filename=pasted.png"})
    assert _refs_socket(t["elements"], "image_layer_1"), \
        "wired image_layer_1 must get a matching image element"
    # The pre-existing text element must be preserved untouched.
    assert _refs_socket(t["elements"], "text_wgxt2t") or any(
        e.get("id") == "text_wgxt2t" for e in t["elements"]
    )


def test_autopopulate_does_not_duplicate_existing_socket_element():
    """A socket already referenced by an element must not be seeded again."""
    t = {
        "version": 2,
        "elements": [
            {
                "id": "image_layer_1",
                "type": "image",
                "region": {"col": 3, "colSpan": 4, "row": 3, "rowSpan": 4},
                "content": "{{ props.image_layer_1 }}",
            }
        ],
    }
    sl._autopopulate_elements_v2(t, {"image_layer_1": "/view?x"})
    image_layer_1_els = [
        e for e in t["elements"]
        if e.get("id") == "image_layer_1" or "props.image_layer_1" in str(e.get("content", ""))
    ]
    assert len(image_layer_1_els) == 1


def test_first_image_is_full_bleed_background():
    """image_layer_1 seeds as a full-bleed background: spans the whole grid and
    bleeds to the canvas edges."""
    t = {"version": 3, "grid": {"columns": 16, "rows": 16}, "elements": [], "sections": []}
    sl._autopopulate_elements_v2(t, {"image_layer_1": "/view?x"})
    img = next(e for e in t["elements"] if e.get("type") == "image")
    assert img["bleed"] is True
    assert img["region"] == {"col": 1, "colSpan": 16, "row": 1, "rowSpan": 16}


def test_wired_background_image_sits_behind_existing_text():
    """When wired into a layout that already has text, the background image is
    inserted at the BACK of the z-order (front of the list) — not on top of it."""
    t = {
        "version": 3,
        "grid": {"columns": 16, "rows": 16},
        "elements": [
            {"id": "text_wgxt2t", "type": "text",
             "region": {"col": 2, "colSpan": 14, "row": 2, "rowSpan": 14},
             "content": "A new kind of skincare"}
        ],
        "sections": [],
    }
    sl._autopopulate_elements_v2(t, {"image_layer_1": "/view?x"})
    assert t["elements"][0]["id"] == "image_layer_1"   # back-most
    assert t["elements"][-1]["id"] == "text_wgxt2t"    # text stays in front


def test_v3_routes_to_grid_autopopulate_not_anchor():
    """v3 templates use grid regions like v2 — a seeded image element must
    carry a `region`, not the v1 anchor/offset/size shape."""
    t = {"version": 3, "elements": [], "sections": []}
    sl._autopopulate_for_template(t, {"image_layer_1": "/view?x"})
    img = next(e for e in t["elements"] if e.get("type") == "image")
    assert "region" in img and "anchor" not in img
