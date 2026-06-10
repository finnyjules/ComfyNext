"""Unit tests for render_frame_np — the single-frame composite the FFmpeg
export, the golden harness, and /comfynext/timeline/render_frame all share."""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

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


def _solid_png(tmp_path, name, rgb, size=(64, 36)):
    p = os.path.join(str(tmp_path), name)
    Image.new("RGB", size, rgb).save(p)
    return p


def _flat_state(clips, w=64, h=36, total=10, bg="#000000"):
    return {
        "fps": 30, "total_frames": total,
        "canvas_width": w, "canvas_height": h, "bg_color": bg,
        "clips": clips,
    }


def test_background_only(tmp_path):
    state = _flat_state([], bg="#336699")
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 0)
    finally:
        NT._close_render_clips(clips)
    assert arr.shape == (36, 64, 3)
    assert np.allclose(arr[18, 32], [0x33 / 255, 0x66 / 255, 0x99 / 255], atol=1e-6)


def test_image_clip_covers_canvas_inside_its_range(tmp_path):
    path = _solid_png(tmp_path, "red.png", (255, 0, 0))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 2, "length": 5,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }])
    clips = NT._prepare_render_clips(state)
    try:
        before = NT.render_frame_np(state, clips, 1)   # before the clip → bg
        inside = NT.render_frame_np(state, clips, 4)   # inside → red
        after = NT.render_frame_np(state, clips, 8)    # after → bg
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(before[18, 32], [0, 0, 0], atol=1e-6)
    assert np.allclose(inside[18, 32], [1, 0, 0], atol=2 / 255)
    assert np.allclose(after[18, 32], [0, 0, 0], atol=1e-6)


def test_opacity_blends_toward_background(tmp_path):
    path = _solid_png(tmp_path, "white.png", (255, 255, 255))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 10,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 0.5,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }])
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 5)
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(arr[18, 32], [0.5, 0.5, 0.5], atol=2 / 255)


def test_keyframed_opacity_interpolates(tmp_path):
    path = _solid_png(tmp_path, "white.png", (255, 255, 255))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 11,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
        "keyframes": [
            {"frame": 0, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 0},
            {"frame": 10, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
        ],
    }], total=11)
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 5)
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(arr[18, 32], [0.5, 0.5, 0.5], atol=2 / 255)


def test_render_timeline_to_file_still_works(tmp_path):
    path = _solid_png(tmp_path, "red.png", (255, 0, 0))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 10,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }])
    meta = NT.render_timeline_to_file(state, str(tmp_path))
    out = os.path.join(str(tmp_path), meta["filename"])
    assert os.path.exists(out)
    assert meta["frames"] == 10
    assert meta["size_bytes"] > 0
