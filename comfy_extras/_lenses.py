"""Curated real-lens library for Lens · 3D Reframe (data only, no IO).

Each lens bundles a focal length with a photographic "look" — a natural-language
description of its perspective and rendering that drives the image model
(nano-banana-2) that re-shoots the photo. A full-frame 36mm sensor is assumed.
"""
from __future__ import annotations

LENSES: list[dict] = [
    {"name": "Ultra-Wide 16mm", "focal_mm": 16,
     "look": "an ultra-wide 16mm lens — a very wide field of view with strong "
             "wide-angle perspective where the nearest parts of the subject loom "
             "larger and the background feels expansive and pushed far back, with "
             "gentle barrel distortion toward the frame edges"},
    {"name": "Wide 24mm Art", "focal_mm": 24,
     "look": "a wide 24mm lens — an environmental wide field of view with natural "
             "wide-angle perspective, mild foreground emphasis and a touch of "
             "barrel distortion"},
    {"name": "Classic 35mm Summilux", "focal_mm": 35,
     "look": "a classic 35mm lens — a natural, slightly wide documentary field of "
             "view with relaxed, true-to-life perspective"},
    {"name": "Normal 50mm Planar", "focal_mm": 50,
     "look": "a normal 50mm lens — a neutral, eye-like field of view and natural "
             "perspective with no compression or distortion"},
    {"name": "Portrait 85mm GM", "focal_mm": 85,
     "look": "an 85mm portrait lens — flattering telephoto compression that gently "
             "flattens facial features, a tighter field of view and smooth, "
             "separated background"},
    {"name": "Tele 135mm f/2", "focal_mm": 135,
     "look": "a 135mm telephoto lens — strong perspective compression that flattens "
             "depth, a narrow field of view and a softly compressed background"},
    {"name": "Long 200mm", "focal_mm": 200,
     "look": "a 200mm super-telephoto lens — very strong compression that flattens "
             "the scene, a very narrow field of view and a tightly stacked, "
             "compressed background"},
]

CUSTOM = "Custom"
NAMES: list[str] = [lens["name"] for lens in LENSES] + [CUSTOM]

_BY_NAME = {lens["name"]: lens for lens in LENSES}


def get(name: str) -> dict | None:
    """Look up a lens by name. Returns None for Custom / unknown names."""
    return _BY_NAME.get(name)


def focal_for(name: str, custom_focal: float) -> float:
    """Resolve a lens name to its focal length, falling back to custom_focal."""
    lens = _BY_NAME.get(name)
    return float(lens["focal_mm"]) if lens else float(custom_focal)


def _intensity(strength: float) -> str:
    if strength < 0.4:
        return "a subtle"
    if strength < 0.8:
        return "a moderate"
    if strength < 1.15:
        return "a clear"
    return "a strong, dramatic"


def reframe_instruction(source_name: str, target_name: str,
                        strength: float = 1.0, custom_focal: float = 50.0) -> str:
    """Build the nano-banana-2 instruction that re-shoots the photo on a new lens."""
    src = get(source_name)
    tgt = get(target_name)
    src_focal = int(src["focal_mm"]) if src else int(custom_focal)
    tgt_focal = int(tgt["focal_mm"]) if tgt else int(custom_focal)
    tgt_look = tgt["look"] if tgt else f"a {tgt_focal}mm lens"

    if tgt_focal < src_focal:
        direction = "wider, more wide-angle"
    elif tgt_focal > src_focal:
        direction = "longer, more telephoto"
    else:
        direction = "equivalent"

    return (
        f"Re-photograph this exact scene as if it were shot on {tgt_look}, instead "
        f"of the {src_focal}mm lens it was actually taken with. Apply {_intensity(strength)} "
        f"change toward the {direction} look: adjust the field of view, perspective, "
        f"depth compression and optical rendering accordingly, moving the camera "
        f"distance the way a real photographer would so the subject stays naturally "
        f"framed. Keep the subject's identity, face, hair, body, pose and outfit, and "
        f"the background and lighting, exactly the same — change only the lens and "
        f"viewpoint. Photorealistic, sharp, high detail, full-frame photograph."
    )
