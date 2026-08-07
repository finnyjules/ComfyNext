"""Input-shape tests for the FLUX 3 (video) builder targeting fal.ai.

fal blackforestlabs/flux-3 splits t2v / i2v into separate functions selected by
_fal_fn_for_input: a first-frame image_url => image-to-video, else text-to-video.
"""
from comfy_api_nodes.video_models import _b_flux_3, VIDEO_MODELS_BY_ID
from comfy_api_nodes.nodes_replicate import _fal_fn_for_input

DATA_URL = "data:image/png;base64,x"


def test_flux3_t2v_baseline():
    inp = _b_flux_3("a boat at sea", "16:9", 10, 0, None, None, {})
    assert inp["prompt"] == "a boat at sea"
    assert inp["aspect_ratio"] == "16:9"
    assert inp["resolution"] == "720p"
    assert "image_url" not in inp


def test_flux3_i2v_sets_image_url_and_drops_aspect_ratio():
    inp = _b_flux_3("p", "16:9", 10, 0, DATA_URL, None, {})
    assert inp["image_url"] == DATA_URL
    assert "aspect_ratio" not in inp   # framing follows the image


def test_flux3_duration_clamped_to_supported_set():
    inp = _b_flux_3("p", "16:9", 99, 0, None, None, {})
    assert inp["duration"] in (5, 10, 15, 20)


def test_flux3_generate_audio_defaults_on():
    assert _b_flux_3("p", "16:9", 10, 0, None, None, {})["generate_audio"] is True
    assert _b_flux_3("p", "16:9", 10, 0, None, None, {"generate_audio": False})["generate_audio"] is False


def test_flux3_registry_entry_is_fal_with_full_fn_map():
    spec = VIDEO_MODELS_BY_ID["flux-3"]
    assert spec.provider == "fal"
    assert spec.fal_app == "blackforestlabs/flux-3"
    # _fal_fn_for_input needs all three keys or it KeyErrors
    for key in ("t2v", "firstLast", "reference"):
        assert key in spec.fal_fn_by_mode


def test_flux3_fn_selection_matches_dispatcher():
    spec = VIDEO_MODELS_BY_ID["flux-3"]
    t2v_inp = _b_flux_3("p", "16:9", 10, 0, None, None, {})
    i2v_inp = _b_flux_3("p", "16:9", 10, 0, DATA_URL, None, {})
    assert _fal_fn_for_input(t2v_inp, spec.fal_fn_by_mode) == "text-to-video"
    assert _fal_fn_for_input(i2v_inp, spec.fal_fn_by_mode) == "image-to-video"
