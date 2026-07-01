"""Video-generation model catalog for the GenerateVideoNode dispatcher.

Mirrors frontend/app/data/video-models.ts. The two files describe the same
models from two angles:
  - the TS file drives the gallery UI (cards, modes, durations, brand swatch)
  - this Python file drives execution (Replicate slug + input dict shape)

The dispatch key is the model `id` — keep it identical across both files.

Adding a model: append an entry to MODELS below, write its `build_input`
function, then mirror the entry in the TS catalog. No other code change
needed — GenerateVideoNode picks up the new entry via VIDEO_MODELS_BY_ID.

Builder signature is uniform: (prompt, aspect_ratio, duration, seed,
image_data_url|None, audio_data_url|None, advanced_dict) -> Replicate
input dict. Models that ignore some inputs (e.g. T2V-only) just drop
them; models that require them (I2V needs image, lip-sync needs both)
raise via the dispatcher if the required input is missing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


# (prompt, aspect_ratio, duration, seed, image_data_url|None,
#  audio_data_url|None, advanced) -> input
#
# Audio was added in v2 of this catalog to support lip-sync models (Fabric).
# Existing builders accept the new positional arg and ignore it; only models
# that actually take audio do anything with it.
VideoModelInputBuilder = Callable[
    [str, str, int, int, str | None, str | None, dict[str, Any]],
    dict[str, Any],
]


@dataclass(frozen=True)
class VideoModel:
    id: str
    label: str
    brand: str
    replicate_slug: str
    aspect_ratios: list[str]
    durations: list[int]
    modes: list[str]              # ['t2v'], ['i2v'], or ['t2v', 'i2v']
    build_input: VideoModelInputBuilder
    default_duration: int = 5


# ---------- Advanced bag helpers --------------------------------------------
# Same shapes as image_models.py so the two files read alike.

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


def _ar_or(allowed: set[str], aspect_ratio: str, fallback: str = "16:9") -> str:
    """Remap an out-of-band aspect ratio to a sensible per-model default."""
    return aspect_ratio if aspect_ratio in allowed else fallback


def _dur_or(allowed: list[int], duration: int, fallback: int) -> int:
    """Pick the closest supported duration when the requested one isn't in the
    model's option set. Most models cap at specific values (5, 6, 8, 10, 15)."""
    if duration in allowed:
        return duration
    if not allowed:
        return fallback
    return min(allowed, key=lambda d: abs(d - duration))


# ---------- Common aspect-ratio sets ----------------------------------------

_VEO_AR        = {"16:9", "9:16"}
_SORA_AR       = {"16:9", "9:16", "1:1"}
_SORA_PRO_AR   = {"16:9", "9:16"}
_RUNWAY_AR     = {"16:9", "9:16", "1:1", "4:3", "3:4"}
_KLING_AR      = {"16:9", "9:16", "1:1"}
_SEEDANCE_AR   = {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
_HAILUO_AR     = {"16:9", "9:16", "1:1"}
_WAN_AR        = {"16:9", "9:16", "1:1"}
_LUMA_AR       = {"16:9", "9:16", "1:1", "4:3", "3:4"}
_LTX_AR        = {"16:9", "9:16", "1:1"}
_PIXVERSE_AR   = {"16:9", "9:16", "1:1"}


# ---------- Per-model builders ----------------------------------------------

# ===== Google (Veo) =========================================================

def _b_veo_3_1(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_VEO_AR, ar, "16:9"),
        "generate_audio": _opt_bool(adv, "generate_audio", True),
        "enhance_prompt": _opt_bool(adv, "enhance_prompt", True),
    }
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    if image:
        inp["image"] = image
    _maybe_set_seed(inp, seed)
    return inp


def _b_veo_3_1_fast(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_VEO_AR, ar, "16:9"),
        "generate_audio": _opt_bool(adv, "generate_audio", True),
    }
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    if image:
        inp["image"] = image
    _maybe_set_seed(inp, seed)
    return inp


# ===== OpenAI (Sora) ========================================================

