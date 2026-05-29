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


# (prompt, input_image_data_url, seed, advanced) -> Replicate input dict.
# Smaller signature than image_models.py because edit models always take an
# input image and rarely have an aspect-ratio dial of their own.
ImageEditInputBuilder = Callable[[str, str, int, dict[str, Any]], dict[str, Any]]


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


# ---------- Per-model builders ---------------------------------------------

def _b_qwen_image_edit_plus(prompt: str, image_url: str, seed: int, adv: dict) -> dict:
    """Qwen-Image-Edit-Plus (2509) — the multi-image successor to the base
    qwen-image-edit. Accepts a list of input images so it can ingest reference
    crops; we pass a single-element list since RotateCameraNode doesn't need
    multi-image semantics.

    Documented capabilities: pose changes, novel view synthesis (90° and 180°
    object rotation), text edits, photo restoration.
    """
    inp: dict[str, Any] = {
        "prompt": prompt,
        # Plus variant expects an array — single-element is the common case.
        "image": [image_url],
        # Defaults below match the model's stated sane values.
        "output_format": "png",
        "output_quality": 95,
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
]

IMAGE_EDIT_MODELS_BY_ID: dict[str, ImageEditModel] = {m.id: m for m in MODELS}

# Default for nodes that want a single fixed model (RotateCameraNode).
DEFAULT_CAMERA_MODEL_ID: str = "qwen-image-edit-plus"
