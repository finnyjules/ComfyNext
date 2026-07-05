"""Shared helpers for the hex/JSON-driven Duotone + Gradient Map nodes.

Pure and unit-testable (see tests-unit/comfy_extras_test/gradient_map_test.py):
parse the widget's JSON payload, build a 256-entry colour LUT, and remap an
image's luminance through it. No ComfyUI runtime needed.
"""
from __future__ import annotations

import json

import torch

# Luma weights match the studio shaders (ITU-R BT.709).
_LW = (0.2126, 0.7152, 0.0722)

DEFAULT_STOPS = [(0.0, (0.05, 0.05, 0.20)), (1.0, (1.00, 0.90, 0.50))]
DEFAULT_DUOTONE = ("#1a1a2e", "#f5f5f5")


def luma(x: torch.Tensor) -> torch.Tensor:
    """[B,H,W,3] → [B,H,W,1] luminance."""
    return _LW[0] * x[..., 0:1] + _LW[1] * x[..., 1:2] + _LW[2] * x[..., 2:3]


def hex_to_rgb(h, fallback=(0.0, 0.0, 0.0)):
    """'#rrggbb' / 'rgb' → (r,g,b) floats in [0,1]; `fallback` on anything invalid."""
    s = str(h).strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except ValueError:
        return fallback


def _coerce(raw):
    """JSON string → parsed value; passthrough for already-parsed lists/dicts."""
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None
    return raw


def parse_stops(raw):
    """JSON string or list of {pos, color} → sorted [(pos, (r,g,b)), …].

    Falls back to a sensible 2-stop ramp on empty / malformed input.
    """
    data = _coerce(raw)
    if not isinstance(data, (list, tuple)) or len(data) == 0:
        return list(DEFAULT_STOPS)
    out = []
    for s in data:
        try:
            pos = float(s["pos"])
            rgb = hex_to_rgb(s["color"], None)
        except (KeyError, TypeError, ValueError):
            continue
        if rgb is None:
            continue
        out.append((min(1.0, max(0.0, pos)), rgb))
    if not out:
        return list(DEFAULT_STOPS)
    out.sort(key=lambda p: p[0])
    return out


def parse_duotone(raw):
    """JSON string or dict {shadow, highlight} → (shadow_hex, highlight_hex)."""
    data = _coerce(raw)
    if isinstance(data, dict):
        return (str(data.get("shadow", DEFAULT_DUOTONE[0])),
                str(data.get("highlight", DEFAULT_DUOTONE[1])))
    return DEFAULT_DUOTONE


def gradient_lut(stops, n=256, device=None, dtype=torch.float32):
    """Build an [n,3] LUT by linear interpolation between pos-sorted stops."""
    stops = list(stops)
    if len(stops) == 1:
        # Degenerate ramp: repeat the single colour across the whole range.
        stops = [(0.0, stops[0][1]), (1.0, stops[0][1])]
    xs = torch.linspace(0.0, 1.0, n, device=device, dtype=dtype)
    pos = torch.tensor([p for p, _ in stops], device=device, dtype=dtype)
    cols = torch.tensor([c for _, c in stops], device=device, dtype=dtype)  # [k,3]
    upper = torch.bucketize(xs, pos, right=True).clamp(1, len(stops) - 1)
    lo = upper - 1
    p0, p1 = pos[lo], pos[upper]
    f = ((xs - p0) / (p1 - p0).clamp_min(1e-6)).clamp(0.0, 1.0).unsqueeze(-1)
    lut = cols[lo] * (1.0 - f) + cols[upper] * f  # [n,3]
    # Flat-hold outside the first/last stop.
    xsu = xs.unsqueeze(-1)
    lut = torch.where(xsu <= pos[0], cols[0].expand_as(lut), lut)
    lut = torch.where(xsu >= pos[-1], cols[-1].expand_as(lut), lut)
    return lut


def apply_gradient_map(image, raw_stops, mix):
    """Remap `image` luminance through the stops ramp, blended by `mix`."""
    lut = gradient_lut(parse_stops(raw_stops), 256, device=image.device, dtype=image.dtype)
    lu = luma(image).clamp(0.0, 1.0)
    idx = (lu[..., 0] * 255.0).round().long().clamp(0, 255)  # [B,H,W]
    mapped = lut[idx]  # [B,H,W,3]
    return (image * (1.0 - mix) + mapped * mix).clamp(0.0, 1.0)


def apply_duotone(image, raw):
    """Map `image` luminance across a shadow→highlight hex pair."""
    sh, hi = parse_duotone(raw)
    c0 = torch.tensor(hex_to_rgb(sh, (0.1, 0.1, 0.3)), device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
    c1 = torch.tensor(hex_to_rgb(hi, (1.0, 0.8, 0.4)), device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
    lu = luma(image).clamp(0.0, 1.0)
    return (c0 * (1.0 - lu) + c1 * lu).clamp(0.0, 1.0)
