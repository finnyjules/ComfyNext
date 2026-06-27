"""
Cloner parity gate: the Python `_expand_clones` must produce the same per-clone
offsets / falloff as the TS `expandClones` (frontend/app/composables/useCloner.ts),
since the server-side wired composite and the client preview share one cloner
model. The golden values below mirror the assertions in
frontend/tests/unit/cloner.unit.spec.ts.

Run:  python tests-unit/comfy_extras_test/test_compositor_cloner.py
      pytest tests-unit/comfy_extras_test/test_compositor_cloner.py
"""
import importlib.util
import math
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOL = 1e-6


def _mod():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_compositor", os.path.join(REPO_ROOT, "comfy_extras", "nodes_compositor.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _base():
    # Identity base layer; only the transform fields matter for cloner math.
    return {"image": None, "x": 0.0, "y": 0.0, "rot": 0.0, "scl": 1.0,
            "op": 1.0, "blend": "normal", "z": 1.0}


DEFAULTS = {
    "enabled": True, "mode": "linear",
    "countX": 3, "countY": 1, "spacingX": 0.25, "spacingY": 0.25,
    "mirrorX": False, "mirrorY": False,
    "nudgeX": 0.0, "nudgeY": 0.0, "staggerX": 0.0, "staggerY": 0.0,
    "count": 6, "radius": 0.3, "startAngle": 0.0, "sweepAngle": 360.0, "faceCenter": False,
    "stepRotation": 0.0, "stepScale": 1.0, "stepOpacity": 1.0,
}


def cloner(**patch):
    return {**DEFAULTS, **patch}


def test_disabled_is_single_identity():
    m = _mod()
    out = m._expand_clones(_base(), cloner(enabled=False, countX=3, countY=3), 1.0)
    assert len(out) == 1
    o = out[0]
    assert (o["x"], o["y"], o["rot"], o["scl"], o["op"]) == (0.0, 0.0, 0.0, 1.0, 1.0)


def test_none_cloner_is_single():
    m = _mod()
    out = m._expand_clones(_base(), None, 1.0)
    assert len(out) == 1


def test_linear_row():
    m = _mod()
    out = m._expand_clones(_base(), cloner(mode="linear", countX=3, countY=1, spacingX=0.2), 1.0)
    assert len(out) == 3
    # original (k=0) is LAST
    assert abs(out[-1]["x"] - 0.0) < TOL and abs(out[-1]["op"] - 1.0) < TOL
    xs = sorted(round(o["x"], 6) for o in out)
    assert xs == [0.0, 0.2, 0.4]


def test_grid_count():
    m = _mod()
    out = m._expand_clones(_base(), cloner(mode="linear", countX=2, countY=3, spacingX=0.1, spacingY=0.25), 1.0)
    assert len(out) == 6
    pts = sorted((round(o["x"], 2), round(o["y"], 2)) for o in out)
    assert pts == sorted([
        (0.0, 0.0), (0.0, 0.25), (0.0, 0.5),
        (0.1, 0.0), (0.1, 0.25), (0.1, 0.5),
    ])


def test_mirror_x_reflects_centered():
    m = _mod()
    out = m._expand_clones(_base(), cloner(mode="linear", countX=3, countY=1, spacingX=0.2, mirrorX=True), 1.0)
    assert len(out) == 5  # 2*3-1
    xs = sorted(round(o["x"], 6) for o in out)
    assert xs == [-0.4, -0.2, 0.0, 0.2, 0.4]
    assert abs(out[-1]["x"]) < TOL and abs(out[-1]["y"]) < TOL  # original on top


def test_mirror_both_axes_centered_block():
    m = _mod()
    out = m._expand_clones(_base(), cloner(
        mode="linear", countX=2, countY=2, spacingX=0.1, spacingY=0.3, mirrorX=True, mirrorY=True), 1.0)
    assert len(out) == 9  # (2*2-1)^2
    pts = sorted((round(o["x"], 2), round(o["y"], 2)) for o in out)
    assert pts == sorted([
        (-0.1, -0.3), (-0.1, 0.0), (-0.1, 0.3),
        (0.0, -0.3), (0.0, 0.0), (0.0, 0.3),
        (0.1, -0.3), (0.1, 0.0), (0.1, 0.3),
    ])


def test_mirror_falloff_matches_positive_twin():
    m = _mod()
    out = m._expand_clones(_base(), cloner(
        mode="linear", countX=3, countY=1, spacingX=0.1, mirrorX=True,
        stepRotation=10, stepScale=0.5), 1.0)
    by_x = {round(o["x"], 6): o for o in out}
    # +0.2 (ix=2) and -0.2 (ix=-2) both at distance k=2 → identical falloff
    assert abs(by_x[0.2]["rot"] - 20.0) < TOL
    assert abs(by_x[-0.2]["rot"] - 20.0) < TOL
    assert abs(by_x[-0.2]["scl"] - 0.25) < TOL


