"""Image-generation model catalog for the GenerateImageNode dispatcher.

Mirrors frontend/app/data/image-models.ts. The two files describe the same
models from two angles:
  - the TS file drives the gallery UI (cards, labels, brand colors)
  - this Python file drives execution (Replicate slug + input dict shape)

The dispatch key is the model `id` — keep it identical across both files.

Adding a model: append an entry to MODELS below, write its `build_input`
function, then mirror the entry in the TS catalog. No other code change
needed — GenerateImageNode picks up the new entry via IMAGE_MODELS_BY_ID.

Scope (v1): models that accept a standard `aspect_ratio` string parameter.
Models with `width/height`, `size`/`resolution` enums only, or non-standard
text-input names (Wan 2.7, HiDream, SANA, SDXL, Z-Image, Riverflow, …) are
out of v1 — they need a different node-side aspect-ratio control.
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
    # Optional cross-provider backup. When BOTH are set, GenerateImageNode fails
    # over to fal if the Replicate dispatch throws (see _run_prediction retries
    # first, then this). `fal_slug` is the full fal endpoint id (e.g.
    # "fal-ai/flux-pro/v1.1"); `fal_build_input` shapes the *fal* request, which
    # uses a different schema than Replicate (image_size enums, not "16:9").
    # Only models with an EXACT fal equivalent are mapped — a v5 model must not
    # silently degrade to fal's v4.
    fal_slug: str | None = None
    fal_build_input: ModelInputBuilder | None = None
    # Which provider GenerateImageNode dispatches to FIRST. "fal" is used for the
    # shared models where fal is measurably faster/steadier than Replicate (whose
    # cold-boot + E9828 capacity failures cost 15s–3.5min); the other provider is
    # always the automatic backup. Ignored unless the model is fal-mapped.
    primary: str = "replicate"


# ---------- Advanced bag helpers --------------------------------------------

def _opt_int(advanced: dict, key: str, default: int) -> int:
    v = advanced.get(key, default)
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return default


def _opt_float(advanced: dict, key: str, default: float) -> float:
    v = advanced.get(key, default)
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v))
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


def _maybe_set_seed(inp: dict, seed: int) -> None:
    if seed and seed > 0:
        inp["seed"] = seed


def _ar_or(advanced_ar_set: set[str], aspect_ratio: str, fallback: str = "1:1") -> str:
    return aspect_ratio if aspect_ratio in advanced_ar_set else fallback


# ---------- Common aspect-ratio sets ----------------------------------------

_FLUX_PRO_AR  = {"1:1", "16:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16"}
_FLUX_DEV_AR  = {"1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"}
_FLUX_2_AR    = {"1:1", "16:9", "3:2", "2:3", "4:5", "5:4", "9:16", "3:4", "4:3"}
_FLUX_KLEIN_AR = {"1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9", "9:21"}
_FLUX_ULTRA_AR = {"21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "9:21"}
_IDEOGRAM_V2_AR = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "16:10", "10:16", "3:1", "1:3"}
_IDEOGRAM_V3_AR = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "16:10", "10:16", "1:3", "3:1", "1:2", "2:1", "4:5", "5:4"}
_GOOGLE_AR    = {"1:1", "16:9", "9:16", "4:3", "3:4"}
_NANO_BANANA_AR = {"1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"}
_NANO_BANANA_PRO_AR = {"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
_SEEDREAM_AR  = {"1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"}
_RECRAFT_AR   = {"1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "4:5", "5:4", "1:2", "2:1"}
_SD35_AR      = {"1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "9:16", "9:21"}
_PHOTON_AR    = {"1:1", "3:4", "4:3", "9:16", "16:9", "9:21", "21:9"}
_BRIA_AR      = {"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"}
_MINIMAX_AR   = {"1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"}
_QWEN_AR      = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}
_OPENAI_AR    = {"1:1", "3:2", "2:3"}
_HUNYUAN_AR   = {"1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"}
_GROK_AR      = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2"}
_WAN22_AR     = {"1:1", "16:9", "9:16", "4:3", "3:4", "21:9"}
_PIMAGE_AR    = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}
_REVE_AR      = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}


# ---------- Per-model builders ----------------------------------------------
#
# Each builder is a small, pure function. Read shared params + advanced bag,
# produce the dict to send to Replicate. Default values mirror the TS catalog
# so the UI and execution agree on what a "default" run looks like.

# ===== BFL ==================================================================

def _b_flux_1_1_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_PRO_AR, ar),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "prompt_upsampling": _opt_bool(adv, "prompt_upsampling", False),
        "output_format": _opt_str(adv, "output_format", "png"),
        "output_quality": 95,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_1_1_pro_ultra(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_ULTRA_AR, ar),
        "raw": _opt_bool(adv, "raw", False),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "output_format": _opt_str(adv, "output_format", "jpg"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_PRO_AR, ar),
        "guidance": _opt_float(adv, "guidance", 3.0),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "prompt_upsampling": _opt_bool(adv, "prompt_upsampling", False),
        "output_format": _opt_str(adv, "output_format", "png"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_dev(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_DEV_AR, ar),
        "num_inference_steps": _opt_int(adv, "num_inference_steps", 28),
        "guidance": _opt_float(adv, "guidance", 3.5),
        "megapixels": _opt_str(adv, "megapixels", "1"),
        "go_fast": _opt_bool(adv, "go_fast", True),
        "num_outputs": max(1, min(4, _opt_int(adv, "num_outputs", 1))),
        "output_format": _opt_str(adv, "output_format", "png"),
        "output_quality": 95,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_schnell(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_DEV_AR, ar),
        "num_inference_steps": _opt_int(adv, "num_inference_steps", 4),
        "megapixels": _opt_str(adv, "megapixels", "1"),
        "go_fast": _opt_bool(adv, "go_fast", True),
        "num_outputs": max(1, min(4, _opt_int(adv, "num_outputs", 1))),
        "output_format": _opt_str(adv, "output_format", "png"),
        "output_quality": 95,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_2_max(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_2_AR, ar),
        "resolution": _opt_str(adv, "resolution", "1 MP"),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_2_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_2_AR, ar),
        "resolution": _opt_str(adv, "resolution", "1 MP"),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_2_flex(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_2_AR, ar),
        "resolution": _opt_str(adv, "resolution", "1 MP"),
        "steps": _opt_int(adv, "steps", 30),
        "guidance": _opt_float(adv, "guidance", 4.5),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "prompt_upsampling": _opt_bool(adv, "prompt_upsampling", True),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_2_dev(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_2_AR, ar),
        "resolution": _opt_str(adv, "resolution", "1 MP"),
        "steps": _opt_int(adv, "steps", 30),
        "guidance": _opt_float(adv, "guidance", 4.5),
        "safety_tolerance": _opt_int(adv, "safety_tolerance", 2),
        "prompt_upsampling": _opt_bool(adv, "prompt_upsampling", True),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_flux_2_klein(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_KLEIN_AR, ar),
        "output_megapixels": _opt_str(adv, "output_megapixels", "1"),
        "go_fast": _opt_bool(adv, "go_fast", False),
        "output_format": _opt_str(adv, "output_format", "jpg"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Google ===============================================================

def _b_nano_banana_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_NANO_BANANA_PRO_AR, ar),
        "resolution": _opt_str(adv, "resolution", "2K"),
        "output_format": _opt_str(adv, "output_format", "jpg"),
        "safety_filter_level": _opt_str(adv, "safety_filter_level", "block_only_high"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_nano_banana_2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_NANO_BANANA_AR, ar),
        "resolution": _opt_str(adv, "resolution", "1K"),
        "google_search": _opt_bool(adv, "google_search", False),
        "image_search": _opt_bool(adv, "image_search", False),
        "output_format": _opt_str(adv, "output_format", "jpg"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_imagen_generic(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_GOOGLE_AR, ar),
        "output_format": _opt_str(adv, "output_format", "jpg"),
        "safety_filter_level": _opt_str(adv, "safety_filter_level", "block_only_high"),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Ideogram =============================================================

def _b_ideogram_v3(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_IDEOGRAM_V3_AR, ar),
        "magic_prompt_option": _opt_str(adv, "magic_prompt", "Auto"),
    }
    style = _opt_str(adv, "style_type", "None")
    if style and style != "None":
        inp["style_type"] = style
    _maybe_set_seed(inp, seed)
    return inp


def _b_ideogram_v2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_IDEOGRAM_V2_AR, ar),
        "style_type": _opt_str(adv, "style_type", "Auto"),
        "magic_prompt_option": _opt_str(adv, "magic_prompt", "Auto"),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== ByteDance ============================================================

def _b_seedream_45(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "size": _opt_str(adv, "size", "2K"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedream_5_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    size = _opt_str(adv, "size", "2K")
    if size not in ("1K", "2K"):
        size = "2K"
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "size": size,  # 1K | 2K
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedream_5_lite(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    size = _opt_str(adv, "size", "2K")
    if size not in ("2K", "3K"):
        size = "2K"  # old stored entries used 1K/2K — clamp to the real 5.0 set
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "size": size,  # 2K | 3K
    }
    # Batch: "auto" lets the model return a set of related images (max_images cap).
    if _opt_str(adv, "sequential_image_generation", "disabled") == "auto":
        inp["sequential_image_generation"] = "auto"
        inp["max_images"] = max(1, min(15, _opt_int(adv, "max_images", 1)))
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedream_4(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "size": _opt_str(adv, "size", "2K"),
        "enhance_prompt": _opt_bool(adv, "enhance_prompt", False),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedream_3(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "guidance_scale": _opt_float(adv, "guidance_scale", 2.5),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Recraft ==============================================================
#
# Recraft V4 family doesn't take an `aspect_ratio` parameter directly — it
# uses a `size` enum with a "Not set" sentinel that falls back to that.
# To keep the gallery UI consistent (one aspect-ratio combo for all models),
# we send `aspect_ratio` directly; Replicate's Recraft API also accepts the
# enum form, so this works. If a future Recraft model rejects it we'll
# switch to a per-model size map then.

def _b_recraft_v4(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_RECRAFT_AR, ar),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_recraft_v3(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_RECRAFT_AR, ar),
        "style": _opt_str(adv, "style", "any"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_recraft_v3_svg(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_RECRAFT_AR, ar),
        "style": _opt_str(adv, "style", "any"),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Stability AI =========================================================

def _b_sd35_family(prompt: str, ar: str, seed: int, adv: dict, *, cfg_default: float) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SD35_AR, ar),
        "cfg": _opt_float(adv, "cfg", cfg_default),
        "output_format": _opt_str(adv, "output_format", "webp"),
    }
    negp = _opt_str(adv, "negative_prompt", "")
    if negp:
        inp["negative_prompt"] = negp
    _maybe_set_seed(inp, seed)
    return inp


def _b_sd35_large(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    return _b_sd35_family(prompt, ar, seed, adv, cfg_default=5.0)


def _b_sd35_large_turbo(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    return _b_sd35_family(prompt, ar, seed, adv, cfg_default=1.0)


def _b_sd35_medium(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    return _b_sd35_family(prompt, ar, seed, adv, cfg_default=5.0)


# ===== OpenAI ===============================================================

def _b_gpt_image_2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_OPENAI_AR, ar),
        "quality": _opt_str(adv, "quality", "auto"),
        "background": _opt_str(adv, "background", "auto"),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "number_of_images": 1,
    }
    # OpenAI ignores `seed` historically — we send it anyway and the
    # endpoint silently drops it if unsupported.
    _maybe_set_seed(inp, seed)
    return inp


def _b_gpt_image_15(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_OPENAI_AR, ar),
        "quality": _opt_str(adv, "quality", "auto"),
        "background": _opt_str(adv, "background", "auto"),
        "input_fidelity": _opt_str(adv, "input_fidelity", "low"),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "number_of_images": 1,
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Alibaba ==============================================================

def _b_qwen_image(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_QWEN_AR, ar),
        "guidance": _opt_float(adv, "guidance", 3.0),
        "num_inference_steps": _opt_int(adv, "num_inference_steps", 30),
        "enhance_prompt": _opt_bool(adv, "enhance_prompt", False),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "go_fast": True,
    }
    negp = _opt_str(adv, "negative_prompt", "")
    if negp:
        inp["negative_prompt"] = negp
    _maybe_set_seed(inp, seed)
    return inp


# ===== Tencent ==============================================================

def _b_hunyuan_image_3(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_HUNYUAN_AR, ar),
        "go_fast": _opt_bool(adv, "go_fast", True),
        "output_format": _opt_str(adv, "output_format", "webp"),
        "output_quality": 95,
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== xAI ==================================================================

def _b_grok_imagine(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_GROK_AR, ar),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Pruna ================================================================

def _b_flux_fast(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_FLUX_DEV_AR, ar),
        "guidance": _opt_float(adv, "guidance", 3.5),
        "num_inference_steps": _opt_int(adv, "num_inference_steps", 28),
        "speed_mode": _opt_str(adv, "speed_mode", "Extra Juiced"),
        "output_format": _opt_str(adv, "output_format", "jpg"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_p_image(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_PIMAGE_AR, ar),
        "prompt_upsampling": _opt_bool(adv, "prompt_upsampling", False),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_wan22_pruna(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_WAN22_AR, ar),
        "megapixels": _opt_int(adv, "megapixels", 2),
        "juiced": _opt_bool(adv, "juiced", False),
        "output_format": _opt_str(adv, "output_format", "jpg"),
        "output_quality": 90,
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Bria =================================================================

def _b_bria_fibo(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_BRIA_AR, ar),
        "guidance_scale": _opt_int(adv, "guidance_scale", 4),
    }
    negp = _opt_str(adv, "negative_prompt", "")
    if negp:
        inp["negative_prompt"] = negp
    _maybe_set_seed(inp, seed)
    return inp


def _b_bria_image_32(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_BRIA_AR, ar),
        "guidance_scale": _opt_float(adv, "guidance_scale", 4.0),
        "prompt_enhancement": _opt_bool(adv, "prompt_enhancement", False),
        "enhance_image": _opt_bool(adv, "enhance_image", False),
    }
    negp = _opt_str(adv, "negative_prompt", "")
    if negp:
        inp["negative_prompt"] = negp
    _maybe_set_seed(inp, seed)
    return inp


# ===== Luma =================================================================

def _b_photon(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_PHOTON_AR, ar),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== MiniMax ==============================================================

def _b_minimax_image_01(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_MINIMAX_AR, ar),
        "prompt_optimizer": _opt_bool(adv, "prompt_optimizer", True),
        "number_of_images": 1,
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Reve =================================================================

def _b_reve_create(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # Reve defaults aspect_ratio to 3:2; mirror that fallback so a 1:1 request
    # (when the user hasn't touched the combo) still lands on a ratio Reve
    # accepts. The gallery's catalog declares 3:2 as the default too.
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_REVE_AR, ar, fallback="3:2"),
        "version": _opt_str(adv, "version", "latest"),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ---------- fal backup builders ---------------------------------------------
#
# fal reuses the same shared params (prompt, aspect_ratio, seed, advanced bag)
# but a *different* input schema than Replicate. Most fal image models size the
# output via an `image_size` enum rather than an aspect-ratio string, so map our
# ratios to the closest of fal's six presets (custom {width,height} is possible
# but the presets keep parity with what the user picked). Only the handful of
# models with an exact fal counterpart get a builder here — see the fleet-wide
# note on ImageModel. fal endpoints/schemas verified against fal's live OpenAPI.

_FAL_IMAGE_SIZE_BY_AR: dict[str, str] = {
    "1:1": "square_hd",
    "4:3": "landscape_4_3",
    "3:4": "portrait_4_3",
    "16:9": "landscape_16_9",
    "9:16": "portrait_16_9",
    # Ratios fal has no exact preset for → nearest-orientation preset.
    "3:2": "landscape_4_3",
    "5:4": "landscape_4_3",
    "16:10": "landscape_16_9",
    "21:9": "landscape_16_9",
    "2:1": "landscape_16_9",
    "2:3": "portrait_4_3",
    "4:5": "portrait_4_3",
    "10:16": "portrait_16_9",
    "9:21": "portrait_16_9",
    "1:2": "portrait_16_9",
}


def _fal_image_size(ar: str) -> str:
    """Map one of our aspect-ratio strings to fal's `image_size` enum."""
    return _FAL_IMAGE_SIZE_BY_AR.get(ar, "square_hd")


