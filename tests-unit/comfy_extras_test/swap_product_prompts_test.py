"""Unit tests for product-swap instruction building
(comfy_extras._swap_product_prompts). Dependency-light by design: no torch, no
comfy_api, no network — fast and importable in CI.
"""
from comfy_extras import _swap_product_prompts as sp


def test_blank_instructions_returns_base_prompt():
    assert sp.swap_product_instruction("") == sp.SWAP_PRODUCT_PROMPT


def test_whitespace_instructions_returns_base_prompt():
    assert sp.swap_product_instruction("   ") == sp.SWAP_PRODUCT_PROMPT


def test_instructions_appended_when_present():
    out = sp.swap_product_instruction("shift the bottle slightly left")
    assert out.startswith(sp.SWAP_PRODUCT_PROMPT)
    assert "Additional direction: shift the bottle slightly left." in out


def test_base_prompt_preserves_branding_language():
    # The whole point of a product swap: the new product's own branding must be kept.
    low = sp.SWAP_PRODUCT_PROMPT.lower()
    assert "label" in low or "logo" in low or "branding" in low


def test_base_prompt_keeps_scene_fixed():
    # The reference scene's background and camera must be preserved.
    low = sp.SWAP_PRODUCT_PROMPT.lower()
    assert "background" in low and "camera" in low
