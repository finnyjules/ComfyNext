"""Unit tests for edit-action instruction building
(comfy_extras._edit_action_prompts). Dependency-light by design: no torch, no
comfy_api, no network — fast and importable in CI.
"""
from comfy_extras import _edit_action_prompts as ep


# ── remove_object_instruction ────────────────────────────────────────────────

def test_remove_names_the_target():
    out = ep.remove_object_instruction("the red car")
    assert "the red car" in out


def test_remove_fills_with_background():
    # The hole must be filled from the surrounding scene, not left blank or
    # replaced with something new.
    low = ep.remove_object_instruction("a lamppost").lower()
    assert "background" in low or "surrounding" in low
    assert "remove" in low


def test_remove_keeps_everything_else():
    low = ep.remove_object_instruction("a lamppost").lower()
    assert "everything else" in low or "keep" in low


def test_remove_appends_extra_instructions():
    out = ep.remove_object_instruction("the sign", "match the wall texture")
    assert out.endswith("Additional direction: match the wall texture.")


def test_remove_strips_blank_instructions():
    assert ep.remove_object_instruction("x", "   ") == ep.remove_object_instruction("x")


# ── text_edit_instruction ────────────────────────────────────────────────────

def test_text_edit_quotes_find_and_replace():
    out = ep.text_edit_instruction("SALE", "50% OFF")
    assert "'SALE'" in out and "'50% OFF'" in out


def test_text_edit_preserves_typography():
    # Regression guard: without this clause the model redraws the whole sign.
    low = ep.text_edit_instruction("a", "b").lower()
    assert "font" in low and "perspective" in low
    assert "change nothing else" in low or "everything else" in low


def test_text_edit_appends_extra_instructions():
    out = ep.text_edit_instruction("a", "b", "keep the neon glow")
    assert out.endswith("Additional direction: keep the neon glow.")


# ── recolor_instruction ──────────────────────────────────────────────────────

def test_recolor_names_target_and_color():
    out = ep.recolor_instruction("the shirt", "forest green (#2d6a4f)")
    assert "the shirt" in out and "forest green (#2d6a4f)" in out


def test_recolor_keeps_material_and_lighting():
    # The point of recolor vs regenerate: texture, shading and lighting stay.
    low = ep.recolor_instruction("the shirt", "red").lower()
    assert "texture" in low and "lighting" in low
    assert "material" in low or "shading" in low


def test_recolor_appends_extra_instructions():
    out = ep.recolor_instruction("the mug", "#ff0000", "matte finish")
    assert out.endswith("Additional direction: matte finish.")
