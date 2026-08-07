"""Tags on the Python image-model catalog + the accepts_refs gate.

The TS catalog (frontend/app/data/image-models.ts) carries per-model tags for
the gallery UI; the Python catalog mirrors them so execution-side code can gate
capabilities (B3's refs ride-along keys off 'multi-image'). These tests pin:

  * nano-banana-pro is ref-capable ('multi-image' present)
  * accepts_refs(spec) is exactly the 'multi-image' gate
  * the Python tags mirror the TS tags per model, in identical order —
    read across the boundary the way catalog-parity.unit.spec.ts does,
    with a regex extraction over the TS source text
"""
from __future__ import annotations

import re
from pathlib import Path

from comfy_api_nodes.image_models import (
    IMAGE_MODELS_BY_ID,
    MODELS,
    accepts_refs,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_TS_CATALOG = _REPO_ROOT / "frontend" / "app" / "data" / "image-models.ts"


def _ts_tags_by_id() -> dict[str, list[str]]:
    """Extract {id: [tags...]} pairs from the TS catalog source text."""
    src = _TS_CATALOG.read_text(encoding="utf-8")
    # Each catalog entry declares `id: '...'` then, later in the same object,
    # `tags: [...]`. Walk id matches in order and grab the tags array that
    # follows each id but precedes the next id.
    ids = [(m.group(1), m.start()) for m in re.finditer(r"id:\s*'([^']+)'", src)]
    out: dict[str, list[str]] = {}
    for i, (model_id, pos) in enumerate(ids):
        end = ids[i + 1][1] if i + 1 < len(ids) else len(src)
        tags_m = re.search(r"tags:\s*\[([^\]]*)\]", src[pos:end])
        assert tags_m is not None, f"no tags array found for TS model {model_id!r}"
        out[model_id] = re.findall(r"'([^']+)'", tags_m.group(1))
    assert out, "TS catalog extraction found no models — regex drifted from the source"
    return out


def test_nano_banana_pro_is_ref_capable():
    tags = IMAGE_MODELS_BY_ID["nano-banana-pro"].tags
    assert "multi-image" in tags


def test_accepts_refs_is_exactly_the_multi_image_gate():
    for m in MODELS:
        assert accepts_refs(m) == ("multi-image" in m.tags), m.id
    # Anchors: the reference implementation is ref-capable, a FLUX model is not.
    assert accepts_refs(IMAGE_MODELS_BY_ID["nano-banana-pro"]) is True
    assert accepts_refs(IMAGE_MODELS_BY_ID["flux-schnell"]) is False


def test_accepts_refs_matches_the_ts_tagged_set():
    """accepts_refs is True for exactly the models tagged 'multi-image' in TS."""
    ts_tags = _ts_tags_by_id()
    shared = [m for m in MODELS if m.id in ts_tags]
    assert shared, "no shared model ids between the two catalogs"
    ts_ref_ids = {mid for mid, tags in ts_tags.items() if "multi-image" in tags}
    py_ref_ids = {m.id for m in shared if accepts_refs(m)}
    assert py_ref_ids == {mid for mid in ts_ref_ids if mid in IMAGE_MODELS_BY_ID}


def test_python_tags_mirror_ts_tags_in_identical_order():
    ts_tags = _ts_tags_by_id()
    for m in MODELS:
        assert m.id in ts_tags, f"{m.id} missing from the TS catalog"
        assert list(m.tags) == ts_tags[m.id], (
            f"{m.id}: Python tags {list(m.tags)} != TS tags {ts_tags[m.id]}"
        )
