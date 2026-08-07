"""Moodboard Python twin (moodboards Plan B, Task B4).

Three concerns:

1. Schema — the twin registers as class_type 'Moodboard' (must equal the
   frontend node type so graphToPrompt maps the Vue node onto it), carries the
   two hidden internal STRING widgets (reading_json required, moodboard_id
   optional) and exactly ONE output of the custom TASTE type named 'style'
   (the image output is deferred to @refs in Task B5 — plan decision note).

2. Block-compile parity — `moodboard_style_block` is a Python port of the
   frontend's `moodboardStyleBlock` (app/lib/taste/styleBlock.ts) and must
   produce byte-identical strings. Both sides assert the SAME shared fixtures
   (tests-unit/comfy_api_test/fixtures/moodboard_style_block_*.json; the TS
   side is frontend/tests/unit/taste-style-block.unit.spec.ts) — so a drift on
   either side reds a test.

3. Broken control — a deliberately reordered palette join must FAIL parity,
   proving the fixtures actually pin the join order (a parity test both sides
   could pass with any order would prove nothing).
"""

import json
import os

import pytest

# Pre-import the util shim so backend modules import cleanly (pre-existing
# utils/install_util sys.path shadow; same as multilora_schema_order_test.py).
import utils.install_util  # noqa: F401
from comfy_extras.nodes_moodboard import MoodboardNode, moodboard_style_block

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
FIXTURE_FILES = [
    "moodboard_style_block_full.json",
    "moodboard_style_block_no_avoids.json",
    "moodboard_style_block_summary_avoids.json",
]


def _load_fixture(name: str) -> dict:
    with open(os.path.join(FIXTURES_DIR, name), "r", encoding="utf-8") as f:
        return json.load(f)


# ── 1. schema ────────────────────────────────────────────────────────────────

def test_moodboard_class_type_matches_frontend_node_type():
    schema = MoodboardNode.define_schema()
    assert schema.node_id == "Moodboard", (
        "node_id must equal the frontend node type 'Moodboard' — graphToPrompt "
        "serializes the Vue node's type as class_type."
    )


def test_moodboard_widgets_are_hidden_internal_strings():
    schema = MoodboardNode.define_schema()
    assert [inp.id for inp in schema.inputs] == ["reading_json", "moodboard_id"]
    by_id = {inp.id: inp for inp in schema.inputs}

    reading = by_id["reading_json"]
    assert reading.io_type == "STRING"
    assert reading.multiline is True
    assert not reading.optional, (
        "reading_json must be REQUIRED (the model_options precedent) so it "
        "always occupies a widgets_values slot the frontend can write by name."
    )
    assert (reading.extra_dict or {}).get("sailor_widget") == "internal"

    mb_id = by_id["moodboard_id"]
    assert mb_id.io_type == "STRING"
    assert mb_id.optional is True
    assert (mb_id.extra_dict or {}).get("sailor_widget") == "internal"


def test_moodboard_single_taste_output_named_style():
    schema = MoodboardNode.define_schema()
    assert len(schema.outputs) == 1, (
        "v1 ships the style output ONLY — the image output is deferred to "
        "@refs (Task B5)."
    )
    out = schema.outputs[0]
    assert out.io_type == "TASTE"
    assert out.display_name == "style"


# ── 2. block-compile parity against the shared fixtures ─────────────────────

@pytest.mark.parametrize("fixture_file", FIXTURE_FILES)
def test_style_block_matches_shared_fixture(fixture_file):
    fx = _load_fixture(fixture_file)
    assert moodboard_style_block(fx["reading"]) == fx["expected"], (
        f"Python block-port drifted from the shared fixture {fixture_file} — "
        "the TS side (taste-style-block.unit.spec.ts) pins the same string."
    )


@pytest.mark.parametrize("fixture_file", FIXTURE_FILES)
def test_execute_compiles_the_fixture_reading(fixture_file):
    fx = _load_fixture(fixture_file)
    out = MoodboardNode.execute(
        reading_json=json.dumps(fx["reading"]), moodboard_id="any-board"
    )
    assert out.args == (fx["expected"],)


@pytest.mark.parametrize("bad", ["", "   ", "not json", '["array"]', "42"])
def test_execute_degrades_on_empty_or_malformed_reading(bad):
    # A bad payload must yield an empty block, never raise — downstream
    # generators treat empty style_in as "no style".
    assert MoodboardNode.execute(reading_json=bad).args == ("",)


# ── 3. broken control: a reordered palette join must fail parity ────────────

def _broken_reordered_palette_block(reading: dict) -> str:
    """The deliberately-wrong port: identical except the palette swatches are
    joined in REVERSED order. If this passed the fixtures, the parity tests
    would not actually be pinning the join order."""
    mutated = dict(reading)
    palette = reading.get("palette")
    if isinstance(palette, list):
        mutated["palette"] = list(reversed(palette))
    return moodboard_style_block(mutated)


def test_broken_control_reordered_palette_fails_parity():
    # Both multi-swatch fixtures must catch the reorder; the palette-less one
    # is legitimately immune (nothing to reorder).
    caught = 0
    for fixture_file in FIXTURE_FILES:
        fx = _load_fixture(fixture_file)
        if len(fx["reading"].get("palette") or []) >= 2:
            assert _broken_reordered_palette_block(fx["reading"]) != fx["expected"]
            caught += 1
    assert caught >= 2, "expected at least two fixtures with a reorderable palette"
