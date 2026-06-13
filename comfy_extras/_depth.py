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
_CACHE_DIRNAME = "models--depth-anything--Depth-Anything-V2-Small-hf"


def _hf_hub_cache_dir() -> str:
    """The HuggingFace hub cache dir, honoring HUGGINGFACE_HUB_CACHE / HF_HOME."""
    direct = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if direct:
        return direct
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return os.path.join(hf_home, "hub")
    return os.path.expanduser("~/.cache/huggingface/hub")


def _depth_ready() -> bool:
    """True iff the HF snapshot for the depth model is on disk."""
    root = os.path.join(_hf_hub_cache_dir(), _CACHE_DIRNAME, "snapshots")
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
