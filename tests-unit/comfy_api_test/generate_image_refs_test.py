"""Moodboard reference ride-along (moodboards Plan B, Task B3).

Covers the three seams the feature adds:

1. Builder emission — the ref-capable models' REPLICATE builders emit their
   schema's reference field (`image_input` for nano-banana, `image_urls` for
   seedream) when refs are present and omit it when absent. BROKEN CONTROL:
   forcing refs into a non-ref builder (FLUX) must NOT surface them anywhere
   in its input dict — the tag gate is real, not decorative.
2. Payload guards — `_parse_style_refs` ports the frontend's moodboard route
   guards: `moodboard_<ms>` folders ONLY (never lora_dataset_*), bare image
   filenames with no traversal, and the ≤3 refs cap.
3. Dispatch — refs flip a fal-primary model to Replicate-first, because only
   the Replicate builders emit the field (fal t2i endpoints take none, and an
   unverified fal field is a silent-fallover trap).
"""
import base64

import pytest

# Pre-import the util shim so nodes_replicate imports cleanly (pre-existing
# utils/install_util sys.path shadow; required for ComfyUI server import).
import utils.install_util  # noqa: F401

from comfy_api_nodes.image_models import (
    IMAGE_MODELS_BY_ID,
    MODELS,
    accepts_refs,
    _b_flux_dev,
    _b_flux_schnell,
    _b_nano_banana_pro,
    _b_nano_banana_2,
    _b_seedream_5_pro,
    _b_seedream_5_lite,
    _b_seedream_4,
)
from comfy_api_nodes.nodes_replicate import (
    _moodboard_ref_data_urls,
    _parse_style_refs,
    _provider_order,
    _safe_moodboard_file,
    _STYLE_REFS_INSTRUCTION,
)
import comfy_api_nodes.nodes_replicate as nodes_replicate

REFS = ["data:image/png;base64,aaa", "data:image/jpeg;base64,bbb"]
REF_FIELDS = ("image_input", "image_urls")


# ── 1. Builder emission ──────────────────────────────────────────────────────

def test_nano_banana_pro_emits_image_input_with_refs():
    inp = _b_nano_banana_pro("a cat", "1:1", 0, {}, REFS)
    assert inp["image_input"] == REFS


def test_nano_banana_pro_omits_image_input_without_refs():
    assert "image_input" not in _b_nano_banana_pro("a cat", "1:1", 0, {})
    assert "image_input" not in _b_nano_banana_pro("a cat", "1:1", 0, {}, None)
    assert "image_input" not in _b_nano_banana_pro("a cat", "1:1", 0, {}, [])


def test_nano_banana_2_emits_image_input_with_refs():
    inp = _b_nano_banana_2("a cat", "1:1", 0, {}, REFS)
    assert inp["image_input"] == REFS
    assert "image_input" not in _b_nano_banana_2("a cat", "1:1", 0, {})


@pytest.mark.parametrize("builder", [_b_seedream_5_pro, _b_seedream_5_lite, _b_seedream_4])
def test_seedream_builders_emit_image_urls_with_refs(builder):
    inp = builder("a cat", "1:1", 0, {}, REFS)
    assert inp["image_urls"] == REFS
    assert "image_urls" not in builder("a cat", "1:1", 0, {})


@pytest.mark.parametrize("builder", [_b_flux_schnell, _b_flux_dev])
def test_flux_builders_ignore_forced_refs(builder):
    """BROKEN CONTROL: a non-ref model's builder given refs must not emit them
    under ANY reference field name — proof the gate lives in the builders, not
    in whoever remembered to withhold the argument."""
    inp = builder("a cat", "1:1", 0, {}, REFS)
    for field in REF_FIELDS:
        assert field not in inp
    # Sanity: the builder still built a normal input.
    assert inp["prompt"] == "a cat"


_REF_MODELS = {"nano-banana-pro", "nano-banana-2", "seedream-5-pro", "seedream-5-lite", "seedream-4"}


def test_every_builder_accepts_refs_and_only_ref_models_emit():
    """Catalog-wide sweep: the widened signature is universal (every builder,
    Replicate and fal alike, accepts refs positionally) and emission is exactly
    the accepts_refs set on the Replicate side, never on the fal side."""
    for m in MODELS:
        inp = m.build_input("p", "1:1", 0, {}, REFS)
        emitted = any(f in inp for f in REF_FIELDS)
        assert emitted == (m.id in _REF_MODELS), m.id
        # accepts_refs (the 'multi-image' tag) is a superset guard: every
        # emitting model must be tagged ref-capable.
        if emitted:
            assert accepts_refs(m), m.id
        if m.fal_build_input is not None:
            fal_inp = m.fal_build_input("p", "1:1", 0, {}, REFS)
            assert not any(f in fal_inp for f in REF_FIELDS), (
                f"{m.id}: fal t2i builders must not emit unverified ref fields"
            )


