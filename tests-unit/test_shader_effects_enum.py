import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.modules.setdefault("nodes", MagicMock())

from comfy_extras._shader_effects import EffectParam, Effect, resolve_params, load_catalog


def _enum_effect():
    p_enum = EffectParam(
        uniform="u_pattern", label="Pattern", type="enum", default=1.0,
        options=[{"label": "A", "value": 0}, {"label": "B", "value": 1}, {"label": "C", "value": 2}],
    )
    p_float = EffectParam(uniform="u_scale", label="Scale", type="float", min=1.0, max=10.0, default=4.0, step=1.0)
    return Effect(id="t", name="T", category="stylize", animated=False, passes=1,
                  center_param=None, textures=[], params=[p_enum, p_float], source="")


def test_enum_default_when_missing():
    out = resolve_params(_enum_effect(), "{}")
    assert out["u_pattern"] == 1.0
    assert out["u_scale"] == 4.0


def test_enum_keeps_valid_value():
    out = resolve_params(_enum_effect(), '{"u_pattern": 2}')
    assert out["u_pattern"] == 2.0


def test_enum_falls_back_to_default_on_invalid():
    out = resolve_params(_enum_effect(), '{"u_pattern": 99}')
    assert out["u_pattern"] == 1.0


def test_float_still_clamps():
    out = resolve_params(_enum_effect(), '{"u_scale": 999}')
    assert out["u_scale"] == 10.0


# ── load_catalog enum integration tests ────────────────────────────────────────

def test_load_catalog_accepts_bayer_dither_enum():
    """The real manifest's bayer_dither effect has a u_pattern enum — catalog loads cleanly."""
    catalog = load_catalog(refresh=True)
    assert "bayer_dither" in catalog.effects, "bayer_dither not found in catalog"
    effect = catalog.effects["bayer_dither"]
    pattern_param = next((p for p in effect.params if p.uniform == "u_pattern"), None)
    assert pattern_param is not None, "u_pattern param not found on bayer_dither"
    assert pattern_param.type == "enum"
    assert len(pattern_param.options) == 12
    assert pattern_param.default == 1


def test_load_catalog_enum_default_must_be_in_options():
    """Validation guard: an enum param whose default isn't in options is rejected."""
    bad_param = EffectParam(
        uniform="u_pattern", label="Pattern", type="enum", default=99,
        options=[{"label": "A", "value": 0}],
    )
    values = [o["value"] for o in (bad_param.options or [])]
    assert bad_param.default not in values, (
        "Expected default 99 to not be in options [0]; validation would reject this"
    )
