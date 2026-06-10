"""Input-shape tests for the Kling v2.5 Turbo Pro builder.

Replicate's kwaivgi/kling-v2.5-turbo-pro schema rejects unknown fields with a
422 ("Unexpected field 'cfg_scale'" / "Unexpected field 'seed'", observed
2026-06-10 via FilmShotNode, which defaults to this model). The builder must
send only fields the live schema accepts. Kling v3 (kwaivgi/kling-v3-video)
is a different schema and still takes cfg_scale/seed — these tests pin v2.5
only.
"""
from comfy_api_nodes.video_models import _b_kling_v2_5_turbo_pro


def test_kling_v2_5_omits_rejected_fields():
    inp = _b_kling_v2_5_turbo_pro("a dog", "16:9", 5, 12345, None, None, {})
    assert "cfg_scale" not in inp, "Replicate 422s on cfg_scale for kling-v2.5-turbo-pro"
    assert "seed" not in inp, "Replicate 422s on seed for kling-v2.5-turbo-pro"


def test_kling_v2_5_core_fields_survive():
    inp = _b_kling_v2_5_turbo_pro("a dog", "16:9", 10, 0, "data:image/png;base64,x",
                                  None, {"negative_prompt": "blurry"})
    assert inp["prompt"] == "a dog"
    assert inp["aspect_ratio"] == "16:9"
    assert inp["duration"] == 10
    assert inp["start_image"] == "data:image/png;base64,x"
    assert inp["negative_prompt"] == "blurry"