def _fal_flux_schnell(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/flux/schnell — same BFL model as Replicate black-forest-labs/
    # flux-schnell (the highest-traffic model, and the one E9828 hit hardest).
    # Replicate's num_outputs batch → fal's num_images (both cap at 4), so the
    # sketch preset's multi-image path survives the fallback.
    inp = {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "num_inference_steps": _opt_int(adv, "num_inference_steps", 4),
        "num_images": max(1, min(4, _opt_int(adv, "num_outputs", 1))),
        "output_format": _opt_str(adv, "output_format", "png"),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_flux_pro_v11(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/flux-pro/v1.1 — same underlying BFL model as Replicate flux-1.1-pro.
    # safety_tolerance here is a STRING "1".."6" (Replicate takes an int).
    tol = _opt_int(adv, "safety_tolerance", 2)
    tol = min(6, max(1, tol))
    inp = {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "num_images": 1,
        "output_format": _opt_str(adv, "output_format", "png"),
        "safety_tolerance": str(tol),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_flux_2_out_fmt(adv: dict) -> str:
    # fal flux-2 accepts only jpeg/png; our TS default is webp.
    v = _opt_str(adv, "output_format", "png")
    return "png" if v == "png" else "jpeg"


def _fal_flux_2_basic(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/flux-2-pro and fal-ai/flux-2-max — same input schema.
    tol = min(5, max(1, _opt_int(adv, "safety_tolerance", 2)))
    inp = {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "safety_tolerance": str(tol),
        "output_format": _fal_flux_2_out_fmt(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_flux_2_tunable(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/flux-2-flex and fal-ai/flux-2-dev — adds steps + guidance.
    inp = _fal_flux_2_basic(prompt, ar, seed, adv)
    inp["num_inference_steps"] = _opt_int(adv, "steps", 28)
    inp["guidance_scale"] = float(adv.get("guidance", 3.5))
    return inp


# Replicate ideogram `style_type` values → fal ideogram `style` enum.
_FAL_IDEOGRAM_STYLE = {
    "Auto": "AUTO", "General": "GENERAL", "Realistic": "REALISTIC", "Design": "DESIGN",
}


def _make_fal_ideogram_v3(rendering_speed: str) -> ModelInputBuilder:
    """One fal endpoint (fal-ai/ideogram/v3) fronts all three Replicate tiers;
    the quality/balanced/turbo split maps to fal's `rendering_speed`."""
    def _build(prompt: str, ar: str, seed: int, adv: dict) -> dict:
        inp = {
            "prompt": prompt,
            "image_size": _fal_image_size(ar),
            "rendering_speed": rendering_speed,  # TURBO | BALANCED | QUALITY
            "num_images": 1,
            # Replicate magic_prompt Auto/On → fal expand_prompt True; Off → False.
            "expand_prompt": _opt_str(adv, "magic_prompt", "Auto").lower() != "off",
        }
        style = _opt_str(adv, "style_type", "None")
        if style in _FAL_IDEOGRAM_STYLE:
            inp["style"] = _FAL_IDEOGRAM_STYLE[style]
        _maybe_set_seed(inp, seed)
        return inp
    return _build


def _fal_output_format(adv: dict, default: str = "png") -> str:
    """Replicate uses 'jpg'; fal's enum is jpeg/png/webp. Normalize."""
    v = _opt_str(adv, "output_format", default)
    return "jpeg" if v == "jpg" else v


def _fal_nano_banana_2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/nano-banana-2 — same Gemini 3.1 Flash Image model as Replicate
    # google/nano-banana-2. fal takes our aspect-ratio strings natively
    # (including the 4:1/1:8 extremes), so no image_size mapping needed.
    res = _opt_str(adv, "resolution", "1K")
    if res not in ("0.5K", "1K", "2K", "4K"):
        res = "1K"
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_NANO_BANANA_AR, ar),
        "resolution": res,
        "num_images": 1,
        "output_format": _fal_output_format(adv),
        # Replicate's google_search knob ≙ fal's enable_web_search.
        "enable_web_search": _opt_bool(adv, "google_search", False),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_nano_banana_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # google/nano-banana-pro on fal — aspect-ratio enum matches ours exactly.
    # Replicate's safety_filter_level has no fal equivalent (fal uses numeric
    # safety_tolerance); leave fal's default rather than guess a mapping.
    res = _opt_str(adv, "resolution", "2K")
    if res not in ("1K", "2K", "4K"):
        res = "2K"
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_NANO_BANANA_PRO_AR, ar),
        "resolution": res,
        "num_images": 1,
        "output_format": _fal_output_format(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_seedream_5_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # bytedance/seedream/v5/pro/text-to-image (no fal-ai/ prefix). fal sizes via
    # image_size presets; the user's explicit aspect ratio wins over the 1K/2K
    # advanced knob. NOTE: no seed parameter on this fal endpoint — generation is
    # stochastic per call (seed only appears in the output).
    return {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "num_images": 1,
        "output_format": _fal_output_format(adv),
    }


def _fal_seedream_5_lite(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/bytedance/seedream/v5/lite/text-to-image. Replicate's batch knobs
    # (sequential_image_generation auto + max_images ≤15) map to fal's
    # max_images (≤6). No seed parameter here either.
    inp = {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "num_images": 1,
        "max_images": 1,
    }
    if _opt_str(adv, "sequential_image_generation", "disabled") == "auto":
        inp["max_images"] = max(1, min(6, _opt_int(adv, "max_images", 1)))
    return inp


def _fal_seedream_v4(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/bytedance/seedream/v4/text-to-image — exact counterpart of Replicate
    # bytedance/seedream-4.
    inp = {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "num_images": 1,
        "max_images": 1,
    }
    _maybe_set_seed(inp, seed)
    return inp


# ---------- Krea ------------------------------------------------------------
_KREA_AR = {"1:1", "4:3", "3:2", "16:9", "2.35:1", "4:5", "2:3", "9:16"}
_KREA_CREATIVITY = {"raw", "low", "medium", "high"}


def _krea_creativity(adv: dict) -> str:
    v = _opt_str(adv, "creativity", "medium")
    return v if v in _KREA_CREATIVITY else "medium"


def _b_krea2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # Replicate krea/krea-2-large. Native aspect_ratio + creativity enum.
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_KREA_AR, ar),
        "creativity": _krea_creativity(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_krea2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal krea/v2/{large,medium}/text-to-image — same field names as Replicate.
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_KREA_AR, ar),
        "creativity": _krea_creativity(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ---------- Catalog (mirrors image-models.ts order) -------------------------

MODELS: list[ImageModel] = [
    # BFL ---------------------------------------------------------------------
    ImageModel("flux-1.1-pro",       "Flux 1.1 Pro",        "BFL", "black-forest-labs/flux-1.1-pro",       sorted(_FLUX_PRO_AR),  _b_flux_1_1_pro,
               fal_slug="fal-ai/flux-pro/v1.1", fal_build_input=_fal_flux_pro_v11, primary="fal"),
    ImageModel("flux-1.1-pro-ultra", "Flux 1.1 Pro Ultra",  "BFL", "black-forest-labs/flux-1.1-pro-ultra", sorted(_FLUX_ULTRA_AR), _b_flux_1_1_pro_ultra),
    ImageModel("flux-pro",           "Flux Pro",            "BFL", "black-forest-labs/flux-pro",           sorted(_FLUX_PRO_AR),  _b_flux_pro),
    ImageModel("flux-dev",           "Flux Dev",            "BFL", "black-forest-labs/flux-dev",           sorted(_FLUX_DEV_AR),  _b_flux_dev),
    ImageModel("flux-schnell",       "Flux Schnell",        "BFL", "black-forest-labs/flux-schnell",       sorted(_FLUX_DEV_AR),  _b_flux_schnell,
               fal_slug="fal-ai/flux/schnell", fal_build_input=_fal_flux_schnell, primary="fal"),
    ImageModel("flux-2-max",         "Flux 2 Max",          "BFL", "black-forest-labs/flux-2-max",         sorted(_FLUX_2_AR),    _b_flux_2_max,
               fal_slug="fal-ai/flux-2-max",  fal_build_input=_fal_flux_2_basic),
    ImageModel("flux-2-pro",         "Flux 2 Pro",          "BFL", "black-forest-labs/flux-2-pro",         sorted(_FLUX_2_AR),    _b_flux_2_pro,
               fal_slug="fal-ai/flux-2-pro",  fal_build_input=_fal_flux_2_basic),
    ImageModel("flux-2-flex",        "Flux 2 Flex",         "BFL", "black-forest-labs/flux-2-flex",        sorted(_FLUX_2_AR),    _b_flux_2_flex,
               fal_slug="fal-ai/flux-2-flex", fal_build_input=_fal_flux_2_tunable),
    ImageModel("flux-2-klein-4b",    "Flux 2 Klein 4B",     "BFL", "black-forest-labs/flux-2-klein-4b",    sorted(_FLUX_KLEIN_AR), _b_flux_2_klein),
    ImageModel("flux-2-dev",         "Flux 2 Dev",          "BFL", "black-forest-labs/flux-2-dev",         sorted(_FLUX_2_AR),    _b_flux_2_dev,
               fal_slug="fal-ai/flux-2-dev",  fal_build_input=_fal_flux_2_tunable),

    # Google ------------------------------------------------------------------
    ImageModel("nano-banana-pro",    "Nano Banana Pro",     "Google", "google/nano-banana-pro",            sorted(_NANO_BANANA_PRO_AR), _b_nano_banana_pro,
               fal_slug="google/nano-banana-pro", fal_build_input=_fal_nano_banana_pro, primary="fal"),
    ImageModel("nano-banana-2",      "Nano Banana 2",       "Google", "google/nano-banana-2",              sorted(_NANO_BANANA_AR),     _b_nano_banana_2,
               fal_slug="fal-ai/nano-banana-2", fal_build_input=_fal_nano_banana_2, primary="fal"),
    ImageModel("imagen-4-ultra",     "Imagen 4 Ultra",      "Google", "google/imagen-4-ultra",             sorted(_GOOGLE_AR),          _b_imagen_generic),
    ImageModel("imagen-4",           "Imagen 4",            "Google", "google/imagen-4",                   sorted(_GOOGLE_AR),          _b_imagen_generic),
    ImageModel("imagen-4-fast",      "Imagen 4 Fast",       "Google", "google/imagen-4-fast",              sorted(_GOOGLE_AR),          _b_imagen_generic),
    ImageModel("imagen-3",           "Imagen 3",            "Google", "google/imagen-3",                   sorted(_GOOGLE_AR),          _b_imagen_generic),
    ImageModel("imagen-3-fast",      "Imagen 3 Fast",       "Google", "google/imagen-3-fast",              sorted(_GOOGLE_AR),          _b_imagen_generic),

    # Ideogram ----------------------------------------------------------------
    ImageModel("ideogram-v3-quality",  "Ideogram V3 Quality",  "Ideogram", "ideogram-ai/ideogram-v3-quality",  sorted(_IDEOGRAM_V3_AR), _b_ideogram_v3,
               fal_slug="fal-ai/ideogram/v3", fal_build_input=_make_fal_ideogram_v3("QUALITY"), primary="fal"),
    ImageModel("ideogram-v3-balanced", "Ideogram V3 Balanced", "Ideogram", "ideogram-ai/ideogram-v3-balanced", sorted(_IDEOGRAM_V3_AR), _b_ideogram_v3,
               fal_slug="fal-ai/ideogram/v3", fal_build_input=_make_fal_ideogram_v3("BALANCED"), primary="fal"),
    ImageModel("ideogram-v3-turbo",    "Ideogram V3 Turbo",    "Ideogram", "ideogram-ai/ideogram-v3-turbo",    sorted(_IDEOGRAM_V3_AR), _b_ideogram_v3,
               fal_slug="fal-ai/ideogram/v3", fal_build_input=_make_fal_ideogram_v3("TURBO"), primary="fal"),
    ImageModel("ideogram-v2",          "Ideogram V2",          "Ideogram", "ideogram-ai/ideogram-v2",          sorted(_IDEOGRAM_V2_AR), _b_ideogram_v2),
    ImageModel("ideogram-v2a-turbo",   "Ideogram V2A Turbo",   "Ideogram", "ideogram-ai/ideogram-v2a-turbo",   sorted(_IDEOGRAM_V2_AR), _b_ideogram_v2),

    # ByteDance ---------------------------------------------------------------
    ImageModel("seedream-5-pro",     "Seedream 5 Pro",      "ByteDance", "bytedance/seedream-5-pro",        sorted(_SEEDREAM_AR), _b_seedream_5_pro,
               fal_slug="bytedance/seedream/v5/pro/text-to-image", fal_build_input=_fal_seedream_5_pro, primary="fal"),
    ImageModel("seedream-5-lite",    "Seedream 5 Lite",     "ByteDance", "bytedance/seedream-5-lite",       sorted(_SEEDREAM_AR), _b_seedream_5_lite,
               fal_slug="fal-ai/bytedance/seedream/v5/lite/text-to-image", fal_build_input=_fal_seedream_5_lite, primary="fal"),
    ImageModel("seedream-4.5",       "Seedream 4.5",        "ByteDance", "bytedance/seedream-4.5",          sorted(_SEEDREAM_AR), _b_seedream_45),
    ImageModel("seedream-4",         "Seedream 4",          "ByteDance", "bytedance/seedream-4",            sorted(_SEEDREAM_AR), _b_seedream_4,
               fal_slug="fal-ai/bytedance/seedream/v4/text-to-image", fal_build_input=_fal_seedream_v4, primary="fal"),
    ImageModel("seedream-3",         "Seedream 3",          "ByteDance", "bytedance/seedream-3",            sorted(_SEEDREAM_AR), _b_seedream_3),

    # Recraft -----------------------------------------------------------------
    ImageModel("recraft-v4-pro",     "Recraft V4 Pro",      "Recraft", "recraft-ai/recraft-v4-pro",         sorted(_RECRAFT_AR), _b_recraft_v4),
    ImageModel("recraft-v4-pro-svg", "Recraft V4 Pro SVG",  "Recraft", "recraft-ai/recraft-v4-pro-svg",     sorted(_RECRAFT_AR), _b_recraft_v4),
    ImageModel("recraft-v4",         "Recraft V4",          "Recraft", "recraft-ai/recraft-v4",             sorted(_RECRAFT_AR), _b_recraft_v4),
    ImageModel("recraft-v4-svg",     "Recraft V4 SVG",      "Recraft", "recraft-ai/recraft-v4-svg",         sorted(_RECRAFT_AR), _b_recraft_v4),
    ImageModel("recraft-v3",         "Recraft V3",          "Recraft", "recraft-ai/recraft-v3",             sorted(_RECRAFT_AR), _b_recraft_v3),
    ImageModel("recraft-v3-svg",     "Recraft V3 SVG",      "Recraft", "recraft-ai/recraft-v3-svg",         sorted(_RECRAFT_AR), _b_recraft_v3_svg),

    # Stability AI ------------------------------------------------------------
    ImageModel("stable-diffusion-3.5-large",       "Stable Diffusion 3.5 Large",       "Stability AI", "stability-ai/stable-diffusion-3.5-large",       sorted(_SD35_AR), _b_sd35_large),
    ImageModel("stable-diffusion-3.5-large-turbo", "Stable Diffusion 3.5 Large Turbo", "Stability AI", "stability-ai/stable-diffusion-3.5-large-turbo", sorted(_SD35_AR), _b_sd35_large_turbo),
    ImageModel("stable-diffusion-3.5-medium",      "Stable Diffusion 3.5 Medium",      "Stability AI", "stability-ai/stable-diffusion-3.5-medium",      sorted(_SD35_AR), _b_sd35_medium),

    # OpenAI ------------------------------------------------------------------
    ImageModel("gpt-image-2",        "GPT Image 2",         "OpenAI", "openai/gpt-image-2",                 sorted(_OPENAI_AR), _b_gpt_image_2),
    ImageModel("gpt-image-1.5",      "GPT Image 1.5",       "OpenAI", "openai/gpt-image-1.5",               sorted(_OPENAI_AR), _b_gpt_image_15),

    # Alibaba -----------------------------------------------------------------
    ImageModel("qwen-image",         "Qwen Image",          "Alibaba", "qwen/qwen-image",                   sorted(_QWEN_AR), _b_qwen_image),

    # Tencent -----------------------------------------------------------------
    ImageModel("hunyuan-image-3",    "Hunyuan Image 3",     "Tencent", "tencent/hunyuan-image-3",           sorted(_HUNYUAN_AR), _b_hunyuan_image_3),

    # xAI ---------------------------------------------------------------------
    ImageModel("grok-imagine",       "Grok Imagine",        "xAI", "xai/grok-imagine-image",                sorted(_GROK_AR), _b_grok_imagine),

    # Pruna -------------------------------------------------------------------
    ImageModel("flux-fast",          "Flux Fast (Pruna)",   "Pruna", "prunaai/flux-fast",                   sorted(_FLUX_DEV_AR), _b_flux_fast),
    ImageModel("p-image",            "P-Image",             "Pruna", "prunaai/p-image",                     sorted(_PIMAGE_AR),   _b_p_image),
    ImageModel("wan-2.2-image-pruna", "Wan 2.2 Image (Pruna)", "Pruna", "prunaai/wan-2.2-image",            sorted(_WAN22_AR),    _b_wan22_pruna),

    # Bria --------------------------------------------------------------------
    ImageModel("bria-fibo",          "Bria Fibo",           "Bria", "bria/fibo",                            sorted(_BRIA_AR), _b_bria_fibo),
    ImageModel("bria-image-3.2",     "Bria Image 3.2",      "Bria", "bria/image-3.2",                       sorted(_BRIA_AR), _b_bria_image_32),

    # Luma --------------------------------------------------------------------
    ImageModel("photon",             "Photon",              "Luma", "luma/photon",                          sorted(_PHOTON_AR), _b_photon),
    ImageModel("photon-flash",       "Photon Flash",        "Luma", "luma/photon-flash",                    sorted(_PHOTON_AR), _b_photon),

    # MiniMax -----------------------------------------------------------------
    ImageModel("minimax-image-01",   "MiniMax Image 01",    "MiniMax", "minimax/image-01",                  sorted(_MINIMAX_AR), _b_minimax_image_01),

    # Reve --------------------------------------------------------------------
    ImageModel("reve-create",        "Reve Create",         "Reve",    "reve/create",                       sorted(_REVE_AR),    _b_reve_create),

    # Krea --------------------------------------------------------------------
    ImageModel("krea-2-large",  "Krea 2 Large",  "Krea", "krea/krea-2-large",  sorted(_KREA_AR), _b_krea2,
               fal_slug="krea/v2/large/text-to-image",  fal_build_input=_fal_krea2, primary="fal"),
    ImageModel("krea-2-medium", "Krea 2 Medium", "Krea", "krea/krea-2-medium", sorted(_KREA_AR), _b_krea2,
               fal_slug="krea/v2/medium/text-to-image", fal_build_input=_fal_krea2, primary="fal"),
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
DEFAULT_MODEL_ID: str = "flux-2-pro"
