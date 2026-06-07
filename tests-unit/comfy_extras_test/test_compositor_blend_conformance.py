"""
Compositor blend-mode conformance gate.

The Compositor renders in TWO engines that MUST produce identical pixels:

  * the canvas preview — the browser <canvas> `globalCompositeOperation`, i.e.
    what the user SEES while composing (`useCompositorLayers.ts`); and
  * the torch backend — `comfy_extras/nodes_compositor.py:_blend`, i.e. what the
    generation graph actually GETS at bake/render time.

If those two diverge, preview != output and WYSIWYG silently breaks (a shadow or
blend that looks one way in the editor and another after you run it). That loss
of trust is the single biggest risk for a Figma-grade compositor.

This test compares every backend blend mode, across a full backdrop x source
grid, against the W3C / CSS Compositing & Blending spec formulas — which are
exactly what Chromium's Skia <canvas> implements. Anything above rounding is a
visible drift. Every new blend mode / effect that touches the composite must keep
this green.

Run directly for a readable report:   python tests-unit/comfy_extras_test/test_compositor_blend_conformance.py
Or under pytest:                       pytest tests-unit/comfy_extras_test/test_compositor_blend_conformance.py
"""
import importlib.util
import os
import sys

import torch

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOLERANCE = 0.6 / 255.0  # ~quantisation rounding; anything larger is visible

# Modes the backend exposes (see _BLEND in nodes_compositor.py). "add" maps to
# the canvas `lighter` op (additive, display-clamped).
MODES = [
    "normal", "multiply", "screen", "overlay", "soft_light",
    "hard_light", "difference", "lighten", "darken", "add",
]


def backend_blend():
    """Import the REAL `_blend` from the node, so a regression in it fails here."""
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_compositor",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_compositor.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._blend


def canvas_reference(a: torch.Tensor, b: torch.Tensor, mode: str) -> torch.Tensor:
    """Ground truth: W3C/CSS compositing spec == Chromium <canvas> blend output.
    `a` = backdrop (destination), `b` = source (top), both in [0, 1].
    """
    if mode == "normal":
        return b
    if mode == "multiply":
        return a * b
    if mode == "screen":
        return a + b - a * b
    if mode == "overlay":
        return torch.where(a <= 0.5, 2 * a * b, 1 - 2 * (1 - a) * (1 - b))
    if mode == "hard_light":
        return torch.where(b <= 0.5, 2 * a * b, 1 - 2 * (1 - a) * (1 - b))
    if mode == "soft_light":
        d = torch.where(a <= 0.25, ((16 * a - 12) * a + 4) * a, torch.sqrt(a))
        return torch.where(b <= 0.5, a - (1 - 2 * b) * a * (1 - a), a + (2 * b - 1) * (d - a))
    if mode == "difference":
        return (a - b).abs()
    if mode == "lighten":
        return torch.maximum(a, b)
    if mode == "darken":
        return torch.minimum(a, b)
    if mode == "add":  # canvas "lighter"
        return (a + b).clamp(0.0, 1.0)
    raise ValueError(f"unknown mode {mode}")


def _grid():
    g = torch.linspace(0.0, 1.0, steps=51)
    a, b = torch.meshgrid(g, g, indexing="ij")
    return a, b


def max_drift(mode: str) -> float:
    """Max per-pixel absolute difference (0..1) between backend and canvas."""
    blend = backend_blend()
    a, b = _grid()
    out = blend(a.clone(), b.clone(), mode)
    ref = canvas_reference(a.clone(), b.clone(), mode)
    return (out - ref).abs().max().item()


def test_blend_modes_match_canvas():
    failures = []
    for mode in MODES:
        drift = max_drift(mode)
        if drift > TOLERANCE:
            failures.append(f"{mode}: max drift {drift * 255:.1f}/255")
    assert not failures, (
        "Backend Compositor blend differs from the canvas preview "
        "(generation output will NOT match what the user composed):\n  "
        + "\n  ".join(failures)
    )


if __name__ == "__main__":
    print(f"{'mode':<12}{'max drift /255':>16}   verdict")
    print("-" * 46)
    ok = True
    for mode in MODES:
        d = max_drift(mode) * 255
        passed = d < 0.6
        ok = ok and passed
        print(f"{mode:<12}{d:>16.1f}   {'match' if passed else 'DRIFT  <-- preview != output'}")
    print("\nPASS" if ok else "\nFAIL")
    raise SystemExit(0 if ok else 1)
