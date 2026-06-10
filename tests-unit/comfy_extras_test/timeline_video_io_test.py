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