def test_nudge_drifts_by_index():
    m = _mod()
    out = m._expand_clones(_base(), cloner(
        mode="linear", countX=3, countY=1, spacingX=0.1, nudgeX=0.02, nudgeY=0.05), 1.0)
    by_x = {round(o["x"], 6): o for o in out}
    assert abs(by_x[0.0]["y"] - 0.0) < TOL
    assert abs(by_x[0.12]["y"] - 0.05) < TOL   # k=1: x=0.12, y=0.05
    assert abs(by_x[0.24]["y"] - 0.10) < TOL   # k=2: x=0.24, y=0.10


def test_stagger_x_offsets_alternating_rows():
    m = _mod()
    out = m._expand_clones(_base(), cloner(
        mode="linear", countX=2, countY=2, spacingX=0.2, spacingY=0.3, staggerX=0.5), 1.0)
    row0 = sorted(round(o["x"], 4) for o in out if abs(o["y"] - 0.0) < TOL)
    row1 = sorted(round(o["x"], 4) for o in out if abs(o["y"] - 0.3) < TOL)
    assert row0 == [0.0, 0.2]
    assert row1 == [0.1, 0.3]  # odd row shifted by 0.5*0.2 = 0.1


def test_nudge_stagger_default_noop():
    m = _mod()
    plain = m._expand_clones(_base(), cloner(mode="linear", countX=2, countY=2, spacingX=0.1, spacingY=0.2), 1.0)
    explicit = m._expand_clones(_base(), cloner(
        mode="linear", countX=2, countY=2, spacingX=0.1, spacingY=0.2,
        nudgeX=0.0, nudgeY=0.0, staggerX=0.0, staggerY=0.0), 1.0)
    assert [(round(o["x"], 6), round(o["y"], 6)) for o in plain] == \
           [(round(o["x"], 6), round(o["y"], 6)) for o in explicit]


def test_falloff_accumulates_by_index():
    m = _mod()
    out = m._expand_clones(_base(), cloner(
        mode="linear", countX=3, countY=1, spacingX=0.1,
        stepRotation=10, stepScale=0.5, stepOpacity=0.8), 1.0)
    by_x = {round(o["x"], 6): o for o in out}
    assert abs(by_x[0.0]["rot"] - 0.0) < TOL
    assert abs(by_x[0.0]["scl"] - 1.0) < TOL
    assert abs(by_x[0.1]["rot"] - 10.0) < TOL
    assert abs(by_x[0.1]["scl"] - 0.5) < TOL
    assert abs(by_x[0.1]["op"] - 0.8) < TOL
    assert abs(by_x[0.2]["rot"] - 20.0) < TOL
    assert abs(by_x[0.2]["scl"] - 0.25) < TOL
    assert abs(by_x[0.2]["op"] - 0.64) < TOL


def test_original_drawn_last():
    m = _mod()
    out = m._expand_clones(_base(), cloner(mode="linear", countX=4, countY=1, spacingX=0.1), 1.0)
    assert abs(out[-1]["x"]) < TOL and abs(out[-1]["y"]) < TOL


def test_radial_full_ring_cardinals():
    m = _mod()
    out = m._expand_clones(_base(), cloner(mode="radial", count=4, radius=0.5, startAngle=0, sweepAngle=360), 1.0)
    assert len(out) == 4
    pts = [(round(o["x"], 4), round(o["y"], 4)) for o in out]

    def has(x, y):
        return any(abs(px - x) < 1e-3 and abs(py - y) < 1e-3 for px, py in pts)
    assert has(0.5, 0.0)    # 0°
    assert has(0.0, 0.5)    # 90°
    assert has(-0.5, 0.0)   # 180°
    assert has(0.0, -0.5)   # 270°


def test_radial_aspect_scales_dy():
    m = _mod()
    # aspect = W/H = 2 → the 90° clone's dy = 0.5 * 2 * sin(90) = 1.0
    out = m._expand_clones(_base(), cloner(mode="radial", count=2, radius=0.5, startAngle=90, sweepAngle=180), 2.0)
    top = max((o for o in out if abs(o["x"]) < 1e-3), key=lambda o: o["y"])
    assert abs(top["y"] - 1.0) < 1e-3


def test_radial_face_center_rotation():
    m = _mod()
    out = m._expand_clones(_base(), cloner(
        mode="radial", count=4, radius=0.5, startAngle=0, sweepAngle=360, faceCenter=True, stepRotation=0), 1.0)
    rots = sorted(round(o["rot"], 2) for o in out)
    assert rots == [0.0, 90.0, 180.0, 270.0]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\nAll {len(fns)} cloner parity tests passed.")
