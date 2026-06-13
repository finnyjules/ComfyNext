# Virtual Lens / Depth of Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local `LensBlur` node that estimates a depth map (Depth Anything V2 Small, downloaded on first use) and renders a tweakable depth-based depth-of-field look — tap-to-focus, aperture, bokeh shape/highlights, chromatic aberration, vignette, lens presets, and a focal-length compression look.

**Architecture:** Three Python units — `_depth.py` (model bundle + cached `estimate_depth`), `_lens.py` (pure-torch render math, unit-tested), `nodes_lens.py` (the node) — plus frontend wiring (tap-to-focus reusing the MaskExtractor preview-click pattern, live-preview auto-rerun, toolbox card with model download). Depth is cached per-image so lens-param tweaks never re-estimate.

**Tech Stack:** Python (ComfyUI `comfy_api.latest.IO`, PyTorch, `transformers` Depth Anything V2), the repo's `_model_downloads` bundle system, Vue 3 + TypeScript, pytest.

---

## File Structure

**Create:**
- `comfy_extras/_depth.py` — registers the `'depth'` model bundle; lazy Depth Anything V2 loader; `estimate_depth(image)` with a per-image cache.
- `comfy_extras/_lens.py` — pure-torch render math: `circle_of_confusion`, `bokeh_kernel`, `render_dof`, `chromatic_aberration`, `vignette`, `focal_compression`, `LENS_PRESETS`/`DEFAULT_PARAMS`/`resolve_params`.
- `comfy_extras/nodes_lens.py` — `LensBlurNode`.
- `tests-unit/comfy_extras_test/depth_test.py`, `tests-unit/comfy_extras_test/lens_test.py`.

**Modify:**
- `nodes.py` — add `"nodes_lens.py"` to the comfy_extras load list.
- `frontend/app/components/vue-canvas/ComfyNode.vue` — extend tap-to-focus + focus-marker overlay to `LensBlur`; add `LensBlur` to `LIVE_PREVIEW_NODES`.
- `frontend/app/data/toolbox-items.ts` — add `'depth'` to `ModelBundleKey`; add the Lens card with `requiresModels: 'depth'`.
- `frontend/app/composables/useModelDownloads.ts` — add `'depth'` to `ALL_MODEL_BUNDLES`.

**Why this split:** depth and lens math are independent, testable units with no I/O coupling (mirrors `_person_swap_prompts.py`/`_live_preview.py` style); the node wires them together; frontend changes are localized reuse of existing patterns.

---

## Task 1: Depth foundation (`_depth.py`)

**Files:**
- Create: `comfy_extras/_depth.py`
- Test: `tests-unit/comfy_extras_test/depth_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/depth_test.py`:

```python
"""Unit tests for comfy_extras._depth.

The real Depth Anything V2 model is never loaded here — `_get_depth_model` is
monkeypatched with a fake so we can test normalization, shape, and the
per-image cache without a download or GPU.
"""
import torch

from comfy_extras import _depth


class _FakeModel:
    """Returns a horizontal ramp as 'depth' so we can assert normalization."""
    def __init__(self):
        self.calls = 0

    def infer(self, h, w):
        self.calls += 1
        # raw values 100..200 across width — must be normalized to [0,1]
        row = torch.linspace(100.0, 200.0, w)
        return row.unsqueeze(0).repeat(h, 1)


def _patch(monkeypatch):
    fake = _FakeModel()
    monkeypatch.setattr(_depth, "_run_model", lambda img: fake.infer(img.shape[-3], img.shape[-2]))
    _depth._DEPTH_CACHE.clear()
    return fake


def test_estimate_depth_shape_and_range(monkeypatch):
    _patch(monkeypatch)
    img = torch.rand(1, 12, 16, 3)
    d = _depth.estimate_depth(img)
    assert d.shape == (12, 16)
    assert float(d.min()) >= 0.0 and float(d.max()) <= 1.0
    # normalization spans the full range
    assert float(d.max()) == 1.0 and float(d.min()) == 0.0


def test_estimate_depth_caches_per_image(monkeypatch):
    fake = _patch(monkeypatch)
    img = torch.rand(1, 8, 8, 3)
    _depth.estimate_depth(img)
    _depth.estimate_depth(img)  # identical image → cache hit, model not re-run
    assert fake.calls == 1


def test_estimate_depth_recomputes_for_different_image(monkeypatch):
    fake = _patch(monkeypatch)
    _depth.estimate_depth(torch.zeros(1, 8, 8, 3))
    _depth.estimate_depth(torch.ones(1, 8, 8, 3))
    assert fake.calls == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/depth_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._depth'`.