def _b_sora_2(prompt, ar, dur, seed, image, audio, adv):
    # T2V only on Replicate. duration accepts 5 or 10.
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SORA_AR, ar, "16:9"),
        "duration": _dur_or([5, 10], dur, 5),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _b_sora_2_pro(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SORA_PRO_AR, ar, "16:9"),
        "duration": _dur_or([5, 10], dur, 5),
    }
    _maybe_set_seed(inp, seed)
    return inp


# ===== Runway ===============================================================

def _b_runway_gen_4_5(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_RUNWAY_AR, ar, "16:9"),
        "duration": _dur_or([5, 10], dur, 5),
        "motion": _opt_int(adv, "motion", 5),
    }
    if image:
        inp["image"] = image
    _maybe_set_seed(inp, seed)
    return inp


# ===== Kling ================================================================

def _b_kling_v3(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_KLING_AR, ar, "16:9"),
        "duration": _dur_or([5, 10, 15], dur, 5),
        "generate_audio": _opt_bool(adv, "generate_audio", True),
        "cfg_scale": _opt_float(adv, "cfg_scale", 0.5),
    }
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    if image:
        inp["start_image"] = image
    _maybe_set_seed(inp, seed)
    return inp


def _b_kling_v2_5_turbo_pro(prompt, ar, dur, seed, image, audio, adv):
    # kwaivgi/kling-v2.5-turbo-pro rejects unknown fields with a 422
    # ("Unexpected field 'cfg_scale'" / "'seed'", observed 2026-06-10), so
    # unlike Kling v3 this builder must NOT send cfg_scale or seed.
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_KLING_AR, ar, "16:9"),
        "duration": _dur_or([5, 10], dur, 5),
    }
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    if image:
        inp["start_image"] = image
    return inp


# ===== ByteDance (Seedance) =================================================

def _b_seedance_2_0(prompt, ar, dur, seed, image, audio, adv):
    # Live schema (verified 2026-06-30): no fps / camera_fixed. References
    # arrive via the FilmShotNode's model_options JSON (adv) — the Shot
    # Director forwards data URLs there. Refs XOR first/last-frame image.
    inp: dict[str, Any] = {
        "prompt": prompt,
        "duration": _dur_or([3, 5, 10, 15], dur, 5),
        "resolution": _opt_str(adv, "resolution", "1080p"),
    }
    if "generate_audio" in adv:
        inp["generate_audio"] = bool(adv["generate_audio"])
    # First frame: a wired IMAGE tensor (already a data URL here) wins over a
    # Shot Director data URL in adv.
    first = image or _opt_str(adv, "image", "")
    if first:
        inp["image"] = first
        if last := _opt_str(adv, "last_frame_image", ""):
            inp["last_frame_image"] = last
    else:
        inp["aspect_ratio"] = _ar_or(_SEEDANCE_AR, ar, "16:9")
        for key in ("reference_images", "reference_videos", "reference_audios"):
            vals = adv.get(key)
            if isinstance(vals, list) and vals:
                inp[key] = vals
    _maybe_set_seed(inp, seed)
    return inp


def _b_seedance_2_0_fast(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "duration": _dur_or([3, 5, 10], dur, 5),
        "resolution": _opt_str(adv, "resolution", "720p"),
        "camera_fixed": _opt_bool(adv, "camera_fixed", False),
    }
    if image:
        inp["image"] = image
    else:
        inp["aspect_ratio"] = _ar_or(_SEEDANCE_AR, ar, "16:9")
    _maybe_set_seed(inp, seed)
    return inp


# ===== MiniMax (Hailuo) =====================================================

def _b_hailuo_2_3(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "duration": _dur_or([6, 10], dur, 6),
        "resolution": _opt_str(adv, "resolution", "768p"),
        "prompt_optimizer": _opt_bool(adv, "prompt_optimizer", True),
    }
    if image:
        inp["first_frame_image"] = image
    else:
        inp["aspect_ratio"] = _ar_or(_HAILUO_AR, ar, "16:9")
    _maybe_set_seed(inp, seed)
    return inp


# ===== Wan (open-source) ====================================================

def _b_wan_2_7_t2v(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_WAN_AR, ar, "16:9"),
        "resolution": _opt_str(adv, "resolution", "720p"),
        "num_frames": _opt_int(adv, "num_frames", 81),
    }
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    _maybe_set_seed(inp, seed)
    return inp


