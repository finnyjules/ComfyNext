"""Unit tests for the turntable segment planner (comfy_extras._turntable_plan).
Pure function, no deps."""
from comfy_extras import _turntable_plan as tpl


def test_front_only_single_full_loop():
    assert tpl.plan_segments(set(), "left") == [("front", "front", 360)]

def test_front_and_back_two_half_arcs():
    assert tpl.plan_segments({"back"}, "left") == [("front", "back", 180), ("back", "front", 180)]

def test_all_four_views_left():
    assert tpl.plan_segments({"right", "back", "left"}, "left") == [
        ("front", "right", 90), ("right", "back", 90),
        ("back", "left", 90), ("left", "front", 90)]

def test_all_four_views_right_reverses_order():
    assert tpl.plan_segments({"right", "back", "left"}, "right") == [
        ("front", "left", 90), ("left", "back", 90),
        ("back", "right", 90), ("right", "front", 90)]

def test_degrees_always_sum_to_360():
    for extra in [set(), {"back"}, {"right", "left"}, {"right", "back", "left"}]:
        for direction in ("left", "right"):
            total = sum(d for _, _, d in tpl.plan_segments(extra, direction))
            assert total == 360, (extra, direction, total)
