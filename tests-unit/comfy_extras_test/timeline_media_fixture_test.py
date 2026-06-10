"""The counter video must be self-describing: frame i decodes to gray ~8+i*8.
Validates the committed fixture (and PyAV's read-back), not the generator."""
import os

import numpy as np
import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MP4 = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures", "assets", "counter_30f.mp4")


def test_counter_video_frames_encode_their_index():
    av = pytest.importorskip("av")
    container = av.open(MP4)
    values = []
    for frame in container.decode(video=0):
        arr = frame.to_ndarray(format="rgb24")
        values.append(int(arr[32, 32, 0]))
    container.close()
    assert len(values) == 30
    for i, v in enumerate(values):
        want = 8 + i * 8
        assert abs(v - want) <= 3, f"frame {i}: {v} != ~{want}"