def _b_wan_2_5_i2v_fast(prompt, ar, dur, seed, image, audio, adv):
    if not image:
        raise RuntimeError("Wan 2.5 I2V Fast requires an input image.")
    inp: dict[str, Any] = {
        "prompt": prompt,
        "image": image,
        "aspect_ratio": _ar_or(_WAN_AR, ar, "16:9"),
        "resolution": _opt_str(adv, "resolution", "480p"),
    }
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    _maybe_set_seed(inp, seed)
    return inp


# ===== Luma =================================================================

def _b_luma_ray_2_720p(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_LUMA_AR, ar, "16:9"),
        "duration": _dur_or([5, 9], dur, 5),
        "loop": _opt_bool(adv, "loop", False),
    }
    if image:
        # Luma uses start_image_url for I2V.
        inp["start_image_url"] = image
    _maybe_set_seed(inp, seed)
    return inp


# ===== Lightricks (LTX) =====================================================

def _b_ltx_video(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_LTX_AR, ar, "16:9"),
        "guidance_scale": _opt_float(adv, "guidance_scale", 3.0),
        "num_inference_steps": _opt_int(adv, "num_inference_steps", 30),
    }
    if image:
        inp["image"] = image
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    _maybe_set_seed(inp, seed)
    return inp


# ===== VEED (talking-head / lip-sync) =======================================

def _b_fabric_1_0(prompt, ar, dur, seed, image, audio, adv):
    # Fabric is lip-sync: requires BOTH image (face) and audio (voice).
    # Ignores prompt/aspect_ratio/duration/seed entirely — output framing
    # comes from the image, length from the audio.
    if not image:
        raise RuntimeError("Fabric 1.0 requires an input image (face).")
    if not audio:
        raise RuntimeError("Fabric 1.0 requires an input audio clip.")
    return {
        "image": image,
        "audio": audio,
        "resolution": _opt_str(adv, "resolution", "720p"),
    }


# ===== PixVerse =============================================================

def _b_pixverse_v6(prompt, ar, dur, seed, image, audio, adv):
    inp: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_PIXVERSE_AR, ar, "16:9"),
        "duration": _dur_or([5, 8], dur, 5),
        "resolution": _opt_str(adv, "resolution", "720p"),
        "generate_audio": _opt_bool(adv, "generate_audio", True),
    }
    style = _opt_str(adv, "style", "none")
    if style and style != "none":
        inp["style"] = style
    if neg := _opt_str(adv, "negative_prompt", ""):
        inp["negative_prompt"] = neg
    if image:
        inp["image"] = image
    _maybe_set_seed(inp, seed)
    return inp


# ---------- Catalog ---------------------------------------------------------

