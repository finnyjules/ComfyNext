"""Font subsetting from /sailor/font_subset.

The product decision (see docs/superpowers/plans/2026-08-04-embed-font-subsetting.md):
subset to the characters used by a piece UNION the full basic-Latin range
U+0020-U+007E. This is deliberately NOT "just the characters used" — the
export must still be able to render any English text if it becomes dynamic
later. These tests exist specifically to catch someone "optimising" the
charset down to only the used characters, which would look like a size win
but would break that guarantee.

Tests call the module-level subsetting helper directly rather than the
aiohttp route, matching the precedent in sailor_encode_alpha_test.py.
"""
import importlib
import io
import os

import pytest
from fontTools.ttLib import TTFont

nt = importlib.import_module("comfy_extras.nodes_timeline")

FONT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "public", "fonts",
    "NeueMontreal", "PPNeueMontreal-Regular.otf",
)

TEXT = "Sailor Type Studio"  # every character here is already basic Latin


def _font_bytes():
    with open(FONT_PATH, "rb") as f:
        return f.read()


def _cmap(font_bytes):
    return TTFont(io.BytesIO(font_bytes)).getBestCmap()


def test_input_font_has_the_characters_the_test_relies_on():
    # Sanity check on the fixture itself: if this ever fails, the assertions
    # below about "absent after subsetting" would be meaningless (it would
    # already be absent beforehand).
    cmap = _cmap(_font_bytes())
    assert 0x00E9 in cmap  # e-acute
    assert 0x2192 in cmap  # rightwards arrow
    assert all((0x20 + i) in cmap for i in range(0x7F - 0x20))


def test_subset_is_materially_smaller():
    before = _font_bytes()
    after = nt.subset_font_bytes(before, TEXT)
    assert len(after) < len(before) * 0.5, (
        f"expected the subset to be under half the input size, "
        f"got {len(after)} of {len(before)} bytes"
    )


def test_subset_still_parses_as_a_font():
    before = _font_bytes()
    after = nt.subset_font_bytes(before, TEXT)
    # Must not raise.
    font = TTFont(io.BytesIO(after))
    assert "cmap" in font


def test_subset_contains_every_character_of_the_supplied_text():
    before = _font_bytes()
    after = nt.subset_font_bytes(before, TEXT)
    cmap = _cmap(after)
    for ch in set(TEXT):
        if ch == " ":
            continue
        assert ord(ch) in cmap, f"expected {ch!r} (U+{ord(ch):04X}) in the subset"


def test_subset_contains_full_basic_latin_even_characters_absent_from_text():
    before = _font_bytes()
    after = nt.subset_font_bytes(before, TEXT)
    cmap = _cmap(after)
    # Digits and several punctuation marks are NOT in TEXT — this is the
    # load-bearing assertion for the "used UNION basic Latin" compromise.
    missing_from_text = [c for c in "0123456789#$%&*+=<>[]{}" if c not in TEXT]
    assert missing_from_text, "test setup bug: nothing to prove here"
    for ch in missing_from_text:
        assert ord(ch) in cmap, (
            f"{ch!r} (U+{ord(ch):04X}) is basic Latin and absent from the text, "
            f"but must still survive subsetting"
        )
    # The full U+0020-U+007E range, not just a spot check.
    for cp in range(0x20, 0x7F):
        assert cp in cmap, f"U+{cp:04X} is basic Latin and must survive subsetting"


def test_subset_drops_characters_outside_text_and_basic_latin():
    before = _font_bytes()
    after = nt.subset_font_bytes(before, TEXT)
    cmap = _cmap(after)
    # e-acute and a rightwards arrow are neither in TEXT nor in basic Latin.
    # Their absence is what proves subsetting actually happened rather than
    # subset_font_bytes being a no-op that returns the input unchanged.
    assert 0x00E9 not in cmap, "accented character should not survive subsetting"
    assert 0x2192 not in cmap, "arrow should not survive subsetting"


def test_missing_font_bytes_is_rejected():
    with pytest.raises(Exception):
        nt.subset_font_bytes(b"", TEXT)


def test_undecodable_font_bytes_is_rejected():
    with pytest.raises(Exception):
        nt.subset_font_bytes(b"this is not a font", TEXT)


def test_oversized_font_is_rejected():
    huge = b"\x00" * (nt.MAX_FONT_SUBSET_BYTES + 1)
    with pytest.raises(Exception):
        nt.subset_font_bytes(huge, TEXT)
