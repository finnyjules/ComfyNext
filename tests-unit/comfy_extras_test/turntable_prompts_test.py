"""Unit tests for turntable instruction building (comfy_extras._turntable_prompts).
Dependency-light: no torch/comfy_api/network."""
from comfy_extras import _turntable_prompts as tp


def test_simple_spin_has_360_loop_and_direction():
    out = tp.simple_spin_instruction("left").lower()
    assert "360" in out and "loop" in out and "left" in out

def test_segment_has_degrees_direction_and_no_morphing():
    out = tp.segment_instruction(90, "right").lower()
    assert "90" in out and "right" in out and "no morphing" in out

def test_instructions_appended_both_helpers():
    assert "Additional direction: keep it slow." in tp.simple_spin_instruction("left", "keep it slow")
    assert "Additional direction: keep it slow." in tp.segment_instruction(180, "left", "keep it slow")

def test_blank_instructions_not_appended():
    assert "Additional direction" not in tp.simple_spin_instruction("left", "   ")
    assert "Additional direction" not in tp.segment_instruction(90, "left", "")
