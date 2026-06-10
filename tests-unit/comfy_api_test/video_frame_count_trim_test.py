"""VideoFromFile.get_frame_count must agree with get_components for trimmed
videos. Regression: `as_trimmed(start, 0)` (duration=0 = "to end of file",
per the Video Slice node) returned 1 — both the metadata-estimate branch
(min(0, remaining) == 0 → fell through) and the decode-count branch
(end_pts == start_pts → counted one frame) treated duration 0 as zero-length.
The undercount fed the Timeline node's decode-budget estimate permissively.

Fixture: counter_30f.mp4 — 30 frames @ 30 fps, frame i is gray 8+i*8.
"""
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MP4 = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures", "assets", "counter_30f.mp4")


def _video():
    from comfy_api.latest import InputImpl
    return InputImpl.VideoFromFile(MP4)


def test_untrimmed_frame_count_unchanged():
    assert _video().get_frame_count() == 30


def test_open_ended_trim_counts_remaining_frames():
    trimmed = _video().as_trimmed(10 / 30.0, 0, strict_duration=False)
    count = trimmed.get_frame_count()
    actual = trimmed.get_components().images.shape[0]
    assert actual == 20, "fixture/decoder sanity"
    assert count == actual, f"get_frame_count {count} != decoded {actual}"


def test_bounded_trim_still_correct():
    trimmed = _video().as_trimmed(10 / 30.0, 0.5, strict_duration=False)
    count = trimmed.get_frame_count()
    actual = trimmed.get_components().images.shape[0]
    assert count == actual, f"get_frame_count {count} != decoded {actual}"
    assert count == 15  # 0.5s @ 30fps
