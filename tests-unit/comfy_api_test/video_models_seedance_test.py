"""Input-shape tests for the Seedance 2.0 builder, now targeting fal.ai.

fal's bytedance/seedance-2.0 takes reference refs in image_urls (array), a
first frame in image_url with optional end_image_url, resolution default 720p,
duration as a STRING, generate_audio, and NO seed input (seed is output-only).
Refs are tagged @Image1 in the prompt (done in the frontend). The Shot Director
forwards these via the FilmShotNode model_options JSON, reaching the builder as
`adv`.
"""
from comfy_api_nodes.video_models import _b_seedance_2_0

DATA_URL = "data:image/png;base64,x"


def test_seedance_plain_t2v_baseline():
    inp = _b_seedance_2_0("a dog", "16:9", 5, 0, None, None, {})
    assert inp["prompt"] == "a dog"
    assert inp["duration"] == "5"          # STRING for fal
    assert inp["resolution"] == "720p"     # fal default
    assert inp["aspect_ratio"] == "16:9"
    assert "seed" not in inp               # fal has no seed input
    assert "generate_audio" not in inp
    # never emit Replicate-shaped keys
    assert "reference_images" not in inp


def test_seedance_forwards_reference_url_arrays():
    adv = {
        "image_urls": [DATA_URL, DATA_URL],
        "video_urls": [DATA_URL],
        "audio_urls": [DATA_URL],
        "resolution": "720p",
        "generate_audio": True,
    }
    inp = _b_seedance_2_0("p", "9:16", 10, 7, None, None, adv)
    assert inp["image_urls"] == [DATA_URL, DATA_URL]
    assert inp["video_urls"] == [DATA_URL]
    assert inp["audio_urls"] == [DATA_URL]
    assert inp["resolution"] == "720p"
    assert inp["generate_audio"] is True
    assert inp["aspect_ratio"] == "9:16"
    assert inp["duration"] == "10"
    assert "seed" not in inp


def test_seedance_first_last_frame_via_adv():
    adv = {"image_url": DATA_URL, "end_image_url": DATA_URL,
           "image_urls": [DATA_URL]}
    inp = _b_seedance_2_0("p", "16:9", 5, 0, None, None, adv)
    assert inp["image_url"] == DATA_URL
    assert inp["end_image_url"] == DATA_URL
    # first-frame image mode: aspect_ratio dropped, refs mutually exclusive
    assert "aspect_ratio" not in inp
    assert "image_urls" not in inp


def test_seedance_wired_first_frame_beats_adv():
    # A wired IMAGE tensor (already a data URL) wins over an adv image_url.
    inp = _b_seedance_2_0("p", "16:9", 5, 0, "data:image/png;base64,WIRED", None,
                          {"image_url": DATA_URL})
    assert inp["image_url"] == "data:image/png;base64,WIRED"
