"""Unit tests for the PyAV clip stitcher (comfy_extras._turntable_stitch).
Builds synthetic clips in-memory — NO network / no paid API."""
import io
import av
import numpy as np
from comfy_extras import _turntable_stitch as st


def _make_clip(n_frames, color, w=32, h=32, fps=8):
    buf = io.BytesIO()
    c = av.open(buf, mode="w", format="mp4")
    s = c.add_stream("h264", rate=fps)
    s.width, s.height, s.pix_fmt = w, h, "yuv420p"
    for _ in range(n_frames):
        arr = np.full((h, w, 3), color, dtype=np.uint8)
        for p in s.encode(av.VideoFrame.from_ndarray(arr, format="rgb24")):
            c.mux(p)
    for p in s.encode():
        c.mux(p)
    c.close()
    buf.seek(0)
    return buf


def _count_frames(buf):
    buf.seek(0)
    with av.open(buf, mode="r") as c:
        return sum(1 for _ in c.decode(c.streams.video[0]))


def test_stitch_drops_one_boundary_frame_per_join():
    clips = [_make_clip(5, 10), _make_clip(5, 120), _make_clip(5, 240)]
    out = st.stitch_clips(clips)
    # 15 total input frames, 2 joins → 2 duplicate boundary frames dropped.
    assert _count_frames(out) == 15 - 2

def test_single_clip_passes_through_frame_count():
    out = st.stitch_clips([_make_clip(6, 90)])
    assert _count_frames(out) == 6

def test_empty_raises():
    import pytest
    with pytest.raises(ValueError):
        st.stitch_clips([])