- [ ] **Step 3: Write `comfy_extras/_depth.py`**

```python
from __future__ import annotations

"""Depth estimation (Depth Anything V2 Small) shared by the Lens and the future
Reframe nodes. The model downloads on first use via the `_model_downloads`
bundle system (library-managed Hugging Face cache, like the Whisper bundle).

estimate_depth() returns a single-channel [H,W] map in [0,1] (1.0 = nearest,
0.0 = farthest) and caches by a cheap image signature so changing lens params
never re-estimates depth.
"""

import os

import torch
import torch.nn.functional as F

from comfy_extras._model_downloads import ModelBundle, loader_cache, register_bundle

_HF_REPO = "depth-anything/Depth-Anything-V2-Small-hf"
_HF_HUB_CACHE = os.path.expanduser("~/.cache/huggingface/hub")
_CACHE_DIRNAME = "models--depth-anything--Depth-Anything-V2-Small-hf"


def _depth_ready() -> bool:
    """True iff the HF snapshot for the depth model is on disk."""
    root = os.path.join(_HF_HUB_CACHE, _CACHE_DIRNAME, "snapshots")
    if not os.path.isdir(root):
        return False
    for rev in os.listdir(root):
        rev_dir = os.path.join(root, rev)
        if any(f.endswith((".safetensors", ".bin")) for f in os.listdir(rev_dir)):
            return True
    return False


def _prepare_depth() -> None:
    """Force-download the depth model into the HF cache (runs at toolbox click)."""
    _get_depth_model()


register_bundle(ModelBundle(
    key="depth",
    label="Depth (Lens)",
    files=[],                       # library-managed HF download — see ready_check_fn
    prepare_fn=_prepare_depth,
    ready_check_fn=_depth_ready,
))


def _device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _get_depth_model():
    cache = loader_cache()
    if "depth:model" in cache:
        return cache["depth:model"]
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    proc = AutoImageProcessor.from_pretrained(_HF_REPO)
    model = AutoModelForDepthEstimation.from_pretrained(_HF_REPO).eval().to(_device())
    cache["depth:model"] = (proc, model)
    return cache["depth:model"]


def _run_model(image: torch.Tensor) -> torch.Tensor:
    """Run Depth Anything on a [1,H,W,3] (or [H,W,3]) image → raw [H,W] depth."""
    from PIL import Image as PILImage
    import numpy as np

    img = image[0] if image.ndim == 4 else image
    h, w, _ = img.shape
    arr = (img.detach().cpu().numpy() * 255.0).clip(0, 255).astype("uint8")
    pil = PILImage.fromarray(arr)
    proc, model = _get_depth_model()
    inputs = proc(images=pil, return_tensors="pt").to(_device())
    with torch.no_grad():
        predicted = model(**inputs).predicted_depth  # [1, h', w']
    depth = F.interpolate(predicted.unsqueeze(1), size=(h, w), mode="bicubic", align_corners=False)
    return depth.squeeze(0).squeeze(0).detach().float().cpu()


# Per-image cache: signature -> normalized [H,W] depth. Bounded to recent images.
_DEPTH_CACHE: dict = {}
_CACHE_MAX = 6


def _signature(image: torch.Tensor) -> tuple:
    """Cheap content signature: shape + a coarse downsample digest."""
    img = image[0] if image.ndim == 4 else image
    small = F.interpolate(
        img.permute(2, 0, 1).unsqueeze(0), size=(16, 16), mode="area"
    )
    q = (small.reshape(-1) * 255.0).round().to(torch.int16)
    return (tuple(img.shape), hash(tuple(q.tolist())))


def estimate_depth(image: torch.Tensor) -> torch.Tensor:
    """Return a normalized [H,W] depth map in [0,1] (1.0 = nearest). Cached per image."""
    sig = _signature(image)
    if sig in _DEPTH_CACHE:
        return _DEPTH_CACHE[sig]
    raw = _run_model(image)
    lo = float(raw.min())
    hi = float(raw.max())
    norm = (raw - lo) / (hi - lo) if hi > lo else torch.zeros_like(raw)
    if len(_DEPTH_CACHE) >= _CACHE_MAX:
        _DEPTH_CACHE.pop(next(iter(_DEPTH_CACHE)))
    _DEPTH_CACHE[sig] = norm
    return norm
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/depth_test.py -v`
Expected: PASS (3 passed). (The tests monkeypatch `_run_model`, so no model loads.)

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_depth.py tests-unit/comfy_extras_test/depth_test.py
git commit -m "feat(lens): depth foundation — Depth Anything V2 bundle + cached estimate_depth

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Lens math — DoF core (`_lens.py` part 1)

