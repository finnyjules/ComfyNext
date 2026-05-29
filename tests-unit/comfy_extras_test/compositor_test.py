"""Unit tests for the Compositor's z-ordering and per-layer mask folding.

These exercise the pure helpers (`_prep_layer`, `_composite_layers`) rather than
`CompositorNode.execute`, which would drag in the live-preview / server stack.
The interesting new behavior — composite order is by z (not slot), and baked
text/shape layers carry per-pixel alpha via a mask — lives entirely in these
dependency-free functions.
"""
import torch

from comfy_extras.nodes_compositor import _prep_layer, _composite_layers


def _layer(image, *, z=0.0, op=1.0, blend="normal", mask=None,
           x=0.0, y=0.0, rot=0.0, scl=1.0):
    """Build a gathered-layer dict the way execute() does."""
    return {"image": image, "x": x, "y": y, "rot": rot, "scl": scl,
            "op": op, "blend": blend, "z": z, "mask": mask}


def _solid(h, w, rgb):
    """A (1, h, w, 3) image filled with one colour (NHWC, like ComfyUI)."""
    t = torch.zeros(1, h, w, 3)
    t[..., 0], t[..., 1], t[..., 2] = rgb
    return t


# ── _prep_layer: alpha = geometric coverage * opacity * (1 - mask) ───────────

def test_prep_layer_identity_no_mask_is_fully_opaque():
    img = _solid(8, 8, (1.0, 0.0, 0.0))
    rgb, a = _prep_layer(_layer(img), 8, 8)
    # Identity transform at canvas size: rgb unchanged, alpha all ones.
    assert rgb.shape == (1, 3, 8, 8)
    assert torch.allclose(a, torch.ones_like(a), atol=1e-5)
    assert torch.allclose(rgb[:, 0], torch.ones_like(rgb[:, 0]), atol=1e-5)


def test_prep_layer_opacity_scales_alpha():
    img = _solid(8, 8, (1.0, 1.0, 1.0))
    _, a = _prep_layer(_layer(img, op=0.5), 8, 8)
    assert torch.allclose(a, torch.full_like(a, 0.5), atol=1e-5)


def test_prep_layer_mask_is_one_minus_alpha():
    # ComfyUI MASK convention: mask = 1 - alpha. mask=0 → opaque, mask=1 → clear.
    img = _solid(4, 4, (1.0, 1.0, 1.0))
    opaque = torch.zeros(1, 4, 4)   # mask 0 everywhere → fully visible
    clear = torch.ones(1, 4, 4)     # mask 1 everywhere → fully transparent
    _, a_opaque = _prep_layer(_layer(img, mask=opaque), 4, 4)
    _, a_clear = _prep_layer(_layer(img, mask=clear), 4, 4)
    assert torch.allclose(a_opaque, torch.ones_like(a_opaque), atol=1e-5)
    assert torch.allclose(a_clear, torch.zeros_like(a_clear), atol=1e-5)


def test_prep_layer_mask_folds_opacity():
    img = _solid(4, 4, (1.0, 1.0, 1.0))
    half_mask = torch.full((1, 4, 4), 0.5)  # → 1 - 0.5 = 0.5 alpha
    _, a = _prep_layer(_layer(img, op=0.5, mask=half_mask), 4, 4)
    assert torch.allclose(a, torch.full_like(a, 0.25), atol=1e-5)  # 0.5 * 0.5


def test_prep_layer_accepts_2d_and_3d_masks():
    img = _solid(4, 4, (1.0, 1.0, 1.0))
    for mask in (torch.zeros(4, 4), torch.zeros(1, 4, 4)):
        _, a = _prep_layer(_layer(img, mask=mask), 4, 4)
        assert a.shape == (1, 1, 4, 4)
        assert torch.allclose(a, torch.ones_like(a), atol=1e-5)


# ── _composite_layers: order is by z, not slot ──────────────────────────────

