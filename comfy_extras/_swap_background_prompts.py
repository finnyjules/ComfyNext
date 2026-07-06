"""Swap-background instruction text for the Swap Background node.

Locks the product and changes the environment (the inverse of Swap Product).
Kept free of torch / comfy_api / network imports so it is unit-testable in CI
(mirrors comfy_extras/_swap_product_prompts.py). Two modes: a wired background
reference image, or a text scene prompt.

Relight lesson (commit b38f825e0): when relighting, do NOT tell the model to
reproduce the product's colours "faithfully / do not alter" — that suppresses
the relight. Branding fidelity (shape/label/logo) is separated from illumination.
"""
from __future__ import annotations

_REF_BASE = (
    "The first image is a background scene. The second image is a product. "
    "Place the product from the second image into the first image's scene so it "
    "looks like it genuinely belongs there. "
)
_PROMPT_BASE_TEMPLATE = (
    "The image is a product on a plain/neutral background. Replace the "
    "background with a new scene described as: {scene}. Place the product into "
    "that new scene so it looks like it genuinely belongs there. "
)
_BRANDING = (
    "Preserve the product's exact shape, proportions and branding — its label, "
    "logo, text and artwork must stay accurate, correctly placed and legible. "
)
_RELIGHT_ON = (
    "Re-light the product so it is physically lit by the new scene: match the "
    "scene's light direction, colour temperature and reflections, while keeping "
    "its branding artwork intact. "
)
_RELIGHT_OFF = (
    "Keep the product's original lighting exactly as shot — do not change how the "
    "product itself is lit; only replace what is behind it. "
)
_SHADOW_ON = (
    "Add a soft, realistic contact shadow and any appropriate reflection where the "
    "product meets the surface, so it sits in the scene. "
)
_SHADOW_OFF = (
    "Add no cast shadow — keep the product cleanly separated from the background. "
)
_KEEP_PLACEMENT_ON = (
    "Keep the product at the same size and position in frame as the input. "
)
_KEEP_PLACEMENT_OFF = (
    "Compose the product naturally within the new scene (it may be re-placed or "
    "resized for a pleasing composition). "
)
_TAIL = "Output only the edited image."


def build_swap_background_instruction(
    has_reference: bool,
    scene_prompt: str,
    relight_to_scene: bool,
    ground_with_shadow: bool,
    keep_scale_and_placement: bool,
    instructions: str = "",
) -> str:
    """Assemble the nano-banana-2 instruction for a product background swap.

    has_reference True → reference mode (image_input = [background, product]).
    Else prompt mode (image_input = [product]); scene_prompt describes the scene.
    """
    if has_reference:
        parts = [_REF_BASE]
    else:
        parts = [_PROMPT_BASE_TEMPLATE.format(scene=(scene_prompt or "").strip())]
    parts.append(_BRANDING)
    parts.append(_RELIGHT_ON if relight_to_scene else _RELIGHT_OFF)
    parts.append(_SHADOW_ON if ground_with_shadow else _SHADOW_OFF)
    parts.append(_KEEP_PLACEMENT_ON if keep_scale_and_placement else _KEEP_PLACEMENT_OFF)
    parts.append(_TAIL)
    base = "".join(parts)
    extra = (instructions or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base
