"""
Compositor *composite-pipeline* conformance gate (sibling to the blend gate).

Where test_compositor_blend_conformance.py locks down per-pixel blend math, this
locks down the COMPOSITE pipeline (`_prep_layer` + `_composite_layers`): how
opacity, the per-pixel mask, z-order, and alpha-over combine. These are the exact
primitives the upcoming masking feature builds on, so a wrong convention here
(e.g. MASK polarity, or premultiply order) would silently break composited ads.

Reference = the W3C/CSS source-over-with-blend formula over an opaque (black)
backdrop, which is what the canvas preview produces. Identity transforms +
canvas-sized layers, so geometry is a no-op and we test the alpha math in
isolation. We compare the INTERIOR (cropping a margin) to avoid the bilinear
edge ramp from grid_sample.

Run:  python tests-unit/comfy_extras_test/test_compositor_composite_conformance.py
      pytest tests-unit/comfy_extras_test/test_compositor_composite_conformance.py
"""
import importlib.util
import os
import sys

import torch

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
H = W = 64
MARGIN = 4  # crop to interior to skip the grid_sample edge ramp
TOL = 1.0 / 255.0


def _node():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_compositor", os.path.join(REPO_ROOT, "comfy_extras", "nodes_compositor.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _solid_layer(color, *, op=1.0, blend="normal", z=0.0, mask=None):
    """A canvas-sized solid IMAGE (NHWC) with identity transform."""
    img = torch.zeros(1, H, W, 3)
    for i, c in enumerate(color):
        img[..., i] = c
    layer = {"image": img, "x": 0.0, "y": 0.0, "rot": 0.0, "scl": 1.0,
             "op": float(op), "blend": blend, "z": float(z)}
    if mask is not None:
        layer["mask"] = mask if torch.is_tensor(mask) else torch.full((1, H, W), float(mask))
    return layer


def _w3c_blend(a, b, mode):
    if mode == "normal":   return b
    if mode == "multiply": return a * b
    if mode == "screen":   return a + b - a * b
    return b


def _reference(stack):
    """W3C composite over black: result = (1-α)·backdrop + α·B(backdrop, src)."""
    result = torch.zeros(3, H, W)
    for i, (color, op, blend, mask) in enumerate(stack):
        src = torch.zeros(3, H, W)
        for j, c in enumerate(color):
            src[j] = c
        m = torch.zeros(H, W) if mask is None else torch.full((H, W), float(mask))
        alpha = op * (1.0 - m)
        if i == 0:
            result = src * alpha
        else:
            B = _w3c_blend(result, src, blend)
            result = result * (1.0 - alpha) + B * alpha
    return result


def _interior(t):  # t: (3,H,W) or (1,3,H,W)
    if t.dim() == 4:
        t = t[0]
    return t[:, MARGIN:H - MARGIN, MARGIN:W - MARGIN]


def _drift(layers, ref_stack):
    m = _node()
    got = _interior(m._composite_layers([_solid_layer(*a, **k) for a, k in layers], H, W))
    exp = _interior(_reference(ref_stack))
    return (got - exp).abs().max().item()


def test_opacity_over_black():
    # one 50%-opacity red layer over black -> red * 0.5
    d = _drift([((( .8, .1, .1),), dict(op=0.5))], [((.8, .1, .1), 0.5, "normal", None)])
    assert d <= TOL, f"opacity-over-black drift {d*255:.1f}/255"


def test_alpha_over_normal():
    # blue under, red on top at 40% -> blue*0.6 + red*0.4
    layers = [(((.0, .0, .9),), dict(z=0)), (((.9, .0, .0),), dict(op=0.4, z=1))]
    ref = [((.0, .0, .9), 1.0, "normal", None), ((.9, .0, .0), 0.4, "normal", None)]
    d = _drift(layers, ref)
    assert d <= TOL, f"alpha-over drift {d*255:.1f}/255"


def test_mask_polarity_and_fold():
    # backdrop green; top red fully masked (mask=1) -> green shows through.
    base = (((.0, .8, .0),), dict(z=0))
    top_masked = (((.9, .0, .0),), dict(z=1, mask=1.0))
    ref = [((.0, .8, .0), 1.0, "normal", None), ((.9, .0, .0), 1.0, "normal", 1.0)]
    assert _drift([base, top_masked], ref) <= TOL, "mask=1 should hide the top layer (MASK=1-alpha)"
    # half mask -> 50% of the top
    top_half = (((.9, .0, .0),), dict(z=1, mask=0.5))
    ref2 = [((.0, .8, .0), 1.0, "normal", None), ((.9, .0, .0), 1.0, "normal", 0.5)]
    assert _drift([base, top_half], ref2) <= TOL, "half mask should be 50% coverage"


def test_z_order_respected():
    m = _node()
    red = _solid_layer((.9, .0, .0), z=5)
    blue = _solid_layer((.0, .0, .9), z=1)
    top = _interior(m._composite_layers([red, blue], H, W))  # red has higher z -> on top
    # center pixel should be red, not blue
    cx = top[:, top.shape[1] // 2, top.shape[2] // 2]
    assert cx[0] > 0.8 and cx[2] < 0.1, f"higher-z layer should win; got {cx.tolist()}"


if __name__ == "__main__":
    tests = [test_opacity_over_black, test_alpha_over_normal,
             test_mask_polarity_and_fold, test_z_order_respected]
    ok = True
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            ok = False
            print(f"  FAIL  {t.__name__}: {e}")
    print("\nPASS" if ok else "\nFAIL")
    raise SystemExit(0 if ok else 1)
