"""Unit tests for pose-instruction building (comfy_extras._pose_prompts).

Dependency-light by design: no torch, no comfy_api, no network — so the
prompt-selection logic that decides how a character gets re-posed stays fast
and importable in CI.
"""
from comfy_extras import _pose_prompts as pp


def test_mannequin_mode_uses_normal_map_base_prompt():
    out = pp.pose_instruction("mannequin", "", "")
    assert out == pp.MANNEQUIN_PROMPT


def test_image_mode_uses_image_base_prompt():
    out = pp.pose_instruction("image", "", "")
    assert out == pp.IMAGE_PROMPT


def test_prompt_mode_embeds_the_pose_description():
    out = pp.pose_instruction("prompt", "", "sitting cross-legged on the floor")
    assert "sitting cross-legged on the floor" in out
    assert "{pose}" not in out  # template was actually filled


def test_prompt_mode_blank_description_falls_back_to_a_default_pose():
    out = pp.pose_instruction("prompt", "", "   ")
    assert "{pose}" not in out
    assert len(out) > 0


def test_extra_direction_is_appended_when_present():
    out = pp.pose_instruction("image", "dramatic rim lighting", "")
    assert out.startswith(pp.IMAGE_PROMPT)
    assert "Additional direction: dramatic rim lighting." in out


def test_no_extra_direction_appended_when_blank():
    out = pp.pose_instruction("image", "   ", "")
    assert "Additional direction:" not in out


def test_unknown_source_defaults_to_mannequin():
    assert pp.pose_instruction("bogus", "", "") == pp.MANNEQUIN_PROMPT
