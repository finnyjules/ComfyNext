from __future__ import annotations

"""Pure-torch lens / depth-of-field render math. No model, network or file IO —
unit-testable. Tensors are Comfy IMAGE layout [1,H,W,3] (or [H,W,3]); depth and
CoC are [H,W].
"""

import math

import torch
import torch.nn.functional as F

_SQRT3_2 = math.sqrt(3) / 2.0          # sin(60°): hexagon flat-top half-plane slope
_ANAMORPHIC_STRETCH = 1.8              # anamorphic bokeh horizontal:vertical stretch


def _to_bchw(img: torch.Tensor) -> torch.Tensor:
    # Processes only the first image of a batch (Comfy nodes loop over batch externally).
    if img.ndim == 4:
        img = img[0]
    return img.permute(2, 0, 1).unsqueeze(0).float()


def _to_hwc(bchw: torch.Tensor) -> torch.Tensor:
    return bchw.squeeze(0).permute(1, 2, 0).unsqueeze(0)


def circle_of_confusion(depth: torch.Tensor, focus: float, aperture: float,
                        max_radius: float = 24.0) -> torch.Tensor:
    """Per-pixel blur radius in pixels. 0 at the focus plane, growing with
    |depth-focus| and aperture. depth/focus in [0,1]; aperture in [0,1]."""
    return (depth - float(focus)).abs() * float(aperture) * float(max_radius)


def bokeh_kernel(shape: str, radius: float) -> torch.Tensor:
    """Normalized 2D kernel of the given lens shape."""
    r = max(1, int(round(radius)))
    size = 2 * r + 1
    ax = torch.arange(size).float() - r
    yy, xx = torch.meshgrid(ax, ax, indexing="ij")
    if shape == "anamorphic":
        mask = ((xx / _ANAMORPHIC_STRETCH) ** 2 + (yy * _ANAMORPHIC_STRETCH) ** 2) <= (r * r)
    elif shape == "hexagonal":
        ax_ = xx.abs()
        ay_ = yy.abs()
        # Flat-top hex; corners clip to the square kernel bounds at large radii (perceptually fine).
        mask = (ay_ <= r) & (ax_ * _SQRT3_2 + ay_ * 0.5 <= r)
    else:  # circular
        mask = (xx * xx + yy * yy) <= (r * r)
    k = mask.float()
    s = k.sum()
    return k / s if float(s) > 0 else k


def _blur(bchw: torch.Tensor, shape: str, radius: float) -> torch.Tensor:
    if radius < 0.5:
        return bchw
    k = bokeh_kernel(shape, radius).to(bchw.device, bchw.dtype)
    k = k.view(1, 1, *k.shape).repeat(bchw.shape[1], 1, 1, 1)
    pad = k.shape[-1] // 2
    return F.conv2d(F.pad(bchw, (pad, pad, pad, pad), mode="reflect"), k, groups=bchw.shape[1])


def render_dof(image: torch.Tensor, coc: torch.Tensor, *,
               bokeh_shape: str = "circular", highlight_bokeh: float = 0.0,
               levels: int = 5) -> torch.Tensor:
    """Depth-of-field via a CoC-keyed blur pyramid: blur the image at `levels`
    increasing radii, then blend per-pixel by each pixel's CoC. Bright pixels are
    boosted before blurring so out-of-focus highlights bloom into bokeh discs."""
    bchw = _to_bchw(image)
    if highlight_bokeh > 0:
        lum = bchw.mean(1, keepdim=True).clamp(0, 1)
        bchw_src = bchw * (1.0 + float(highlight_bokeh) * (lum ** 3) * 3.0)
    else:
        bchw_src = bchw

    max_r = float(coc.max()) if coc.numel() else 0.0
    if max_r < 0.5:
        return _to_hwc(bchw).clamp(0, 1)

    if levels < 2:
        return _to_hwc(_blur(bchw_src, bokeh_shape, max_r)).clamp(0, 1)

    radii = [max_r * i / (levels - 1) for i in range(levels)]
    # pyr[0] is the sharp, UN-boosted image; only the out-of-focus layers get the
    # highlight bloom, so in-focus highlights are not brightened.
    pyr = [_blur(bchw if i == 0 else bchw_src, bokeh_shape, r) for i, r in enumerate(radii)]

    cf = (coc / max_r) * (levels - 1)                        # [H,W] in [0, levels-1]
    out = torch.zeros_like(bchw)
    for i in range(levels):
        w_i = (1.0 - (cf - i).abs()).clamp(0, 1)             # tent weight at level i
        out = out + pyr[i] * w_i.view(1, 1, *w_i.shape)
    return _to_hwc(out).clamp(0, 1)


