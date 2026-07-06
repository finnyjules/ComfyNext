"""Turntable instruction text. Dependency-light (no torch/comfy_api/network) so
it is unit-testable in CI (mirrors comfy_extras/_swap_product_prompts.py)."""
from __future__ import annotations

_SPIN = (
    "The product makes a smooth, continuous full 360° turntable spin to the "
    "{direction}; camera fixed; consistent lighting and background; seamless loop."
)
_SEG = (
    "Smooth turntable rotation {degrees}° to the {direction}: the product turns "
    "cleanly with no morphing or warping; camera fixed; consistent lighting and "
    "background."
)


def _append(base: str, instructions: str) -> str:
    extra = (instructions or "").strip()
    return f"{base} Additional direction: {extra}." if extra else base


def simple_spin_instruction(direction: str, instructions: str = "") -> str:
    return _append(_SPIN.format(direction=direction), instructions)


def segment_instruction(degrees: int, direction: str, instructions: str = "") -> str:
    return _append(_SEG.format(degrees=int(degrees), direction=direction), instructions)