# ── 2. Payload guards ────────────────────────────────────────────────────────

def _payload(folder="moodboard_1754000000000", files=("00_a.png", "01_b.jpg")):
    import json
    return json.dumps({"folder": folder, "files": list(files)})


def test_parse_style_refs_accepts_a_valid_payload():
    assert _parse_style_refs(_payload()) == (
        "moodboard_1754000000000", ["00_a.png", "01_b.jpg"],
    )


@pytest.mark.parametrize("folder", [
    "lora_dataset_1754000000000",   # the training-set folders are OFF LIMITS
    "lora_dataset_x",
    "../input",
    "moodboard_1/..",
    "moodboard_",
    "xmoodboard_1",
    "moodboard_1x",
    "",
])
def test_parse_style_refs_rejects_bad_folders(folder):
    assert _parse_style_refs(_payload(folder=folder)) is None


def test_parse_style_refs_drops_traversal_and_non_image_files():
    parsed = _parse_style_refs(_payload(files=[
        "../secret.png", "a/../b.png", "sub/c.png", "d\\e.png", "notes.txt", "ok.webp",
    ]))
    assert parsed == ("moodboard_1754000000000", ["ok.webp"])
    # All files bad → the whole payload is void, not an empty ref list.
    assert _parse_style_refs(_payload(files=["../x.png", "y.txt"])) is None


@pytest.mark.parametrize("raw", ["", "   ", None, "not json", "[1,2]", '"str"', '{"files": ["a.png"]}'])
def test_parse_style_refs_tolerates_garbage(raw):
    assert _parse_style_refs(raw) is None


def test_parse_style_refs_caps_at_three():
    files = [f"{i:02d}_img.png" for i in range(5)]
    parsed = _parse_style_refs(_payload(files=files))
    assert parsed is not None
    assert parsed[1] == files[:3]


def test_safe_moodboard_file_rules():
    assert _safe_moodboard_file("00_a.png")
    assert _safe_moodboard_file("photo.JPEG")
    for bad in ["", "a.txt", "a/b.png", "a\\b.png", "..png", "x..y.png", None, 3]:
        assert not _safe_moodboard_file(bad), bad


# ── 2b. File loading (≤3 cap, base64 data URLs) ─────────────────────────────

def test_ref_loader_reads_caps_and_encodes(tmp_path):
    folder = "moodboard_1754000000000"
    d = tmp_path / folder
    d.mkdir()
    names = [f"{i:02d}_img.png" for i in range(4)]
    for i, name in enumerate(names):
        (d / name).write_bytes(bytes([i]) * 8)

    urls = _moodboard_ref_data_urls(folder, names, input_dir=str(tmp_path))
    assert len(urls) == 3  # ≤3 cap holds even when handed 4 validated files
    for i, url in enumerate(urls):
        prefix = "data:image/png;base64,"
        assert url.startswith(prefix)
        assert base64.b64decode(url[len(prefix):]) == bytes([i]) * 8


def test_ref_loader_mime_by_extension_and_skips_missing(tmp_path):
    folder = "moodboard_1"
    d = tmp_path / folder
    d.mkdir()
    (d / "a.jpg").write_bytes(b"jj")
    (d / "b.webp").write_bytes(b"ww")
    urls = _moodboard_ref_data_urls(folder, ["a.jpg", "gone.png", "b.webp"], input_dir=str(tmp_path))
    assert [u.split(";")[0] for u in urls] == ["data:image/jpeg", "data:image/webp"]


# ── 3. Dispatch order flips Replicate-first when refs ride ───────────────────

def test_provider_order_prefers_replicate_with_refs(monkeypatch):
    spec = IMAGE_MODELS_BY_ID["nano-banana-pro"]
    assert spec.primary == "fal"  # precondition: the marquee model is fal-primary
    monkeypatch.setattr(nodes_replicate, "_fal_available", lambda s: True)
    assert _provider_order(spec) == ["fal", "replicate"]
    assert _provider_order(spec, prefer_replicate=True) == ["replicate", "fal"]
    # Without fal, order is Replicate-only either way.
    monkeypatch.setattr(nodes_replicate, "_fal_available", lambda s: False)
    assert _provider_order(spec, prefer_replicate=True) == ["replicate"]


def test_style_instruction_is_style_only():
    assert "STYLE references" in _STYLE_REFS_INSTRUCTION
    assert "do not copy their subjects or composition" in _STYLE_REFS_INSTRUCTION
