from __future__ import annotations

"""Pure-torch lens / depth-of-field render math. No model, network or file IO —
unit-testable. Tensors are Comfy IMAGE layout [1,H,W,3] (or [H,W,3]); depth and
CoC are [H,W].
"""

import torch
import torch.nn.functional as F


def _to_bchw(img: torch.Tensor) -> torch.Tensor:
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
        mask = ((xx / 1.8) ** 2 + (yy * 1.8) ** 2) <= (r * r)
    elif shape == "hexagonal":
        ax_ = xx.abs()
        ay_ = yy.abs()
        mask = (ay_ <= r) & (ax_ * 0.8660254 + ay_ * 0.5 <= r)
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

    radii = [max_r * i / (levels - 1) for i in range(levels)]
    pyr = [_blur(bchw_src, bokeh_shape, r) for r in radii]   # pyr[0] = sharp

    cf = (coc / max_r) * (levels - 1)                        # [H,W] in [0, levels-1]
    out = torch.zeros_like(bchw)
    for i in range(levels):
        w_i = (1.0 - (cf - i).abs()).clamp(0, 1)             # tent weight at level i
        out = out + pyr[i] * w_i.view(1, 1, *w_i.shape)
    return _to_hwc(out).clamp(0, 1)
