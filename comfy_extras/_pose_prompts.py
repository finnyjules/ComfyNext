"""Pose-instruction text for the Pose Mannequin node's three pose sources.

Kept free of torch / comfy_api / network imports so the prompt-selection logic
is unit-testable in CI (mirrors comfy_api_nodes/replicate_refs.py). The Python
node imports these; the mannequin instant path in
frontend/server/api/inpaint/pose.post.ts keeps its own copy of MANNEQUIN_PROMPT.
"""
from __future__ import annotations

# Mannequin mode: the 2nd image is a SURFACE-NORMAL render (colours encode facing
# direction). Unchanged from the original node so mannequin output is identical.
MANNEQUIN_PROMPT = (
    "The first image is a character. The second image is a SURFACE-NORMAL render of "
    "a posed 3D mannequin: its colours encode the target body pose AND the exact 3D "
    "orientation — which way the body and each limb face. Redraw the EXACT SAME "
    "character from the first image — keep their face, hair, skin tone, body type, "
    "clothing and art style identical — but pose them to match the second image: "
    "limb positions, stance, head angle, AND the whole-body orientation/facing "
    "direction (front, three-quarter, side, or back). If the body is turned or facing "
    "away, turn the character the same way; do NOT default to a front-facing view. "
    "Full body, head to toe, plain neutral studio background, natural and photographic. "
    "Output only the character in that pose, never the normal-map render itself."
)

# Image mode: the 2nd image is a REAL photo/figure. Copy only its pose — not its
# identity, clothing, or background.
IMAGE_PROMPT = (
    "The first image is a character. The second image shows a person or figure in a "
    "TARGET body pose. Redraw the EXACT SAME character from the first image — keep "
    "their face, hair, skin tone, body type, clothing and art style identical — but "
    "re-pose them to match the SECOND image's body pose: stance, limb positions, head "
    "angle, and whole-body orientation/facing direction. Copy ONLY the pose from the "
    "second image — never its identity, clothing, or background. Full body, head to "
    "toe, plain neutral studio background, natural and photographic. Output only the "
    "re-posed character."
)

# Prompt mode: a single character image + a text pose description. {pose} is filled
# from the node's pose_prompt widget.
TEXT_PROMPT = (
    "The image is a character. Redraw the EXACT SAME character — keep their face, "
    "hair, skin tone, body type, clothing and art style identical — but re-pose their "
    "body as follows: {pose}. Full body, head to toe, plain neutral studio "
    "background, natural and photographic. Output only the re-posed character."
)

_DEFAULT_POSE = "a natural, relaxed standing pose"


def pose_instruction(pose_source: str, extra: str = "", pose_prompt: str = "") -> str:
    """Build the nano-banana-2 instruction for a given pose source.

    pose_source: "mannequin" | "image" | "prompt" (anything else → mannequin).
    extra:       optional free-text direction (lighting/outfit notes), appended.
    pose_prompt: the body-pose description, only used by "prompt" mode.
    """
    if pose_source == "image":
        base = IMAGE_PROMPT
    elif pose_source == "prompt":
        pose = (pose_prompt or "").strip() or _DEFAULT_POSE
        base = TEXT_PROMPT.format(pose=pose)
    else:
        base = MANNEQUIN_PROMPT

    extra = (extra or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base
