"""fal input-builder contracts.

These builders are the *primary* provider for their models (see MODELS'
`primary="fal"`), so a payload fal rejects doesn't just degrade — it burns a
round-trip and falls the request over to Replicate, cold boot and all. Each
assertion below mirrors a real constraint in fal's published endpoint schema.
"""

import pytest

from comfy_api_nodes.image_models import MODELS, _fal_flux_schnell

# The prompt bar's sketch preset — see frontend sketchPadPromptOverrides().
SKETCH_ADVANCED = {"megapixels": "0.25", "num_outputs": 4, "output_format": "webp"}

# fal-ai/flux/schnell: SchnellTextToImageInput.output_format is a literal enum.
FAL_SCHNELL_OUTPUT_FORMATS = {"jpeg", "png"}


def test_flux_schnell_is_fal_primary():
    """Guards the premise of the tests below."""
    spec = next(m for m in MODELS if m.id == "flux-schnell")
    assert spec.primary == "fal"
    assert spec.fal_build_input is _fal_flux_schnell


def test_sketch_preset_output_format_is_fal_legal():
    inp = _fal_flux_schnell("a dog on a couch", "1:1", 0, SKETCH_ADVANCED)
    assert inp["output_format"] in FAL_SCHNELL_OUTPUT_FORMATS


@pytest.mark.parametrize("fmt,expected", [
    ("webp", "jpeg"),  # Replicate-only format → nearest legal fal equivalent
    ("jpg", "jpeg"),   # Replicate spelling → fal spelling
    ("jpeg", "jpeg"),
    ("png", "png"),
])
def test_output_format_normalizes_to_fal_enum(fmt, expected):
    inp = _fal_flux_schnell("x", "1:1", 0, {"output_format": fmt})
    assert inp["output_format"] == expected


def test_megapixels_is_honored_as_an_explicit_image_size():
    """The sketch preset asks for 0.25MP. fal has no `megapixels` knob, but its
    image_size accepts a {width,height} object — dropping the request silently
    renders 4× the pixels the caller asked for."""
    inp = _fal_flux_schnell("x", "1:1", 0, SKETCH_ADVANCED)
    assert inp["image_size"] == {"width": 512, "height": 512}


def test_megapixels_respects_aspect_ratio():
    inp = _fal_flux_schnell("x", "16:9", 0, {"megapixels": "0.25"})
    size = inp["image_size"]
    assert isinstance(size, dict)
    # ~0.25MP, 16:9, and both edges must be multiples of 16 for the VAE.
    assert size["width"] % 16 == 0 and size["height"] % 16 == 0
    assert 0.2 < (size["width"] * size["height"]) / 1_000_000 < 0.3
    assert 1.7 < size["width"] / size["height"] < 1.8


def test_default_megapixels_keeps_the_named_size_preset():
    """No megapixels asked for → keep the existing named-enum behavior."""
    inp = _fal_flux_schnell("x", "1:1", 0, {})
    assert inp["image_size"] == "square_hd"


def test_num_outputs_maps_to_num_images_and_caps_at_four():
    assert _fal_flux_schnell("x", "1:1", 0, SKETCH_ADVANCED)["num_images"] == 4
    assert _fal_flux_schnell("x", "1:1", 0, {"num_outputs": 9})["num_images"] == 4
    assert _fal_flux_schnell("x", "1:1", 0, {})["num_images"] == 1


def test_inference_steps_stay_within_fal_maximum():
    """fal caps num_inference_steps at 12; Replicate's flux-schnell allows more."""
    assert _fal_flux_schnell("x", "1:1", 0, {"num_inference_steps": 50})["num_inference_steps"] <= 12


# --- queue poll cadence -----------------------------------------------------

def test_poll_delay_starts_well_under_a_fast_model_runtime():
    """flux-schnell finishes in ~1s. A flat 2s first sleep meant every sketch
    waited longer on the poll than on the model."""
    from comfy_api_nodes.fal_refs import _poll_delay
    assert _poll_delay(0) <= 0.5


def test_poll_delay_is_monotonic_and_capped():
    from comfy_api_nodes.fal_refs import _poll_delay
    delays = [_poll_delay(i) for i in range(12)]
    assert delays == sorted(delays)
    assert max(delays) <= 2.0
    assert delays[-1] == 2.0  # settles at the old steady-state rate


def test_poll_delay_does_not_hammer_a_long_job():
    """A 15-minute video job must not cost hundreds of extra status calls."""
    from comfy_api_nodes.fal_refs import _poll_delay
    elapsed, polls = 0.0, 0
    while elapsed < 900:
        elapsed += _poll_delay(polls)
        polls += 1
    assert polls < 900 / 2.0 + 10  # ≤10 more than the old flat-2s cadence
