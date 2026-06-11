"""Catalog loader, param resolution, and frame-plan tests for shader effects."""
import sys
from unittest.mock import MagicMock

sys.modules.setdefault("nodes", MagicMock())

import json

import pytest

from comfy_extras._shader_effects import frame_plan, load_catalog, resolve_params


def test_catalog_loads_and_has_spike_effects():
    cat = load_catalog(refresh=True)
    assert "noise_distortion" in cat.effects
    assert "halftone" in cat.effects
    eff = cat.effects["noise_distortion"]
    assert eff.source.startswith("#version 300 es")
    assert eff.category == "distortion"
    assert eff.params[0].uniform == "u_amount"


def test_resolve_params_defaults_overrides_and_clamps():
    cat = load_catalog(refresh=True)
    eff = cat.effects["noise_distortion"]
    # Defaults
    u = resolve_params(eff, "{}")
    assert u["u_amount"] == pytest.approx(0.06)
    # Override + clamp + unknown key ignored
    u = resolve_params(eff, json.dumps({"u_amount": 99.0, "u_bogus": 1.0}))
    assert u["u_amount"] == pytest.approx(0.3)
    assert "u_bogus" not in u


def test_resolve_params_rejects_bad_json():
    cat = load_catalog(refresh=True)
    with pytest.raises(ValueError, match="params"):
        resolve_params(cat.effects["halftone"], "{not json")


def test_frame_plan_semantics():
    # Still + no duration -> one frame at `time`
    assert frame_plan(1, 2.5, 0.0, 24) == [(0, 2.5)]
    # Still + duration -> duration*fps frames advancing from `time`
    plan = frame_plan(1, 0.0, 1.0, 4)
    assert plan == [(0, 0.0), (0, 0.25), (0, 0.5), (0, 0.75)]
    # Batch input -> one output frame per input frame, duration ignored
    plan = frame_plan(3, 1.0, 99.0, 2)
    assert plan == [(0, 1.0), (1, 1.5), (2, 2.0)]
