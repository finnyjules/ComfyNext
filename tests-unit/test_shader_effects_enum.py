import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.modules.setdefault("nodes", MagicMock())

from comfy_extras._shader_effects import EffectParam, Effect, resolve_params


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
