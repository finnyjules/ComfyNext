"""Edit-action instruction text for the Remove Object / Text Edit / Recolor
Object nodes (comfy_extras/nodes_edit_actions.py).

Kept free of torch / comfy_api / network imports so prompt building stays fast
and importable in CI (mirrors comfy_extras/_swap_product_prompts.py). Each
builder returns a complete nano-banana-2 instruction; the shared `_finish`
appends the user's optional free-text refinement.
"""
from __future__ import annotations


def _finish(base: str, instructions: str = "") -> str:
    extra = (instructions or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base


def remove_object_instruction(target: str, instructions: str = "") -> str:
    """Instruction to erase a described object and fill the hole from the scene."""
    base = (
        f"Remove {target.strip()} from the image completely. Fill the area it "
        "occupied by seamlessly continuing the surrounding background — match "
        "the scene's textures, perspective, lighting and grain so no trace, "
        "outline or shadow of the removed object remains. "
        "Keep EVERYTHING ELSE in the image exactly as it is: composition, "
        "framing, colours, other subjects and overall lighting. "
        "Output only the edited image."
    )
    return _finish(base, instructions)


def text_edit_instruction(find: str, replace: str, instructions: str = "") -> str:
    """Instruction to replace rendered text in the image, keeping typography."""
    base = (
        f"Find the text '{find.strip()}' in the image and replace it with "
        f"'{replace.strip()}'. Match the original typography exactly: the same "
        "font, weight, size, colour, letter-spacing, perspective, distortion "
        "and lighting, so the new text looks native to the image. "
        "Change NOTHING ELSE — every other pixel, object and text element "
        "stays exactly as it is. Output only the edited image."
    )
    return _finish(base, instructions)


def recolor_instruction(target: str, color: str, instructions: str = "") -> str:
    """Instruction to recolor a described object while keeping its material."""
    base = (
        f"Change the colour of {target.strip()} to {color.strip()}. "
        "Keep the object's material, texture, shading, highlights, reflections "
        "and the scene's lighting exactly as they are — only the object's base "
        "colour changes, as if the same object had been manufactured in the "
        "new colour. Keep EVERYTHING ELSE in the image untouched. "
        "Output only the edited image."
    )
    return _finish(base, instructions)
