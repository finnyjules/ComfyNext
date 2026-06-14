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


def test_rotated_clip_corners_are_transparent(tmp_path):
    """Rotating must not paint the PIL expand-bbox: the area outside the
    rotated quad but inside its bounding box shows the BACKGROUND, not black.
    Regression for the black-box-around-rotated-clips export bug."""
    path = _solid_png(tmp_path, "white.png", (255, 255, 255), size=(64, 64))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 10,
        "x": 0, "y": 0, "rotation": 45, "scale": 0.5, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }], w=128, h=128, bg="#336699")
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 0)
    finally:
        NT._close_render_clips(clips)
    bg = [0x33 / 255, 0x66 / 255, 0x99 / 255]
    # 64x64 source aspect-fit into 128x128 -> 128x128, scale 0.5 -> 64x64
    # square centered at (64, 64), rotated 45 deg -> diamond: inside iff
    # |dx| + |dy| <= ~45. Its expand-bbox spans ~[19, 109]. Point (24, 24):
    # |dx| + |dy| = 80 > 45 -> outside the diamond, inside the bbox.
    assert np.allclose(arr[24, 24], bg, atol=2 / 255), f"bbox corner shows {arr[24, 24]}, expected bg"
    # Center is inside the diamond -> white.
    assert np.allclose(arr[64, 64], [1, 1, 1], atol=2 / 255)


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


def test_transform_preserve_alpha_keeps_transparency(tmp_path):
    """preserve_alpha=True must carry the source's per-pixel alpha through;
    the default (False) flattens to opaque (correct for opaque photo/video clips)."""
    from PIL import Image as _Image
    transparent_white = _Image.new("RGBA", (64, 36), (255, 255, 255, 0))
    _rgb, alpha = NT._transform_and_alpha(transparent_white, 64, 36, 0, 0, 0, 1, preserve_alpha=True)
    assert float(alpha.max()) == 0.0, "transparent source must stay transparent"
    _rgb2, alpha2 = NT._transform_and_alpha(transparent_white, 64, 36, 0, 0, 0, 1)
    assert float(alpha2.max()) > 0.0, "default path makes the fitted region opaque"
