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


# ---------------------------------------------------------------------------
# GEOMETRY conformance. The tests above deliberately use identity transforms so
# the alpha math is tested in isolation — which is exactly why a units bug in
# `_transform` slipped through: the server placed every offset layer at HALF the
# authored displacement for months without a red test.
#
# The contract is the CLIENT, `drawWiredImageLayer`:
#     ctx.translate(W / 2 + layer.x * W, H / 2 + layer.y * H)
#     ctx.rotate(rot); ctx.scale(s, s); drawImage(src, -fitW/2, -fitH/2, ...)
# i.e. one unit of x = one FULL canvas width, and the rotation is a true rotation
# in PIXEL space (unaffected by the canvas aspect). Users author these numbers by
# dragging in that preview, so the preview is the source of truth and the node
# must reproduce it.
# ---------------------------------------------------------------------------
GEO_TOL_PX = 1.0


def _marker(w, h, bw, bh):
    """A canvas-sized tensor (1,3,h,w) holding one centered white block."""
    t = torch.zeros(1, 3, h, w)
    t[:, :, h // 2 - bh // 2:h // 2 + bh // 2, w // 2 - bw // 2:w // 2 + bw // 2] = 1.0
    return t


def _centroid(plane):
    """Intensity-weighted centroid (x, y) in pixels of a (h, w) plane."""
    h, w = plane.shape
    ys, xs = torch.meshgrid(torch.arange(h, dtype=torch.float32),
                            torch.arange(w, dtype=torch.float32), indexing="ij")
    total = plane.sum()
    return (xs * plane).sum().item() / total, (ys * plane).sum().item() / total


def _bbox(plane, thresh=0.5):
    ys, xs = torch.nonzero(plane > thresh, as_tuple=True)
    return int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def test_x_offset_moves_a_full_canvas_width_per_unit():
    """x_off = 0.25 must move content 0.25 * W, not 0.125 * W.

    Regression gate for the live-verified defect where `_transform` read x/y in
    affine_grid's [-1,1] space (one unit = HALF a canvas width) while the client
    and this node's own tooltip define one unit = a full canvas width.
    """
    m = _node()
    w = h = 256
    src = _marker(w, h, 32, 32)
    rest_x, rest_y = _centroid(_transform_plane(m, src, 0.0, 0.0))
    for x_off in (0.125, 0.25, -0.25):
        cx, cy = _centroid(_transform_plane(m, src, x_off, 0.0))
        moved = cx - rest_x
        want = x_off * w
        assert abs(moved - want) <= GEO_TOL_PX, (
            f"x_off={x_off}: content moved {moved:.2f}px, client contract is "
            f"{want:.2f}px (= x * W); off by {moved - want:+.2f}px")
        assert abs(cy - rest_y) <= GEO_TOL_PX, f"x_off={x_off} must not move y ({cy - rest_y:+.2f}px)"


def test_y_offset_moves_a_full_canvas_height_per_unit():
    m = _node()
    w = h = 256
    src = _marker(w, h, 32, 32)
    rest_x, rest_y = _centroid(_transform_plane(m, src, 0.0, 0.0))
    for y_off in (0.25, -0.125):
        cx, cy = _centroid(_transform_plane(m, src, 0.0, y_off))
        moved = cy - rest_y
        want = y_off * h  # +y is DOWN, matching canvas 2D
        assert abs(moved - want) <= GEO_TOL_PX, (
            f"y_off={y_off}: content moved {moved:.2f}px, want {want:.2f}px (= y * H)")
        assert abs(cx - rest_x) <= GEO_TOL_PX, f"y_off={y_off} must not move x ({cx - rest_x:+.2f}px)"


def test_offset_is_independent_of_canvas_aspect():
    """A 0.25 offset is 0.25 of W (or H) on a wide canvas too, not 0.25 of the
    short side — the client normalizes each axis by its own dimension."""
    m = _node()
    w, h = 384, 128
    src = _marker(w, h, 32, 32)
    rest_x, rest_y = _centroid(_transform_plane(m, src, 0.0, 0.0))
    cx, _ = _centroid(_transform_plane(m, src, 0.25, 0.0))
    assert abs((cx - rest_x) - 0.25 * w) <= GEO_TOL_PX, \
        f"wide canvas: moved {cx - rest_x:.2f}px, want {0.25 * w:.2f}px"
    _, cy = _centroid(_transform_plane(m, src, 0.0, 0.25))
    assert abs((cy - rest_y) - 0.25 * h) <= GEO_TOL_PX, \
        f"wide canvas: moved {cy - rest_y:.2f}px, want {0.25 * h:.2f}px"


def test_rotation_is_a_pixel_space_rotation_on_a_wide_canvas():
    """90 deg must turn an 80x16 bar into a 16x80 bar whatever the canvas aspect.

    affine_grid's normalized space is anisotropic when W != H, so a rotation
    matrix written straight into `theta` shears instead of rotating (this bar
    used to come out 48x26 on a 384x128 canvas).
    """
    m = _node()
    for (w, h) in ((256, 256), (384, 128), (128, 384)):
        src = _marker(w, h, 80, 16)
        turned = _transform_plane(m, src, 0.0, 0.0, rotation=90.0)
        bw, bh = _bbox(turned)
        assert abs(bw - 16) <= 2 and abs(bh - 80) <= 2, \
            f"canvas {w}x{h}: 90deg of an 80x16 bar gave {bw}x{bh}, want 16x80"


def test_rotation_handedness_matches_canvas_2d():
    """ctx.rotate(+90deg) with y-down sends +x to +y (visually clockwise)."""
    m = _node()
    w = h = 256
    src = torch.zeros(1, 3, h, w)
    src[:, :, h // 2 - 8:h // 2 + 8, w // 2 + 40:w // 2 + 56] = 1.0  # marker to the RIGHT
    rest_x, rest_y = _centroid(_transform_plane(m, _marker(w, h, 16, 16), 0.0, 0.0))
    cx, cy = _centroid(_transform_plane(m, src, 0.0, 0.0, rotation=90.0))
    assert cy - rest_y > 20, f"+90deg should send a right-hand marker DOWN; y moved {cy - rest_y:+.2f}px"
    assert abs(cx - rest_x) <= 4, f"+90deg should leave it near the vertical axis; x {cx - rest_x:+.2f}px"


def test_scale_is_unit_free():
    """Scale is relative, so no space conversion applies: 2x doubles the block."""
    m = _node()
    for (w, h) in ((256, 256), (384, 128)):
        src = _marker(w, h, 32, 32)
        bw, bh = _bbox(_transform_plane(m, src, 0.0, 0.0, scale=2.0))
        assert abs(bw - 64) <= 2 and abs(bh - 64) <= 2, \
            f"canvas {w}x{h}: scale=2 gave {bw}x{bh}, want 64x64"


def _transform_plane(m, src, x_off, y_off, rotation=0.0, scale=1.0):
    """Run `_transform` and return the red plane (h, w) of the warped result."""
    rgb, _alpha = m._transform(src, x_off, y_off, rotation, scale)
    return rgb[0, 0]


if __name__ == "__main__":
    tests = [test_opacity_over_black, test_alpha_over_normal,
             test_mask_polarity_and_fold, test_z_order_respected,
             test_x_offset_moves_a_full_canvas_width_per_unit,
             test_y_offset_moves_a_full_canvas_height_per_unit,
             test_offset_is_independent_of_canvas_aspect,
             test_rotation_is_a_pixel_space_rotation_on_a_wide_canvas,
             test_rotation_handedness_matches_canvas_2d,
             test_scale_is_unit_free]
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
