"""Tests for fal function selection from the built payload, and that the fal
ref keys resolve local /view references. execute() itself is exercised by the
live smoke (Task 7); here we unit-test the pure pieces it composes.
"""
# `nodes_replicate` transitively imports `server`, which imports `nodes`, which
# prepends `<repo>/comfy` onto sys.path — and `comfy/utils.py` (a plain module)
# shadows the top-level `utils/` package needed by `app/frontend_management.py`.
# Importing `utils.install_util` here first caches the real package in
# sys.modules before that shadowing can happen. Pre-existing repo quirk, not
# specific to fal dispatch; no other test module currently imports
# `nodes_replicate` so this landmine was never tripped before.
import utils.install_util  # noqa: F401

from comfy_api_nodes.nodes_replicate import _fal_fn_for_input, _resolve_local_refs

FN_BY_MODE = {
    "reference": "reference-to-video",
    "firstLast": "image-to-video",
    "t2v": "text-to-video",
}


def test_fn_first_last_when_image_url_present():
    inp = {"prompt": "p", "image_url": "data:image/png;base64,x"}
    assert _fal_fn_for_input(inp, FN_BY_MODE) == "image-to-video"


def test_fn_reference_when_url_arrays_present():
    inp = {"prompt": "p", "image_urls": ["data:image/png;base64,x"]}
    assert _fal_fn_for_input(inp, FN_BY_MODE) == "reference-to-video"


def test_fn_text_to_video_when_no_media():
    inp = {"prompt": "p", "aspect_ratio": "16:9"}
    assert _fal_fn_for_input(inp, FN_BY_MODE) == "text-to-video"


def test_resolve_fal_list_and_str_keys(monkeypatch):
    import comfy_api_nodes.nodes_replicate as nr
    monkeypatch.setattr(nr, "_local_ref_to_data_url", lambda name: f"DATA:{name}")
    adv = {
        "image_urls": ["/view?filename=a.png&type=input", "https://x/y.png"],
        "image_url": "/view?filename=first.png&type=input",
        "end_image_url": "/view?filename=last.png&type=input",
    }
    out = _resolve_local_refs(adv)
    assert out["image_urls"] == ["DATA:a.png", "https://x/y.png"]
    assert out["image_url"] == "DATA:first.png"
    assert out["end_image_url"] == "DATA:last.png"
