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


# --- Critical 2 regression: in_frame was silently dropped -------------------
#
# spacetype_source_index() had no in_frame parameter at all, while its JS twin
# sourceT01() folded `(clip.in_frame ?? 0) + localFrame` into the raw frame
# before wrapping. A clip with a nonzero in-point previewed the trim correctly
# in the browser but exported as if in_frame were 0 — silently different
# content. These pin `raw = in_frame + local_frame` BEFORE wrap/clamp, in_frame
# defaulting to 0 so every call above (all pre-dating this parameter) is
# unaffected.

def test_applies_in_frame_offset():
    assert spacetype_source_index(0, 180, True, in_frame=40) == 40
    assert spacetype_source_index(150, 180, True, in_frame=40) == 10   # (150+40) % 180
    assert spacetype_source_index(0, 180, False, in_frame=40) == 40
    assert spacetype_source_index(150, 180, False, in_frame=40) == 179  # clamped, not wrapped


def test_in_frame_wraps_across_multiple_cycles():
    baked = 180
    assert spacetype_source_index(500, baked, True, in_frame=40) == (500 + 40) % baked
    assert spacetype_source_index(1000, baked, True, in_frame=40) == (1000 + 40) % baked


def test_in_frame_defaults_to_zero_for_existing_callers():
    # Every call site above this comment predates the in_frame parameter — the
    # default must reproduce their exact expectations unchanged.
    assert spacetype_source_index(200, 180, True) == spacetype_source_index(200, 180, True, in_frame=0)
    assert spacetype_source_index(200, 180, False) == spacetype_source_index(200, 180, False, in_frame=0)


# --- Twin-relationship table, shared (by value) with the JS side -----------
#
# KEEP IN SYNC with the `TWIN_CASES` table in
# frontend/tests/unit/spacetype-clip-bake.unit.spec.ts. Each case fixes
# (T, k, in_frame, local_frame, loop) and the expected baked-frame index. The
# JS side asserts sourceT01(...) * T rounds to the same index — pinning that
# Python's spacetype_source_index (indexes into the k*T baked PNGs) and JS's
# sourceT01 (computes k*T-cycle t01 for the live WebGL preview) agree on the
# same (in_frame, local_frame) pair, per Critical 1 + Critical 2 together.
TWIN_CASES = [
    # (label,            T,   k, in_frame, local_frame, loop,  expected_idx)
    ("start",            180, 3, 0,        0,           True,  0),
    ("one_loop_in",      180, 3, 0,        180,         True,  180),
    ("last_frame",       180, 3, 0,        539,         True,  539),
    ("wraps_at_cycle",   180, 3, 0,        540,         True,  0),
    ("in_frame_offset",  180, 3, 40,       100,         True,  140),
    ("in_frame_at_edge", 180, 3, 40,       500,         True,  0),    # 540 % 540
    ("in_frame_past",    180, 3, 40,       1000,        True,  500),  # 1040 % 540
    ("hold_last_no_loop",180, 3, 0,        600,         False, 539),
    ("hold_with_in",     180, 3, 550,      0,            False, 539),
    ("negative_wraps",   180, 3, 0,        -5,          True,  535),
]


def test_matches_js_source_t01_twin_table():
    for label, T, k, in_frame, local_frame, loop, expected in TWIN_CASES:
        baked = T * k
        got = spacetype_source_index(local_frame, baked, loop, in_frame=in_frame)
        assert got == expected, f"{label}: expected {expected}, got {got}"
