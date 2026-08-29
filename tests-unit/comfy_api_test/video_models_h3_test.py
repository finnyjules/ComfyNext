"""Input-shape tests for the MiniMax Hailuo H3 / H3 Max builders on fal.ai.

fal's minimax/h3 family has enums that differ from every marketing surface, and
each divergence is a silent-fallover risk (fal returns 200 at submit and only
fails when the result is fetched):
  - resolution is UPPERCASE-P: "768P", never "768p" (our catalog stores lower).
  - duration is an INTEGER 5-15, not a suffixed string ("5s") like Veo.
  - prompt_expansion_mode is REQUIRED on H3 Max and its enum omits "fast".
  - there is no audio parameter (native stereo is always on).
  - image-to-video with no image_url silently routes to text-to-video.
These tests pin the exact payload the builder must produce.
"""
from comfy_api_nodes.video_models import _b_hailuo_h3, _b_hailuo_h3_max

DATA_URL = "data:image/png;base64,x"


def test_h3_plain_t2v_baseline():
    inp = _b_hailuo_h3("a dog on a skateboard", "16:9", 5, 0, None, None, {})
    assert inp["prompt"] == "a dog on a skateboard"
    assert inp["duration"] == 5                    # INTEGER for fal, not "5"
    assert isinstance(inp["duration"], int)
    assert inp["resolution"] == "768P"             # UPPERCASE-P, forced (fal defaults to 2K)
    assert inp["prompt_expansion_mode"] == "balanced"
    assert inp["aspect_ratio"] == "16:9"
    assert "generate_audio" not in inp             # no audio param exists on H3
    assert "seed" not in inp                        # seed 0 is not sent


def test_h3_resolution_lowercase_maps_to_uppercase():
    # The catalog + gallery pass '768p' (lowercase) through model_options.
    inp = _b_hailuo_h3("p", "16:9", 5, 0, None, None, {"resolution": "768p"})
    assert inp["resolution"] == "768P"


def test_h3_out_of_range_duration_snaps_to_nearest():
    inp = _b_hailuo_h3("p", "16:9", 8, 0, None, None, {})
    assert inp["duration"] in (5, 6, 10)


def test_h3_i2v_wired_image_drops_aspect_ratio():
    inp = _b_hailuo_h3("p", "9:16", 5, 0, "data:image/png;base64,WIRED", None, {})
    assert inp["image_url"] == "data:image/png;base64,WIRED"
    assert "aspect_ratio" not in inp               # i2v: aspect follows the image


def test_h3_first_last_frame_via_adv():
    adv = {"image_url": DATA_URL, "end_image_url": DATA_URL}
    inp = _b_hailuo_h3("p", "16:9", 5, 0, None, None, adv)
    assert inp["image_url"] == DATA_URL
    assert inp["end_image_url"] == DATA_URL
    assert "aspect_ratio" not in inp


def test_h3_wired_image_beats_adv():
    inp = _b_hailuo_h3("p", "16:9", 5, 0, "data:image/png;base64,WIRED", None,
                       {"image_url": DATA_URL})
    assert inp["image_url"] == "data:image/png;base64,WIRED"


def test_h3_seed_sent_when_positive():
    inp = _b_hailuo_h3("p", "16:9", 5, 42, None, None, {})
    assert inp["seed"] == 42


def test_h3_max_baseline_and_required_pem():
    inp = _b_hailuo_h3_max("p", "16:9", 5, 0, None, None, {})
    assert inp["resolution"] == "768P"
    assert inp["duration"] == 5
    # prompt_expansion_mode is REQUIRED on H3 Max — must always be present.
    assert inp["prompt_expansion_mode"] == "balanced"


def test_h3_max_rejects_fast_mode():
    # "fast" is valid on base H3 but does NOT exist on H3 Max; clamp to default.
    assert _b_hailuo_h3("p", "16:9", 5, 0, None, None,
                        {"prompt_expansion_mode": "fast"})["prompt_expansion_mode"] == "fast"
    assert _b_hailuo_h3_max("p", "16:9", 5, 0, None, None,
                            {"prompt_expansion_mode": "fast"})["prompt_expansion_mode"] == "balanced"
