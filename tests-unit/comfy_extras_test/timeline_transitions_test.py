"""Python twin of frontend/tests/unit/timeline-transitions.unit.spec.ts — the
two files pin the SAME junction-transition window/weight/modulation math
(shared/timeline/transitions.ts ↔ nodes_timeline.py). Change them together."""
import importlib.util
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_nodes_timeline():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_transitions_test",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NT = _load_nodes_timeline()


def img(cid, start, length):
    return {"id": cid, "kind": "image", "start_frame": start, "in_frame": 0, "length": length}


def tr(**over):
    base = {"id": "t-x", "track_id": "trk", "from_clip_id": "a", "to_clip_id": "b",
            "kind": "crossfade", "duration": 10}
    base.update(over)
    return base


def state(clips, transitions):
    return {
        "version": 2,
        "canvas": {"width": 640, "height": 360, "fps": 30, "bg_color": "#000000"},
        "tracks": [{"id": "trk", "kind": "video", "name": "V", "muted": False,
                    "locked": False, "clips": clips}],
        "transitions": transitions,
        "total_frames": 0,
    }


def test_window_centered_on_cut():
    [w] = NT._transition_windows(state([img("a", 0, 30), img("b", 30, 30)], [tr()]))
    assert (w["cut"], w["start_f"], w["end_f"]) == (30, 25, 35)


def test_window_clamps_tail_to_incoming_end():
    [w] = NT._transition_windows(state([img("a", 0, 30), img("b", 30, 3)], [tr()]))
    assert (w["start_f"], w["end_f"], w["cut"]) == (25, 33, 30)


def test_window_clamps_head_to_outgoing_start():
    [w] = NT._transition_windows(state([img("a", 28, 2), img("b", 30, 30)], [tr()]))
    assert (w["start_f"], w["end_f"]) == (28, 35)


def test_stale_transitions_drop():
    assert NT._transition_windows(state([img("a", 0, 30), img("b", 31, 30)], [tr()])) == []
    assert NT._transition_windows(state([img("a", 0, 30)], [tr()])) == []


def test_mod_outgoing_extends_with_clamped_tail():
    s = state([img("a", 0, 30), img("b", 30, 30)], [tr()])
    by = NT._index_transition_windows(NT._transition_windows(s))
    mod = NT._transition_mod(by, "a", 0, 30, 32, False)
    assert mod["visible"] and mod["local"] == 29 and mod["alpha_mul"] == 1.0


def test_mod_incoming_early_with_crossfade_weight():
    s = state([img("a", 0, 30), img("b", 30, 30)], [tr()])
    by = NT._index_transition_windows(NT._transition_windows(s))
    mod = NT._transition_mod(by, "b", 30, 30, 26, False)
    assert mod["visible"] and mod["local"] == 0
    # pinned: w = (g - start_f + 1) / (len + 1) = (26-25+1)/11
    assert abs(mod["alpha_mul"] - 2 / 11) < 1e-9
    assert mod["draw_after"] == "a"


def test_mod_kinds():
    def mod_for(kind, g=30):
        s = state([img("a", 0, 30), img("b", 30, 30)], [tr(kind=kind)])
        by = NT._index_transition_windows(NT._transition_windows(s))
        return NT._transition_mod(by, "b", 30, 30, g, True)
    w = (30 - 25 + 1) / 11
    assert mod_for("wipe_left")["wipe"] == ("left", w)
    assert mod_for("wipe_right")["wipe"] == ("right", w)
    assert abs(mod_for("slide_up")["dy"] - (1 - w)) < 1e-9
    assert abs(mod_for("slide_down")["dy"] + (1 - w)) < 1e-9
    assert mod_for("crossfade")["wipe"] is None


def test_order_for_transitions_moves_incoming_after_outgoing():
    wins = [{"kind": "crossfade", "cut": 30, "start_f": 25, "end_f": 35,
             "from_id": "a", "to_id": "b"}]
    items = [{"id": "b"}, {"id": "x"}, {"id": "a"}]
    ordered = NT._order_for_transitions(items, lambda c: c["id"], wins)
    assert [c["id"] for c in ordered] == ["x", "a", "b"]
