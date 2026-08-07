"""fal fallover contracts for the FLUX.2 family (pro/max/flex/dev).

Unlike flux-schnell/flux-1.1-pro (fal is `primary` there), fal here is the
*backup* — `primary` stays "replicate" — so these builders only run when the
Replicate call fails over. Still worth pinning: a fal payload these models
reject burns the fallover attempt too, and the caller has nowhere left to go.
"""

from comfy_api_nodes.image_models import MODELS, _b_flux_2_dev, _fal_flux_2_basic, _fal_flux_2_tunable


def test_flux_2_pro_has_fal_backup():
    spec = next(m for m in MODELS if m.id == "flux-2-pro")
    assert spec.fal_slug == "fal-ai/flux-2-pro"
    assert spec.fal_build_input is _fal_flux_2_basic
    assert spec.primary == "replicate"   # fal is the BACKUP, not primary


def test_fal_flux_2_maps_ar_to_image_size():
    inp = _fal_flux_2_basic("x", "16:9", 0, {})
    assert inp["image_size"] == "landscape_16_9"
    assert "aspect_ratio" not in inp


def test_fal_flux_2_safety_tolerance_is_string_capped_at_5():
    assert _fal_flux_2_basic("x", "1:1", 0, {"safety_tolerance": 9})["safety_tolerance"] == "5"
    assert _fal_flux_2_basic("x", "1:1", 0, {})["safety_tolerance"] == "2"


def test_fal_flux_2_output_format_coerced_to_fal_enum():
    # TS default for flux-2 is webp, which fal flux-2 rejects.
    assert _fal_flux_2_basic("x", "1:1", 0, {"output_format": "webp"})["output_format"] in {"jpeg", "png"}


def test_fal_flux_2_tunable_forwards_steps_and_guidance():
    inp = _fal_flux_2_tunable("x", "1:1", 0, {"steps": 40, "guidance": 6.0})
    assert inp["num_inference_steps"] == 40
    assert inp["guidance_scale"] == 6.0


def test_flux_2_dev_exists_and_maps_both_providers():
    spec = next(m for m in MODELS if m.id == "flux-2-dev")
    assert spec.replicate_slug == "black-forest-labs/flux-2-dev"
    assert spec.fal_build_input is _fal_flux_2_tunable


def test_b_flux_2_dev_defaults_match_card_and_fal():
    # The TS card's flux-2-dev advanced defaults are steps=28/guidance=3.5,
    # and _fal_flux_2_tunable defaults the same way — the Replicate builder
    # must agree so the model renders consistently on either provider.
    inp = _b_flux_2_dev("x", "1:1", 0, {})
    assert inp["steps"] == 28
    assert inp["guidance"] == 3.5
