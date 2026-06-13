"""Unit tests for relight instruction building (comfy_extras._relight_prompts).

Dependency-light by design: no torch, no comfy_api, no network — so the
gimbal-angle → director's-note translation stays fast and importable in CI
(mirrors comfy_extras/_person_swap_prompts.py).
"""
from comfy_extras import _relight_prompts as rl


def test_direction_buckets():
    assert "from the front" in rl.light_to_phrase(0, 0, 0.6)
    assert "from the front-left" in rl.light_to_phrase(-30, 0, 0.6)
    assert "from the left" in rl.light_to_phrase(-90, 0, 0.6)
    assert "from the back-right" in rl.light_to_phrase(135, 0, 0.6)
    assert "from behind" in rl.light_to_phrase(180, 0, 0.6)


def test_elevation_buckets():
    # near eye level → no height clause
    assert "positioned" not in rl.light_to_phrase(0, 0, 0.6)
    # positive side
    assert "positioned above" in rl.light_to_phrase(0, 30, 0.6)
    assert "high above" in rl.light_to_phrase(0, 60, 0.6)
    assert "overhead" in rl.light_to_phrase(0, 85, 0.6)
    # negative side
    assert "slightly below" in rl.light_to_phrase(0, -30, 0.6)
    assert "below" in rl.light_to_phrase(0, -60, 0.6)
    assert "far below" in rl.light_to_phrase(0, -85, 0.6)


def test_intensity_buckets():
    assert "soft" in rl.light_to_phrase(0, 0, 0.1)
    assert "moderate" in rl.light_to_phrase(0, 0, 0.4)
    assert "strong" in rl.light_to_phrase(0, 0, 0.6)
    assert "dramatic" in rl.light_to_phrase(0, 0, 0.9)


def test_preset_phrase_included_only_when_not_custom():
    custom = rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "")
    assert "Lighting style:" not in custom
    golden = rl.relight_instruction("Golden hour", 0, 0, 0.6, True, False, "")
    assert "Lighting style:" in golden
    assert rl.PRESET_PHRASES["Golden hour"] in golden


def test_keep_background_clause_toggles():
    keep = rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "")
    assert "ONLY the lighting" in keep
    change = rl.relight_instruction("Custom", 0, 0, 0.6, False, False, "")
    assert "environment and background" in change


def test_reference_clause_only_when_has_reference():
    assert "lighting reference" not in rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "")
    assert "lighting reference" in rl.relight_instruction("Custom", 0, 0, 0.6, True, True, "")


def test_instructions_appended_only_when_present():
    assert "Additional direction:" not in rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "   ")
    out = rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "warmer please")
    assert "Additional direction: warmer please." in out


def test_always_ends_with_output_clause():
    out = rl.relight_instruction("Golden hour", -30, 20, 0.6, True, True, "x")
    assert out.rstrip().endswith("Output only the edited image.")
