"""Image-generation model catalog for the GenerateImageNode dispatcher.

Mirrors frontend/app/data/image-models.ts. The two files describe the same
models from two angles:
  - the TS file drives the gallery UI (cards, labels, brand colors)
  - this Python file drives execution (Replicate slug + input dict shape)

The dispatch key is the model `id` — keep it identical across both files.

Adding a model: append an entry to MODELS below, write its `build_input`
function, then mirror the entry in the TS catalog. No other code change
needed — GenerateImageNode picks up the new entry via IMAGE_MODELS_BY_ID.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

# Per-model input builder. Receives the shared widgets the node always exposes
# (prompt, aspect_ratio, seed) plus the per-model `advanced` JSON bag the
# gallery wrote into the node's `model_options` widget. Returns the dict to
# POST to Replicate as `input`.
ModelInputBuilder = Callable[[str, str, int, dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class ImageModel:
    id: str
    label: str
    brand: str
    replicate_slug: str
    aspect_ratios: list[str]
    build_input: ModelInputBuilder


# ---------- Per-model builders ----------------------------------------------
#
# Each builder is a small, pure function — easy to test, easy to add. Keep
# them stateless; share Replicate-friendly normalization (aspect-ratio
# fallbacks, seed gating) inline rather than via shared mutable state.


def _opt_int(advanced: dict, key: str, default: int) -> int:
    """Read an int from the advanced bag, tolerating string serialization."""
    v = advanced.get(key, default)
    if isinstance(v, bool):  # bool is subclass of int — guard explicitly
        return int(v)
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return default


def _opt_bool(advanced: dict, key: str, default: bool) -> bool:
    v = advanced.get(key, default)
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.lower() in ("true", "1", "yes", "on")
    return bool(v)


def _opt_str(advanced: dict, key: str, default: str) -> str:
    v = advanced.get(key, default)
    return str(v) if v is not None else default


# Aspect-ratio whitelists per upstream model. Kept here so each builder
# can fall back to a sensible 1:1 when the caller asks for a ratio the
# model doesn't accept (e.g. the gallery presented the union of all
# supported ratios but the chosen model only takes a subset).
_FLUX_1_1_PRO_AR = {
    "1:1", "16:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16",
}
_IDEOGRAM_V3_AR = {
    "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "16:10", "10:16", "1:3", "3:1",
}


def _build_flux_1_1_pro(prompt: str, aspect_ratio: str, seed: int, advanced: dict) -> dict:
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio if aspect_ratio in _FLUX_1_1_PRO_AR else "1:1",
        "safety_tolerance": _opt_int(advanced, "safety_tolerance", 2),
        "prompt_upsampling": _opt_bool(advanced, "prompt_upsampling", False),
        "output_format": _opt_str(advanced, "output_format", "png"),
        "output_quality": 95,
    }
    if seed and seed > 0:
        inp["seed"] = seed
    return inp


def _build_ideogram_v3_turbo(prompt: str, aspect_ratio: str, seed: int, advanced: dict) -> dict:
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio if aspect_ratio in _IDEOGRAM_V3_AR else "1:1",
        "magic_prompt_option": _opt_str(advanced, "magic_prompt", "Auto"),
    }
    style = _opt_str(advanced, "style_type", "None")
    if style and style != "None":
        inp["style_type"] = style
    if seed and seed > 0:
        inp["seed"] = seed
    return inp


# ---------- Catalog ---------------------------------------------------------

MODELS: list[ImageModel] = [
    ImageModel(
        id="flux-1.1-pro",
        label="Flux 1.1 Pro",
        brand="BFL",
        replicate_slug="black-forest-labs/flux-1.1-pro",
        aspect_ratios=sorted(_FLUX_1_1_PRO_AR),
        build_input=_build_flux_1_1_pro,
    ),
    ImageModel(
        id="ideogram-v3-turbo",
        label="Ideogram V3 Turbo",
        brand="Ideogram",
        replicate_slug="ideogram-ai/ideogram-v3-turbo",
        aspect_ratios=sorted(_IDEOGRAM_V3_AR),
        build_input=_build_ideogram_v3_turbo,
    ),
]

IMAGE_MODELS_BY_ID: dict[str, ImageModel] = {m.id: m for m in MODELS}

# Union of every aspect ratio across all models — exposed as the `aspect_ratio`
# combo options on the node. The per-model build_input falls back to 1:1 for
# any ratio the chosen model doesn't accept.
ALL_ASPECT_RATIOS: list[str] = sorted(
    {ar for m in MODELS for ar in m.aspect_ratios},
    # 1:1 first, then everything else by numeric order
    key=lambda ar: (0 if ar == "1:1" else 1, ar),
)

# Default model id surfaced on a freshly-dropped node. Pick the safest
# general-purpose model so users get a reasonable first result with no
# configuration.
DEFAULT_MODEL_ID: str = "flux-1.1-pro"
