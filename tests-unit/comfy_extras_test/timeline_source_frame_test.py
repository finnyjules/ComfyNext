"""Python twin of frontend/tests/unit/source-frame.unit.spec.ts — the two
files pin the SAME timeline→source frame mapping (types.ts BaseClip
speed/reverse doc comments). Change them together or the golden gate breaks."""
import importlib.util
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_nodes_timeline():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_source_frame_test",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NT = _load_nodes_timeline()


def clip(**over):
    base = {"in_frame": 0, "length": 10}
    base.update(over)
    return base


def test_identity_at_speed_1():
    assert NT._source_frame_at(clip(), 0) == 0
    assert NT._source_frame_at(clip(), 7) == 7
    assert NT._source_frame_at(clip(in_frame=5), 7) == 12


def test_speed_half_holds_each_source_frame_twice():
    got = [NT._source_frame_at(clip(speed=0.5), l) for l in range(5)]
    assert got == [0, 0, 1, 1, 2]


def test_speed_2_skips_every_other_source_frame():
    assert NT._source_frame_at(clip(speed=2), 3) == 6


def test_reverse_plays_mapped_range_last_to_first():
    assert NT._source_frame_at(clip(reverse=True), 0) == 9
    assert NT._source_frame_at(clip(reverse=True), 9) == 0
    assert NT._source_frame_at(clip(reverse=True, in_frame=3), 0) == 12


def test_reverse_after_speed():
    assert NT._source_frame_at(clip(reverse=True, speed=0.5), 0) == 4
    assert NT._source_frame_at(clip(reverse=True, speed=0.5), 9) == 0


def test_defaults_never_negative():
    assert NT._source_frame_at({"length": 1}, 0) == 0
    assert NT._source_frame_at({"length": 0, "reverse": True}, 0) == 0
    # None speed (JSON null) must behave as 1, not crash
    assert NT._source_frame_at({"length": 10, "speed": None}, 4) == 4
