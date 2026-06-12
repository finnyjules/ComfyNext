"""Person-swap instruction text for the Person Swap node's two outfit modes.

Kept free of torch / comfy_api / network imports so the keep-outfit-vs-new-look
prompt selection is unit-testable in CI (mirrors comfy_extras/_pose_prompts.py).
"""
from __future__ import annotations

# keep_outfit = True: swap identity only, keep the original scene's wardrobe.
KEEP_OUTFIT_PROMPT = (
    "The first image is a scene containing a person. The second image shows a "
    "different person (their identity/likeness). Replace the person in the first "
    "image with the person from the second image — give them the second person's "
    "face, hair, skin tone and body type — but keep EVERYTHING ELSE from the first "
    "image identical: the same clothing/outfit, the same body pose and stance, the "
    "same framing, camera angle, background and lighting. Only the person's "
    "identity changes; the wardrobe and the scene stay exactly as they are. Do not "
    "restyle, recolor or redraw the clothing. Output only the edited scene."
)

# keep_outfit = False: bring the new person AND their own clothing/style.
NEW_LOOK_PROMPT = (
    "The first image is a scene containing a person. The second image shows a "
    "different person. Replace the person in the first image with the person from "
    "the second image, bringing the second person's own appearance AND their "
    "clothing/style. Keep the first image's body pose and stance, framing, camera "
    "angle, background and lighting unchanged — only the person and their wardrobe "
    "become the second person. Output only the edited scene."
)


def swap_instruction(keep_outfit: bool, instructions: str = "") -> str:
    """Build the nano-banana-2 instruction for a person swap.

    keep_outfit:  True → keep the original scene's wardrobe (identity-only swap);
                  False → bring the new person's own clothing too.
    instructions: optional free-text direction (also the multi-person targeting
                  hint, e.g. "replace the woman on the left"); appended when set.
    """
    base = KEEP_OUTFIT_PROMPT if keep_outfit else NEW_LOOK_PROMPT
    extra = (instructions or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base
