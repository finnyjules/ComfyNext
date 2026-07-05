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
    "from the second image, placing it in the same position, scale and "
    "orientation as the original product. Reproduce the second product's shape, "
    "proportions, label, logo, text and colours faithfully — do not invent, "
    "restyle or alter any branding. Relight the new product to match the "
    "scene's lighting direction, colour temperature, shadows and reflections, "
    "and match the camera's lens perspective, depth of field and grain. Keep "
    "EVERYTHING ELSE from the first image identical: the background, surface, "
    "framing and camera angle. Output only the edited scene."
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
