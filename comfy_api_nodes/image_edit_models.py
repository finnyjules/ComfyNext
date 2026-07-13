"""Image-edit model catalog for purpose-built edit nodes.

Currently powers `RotateCameraNode` (the "Rotate camera" generator). Built
with the same dispatcher shape as `image_models.py` and `video_models.py`
so adding more edit models (Nano Banana, Seedream-Edit, Bytedance Seed-Edit)
is one entry per model when we later add a multi-model edit gallery.

For RotateCameraNode v1 there's exactly one model — `qwen-image-edit-plus` —
since it's the only one in the catalog with documented novel-view-synthesis
capability. Other edit models could be added behind a model picker if a
future node needs the choice.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


# (prompt, image_urls, seed, advanced) -> Replicate input dict.
# `image_urls` is a list of data-URL/URL references (one for single-source edit
# nodes, up to N for the multi-reference generator). Smaller signature than
# image_models.py because edit models always take input image(s) and rarely
# have an aspect-ratio dial of their own.
ImageEditInputBuilder = Callable[[str, list[str], int, dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class ImageEditModel:
    id: str
    label: str
    brand: str
    replicate_slug: str
    build_input: ImageEditInputBuilder


def _maybe_set_seed(inp: dict, seed: int) -> None:
    if seed and seed > 0:
        inp["seed"] = seed


def _clamp_size(value: Any, allowed: set[str], fallback: str) -> str:
    """Return `value` if it's one of the model's allowed size presets, else the
    fallback. The multi-reference node exposes a union size combo (1K/2K/3K);
    each model clamps to the presets it actually accepts."""
    return value if value in allowed else fallback


# ---------- Per-model builders ---------------------------------------------

def _b_qwen_image_edit_plus(prompt: str, image_urls: list[str], seed: int, adv: dict) -> dict:
    """Qwen-Image-Edit-Plus (2509) — the multi-image successor to the base
    qwen-image-edit. Accepts a list of input images so it can ingest reference
    crops.

    Documented capabilities: pose changes, novel view synthesis (90° and 180°
    object rotation), text edits, photo restoration.
    """
    inp: dict[str, Any] = {
        "prompt": prompt,
        "image": list(image_urls),
        # Defaults below match the model's stated sane values.
        "output_format": "png",
        "output_quality": 95,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedream_5_pro_edit(prompt: str, image_urls: list[str], seed: int, adv: dict) -> dict:
    """Seedream 5 Pro — flagship text+reference model, up to 10 reference images."""
    inp: dict[str, Any] = {
        "prompt": prompt,
        "image_input": list(image_urls),
        "size": _clamp_size(adv.get("size"), {"1K", "2K"}, "2K"),
    }
    ar = adv.get("aspect_ratio")
    if ar:
        inp["aspect_ratio"] = ar  # supports "match_input_image"
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedream_5_lite_edit(prompt: str, image_urls: list[str], seed: int, adv: dict) -> dict:
    """Seedream 5 Lite — reasoning-driven, cheaper, 2K/3K output."""
    inp: dict[str, Any] = {
        "prompt": prompt,
        "image_input": list(image_urls),
        "size": _clamp_size(adv.get("size"), {"2K", "3K"}, "2K"),
    }
    ar = adv.get("aspect_ratio")
    if ar:
        inp["aspect_ratio"] = ar
    _maybe_set_seed(inp, seed)
    return inp


def _b_nano_banana_2_edit(prompt: str, image_urls: list[str], seed: int, adv: dict) -> dict:
    """Google Nano Banana 2 — strong instruction following; accepts a multi-
    element image_input array already used by EditImageNode with one image."""
    inp: dict[str, Any] = {
        "prompt": prompt,
        "image_input": list(image_urls),
        "resolution": _clamp_size(adv.get("size"), {"1K", "2K", "4K"}, "2K"),
        "output_format": "png",
    }
    _maybe_set_seed(inp, seed)
    return inp


# ---------- Catalog ---------------------------------------------------------

MODELS: list[ImageEditModel] = [
    ImageEditModel(
        id="qwen-image-edit-plus",
        label="Qwen Image Edit Plus",
        brand="Alibaba",
        replicate_slug="qwen/qwen-image-edit-plus",
        build_input=_b_qwen_image_edit_plus,
    ),
    # Multi-reference generation models (used by GenerateFromReferencesNode).
    ImageEditModel(
        id="seedream-5-pro",
        label="Seedream 5 Pro",
        brand="ByteDance",
        replicate_slug="bytedance/seedream-5-pro",
        build_input=_b_seedream_5_pro_edit,
    ),
    ImageEditModel(
        id="seedream-5-lite",
        label="Seedream 5 Lite",
        brand="ByteDance",
        replicate_slug="bytedance/seedream-5-lite",
        build_input=_b_seedream_5_lite_edit,
    ),
    ImageEditModel(
        id="nano-banana-2",
        label="Nano Banana 2",
        brand="Google",
        replicate_slug="google/nano-banana-2",
        build_input=_b_nano_banana_2_edit,
    ),
]

# Models offered by the multi-reference "Generate from references" node, in
# display order. Qwen stays out — it's the single-purpose RotateCamera model.
REFERENCE_MODEL_IDS: list[str] = ["seedream-5-pro", "seedream-5-lite", "nano-banana-2"]
DEFAULT_REFERENCE_MODEL_ID: str = "seedream-5-pro"

IMAGE_EDIT_MODELS_BY_ID: dict[str, ImageEditModel] = {m.id: m for m in MODELS}

# Default for nodes that want a single fixed model (RotateCameraNode).
DEFAULT_CAMERA_MODEL_ID: str = "qwen-image-edit-plus"
