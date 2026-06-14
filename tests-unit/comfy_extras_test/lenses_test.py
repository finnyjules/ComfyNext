"""Unit tests for comfy_extras._lenses (lens library + instruction builder)."""
from comfy_extras import _lenses


def test_every_lens_has_required_keys_and_valid_focal():
    for lens in _lenses.LENSES:
        for key in ("name", "focal_mm", "look"):
            assert key in lens, f"{lens.get('name')} missing {key}"
        assert lens["focal_mm"] > 0
        assert isinstance(lens["look"], str) and lens["look"]


def test_names_include_custom_last():
    assert _lenses.NAMES[-1] == _lenses.CUSTOM
    assert len(_lenses.NAMES) == len(_lenses.LENSES) + 1


def test_get_known_and_unknown():
    assert _lenses.get("Normal 50mm Planar")["focal_mm"] == 50
    assert _lenses.get("Custom") is None
    assert _lenses.get("nonexistent") is None


def test_focal_for_falls_back_to_custom():
    assert _lenses.focal_for("Portrait 85mm GM", 123.0) == 85.0
    assert _lenses.focal_for("Custom", 123.0) == 123.0


def test_reframe_instruction_mentions_target_and_direction():
    # 50 → 85 is a telephoto move; instruction should describe the target look.
    instr = _lenses.reframe_instruction("Normal 50mm Planar", "Portrait 85mm GM", 1.0, 50.0)
    assert "85mm" in instr
    assert "telephoto" in instr
    assert "identity" in instr  # preserves the subject

    # 50 → 24 is a wider move.
    wide = _lenses.reframe_instruction("Normal 50mm Planar", "Wide 24mm Art", 1.0, 50.0)
    assert "wide-angle" in wide


def test_reframe_instruction_custom_focal():
    instr = _lenses.reframe_instruction("Custom", "Custom", 1.0, 70.0)
    assert "70mm" in instr
