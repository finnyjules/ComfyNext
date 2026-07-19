"""Space Type clips on the timeline: baked-cycle → clip-frame mapping.

The browser bakes one seamless cycle (k whole loops) rather than the whole
clip, so export must tile it. spacetype_source_index is the Python twin of
sourceT01() in frontend/app/lib/engine/spaceTypeClipRenderer.ts — if the two
drift, a long clip's export desyncs from what the user scrubbed.
"""

from comfy_extras.nodes_timeline import spacetype_source_index


def test_tiles_past_the_baked_range():
    # 180 baked frames: frame 200 wraps to 20, and the loop point is exact.
    assert spacetype_source_index(200, 180, True) == 20
    assert spacetype_source_index(180, 180, True) == 0
    assert spacetype_source_index(0, 180, True) == 0
    assert spacetype_source_index(179, 180, True) == 179


def test_holds_last_frame_when_loop_is_off():
    assert spacetype_source_index(200, 180, False) == 179
    assert spacetype_source_index(179, 180, False) == 179
    assert spacetype_source_index(0, 180, False) == 0


def test_negative_and_empty_are_safe():
    # Python's % is already floor-based, so a negative frame wraps forward.
    assert spacetype_source_index(-5, 180, True) == 175
    assert spacetype_source_index(-5, 180, False) == 0
    # No baked frames at all must not raise or index out of range.
    assert spacetype_source_index(10, 0, True) == 0
    assert spacetype_source_index(10, 0, False) == 0


def test_every_index_is_in_range_across_several_cycles():
    baked = 180
    for f in range(-10, baked * 4):
        for loop in (True, False):
            assert 0 <= spacetype_source_index(f, baked, loop) < baked


def test_frames_one_cycle_apart_map_to_the_same_phase():
    # The property the golden test asserts in pixels: n and n + baked_count are
    # the same phase of the loop.
    baked = 180
    for f in (0, 45, 90, 179):
        assert spacetype_source_index(f, baked, True) == spacetype_source_index(f + baked, baked, True)
        assert spacetype_source_index(f, baked, True) == spacetype_source_index(f + baked * 3, baked, True)
