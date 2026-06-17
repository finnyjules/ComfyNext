import json
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.modules.setdefault("nodes", MagicMock())

import comfy_extras._shader_effects as sfx
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


def _write_catalog(dirpath, param):
    """Write a minimal one-effect manifest + its .frag into dirpath."""
    with open(os.path.join(dirpath, "foo.frag"), "w", encoding="utf-8") as f:
        f.write("#version 300 es\nvoid main(){}\n")
    manifest = {
        "version": 1,
        "effects": [{
            "id": "foo", "name": "Foo", "category": "stylize", "animated": False,
            "passes": 1, "centerParam": None, "textures": [], "params": [param],
        }],
    }
    with open(os.path.join(dirpath, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f)


def test_load_catalog_rejects_enum_default_not_in_options(tmp_path, monkeypatch):
    """load_catalog raises when an enum param's default isn't one of its options."""
    _write_catalog(tmp_path, {
        "uniform": "u_pattern", "label": "Pattern", "type": "enum", "default": 99,
        "options": [{"label": "A", "value": 0}, {"label": "B", "value": 1}],
    })
    # monkeypatch restores CATALOG_DIR + the _catalog cache after the test, so the
    # real catalog is intact for other tests in the session.
    monkeypatch.setattr(sfx, "CATALOG_DIR", str(tmp_path))
    monkeypatch.setattr(sfx, "_catalog", None)
    with pytest.raises(ValueError, match="enum default"):
        load_catalog(refresh=True)


def test_load_catalog_accepts_valid_enum_default(tmp_path, monkeypatch):
    """A well-formed enum param (default in options) loads cleanly."""
    _write_catalog(tmp_path, {
        "uniform": "u_pattern", "label": "Pattern", "type": "enum", "default": 1,
        "options": [{"label": "A", "value": 0}, {"label": "B", "value": 1}],
    })
    monkeypatch.setattr(sfx, "CATALOG_DIR", str(tmp_path))
    monkeypatch.setattr(sfx, "_catalog", None)
    catalog = load_catalog(refresh=True)
    assert catalog.effects["foo"].params[0].type == "enum"