MODELS: list[VideoModel] = [
    VideoModel(
        id="veo-3.1", label="Veo 3.1", brand="Google",
        replicate_slug="google/veo-3.1",
        aspect_ratios=["16:9", "9:16"], durations=[8], default_duration=8,
        modes=["t2v", "i2v"], build_input=_b_veo_3_1,
    ),
    VideoModel(
        id="veo-3.1-fast", label="Veo 3.1 Fast", brand="Google",
        replicate_slug="google/veo-3.1-fast",
        aspect_ratios=["16:9", "9:16"], durations=[8], default_duration=8,
        modes=["t2v", "i2v"], build_input=_b_veo_3_1_fast,
    ),
    VideoModel(
        id="sora-2", label="Sora 2", brand="OpenAI",
        replicate_slug="openai/sora-2",
        aspect_ratios=["16:9", "9:16", "1:1"], durations=[5, 10], default_duration=5,
        modes=["t2v"], build_input=_b_sora_2,
    ),
    VideoModel(
        id="sora-2-pro", label="Sora 2 Pro", brand="OpenAI",
        replicate_slug="openai/sora-2-pro",
        aspect_ratios=["16:9", "9:16"], durations=[5, 10], default_duration=5,
        modes=["t2v"], build_input=_b_sora_2_pro,
    ),
    VideoModel(
        id="runway-gen-4.5", label="Runway Gen-4.5", brand="Runway",
        replicate_slug="runwayml/gen-4.5",
        aspect_ratios=["16:9", "9:16", "1:1", "4:3", "3:4"],
        durations=[5, 10], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_runway_gen_4_5,
    ),
    VideoModel(
        id="kling-v3", label="Kling Video 3.0", brand="Kling",
        replicate_slug="kwaivgi/kling-v3-video",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5, 10, 15], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_kling_v3,
    ),
    VideoModel(
        id="kling-v2.5-turbo-pro", label="Kling v2.5 Turbo Pro", brand="Kling",
        replicate_slug="kwaivgi/kling-v2.5-turbo-pro",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5, 10], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_kling_v2_5_turbo_pro,
    ),
    VideoModel(
        id="seedance-2.0", label="Seedance 2.0", brand="ByteDance",
        replicate_slug="bytedance/seedance-2.0",
        aspect_ratios=["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        durations=[3, 5, 10, 15], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_seedance_2_0,
    ),
    VideoModel(
        id="seedance-2.0-fast", label="Seedance 2.0 Fast", brand="ByteDance",
        replicate_slug="bytedance/seedance-2.0-fast",
        aspect_ratios=["16:9", "9:16", "1:1", "4:3", "3:4"],
        durations=[3, 5, 10], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_seedance_2_0_fast,
    ),
    VideoModel(
        id="hailuo-2.3", label="Hailuo 2.3", brand="MiniMax",
        replicate_slug="minimax/hailuo-2.3",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[6, 10], default_duration=6,
        modes=["t2v", "i2v"], build_input=_b_hailuo_2_3,
    ),
    VideoModel(
        id="wan-2.7-t2v", label="Wan 2.7 T2V", brand="Wan",
        replicate_slug="wan-video/wan-2.7-t2v",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5], default_duration=5,
        modes=["t2v"], build_input=_b_wan_2_7_t2v,
    ),
    VideoModel(
        id="wan-2.5-i2v-fast", label="Wan 2.5 I2V Fast", brand="Wan",
        replicate_slug="wan-video/wan-2.5-i2v-fast",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5], default_duration=5,
        modes=["i2v"], build_input=_b_wan_2_5_i2v_fast,
    ),
    VideoModel(
        id="luma-ray-2-720p", label="Luma Ray 2 (720p)", brand="Luma",
        replicate_slug="luma/ray-2-720p",
        aspect_ratios=["16:9", "9:16", "1:1", "4:3", "3:4"],
        durations=[5, 9], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_luma_ray_2_720p,
    ),
    VideoModel(
        id="ltx-video", label="LTX-Video", brand="Lightricks",
        replicate_slug="lightricks/ltx-video",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_ltx_video,
    ),
    VideoModel(
        id="pixverse-v6", label="PixVerse v6", brand="PixVerse",
        replicate_slug="pixverse/pixverse-v6",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5, 8], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_pixverse_v6,
    ),
    VideoModel(
        id="fabric-1.0", label="VEED Fabric 1.0", brand="VEED",
        replicate_slug="veed/fabric-1.0",
        # Placeholder values — Fabric ignores aspect_ratio and duration.
        # Output framing matches the image; length matches the audio.
        aspect_ratios=["16:9"],
        durations=[60], default_duration=60,
        modes=["i2v"], build_input=_b_fabric_1_0,
    ),
]


VIDEO_MODELS_BY_ID: dict[str, VideoModel] = {m.id: m for m in MODELS}

# Default model id used by GenerateVideoNode's schema. Veo 3.1 is the safest
# "just works" pick — high quality, native audio, broadly available.
DEFAULT_VIDEO_MODEL_ID: str = "veo-3.1"


# Aggregated option lists used by GenerateVideoNode for its top-level combos.
# The per-model builders are still the source of truth for what's actually
# accepted — these aggregates exist so the schema can declare a single combo
# that includes every value any model takes, and the dispatcher remaps to a
# per-model fallback when the user's pick isn't supported.
ALL_VIDEO_ASPECT_RATIOS: list[str] = sorted(
    {ar for m in MODELS for ar in m.aspect_ratios},
    key=lambda s: (0 if s == "1:1" else 1, s),
)
ALL_VIDEO_DURATIONS: list[int] = sorted({d for m in MODELS for d in m.durations})
