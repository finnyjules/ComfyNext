"""Input-shape tests for the Seedance 2.0 builder.

Replicate's bytedance/seedance-2.0 schema (verified live 2026-06-30, see
docs/superpowers/specs/2026-06-30-shot-director-design.md) has NO fps and NO
camera_fixed fields, takes reference_images/videos/audios (mutually exclusive
with first/last-frame image), and generate_audio. The Shot Director forwards
those via the FilmShotNode's model_options JSON, which reaches the builder as
`adv`.
"""
from comfy_api_nodes.video_models import _b_seedance_2_0

DATA_URL = "data:image/png;base64,x"


def test_seedance_omits_schema_invalid_fields():
    inp = _b_seedance_2_0("a dog", "16:9", 5, 0, None, None, {})
    assert "fps" not in inp, "bytedance/seedance-2.0 has no fps input"
    assert "camera_fixed" not in inp, "bytedance/seedance-2.0 has no camera_fixed input"


def test_seedance_plain_t2v_baseline():
    inp = _b_seedance_2_0("a dog", "16:9", 5, 0, None, None, {})
    assert inp["prompt"] == "a dog"
    assert inp["duration"] == 5
    assert inp["resolution"] == "1080p"
    assert inp["aspect_ratio"] == "16:9"
    # generate_audio only sent when explicitly set — keeps plain Film a Shot
    # payloads unchanged.
    assert "generate_audio" not in inp


def test_seedance_forwards_reference_arrays():
    adv = {
        "reference_images": [DATA_URL, DATA_URL],
        "reference_videos": [DATA_URL],
        "reference_audios": [DATA_URL],
        "resolution": "720p",
        "generate_audio": True,
    }
    inp = _b_seedance_2_0("p", "9:16", 10, 7, None, None, adv)
    assert inp["reference_images"] == [DATA_URL, DATA_URL]
    assert inp["reference_videos"] == [DATA_URL]
    assert inp["reference_audios"] == [DATA_URL]
    assert inp["resolution"] == "720p"
    assert inp["generate_audio"] is True
    assert inp["aspect_ratio"] == "9:16"
    assert inp["seed"] == 7


def test_seedance_first_last_frame_via_adv():
    adv = {"image": DATA_URL, "last_frame_image": DATA_URL,
           "reference_images": [DATA_URL]}
    inp = _b_seedance_2_0("p", "16:9", 5, 0, None, None, adv)
    assert inp["image"] == DATA_URL
    assert inp["last_frame_image"] == DATA_URL
    # image dims replace aspect_ratio; refs are mutually exclusive with image
    assert "aspect_ratio" not in inp
    assert "reference_images" not in inp


def test_seedance_wired_image_wins_over_adv():
    wired = "data:image/png;base64,wired"
    inp = _b_seedance_2_0("p", "16:9", 5, 0, wired, None, {"image": DATA_URL})
    assert inp["image"] == wired