**Files:**
- Create: `comfy_extras/_lens.py`
- Test: `tests-unit/comfy_extras_test/lens_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/lens_test.py`:

```python
"""Unit tests for comfy_extras._lens (pure-torch render math; no model/IO)."""
import torch

from comfy_extras import _lens


def test_coc_zero_at_focus_and_monotonic():
    depth = torch.tensor([[0.0, 0.25, 0.5, 0.75, 1.0]])
    coc = _lens.circle_of_confusion(depth, focus=0.5, aperture=0.5)
    assert float(coc[0, 2]) == 0.0                      # at the focus plane → sharp
    assert coc[0, 0] > 0 and coc[0, 4] > 0              # far from focus → blurred
    assert coc[0, 0] >= coc[0, 1]                       # monotonic with distance


def test_coc_grows_with_aperture():
    depth = torch.zeros(1, 1)
    small = _lens.circle_of_confusion(depth, focus=1.0, aperture=0.2)
    big = _lens.circle_of_confusion(depth, focus=1.0, aperture=0.9)
    assert float(big[0, 0]) > float(small[0, 0])


def test_bokeh_kernel_normalized_and_shaped():
    k = _lens.bokeh_kernel("circular", 4)
    assert abs(float(k.sum()) - 1.0) < 1e-5            # normalized
    ana = _lens.bokeh_kernel("anamorphic", 6)
    # anamorphic spreads wider horizontally than vertically
    assert (ana.sum(0) > 0).sum() > (ana.sum(1) > 0).sum()


def test_render_dof_focused_is_sharp():
    img = torch.rand(1, 16, 16, 3)
    coc = torch.zeros(16, 16)                           # everything in focus
    out = _lens.render_dof(img, coc, bokeh_shape="circular", highlight_bokeh=0.0)
    assert torch.allclose(out, img, atol=1e-4)


def test_render_dof_blurs_when_out_of_focus():
    img = torch.rand(1, 32, 32, 3)
    coc = torch.full((32, 32), 6.0)                     # everything heavily blurred
    out = _lens.render_dof(img, coc, bokeh_shape="circular", highlight_bokeh=0.0)
    # local variance drops when blurred
    assert out.var().item() < img.var().item()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/lens_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._lens'`.

- [ ] **Step 3: Write `comfy_extras/_lens.py` (DoF core)**

```python
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
        mask = ((xx / 1.8) ** 2 + yy ** 2) <= (r * r)
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/lens_test.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_lens.py tests-unit/comfy_extras_test/lens_test.py
git commit -m "feat(lens): DoF core — circle of confusion, bokeh kernels, blur-pyramid render

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lens math — effects & presets (`_lens.py` part 2)

**Files:**
- Modify: `comfy_extras/_lens.py`
- Test: `tests-unit/comfy_extras_test/lens_test.py`

- [ ] **Step 1: Add failing tests**

Append to `tests-unit/comfy_extras_test/lens_test.py`:

```python
def test_chromatic_aberration_identity_at_zero():
    img = torch.rand(1, 12, 12, 3)
    assert torch.allclose(_lens.chromatic_aberration(img, 0.0), img, atol=1e-6)


def test_chromatic_aberration_shifts_channels():
    img = torch.rand(1, 16, 16, 3)
    out = _lens.chromatic_aberration(img, 0.5)
    assert not torch.allclose(out, img, atol=1e-4)


def test_vignette_darkens_corners():
    img = torch.ones(1, 21, 21, 3)
    out = _lens.vignette(img, 0.8)
    center = float(out[0, 10, 10].mean())
    corner = float(out[0, 0, 0].mean())
    assert corner < center
    assert torch.allclose(_lens.vignette(img, 0.0), img, atol=1e-6)


