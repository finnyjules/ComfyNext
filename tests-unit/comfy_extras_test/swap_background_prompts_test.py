"""Unit tests for swap-background instruction building
(comfy_extras._swap_background_prompts). Dependency-light: no torch, no
comfy_api, no network — fast and importable in CI.
"""
from comfy_extras import _swap_background_prompts as sb


def _base(**kw):
    args = dict(has_reference=False, scene_prompt="", relight_to_scene=True,
                ground_with_shadow=True, keep_scale_and_placement=True, instructions="")
    args.update(kw)
    return sb.build_swap_background_instruction(**args)


def test_reference_mode_wording_when_has_reference():
    out = _base(has_reference=True)
    low = out.lower()
    assert "first image" in low and "second image" in low  # two-image framing

def test_prompt_mode_includes_scene_prompt_text():
    out = _base(has_reference=False, scene_prompt="marble bathroom counter")
    assert "marble bathroom counter" in out

def test_branding_always_preserved():
    low = _base().lower()
    assert "label" in low or "logo" in low or "branding" in low

def test_relight_on_adds_relight_clause_off_keeps_original():
    on = _base(relight_to_scene=True).lower()
    off = _base(relight_to_scene=False).lower()
    assert "relight" in on or "re-light" in on
    assert "original lighting" in off or "keep the product's lighting" in off

def test_no_faithful_colours_trap_when_relighting():
    # The b38f825e0 lesson: relight mode must NOT tell the model to keep the
    # product's colours faithfully/unaltered (that suppresses relighting).
    low = _base(relight_to_scene=True).lower()
    assert "colours faithfully" not in low and "colors faithfully" not in low

def test_ground_with_shadow_toggles_clause():
    on = _base(ground_with_shadow=True).lower()
    off = _base(ground_with_shadow=False).lower()
    assert "shadow" in on
    assert "no cast shadow" in off or "no shadow" in off

def test_keep_scale_toggles_clause():
    on = _base(keep_scale_and_placement=True).lower()
    off = _base(keep_scale_and_placement=False).lower()
    assert "same size and position" in on or "same scale and position" in on
    assert "compose" in off

def test_instructions_appended_when_present():
    out = _base(instructions="warmer tone")
    assert "Additional direction: warmer tone." in out

def test_instructions_blank_not_appended():
    assert "Additional direction" not in _base(instructions="   ")
