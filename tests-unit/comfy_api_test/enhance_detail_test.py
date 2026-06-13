"""Unit tests for the Enhance Detail engine→Replicate-input mapping.

Pure logic: given a chosen engine, an image URL, a prompt, a detail_strength,
and per-engine advanced params, produce the (slug, input_dict) that will be
sent to Replicate. No network, no torch — lives in replicate_refs so it stays
importable in CI.
"""
import pytest

from comfy_api_nodes import replicate_refs as rr

IMG = "data:image/png;base64,AAAA"


def test_creative_uses_clarity_in_place():
    slug, body = rr.build_enhance_input(
        "Creative", image_url=IMG, prompt="hi", detail_strength=0.4,
    )
    assert slug == "philz1337x/clarity-upscaler"
    assert body["image"] == IMG
    assert body["prompt"] == "hi"
    assert body["scale_factor"] == 1.0          # strictly in place
    assert body["creativity"] == pytest.approx(0.3)   # 0.1 + 0.4*0.5
    assert body["output_format"] == "png"


def test_creative_creativity_endpoints():
    _, lo = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=0.0)
    _, hi = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=1.0)
    assert lo["creativity"] == pytest.approx(0.1)
    assert hi["creativity"] == pytest.approx(0.6)


def test_creative_seed_omitted_when_zero_and_sent_when_positive():
    _, no_seed = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=0.4, seed=0)
    _, seeded = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=0.4, seed=7)
    assert "seed" not in no_seed
    assert seeded["seed"] == 7


def test_faithful_uses_topaz_enhance_only():
    slug, body = rr.build_enhance_input(
        "Faithful", image_url=IMG, prompt="ignored", detail_strength=0.9,
        topaz_enhance_model="High Fidelity V2", topaz_subject_detection="Foreground",
        topaz_output_format="jpg",
    )
    assert slug == "topazlabs/image-upscale"
    assert body["upscale_factor"] == "None"      # enhance only, no resize
    assert body["enhance_model"] == "High Fidelity V2"
    assert body["subject_detection"] == "Foreground"
    assert body["output_format"] == "jpg"
    assert "prompt" not in body                  # Faithful ignores prompt
    assert "scale_factor" not in body


def test_diffusion_refine_uses_magic_image_refiner_in_place():
    slug, body = rr.build_enhance_input(
        "Diffusion Refine", image_url=IMG, prompt="portrait", detail_strength=0.4,
        refine_steps=30,
    )
    assert slug == "fermatresearch/magic-image-refiner"
    assert body["resolution"] == "original"      # strictly in place
    assert body["prompt"] == "portrait"
    assert body["steps"] == 30
    assert body["resemblance"] == pytest.approx(0.75)
    assert body["creativity"] == pytest.approx(0.33)   # 0.15 + 0.4*0.45


def test_diffusion_refine_creativity_endpoints_stay_in_safe_band():
    _, lo = rr.build_enhance_input("Diffusion Refine", image_url=IMG, prompt="", detail_strength=0.0)
    _, hi = rr.build_enhance_input("Diffusion Refine", image_url=IMG, prompt="", detail_strength=1.0)
    assert lo["creativity"] == pytest.approx(0.15)
    assert hi["creativity"] == pytest.approx(0.60)
    # stay below 1.0 so the subject is never fully destroyed
    assert 0.0 <= lo["creativity"] <= 1.0 and 0.0 <= hi["creativity"] <= 1.0


def test_unknown_engine_raises():
    with pytest.raises(ValueError):
        rr.build_enhance_input("Nope", image_url=IMG, prompt="", detail_strength=0.4)
