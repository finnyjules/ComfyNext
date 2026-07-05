"""Product-swap instruction text for the Swap Product node.

Kept free of torch / comfy_api / network imports so the prompt building stays
fast and importable in CI (mirrors comfy_extras/_person_swap_prompts.py). The
node places a new product into a finished packshot scene, copying the scene's
background, framing, camera and lighting from the reference image — so results
stay consistent across products without seed-locking.
"""
from __future__ import annotations

SWAP_PRODUCT_PROMPT = (
    "The first image is a finished product photo — a packshot with a fixed "
    "background, surface, camera angle and lighting. The second image shows a "
    "different product. Replace the product in the first image with the product "
    "from the second image, placed in the same position, scale and orientation "
    "as the original product. "
    "Fully RE-LIGHT the new product so it is physically lit by the first image's "
    "scene: match the scene's lighting direction, colour temperature, contrast "
    "and falloff; add the same highlights and reflections; and cast the same "
    "soft contact shadow on the surface. Discard the second image's original "
    "studio lighting and white balance entirely — the product must look lit by "
    "this environment, never pasted in. "
    "Preserve the new product's exact shape, proportions and branding — its "
    "label, logo, text and artwork must stay accurate, correctly placed and "
    "legible — but let their illumination, shading and colour temperature follow "
    "the scene's light rather than the second image's. "
    "Keep EVERYTHING ELSE from the first image identical: the background, "
    "surface, framing, camera angle, lens perspective, depth of field and grain. "
    "Output only the edited scene."
)


def swap_product_instruction(instructions: str = "") -> str:
    """Build the nano-banana-2 instruction for a product swap.

    instructions: optional free-text refinement; appended as an extra sentence
                  when non-blank.
    """
    extra = (instructions or "").strip()
    if extra:
        return f"{SWAP_PRODUCT_PROMPT} Additional direction: {extra}."
    return SWAP_PRODUCT_PROMPT