def chromatic_aberration(image: torch.Tensor, amount: float) -> torch.Tensor:
    """Radial per-channel scale: red samples slightly outward, blue inward."""
    if amount <= 0:
        return image
    bchw = _to_bchw(image)
    _, c, h, w = bchw.shape
    ys = torch.linspace(-1, 1, h)
    xs = torch.linspace(-1, 1, w)
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    base = torch.stack((gx, gy), dim=-1).unsqueeze(0)       # [1,H,W,2]
    a = float(amount) * 0.03
    out = bchw.clone()
    for ch, scale in ((0, 1.0 + a), (2, 1.0 - a)):           # R out, B in
        grid = base * scale
        sampled = F.grid_sample(bchw[:, ch:ch + 1], grid, mode="bilinear",
                                padding_mode="border", align_corners=True)
        out[:, ch:ch + 1] = sampled
    return _to_hwc(out).clamp(0, 1)


def vignette(image: torch.Tensor, amount: float) -> torch.Tensor:
    """Radial edge darkening. amount in [0,1]; 0 = no-op."""
    if amount <= 0:
        return image
    bchw = _to_bchw(image)
    _, _, h, w = bchw.shape
    ys = torch.linspace(-1, 1, h)
    xs = torch.linspace(-1, 1, w)
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    r = (gx * gx + gy * gy).sqrt().clamp(0, 1)
    mask = 1.0 - float(amount) * (r ** 2)
    out = bchw * mask.view(1, 1, h, w)
    return _to_hwc(out).clamp(0, 1)


def focal_compression(image: torch.Tensor, depth: torch.Tensor, focal_length: float,
                      center=(0.5, 0.5)) -> torch.Tensor:
    """Depth-scaled resample that reads as wide↔telephoto compression. Positive
    focal_length pulls far (low-depth) pixels toward the center (telephoto);
    negative pushes them out (wide). 0 = identity. No disocclusion holes —
    this is a believable look, not a true reprojection."""
    if abs(focal_length) < 1e-6:
        return image
    bchw = _to_bchw(image)
    _, _, h, w = bchw.shape
    ys = torch.linspace(-1, 1, h)
    xs = torch.linspace(-1, 1, w)
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    cx = (float(center[0]) * 2 - 1)
    cy = (float(center[1]) * 2 - 1)
    far = (1.0 - depth).clamp(0, 1)                         # 1 = farthest
    k = 1.0 - float(focal_length) * 0.25 * far              # per-pixel zoom factor
    sx = (gx - cx) * k + cx
    sy = (gy - cy) * k + cy
    grid = torch.stack((sx, sy), dim=-1).unsqueeze(0)
    out = F.grid_sample(bchw, grid, mode="bilinear", padding_mode="border", align_corners=True)
    return _to_hwc(out).clamp(0, 1)


# Character-param defaults (NOT focus/aperture — those are always user-driven).
DEFAULT_PARAMS: dict = {
    "bokeh_shape": "circular",
    "highlight_bokeh": 0.3,
    "chromatic_aberration": 0.0,
    "vignette": 0.0,
    "focal_length": 0.0,
}

# Presets override a subset of the character params. "Custom" = no overrides.
LENS_PRESETS: dict[str, dict] = {
    "Custom": {},
    "85mm Portrait": {"bokeh_shape": "circular", "highlight_bokeh": 0.6, "vignette": 0.25, "focal_length": 0.6},
    "Vintage Swirly": {"bokeh_shape": "circular", "highlight_bokeh": 0.5, "chromatic_aberration": 0.4, "vignette": 0.5},
    "Anamorphic": {"bokeh_shape": "anamorphic", "highlight_bokeh": 0.7, "chromatic_aberration": 0.2, "focal_length": 0.3},
    "Clean": {"bokeh_shape": "hexagonal", "highlight_bokeh": 0.2, "chromatic_aberration": 0.0, "vignette": 0.0},
}

PRESETS = list(LENS_PRESETS.keys())


def resolve_params(preset: str, overrides: dict) -> dict:
    """DEFAULT_PARAMS < preset < explicit overrides (only keys present in overrides)."""
    out = {**DEFAULT_PARAMS, **LENS_PRESETS.get(preset, {})}
    out.update({k: v for k, v in overrides.items() if k in DEFAULT_PARAMS})
    return out