def test_focal_compression_identity_at_zero():
    img = torch.rand(1, 16, 16, 3)
    depth = torch.rand(16, 16)
    assert torch.allclose(_lens.focal_compression(img, depth, 0.0), img, atol=1e-5)


def test_resolve_params_preset_then_overrides():
    base = _lens.resolve_params("Custom", {})
    assert base["bokeh_shape"] == _lens.DEFAULT_PARAMS["bokeh_shape"]
    portrait = _lens.resolve_params("85mm Portrait", {})
    assert portrait == {**_lens.DEFAULT_PARAMS, **_lens.LENS_PRESETS["85mm Portrait"]}
    overridden = _lens.resolve_params("85mm Portrait", {"vignette": 0.9})
    assert overridden["vignette"] == 0.9
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/lens_test.py -v`
Expected: the 5 new tests FAIL with `AttributeError` (functions/dicts not defined yet); the original 5 still pass.

- [ ] **Step 3: Append to `comfy_extras/_lens.py`**

```python
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
```

- [ ] **Step 4: Run all lens tests**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/lens_test.py -v`
Expected: PASS (10 passed).

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_lens.py tests-unit/comfy_extras_test/lens_test.py
git commit -m "feat(lens): chromatic aberration, vignette, focal compression + presets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The LensBlur node (`nodes_lens.py`) + registration

**Files:**
- Create: `comfy_extras/nodes_lens.py`
- Modify: `nodes.py` (comfy_extras load list)

- [ ] **Step 1: Write `comfy_extras/nodes_lens.py`**

```python
from __future__ import annotations

"""Lens · Depth of Field — local depth-based DoF / virtual lens.

Estimates depth once (Depth Anything V2, cached), then renders a tweakable
shallow-focus look: tap-to-focus (the `focus_point` String widget is written by
the preview click, like MaskExtractor's `points`), aperture, bokeh shape +
highlights, chromatic aberration, vignette, lens presets, and a focal-length
compression look. Live-preview effect (type:"temp"); export via a downstream
Image node.
"""

import json

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._depth import estimate_depth
from comfy_extras import _lens


class LensBlurNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LensBlur",
            display_name="Lens · Depth of Field",
            description=(
                "Depth-based depth of field. Click the preview to focus, then set "
                "aperture and lens character. Estimates depth locally (Depth Anything "
                "V2) — downloads ~100 MB on first use."
            ),
            category="image/lens",
            inputs=[
                IO.Image.Input("image", tooltip="The image to apply the lens to."),
                IO.Image.Input("depth", optional=True,
                               tooltip="Optional: wire a depth map to override auto-estimation."),
                IO.String.Input("focus_point", default='{"x":0.5,"y":0.5}',
                                tooltip="Click the preview to focus. Managed by the UI."),
                IO.Float.Input("focus_offset", default=0.0, min=-1.0, max=1.0, step=0.01,
                               tooltip="Pull focus nearer/farther from the tapped point."),
                IO.Float.Input("aperture", default=0.4, min=0.0, max=1.0, step=0.01,
                               tooltip="Blur strength — higher = shallower depth of field."),
                IO.Combo.Input("lens_preset", options=_lens.PRESETS, default="Custom",
                               tooltip="A lens look. Sets the character below; your edits override."),
                IO.Combo.Input("bokeh_shape", options=["circular", "hexagonal", "anamorphic"],
                               default="circular"),
                IO.Float.Input("highlight_bokeh", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("chromatic_aberration", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("vignette", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("focal_length", default=0.0, min=-1.0, max=1.0, step=0.01,
                               tooltip="Compression look: negative = wide, positive = telephoto."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image=None, depth=None, focus_point='{"x":0.5,"y":0.5}', focus_offset=0.0,
                aperture=0.4, lens_preset="Custom", bokeh_shape="circular", highlight_bokeh=0.3,
                chromatic_aberration=0.0, vignette=0.0, focal_length=0.0) -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        img = image[0] if image.ndim == 4 else image
        h, w, _ = img.shape

        # Depth: wired (resized to image) or auto-estimated (cached).
        if depth is not None:
            d = depth[0] if depth.ndim == 4 else depth
            if d.ndim == 3:
                d = d.mean(dim=-1)
            d = torch.nn.functional.interpolate(
                d.view(1, 1, *d.shape), size=(h, w), mode="bilinear", align_corners=False
            ).view(h, w).clamp(0, 1)
        else:
            d = estimate_depth(image)

        # Focus plane from the tapped point + offset.
        try:
            fp = json.loads(focus_point or "{}")
            fx = float(fp.get("x", 0.5)); fy = float(fp.get("y", 0.5))
        except (json.JSONDecodeError, TypeError, ValueError):
            fx, fy = 0.5, 0.5
        px = min(w - 1, max(0, int(fx * w)))
        py = min(h - 1, max(0, int(fy * h)))
        focus = float(d[py, px]) + float(focus_offset)
        focus = max(0.0, min(1.0, focus))

        params = _lens.resolve_params(lens_preset, {
            "bokeh_shape": bokeh_shape,
            "highlight_bokeh": highlight_bokeh,
            "chromatic_aberration": chromatic_aberration,
            "vignette": vignette,
            "focal_length": focal_length,
        })

        result = image
        result = _lens.focal_compression(result, d, params["focal_length"], center=(fx, fy))
        coc = _lens.circle_of_confusion(d, focus, float(aperture))
        result = _lens.render_dof(result, coc, bokeh_shape=params["bokeh_shape"],
                                  highlight_bokeh=params["highlight_bokeh"])
        result = _lens.chromatic_aberration(result, params["chromatic_aberration"])
        result = _lens.vignette(result, params["vignette"])
        return IO.NodeOutput(result, ui=save_live_preview(result, uid))


class LensExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [LensBlurNode]


async def comfy_entrypoint() -> LensExtension:
    return LensExtension()
```

