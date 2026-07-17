"""Python twin of frontend/tests/unit/timeline-filters.unit.spec.ts — pins the
SAME ClipFilters math (shared/timeline/filters.ts ↔ _apply_filters_np).
Change them together; the 06-filters golden fixture gates the renderers."""
import importlib.util
import os
import sys

import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_nodes_timeline():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_filters_test",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NT = _load_nodes_timeline()


def apply(px, **filters):
    f = NT._filters_or_none(filters)
    arr = np.array([[list(px)]], dtype=np.float32)
    return NT._apply_filters_np(arr, f)[0, 0].tolist()


PX = (0.25, 0.5, 0.75)


def test_identity_passes_through():
    assert NT._filters_or_none(None) is None
    assert NT._filters_or_none({"brightness": 0, "contrast": 1, "saturation": 1, "hue": 0, "temperature": 0}) is None
    assert apply(PX) == list(PX)


def test_brightness_additive_and_clamped():
    out = apply(PX, brightness=0.1)
    assert np.allclose(out, [0.35, 0.6, 0.85], atol=1e-6)
    assert apply(PX, brightness=0.5)[2] == 1.0
    assert apply(PX, brightness=-0.3)[0] == 0.0


def test_contrast_pivots_at_half():
    out = apply(PX, contrast=2)
    assert np.allclose(out, [0.0, 0.5, 1.0], atol=1e-6)


def test_saturation_zero_is_rec709_luma():
    luma = 0.2126 * 0.25 + 0.7152 * 0.5 + 0.0722 * 0.75
    out = apply(PX, saturation=0)
    assert np.allclose(out, [luma] * 3, atol=1e-6)


def test_hue_120_matches_svg_matrix():
    out = apply((1.0, 0.0, 0.0), hue=120)
    assert out[1] > out[0]
    assert abs(out[0] - 0.0) < 1e-6  # clamped negative
    expect_g = 0.213 - np.cos(np.deg2rad(120)) * 0.213 + np.sin(np.deg2rad(120)) * 0.143
    assert abs(out[1] - expect_g) < 1e-6


def test_temperature_multiplicative():
    out = apply(PX, temperature=1)
    assert abs(out[0] - 0.25 * 1.2) < 1e-6
    assert abs(out[2] - 0.75 * 0.8) < 1e-6


def test_order_brightness_before_contrast():
    out = apply((0.25, 0.25, 0.25), brightness=0.5, contrast=2)
    assert abs(out[0] - 1.0) < 1e-6
