from comfy_api_nodes.image_models import (
    MODELS, _b_krea2, _fal_krea2,
)

KREA_ARS = {"1:1", "4:3", "3:2", "16:9", "2.35:1", "4:5", "2:3", "9:16"}


def test_krea_large_is_fal_primary_with_replicate_backup():
    spec = next(m for m in MODELS if m.id == "krea-2-large")
    assert spec.primary == "fal"
    assert spec.fal_slug == "krea/v2/large/text-to-image"
    assert spec.fal_build_input is _fal_krea2
    assert spec.replicate_slug == "krea/krea-2-large"


def test_fal_krea_uses_native_aspect_ratio_not_image_size():
    inp = _fal_krea2("a boat", "16:9", 0, {})
    assert inp["prompt"] == "a boat"
    assert inp["aspect_ratio"] == "16:9"     # native, NOT "landscape_16_9"
    assert "image_size" not in inp
    assert inp["creativity"] == "medium"     # default


def test_fal_krea_unsupported_ar_falls_back_to_square():
    inp = _fal_krea2("x", "21:9", 0, {})     # not in Krea's enum
    assert inp["aspect_ratio"] == "1:1"


def test_fal_krea_creativity_clamped_to_enum():
    assert _fal_krea2("x", "1:1", 0, {"creativity": "wild"})["creativity"] == "medium"
    assert _fal_krea2("x", "1:1", 0, {"creativity": "raw"})["creativity"] == "raw"


def test_krea_seed_only_when_nonzero():
    assert "seed" not in _fal_krea2("x", "1:1", 0, {})
    assert _fal_krea2("x", "1:1", 7, {})["seed"] == 7


def test_replicate_krea_shape():
    inp = _b_krea2("x", "3:2", 5, {"creativity": "high"})
    assert inp["aspect_ratio"] == "3:2"
    assert inp["creativity"] == "high"
    assert inp["seed"] == 5