- [ ] **Step 2: Register in the load list**

In `nodes.py`, find the comfy_extras load list and add `"nodes_lens.py",` near the other image-effect entries (e.g. right after `"nodes_glsl_lens.py",`). Match the surrounding indentation.

- [ ] **Step 3: Import smoke test**

Run:
```bash
.venv/bin/python -c "import comfy_extras.nodes_lens as m; s=m.LensBlurNode.define_schema(); print(s.node_id, [getattr(i,'name','?') for i in s.inputs])"
```
Expected: prints `LensBlur ['image', 'depth', 'focus_point', 'focus_offset', 'aperture', 'lens_preset', 'bokeh_shape', 'highlight_bokeh', 'chromatic_aberration', 'vignette', 'focal_length']` with no error. (This import also registers the `'depth'` bundle via `_depth`.)

- [ ] **Step 4: End-to-end render smoke (no model — wired depth path)**

Run:
```bash
.venv/bin/python -c "
import asyncio, torch
from comfy_extras.nodes_lens import LensBlurNode
class H: unique_id='1'
LensBlurNode.hidden = H()
img = torch.rand(1,32,32,3); dep = torch.rand(1,32,32,3)
out = asyncio.get_event_loop().run_until_complete(
    LensBlurNode.execute(image=img, depth=dep, aperture=0.6, vignette=0.5))
print('output image shape:', out.result[0].shape if hasattr(out,'result') else 'ok')
"
```
Expected: prints an output shape `torch.Size([1, 32, 32, 3])` (or `ok`) with no exception — exercises the full render via the wired-depth path so the depth model isn't needed.

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_lens.py nodes.py
git commit -m "feat(lens): LensBlur node wiring depth + lens render, registered in load list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — tap-to-focus + live preview

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue`

- [ ] **Step 1: Add `LensBlur` to `LIVE_PREVIEW_NODES`**

In `ComfyNode.vue`, find the `LIVE_PREVIEW_NODES` Set (around line 185–234) and add `'LensBlur'` to it (e.g. on the Lens-style line near `'TiltShift'`/`'Bokeh'` if present, or just append before the closing `])`):

```typescript
  // Depth-based lens / DoF (auto-reruns; depth is cached so reruns are render-only)
  'LensBlur',
])
```

- [ ] **Step 2: Add a focus-point reader (mirrors `_maskExtractorPointsRaw`)**

In `ComfyNode.vue`, just after the `maskExtractorPoints` computed (around line 678), add:

```typescript
function _lensFocusPoint(): { x: number; y: number } | null {
  if (props.data.nodeType !== 'LensBlur') return null
  const defs = props.data.widgetDefs as any[]
  const idx = defs?.findIndex((d: any) => d.name === 'focus_point') ?? -1
  if (idx < 0) return null
  try {
    const o = JSON.parse(props.data.widgetsValues?.[idx] ?? '{}')
    if (Number.isFinite(+o.x) && Number.isFinite(+o.y)) return { x: +o.x, y: +o.y }
  } catch {}
  return { x: 0.5, y: 0.5 }
}
const lensFocusPoint = computed(() => _lensFocusPoint())
```

- [ ] **Step 3: Handle the click for `LensBlur` in `onPreviewClick`**

In `onPreviewClick` (around line 680), replace the early-return guard and the write-back so it handles both node types. Change:

```typescript
function onPreviewClick(e: MouseEvent) {
  if (props.data.nodeType !== 'MaskExtractor') return
```
to:
```typescript
function onPreviewClick(e: MouseEvent) {
  if (props.data.nodeType !== 'MaskExtractor' && props.data.nodeType !== 'LensBlur') return
```

Then, just before the existing MaskExtractor write-back (the block that finds the `points` widget — `const defs = props.data.widgetDefs as any[]` … `props.data.widgetsValues[idx] = JSON.stringify(next)`), add a `LensBlur` branch that writes a single focus point and returns early:

```typescript
  if (props.data.nodeType === 'LensBlur') {
    const ldefs = props.data.widgetDefs as any[]
    const lidx = ldefs.findIndex((d: any) => d.name === 'focus_point')
    if (lidx < 0) return
    if (!Array.isArray(props.data.widgetsValues)) return
    props.data.widgetsValues[lidx] = JSON.stringify({ x: nx, y: ny })
    return
  }
```

(The `nx`/`ny` normalized coords are already computed above this point in the function.)

- [ ] **Step 4: Enable the crosshair cursor + focus marker overlay**

In the template (around line 1444), update the cursor class to include LensBlur:

```vue
            :class="{ 'cursor-crosshair': data.nodeType === 'MaskExtractor' || data.nodeType === 'LensBlur' }"
```

And after the MaskExtractor SVG overlay block (ends around line 1463), add a focus-marker overlay for LensBlur:

```vue
          <svg
            v-if="data.nodeType === 'LensBlur' && previewNaturalDims && lensFocusPoint"
            class="absolute inset-0 w-full h-full max-h-[300px] pointer-events-none rounded-lg"
            :viewBox="`0 0 ${previewNaturalDims.w} ${previewNaturalDims.h}`"
            preserveAspectRatio="xMidYMid meet"
          >
            <circle
              :cx="lensFocusPoint.x * previewNaturalDims.w"
              :cy="lensFocusPoint.y * previewNaturalDims.h"
              :r="Math.max(previewNaturalDims.w, previewNaturalDims.h) * 0.02"
              fill="none"
              stroke="#fbbf24"
              stroke-width="3"
              vector-effect="non-scaling-stroke"
            />
          </svg>
```

- [ ] **Step 5: Type-check the touched file**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ComfyNode.vue" | grep -v "1112\|1113\|1114\|1346\|1347" || echo "no new ComfyNode errors"`
Expected: `no new ComfyNode errors` (lines 1112–1114 / 1346–1347 are pre-existing errors unrelated to this change).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue
git commit -m "feat(lens): tap-to-focus + focus marker + live preview for LensBlur node

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — model download + toolbox discovery

**Files:**
- Modify: `frontend/app/data/toolbox-items.ts`
- Modify: `frontend/app/composables/useModelDownloads.ts`

- [ ] **Step 1: Add `'depth'` to the `ModelBundleKey` union**

In `frontend/app/data/toolbox-items.ts`, find the `export type ModelBundleKey =` union (around line 68–72) and add `'depth'`:

```typescript
export type ModelBundleKey =
  | 'faceswap' | 'bgremove' | 'upscale'
  | 'frameinterp' | 'subjecttrack'
  | 'facerestore' | 'lipsync' | 'objectremove'
  | 'whisper' | 'demucs'
  | 'depth'
```
(Match the exact existing members; just append `'depth'` to the union — do not drop any existing key.)

- [ ] **Step 2: Add `'depth'` to `ALL_MODEL_BUNDLES`**

In `frontend/app/composables/useModelDownloads.ts`, add `'depth'` to the `ALL_MODEL_BUNDLES` array (around line 12–16):

```typescript
  'facerestore', 'lipsync', 'objectremove',
  'whisper', 'demucs', 'depth',
]
```

- [ ] **Step 3: Add the Lens toolbox card**

In `frontend/app/data/toolbox-items.ts`, find the image-domain **Lens** section (the one containing `Bokeh`, `ChromaticAberration`, `CRT`, etc.). Add the LensBlur card as the first item in that section's `items` array. Verify `Aperture` (or another focus-suggesting icon) is imported at the top of the file; the `Aperture` icon is already used by the `Blur` item, so reuse it:

```typescript
      { nodeType: 'LensBlur', label: 'Lens / DoF', description: 'Depth-based depth of field — tap to focus, set aperture, bokeh, vignette, focal length. Estimates depth locally; downloads ~100 MB on first use.', icon: Aperture, requiresModels: 'depth' },
```

- [ ] **Step 4: Type-check the touched files**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "toolbox-items\|useModelDownloads" || echo "no new type errors in touched files"`
Expected: `no new type errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/toolbox-items.ts frontend/app/composables/useModelDownloads.ts
git commit -m "feat(lens): register depth model bundle + Lens toolbox card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Manual in-browser verification (needs user)

The depth model download and GPU render aren't unit-testable end-to-end, so this is a guided manual check.

- [ ] **Step 1: Restart ComfyUI** (new Python nodes — not hot-reloaded): kill the running process and relaunch `.venv/bin/python main.py --listen 127.0.0.1 --port 8188`.
- [ ] **Step 2: Run the frontend** (`cd frontend && npm run dev`) and hard-reload.
- [ ] **Step 3:** Open the toolbox → image → **Lens** → add **Lens / DoF**. Confirm it triggers the depth model download (~100 MB) with a progress toast, then adds the node.
- [ ] **Step 4:** Wire an image. Confirm depth estimation runs once and a result renders in the node preview.
- [ ] **Step 5:** Click a subject in the preview — confirm the amber focus marker moves there and that subject becomes sharp while the rest blurs. Sweep **aperture** and confirm responsiveness (depth cached → fast).
- [ ] **Step 6:** Try **bokeh_shape** (circular/hex/anamorphic), **highlight_bokeh**, **vignette**, **chromatic_aberration**, and each **lens_preset**; push **focal_length** both directions and confirm the compression look (no holes). Use **focus_offset** to pull focus.
- [ ] **Step 7:** Wire the output into an Image node with Export on, run it, and confirm the chosen result lands in the Assets panel (the Lens node itself stays a temp live-preview).

---

## Self-Review

- **Spec coverage:** local Depth Anything V2 via bundle + cached estimate_depth (Task 1) ✓; optional depth override input (Task 4 execute) ✓; tap-to-focus + focus marker (Task 5) ✓; focus_offset / aperture (Task 4) ✓; bokeh shape/highlights via render_dof (Task 2) ✓; CA + vignette + focal compression + presets (Task 3) ✓; live-preview-not-asset via save_live_preview + LIVE_PREVIEW_NODES (Tasks 4–5) ✓; torch layered (blur-pyramid) DoF (Task 2) ✓; toolbox card + requiresModels + bundle key (Task 6) ✓; load-list registration (Task 4) ✓; unit tests for depth + lens (Tasks 1–3) ✓; manual verify (Task 7) ✓.
- **Placeholder scan:** no TBD/TODO; every code step has complete code. The `~100 MB` size is flagged in the spec to confirm against the HF weights during Task 6.
- **Type/name consistency:** `estimate_depth(image)->[H,W]` defined in Task 1, used in Task 4. `_lens` symbols — `circle_of_confusion`, `bokeh_kernel`, `render_dof` (Task 2); `chromatic_aberration`, `vignette`, `focal_compression`, `DEFAULT_PARAMS`, `LENS_PRESETS`, `PRESETS`, `resolve_params` (Task 3) — all consumed with matching signatures in Task 4. Node id `LensBlur` and widget name `focus_point` are consistent across the node (Task 4), the frontend reader/click/overlay (Task 5), `LIVE_PREVIEW_NODES` (Task 5), and the toolbox card (Task 6). Model bundle key `'depth'` matches between `_depth.register_bundle` (Task 1), `ModelBundleKey`/`ALL_MODEL_BUNDLES` (Task 6), and the card's `requiresModels` (Task 6).