def _center_pixel(result):
    return result[0, :, result.shape[2] // 2, result.shape[3] // 2]


def test_composite_default_z_keeps_slot_order():
    red = _solid(8, 8, (1.0, 0.0, 0.0))
    green = _solid(8, 8, (0.0, 1.0, 0.0))
    # Default z = slot index: red (z=1) below, green (z=2) on top → green wins.
    out = _composite_layers([_layer(red, z=1.0), _layer(green, z=2.0)], 8, 8)
    px = _center_pixel(out)
    assert px[1] > 0.9 and px[0] < 0.1


def test_composite_z_overrides_slot_order():
    # Same two layers gathered red-then-green, but z sends green BELOW red.
    red = _solid(8, 8, (1.0, 0.0, 0.0))
    green = _solid(8, 8, (0.0, 1.0, 0.0))
    out = _composite_layers([_layer(red, z=5.0), _layer(green, z=1.0)], 8, 8)
    px = _center_pixel(out)
    assert px[0] > 0.9 and px[1] < 0.1  # red on top now


def test_composite_local_run_interleaves_between_wired_by_z():
    # Mimics a baked text layer (mask) sitting between two wired images.
    bg = _solid(8, 8, (0.0, 0.0, 1.0))      # wired, z=0
    fg = _solid(8, 8, (1.0, 0.0, 0.0))      # wired, z=2
    text = _solid(8, 8, (1.0, 1.0, 1.0))    # baked local, z=1, opaque mask
    opaque = torch.zeros(1, 8, 8)
    out = _composite_layers([
        _layer(bg, z=0.0),
        _layer(fg, z=2.0),
        _layer(text, z=1.0, mask=opaque),
    ], 8, 8)
    # fg has the highest z, so the red foreground is what shows on top.
    px = _center_pixel(out)
    assert px[0] > 0.9 and px[1] < 0.1 and px[2] < 0.1


def test_composite_masked_layer_lets_lower_layer_show_through():
    bg = _solid(4, 4, (0.0, 0.0, 1.0))
    top = _solid(4, 4, (1.0, 0.0, 0.0))
    clear = torch.ones(1, 4, 4)  # fully transparent top → bg shows
    out = _composite_layers([_layer(bg, z=0.0), _layer(top, z=1.0, mask=clear)], 4, 4)
    px = _center_pixel(out)
    assert px[2] > 0.9 and px[0] < 0.1


def test_composite_empty_returns_black():
    out = _composite_layers([], 6, 6)
    assert out.shape == (1, 3, 6, 6)
    assert torch.allclose(out, torch.zeros_like(out))


# ── channel normalization: layers may arrive as RGBA / grayscale ─────────────

def test_prep_layer_rgba_folds_embedded_alpha_into_coverage():
    # A 4-channel (RGBA) layer: opaque centre box, transparent elsewhere. The
    # 4th channel must fold into coverage, not collide with the 3ch composite.
    img = torch.zeros(1, 8, 8, 4)
    img[..., 0] = 1.0              # red
    img[0, 2:6, 2:6, 3] = 1.0      # alpha box (NHWC)
    rgb, a = _prep_layer(_layer(img), 8, 8)
    assert rgb.shape == (1, 3, 8, 8)
    assert a.shape == (1, 1, 8, 8)
    assert a[0, 0, 4, 4] > 0.9     # inside alpha box → opaque
    assert a[0, 0, 0, 0] < 0.1     # outside → transparent


def test_composite_rgba_over_rgb_does_not_crash_and_alpha_wins():
    # Regression: mixing a 4ch RGBA layer with a 3ch RGB composite used to throw
    # "tensor a (4) must match tensor b (3)". Now RGBA coerces to RGB + alpha.
    blue = _solid(8, 8, (0.0, 0.0, 1.0))   # wired RGB, bottom
    rgba = torch.zeros(1, 8, 8, 4)
    rgba[..., 0] = 1.0
    rgba[0, 2:6, 2:6, 3] = 1.0             # red, opaque only in centre box
    out = _composite_layers([_layer(blue, z=1.0), _layer(rgba, z=2.0)], 8, 8)
    assert out.shape == (1, 3, 8, 8)
    assert out[0, 0, 4, 4] > 0.9 and out[0, 2, 4, 4] < 0.1   # centre red
    assert out[0, 2, 0, 0] > 0.9 and out[0, 0, 0, 0] < 0.1   # corner blue


def test_prep_layer_grayscale_expands_to_rgb():
    gray = torch.full((1, 8, 8, 1), 0.5)
    rgb, a = _prep_layer(_layer(gray), 8, 8)
    assert rgb.shape == (1, 3, 8, 8)
    assert torch.allclose(rgb, torch.full_like(rgb, 0.5), atol=1e-5)
