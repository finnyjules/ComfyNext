"""Dispatch tests for the Text Effect node.

These exercise `build_text_effect_request` — the pure decision of *which model*
and *what inputs* — rather than the node's `execute`. Importing the node would
drag in the whole ComfyUI server stack (torch, PromptServer, …), so the logic
worth testing lives in the dependency-free catalog module and is tested there.
The node itself is a thin wrapper: encode the tensor → call the builder → run
the prediction → decode the result.
"""
import pytest

from comfy_api_nodes.text_effects import (
    EFFECTS_BY_ID,
    DEFAULT_EFFECT_ID,
    build_prompt,
    build_edit_prompt,
    build_text_effect_request,
    aspect_ok,
    _EDIT_MODEL_SLUG,
)


def test_generate_mode_uses_ideogram():
    slug, inp = build_text_effect_request("liquid-chrome", "NEXT", "16:9", seed=0)
    assert slug == EFFECTS_BY_ID["liquid-chrome"].model_slug
    assert slug == "ideogram-ai/ideogram-v3-turbo"
    assert inp["prompt"] == build_prompt("liquid-chrome", "NEXT")
    assert inp["aspect_ratio"] == "16:9"
    assert inp["magic_prompt_option"] == "Off"
    assert "input_image" not in inp


def test_restyle_mode_uses_flux_kontext():
    slug, inp = build_text_effect_request(
        "liquid-chrome", "", "16:9", seed=0, image_data_url="DATA_URL")
    assert slug == _EDIT_MODEL_SLUG == "black-forest-labs/flux-kontext-pro"
    assert inp["input_image"] == "DATA_URL"
    assert inp["aspect_ratio"] == "match_input_image"
    assert inp["output_format"] == "png"
    assert inp["prompt"] == build_edit_prompt("liquid-chrome", "")


def test_generate_requires_text_but_restyle_does_not():
    # Generate mode with blank text errors…
    with pytest.raises(ValueError):
        build_text_effect_request("liquid-chrome", "  ", "1:1", seed=0)
    # …but restyle mode with blank text is fine (the word is in the image).
    slug, _ = build_text_effect_request(
        "liquid-chrome", "  ", "1:1", seed=0, image_data_url="DATA_URL")
    assert slug == _EDIT_MODEL_SLUG


def test_seed_only_included_when_positive():
    _, gen = build_text_effect_request("liquid-chrome", "NEXT", "1:1", seed=0)
    assert "seed" not in gen
    _, gen_seeded = build_text_effect_request("liquid-chrome", "NEXT", "1:1", seed=7)
    assert gen_seeded["seed"] == 7
    _, edit = build_text_effect_request(
        "liquid-chrome", "", "1:1", seed=0, image_data_url="DATA_URL")
    assert "seed" not in edit
    _, edit_seeded = build_text_effect_request(
        "liquid-chrome", "", "1:1", seed=9, image_data_url="DATA_URL")
    assert edit_seeded["seed"] == 9


def test_generate_validates_aspect_ratio():
    _, inp = build_text_effect_request("liquid-chrome", "NEXT", "bogus", seed=0)
    assert inp["aspect_ratio"] == aspect_ok("bogus") == "1:1"


def test_unknown_effect_falls_back_to_default():
    slug, inp = build_text_effect_request("does-not-exist", "NEXT", "1:1", seed=0)
    assert slug == EFFECTS_BY_ID[DEFAULT_EFFECT_ID].model_slug
    assert inp["prompt"] == build_prompt(DEFAULT_EFFECT_ID, "NEXT")
