"""EditState version acceptance + v2 graceful handling for the timeline
renderer, plus the Python mirror of the TS interpolation unit tests
(frontend/tests/unit/interpolate.unit.spec.ts) — same inputs, same expected
numbers, continuing the mirrored-math conformance pattern."""
import importlib.util
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_nodes_timeline():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_under_test",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NT = _load_nodes_timeline()


def _v2_state():
    return {
        "version": 2,
        "canvas": {"width": 640, "height": 360, "fps": 30, "bg_color": "#000000"},
        "total_frames": 24,
        "transitions": [
            {"id": "tr1", "track_id": "t1", "from_clip_id": "a", "to_clip_id": "b",
             "kind": "crossfade", "duration": 10},
        ],
        "tracks": [
            {"id": "t1", "kind": "video", "name": "Video 1", "muted": False, "locked": False,
             "clips": [
                 {"id": "a", "kind": "image", "asset_id": "x", "path": "/nonexistent/a.png",
                  "start_frame": 0, "in_frame": 0, "length": 12, "speed": 1.0, "reverse": False,
                  "filters": {"saturation": 1.2}},
             ]},
            {"id": "t2", "kind": "captions", "name": "Captions", "muted": False, "locked": False,
             "clips": [
                 {"id": "cap1", "kind": "caption", "start_frame": 0, "in_frame": 0, "length": 24,
                  "caption": {"words": [{"text": "hi", "start_frame": 0, "end_frame": 10}],
                              "preset": "clean", "font_family": "Inter", "font_size": 0.05,
                              "color": "#ffffff", "highlight_color": "#ffe14d", "y": 0.85}},
             ]},
        ],
    }


def test_is_edit_state_accepts_v1_and_v2():
    assert NT._is_edit_state({"version": 1, "tracks": []})
    assert NT._is_edit_state(_v2_state())


def test_is_edit_state_rejects_garbage():
    assert not NT._is_edit_state(None)
    assert not NT._is_edit_state("nope")
    assert not NT._is_edit_state({"version": 3, "tracks": []})
    assert not NT._is_edit_state({"version": 2})          # no tracks
    assert not NT._is_edit_state({"version": 2, "tracks": "x"})


def test_adapt_edit_state_flattens_v2_and_skips_captions():
    flat = NT._adapt_edit_state(_v2_state())
    assert flat["fps"] == 30
    assert flat["canvas_width"] == 640
    # The image clip survives; the caption clip (no pixels to draw yet) does not.
    kinds = [c["kind"] for c in flat["clips"]]
    assert kinds == ["image"]


def test_adapt_edit_state_passthrough_for_non_edit_state():
    legacy = {"fps": 30, "clips": []}
    assert NT._adapt_edit_state(legacy) is legacy


def test_interp_transform_mirrors_ts():
    # Same cases/numbers as frontend/tests/unit/interpolate.unit.spec.ts.
    static = {"x": 0.2, "y": 0.0, "rotation": 0.0, "scale": 1.5, "opacity": 1.0}
    assert NT._interp_transform(static, None, 10) == static

    kfs = [
        {"frame": 0, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
        {"frame": 10, "x": 1, "y": -1, "rotation": 90, "scale": 2, "opacity": 0},
    ]
    tf = NT._interp_transform(static, kfs, 5)
    assert abs(tf["x"] - 0.5) < 1e-9
    assert abs(tf["rotation"] - 45.0) < 1e-9
    assert abs(tf["opacity"] - 0.5) < 1e-9

    eased = [
        {"frame": 0, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1, "ease": "easeInOut"},
        {"frame": 10, "x": 1, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
    ]
    assert abs(NT._interp_transform(static, eased, 2.5)["x"] - 0.15625) < 1e-9

    clamped = [
        {"frame": 5, "x": 0.3, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
        {"frame": 10, "x": 0.9, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
    ]
    assert abs(NT._interp_transform(static, clamped, 0)["x"] - 0.3) < 1e-9
    assert abs(NT._interp_transform(static, clamped, 99)["x"] - 0.9) < 1e-9


def test_ease_presets_match_ts():
    import importlib.util, os, sys
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if repo not in sys.path:
        sys.path.insert(0, repo)
    spec = importlib.util.spec_from_file_location(
        "nt_ease", os.path.join(repo, "comfy_extras", "nodes_timeline.py"))
    nt = importlib.util.module_from_spec(spec); spec.loader.exec_module(nt)
    assert abs(nt._ease(0.5, "linear") - 0.5) < 1e-6
    assert abs(nt._ease(0.5, None) - 0.5) < 1e-6
    assert abs(nt._ease(0.5, "power2.in") - 0.25) < 1e-6
    assert abs(nt._ease(0.5, "power2.out") - 0.75) < 1e-6
    assert abs(nt._ease(0.5, "easeInOut") - 0.5) < 1e-6
    assert abs(nt._ease(0.25, "easeInOut") - 0.15625) < 1e-6
