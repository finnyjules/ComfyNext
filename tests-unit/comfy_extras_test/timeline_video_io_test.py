"""Timeline ↔ VIDEO interop: clip inputs accept VIDEO objects (decoded to frame
batches) and the node exposes a VIDEO output — the type chain
Video → Timeline → SaveVideo must validate and execute.
Regression for: 'received_type(VIDEO) mismatch input_type(IMAGE)'."""
import importlib.util
import os
import sys
from fractions import Fraction

import pytest
import torch

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


def test_clip_inputs_accept_image_and_video():
    schema = NT.TimelineNode.define_schema()
    clip1 = next(i for i in schema.inputs if getattr(i, "id", None) == "clip1")
    assert clip1.get_io_type() == "IMAGE,VIDEO"


def test_schema_has_video_output_after_frames():
    schema = NT.TimelineNode.define_schema()
    io_types = [o.io_type for o in schema.outputs]
    assert io_types[0] == "IMAGE"   # slot order preserved for existing graphs
    assert "VIDEO" in io_types


def test_coerce_video_clips_decodes_video_objects():
    from comfy_api.latest import InputImpl, Types
    frames = torch.rand(4, 8, 8, 3)
    vid = InputImpl.VideoFromComponents(
        Types.VideoComponents(images=frames, audio=None, frame_rate=Fraction(30)))
    kwargs = {"clip1": vid, "clip2": torch.rand(2, 8, 8, 3), "clip3": None}
    NT._coerce_video_clips(kwargs)
    assert torch.equal(kwargs["clip1"], frames)
    assert isinstance(kwargs["clip2"], torch.Tensor)   # tensors pass through
    assert kwargs["clip3"] is None


def test_coerce_video_clips_refuses_oversized_video():
    # A 30s 4K clip decodes to ~70 GB of float32 frames — the guard must
    # refuse from container metadata alone, never calling get_components().
    class HugeFakeVideo:
        def get_dimensions(self):
            return (3840, 2160)

        def get_frame_count(self):
            return 30 * 30  # 30s @ 30fps

        def get_components(self):
            raise AssertionError("must not decode an over-budget video")

    kwargs = {"clip1": HugeFakeVideo()}
    with pytest.raises(ValueError, match="too large to composite"):
        NT._coerce_video_clips(kwargs)


def test_coerce_video_clips_decodes_when_metadata_unavailable():
    # If metadata probing fails, fall back to decoding as before the guard.
    frames = torch.rand(2, 8, 8, 3)

    class NoMetadataVideo:
        def get_dimensions(self):
            raise RuntimeError("no container metadata")

        def get_components(self):
            from comfy_api.latest import Types
            return Types.VideoComponents(
                images=frames, audio=None, frame_rate=Fraction(30))

    kwargs = {"clip1": NoMetadataVideo()}
    NT._coerce_video_clips(kwargs)
    assert torch.equal(kwargs["clip1"], frames)


def test_frames_to_video_round_trips():
    frames = torch.rand(3, 8, 8, 3)
    video = NT._frames_to_video(frames, 24)
    comps = video.get_components()
    assert torch.equal(comps.images, frames)
    assert comps.frame_rate == Fraction(24)


def test_needed_source_frames_legacy_and_state():
    assert NT._needed_source_frames({"clip1_length": 45}, None, 1) == 45
    state = {"tracks": [{"clips": [
        {"kind": "workflow", "port_index": 1, "in_frame": 10, "length": 20},
        {"kind": "workflow", "port_index": 1, "in_frame": 0, "length": 50},
        {"kind": "workflow", "port_index": 2, "in_frame": 0, "length": 999},
        {"kind": "video", "asset_id": "x", "length": 7},
    ]}]}
    assert NT._needed_source_frames({}, state, 1) == 50
    assert NT._needed_source_frames({}, state, 2) == 999
    assert NT._needed_source_frames({}, state, 3) is None
    assert NT._needed_source_frames({}, None, 1) is None


def test_decode_video_bounded_frames_and_downscale():
    from comfy_api.latest import InputImpl
    mp4 = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures", "assets", "counter_30f.mp4")
    video = InputImpl.VideoFromFile(mp4)
    frames = NT._decode_video_bounded(video, max_frames=10, max_dim=None)
    assert frames.shape[0] == 10
    # self-describing: frame i is gray ~ (8 + i*8)/255
    for i in (0, 5, 9):
        g = float(frames[i, 32, 32, 0]) * 255.0
        assert abs(g - (8 + i * 8)) <= 3
    small = NT._decode_video_bounded(InputImpl.VideoFromFile(mp4), max_frames=4, max_dim=32)
    assert small.shape[0] == 4
    assert max(small.shape[1], small.shape[2]) <= 32


def test_coerce_uses_bounds_from_legacy_widgets():
    from comfy_api.latest import InputImpl
    mp4 = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures", "assets", "counter_30f.mp4")
    kwargs = {"clip1": InputImpl.VideoFromFile(mp4), "clip1_length": 6}
    NT._coerce_video_clips(kwargs)
    assert kwargs["clip1"].shape[0] == 6


def test_budget_uses_bounded_estimate():
    # A '4K, 1000-frame' source that would blow the budget unbounded is FINE
    # when only 8 frames are needed at a small canvas.
    class BigMetaVideo:
        def get_dimensions(self):
            return (3840, 2160)

        def get_frame_count(self):
            return 1000

        def get_stream_source(self):
            raise AssertionError("budget must pass before any decode in this test")

        def get_components(self):
            raise AssertionError("must not full-decode")

    state = {"canvas": {"width": 640, "height": 360},
             "tracks": [{"clips": [{"kind": "workflow", "port_index": 1, "in_frame": 0, "length": 8}]}]}
    kwargs = {"clip1": BigMetaVideo()}
    with pytest.raises(AssertionError, match="budget must pass"):
        NT._coerce_video_clips(kwargs, state)   # reaching decode proves the budget passed


def test_decode_video_bounded_honors_trims():
    """Video Slice → Timeline: trimmed sources must NOT stream the raw file
    (regression: the untrimmed head was composited silently)."""
    from comfy_api.latest import InputImpl
    mp4 = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures", "assets", "counter_30f.mp4")
    trimmed = InputImpl.VideoFromFile(mp4, start_time=10 / 30.0)
    frames = NT._decode_video_bounded(trimmed, max_frames=5, max_dim=None)
    g0 = float(frames[0, 32, 32, 0]) * 255.0
    assert abs(g0 - (8 + 10 * 8)) <= 4, f"expected source frame 10 (gray~88), got {g0}"


def test_needed_source_frames_missing_length_matches_renderer_default():
    state = {"tracks": [{"clips": [{"kind": "workflow", "port_index": 1, "in_frame": 5}]}]}
    assert NT._needed_source_frames({}, state, 1) == 35   # 5 + renderer default 30
