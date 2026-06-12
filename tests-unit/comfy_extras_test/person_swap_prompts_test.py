"""Unit tests for person-swap instruction building (comfy_extras._person_swap_prompts).

Dependency-light by design: no torch, no comfy_api, no network — so the
keep-outfit-vs-new-look prompt selection stays fast and importable in CI.
"""
from comfy_extras import _person_swap_prompts as ps


def test_keep_outfit_true_uses_keep_outfit_prompt():
    assert ps.swap_instruction(True, "") == ps.KEEP_OUTFIT_PROMPT


def test_keep_outfit_false_uses_new_look_prompt():
    assert ps.swap_instruction(False, "") == ps.NEW_LOOK_PROMPT


def test_instructions_appended_when_present():
    out = ps.swap_instruction(True, "replace the woman on the left")
    assert out.startswith(ps.KEEP_OUTFIT_PROMPT)
    assert "Additional direction: replace the woman on the left." in out


def test_no_instructions_appended_when_blank():
    assert ps.swap_instruction(True, "   ") == ps.KEEP_OUTFIT_PROMPT
    assert ps.swap_instruction(False, "") == ps.NEW_LOOK_PROMPT


def test_keep_outfit_prompt_preserves_wardrobe_language():
    # The whole point of keep_outfit: the original clothing must be retained.
    assert "outfit" in ps.KEEP_OUTFIT_PROMPT.lower() or "clothing" in ps.KEEP_OUTFIT_PROMPT.lower()


def test_new_look_prompt_brings_new_wardrobe():
    assert "clothing" in ps.NEW_LOOK_PROMPT.lower() or "wardrobe" in ps.NEW_LOOK_PROMPT.lower()
