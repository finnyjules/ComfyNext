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


import numpy as np

from comfy_extras._shader_effects import render_effect

_UNIFORM_MIX_FRAG = """#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
uniform float u_mix;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() {
    vec3 col = texture(u_image0, v_texCoord).rgb;
    fragColor0 = vec4(mix(col, vec3(u_time), u_mix), 1.0);
}
"""


def _img(w=32, h=32, value=0.25):
    return np.full((h, w, 3), value, dtype=np.float32)


def test_render_effect_named_uniforms_and_passthrough():
    # u_mix=0 -> passthrough
    outs = render_effect(_UNIFORM_MIX_FRAG, 32, 32, [{"image": _img(), "uniforms": {"u_mix": 0.0, "u_time": 0.0}}])
    assert len(outs) == 1 and outs[0].shape == (32, 32, 4)
    assert np.abs(outs[0][..., :3] - 0.25).max() < 1.0 / 255.0


def test_render_effect_per_job_uniforms_differ():
    jobs = [
        {"image": _img(), "uniforms": {"u_mix": 1.0, "u_time": 0.0}},
        {"image": _img(), "uniforms": {"u_mix": 1.0, "u_time": 1.0}},
    ]
    outs = render_effect(_UNIFORM_MIX_FRAG, 32, 32, jobs)
    assert np.abs(outs[0][..., :3] - 0.0).max() < 1.0 / 255.0
    assert np.abs(outs[1][..., :3] - 1.0).max() < 1.0 / 255.0


def test_render_effect_compile_error_raises_with_log():
    import pytest
    with pytest.raises(RuntimeError, match="(?i)compil"):
        render_effect("#version 300 es\nvoid main() { bogus }", 8, 8, [{"image": _img(8, 8), "uniforms": {}}])


def test_render_effect_extra_texture_binds():
    frag = """#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform sampler2D u_lut;
uniform vec2 u_resolution;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = vec4(texture(u_lut, v_texCoord).rgb, 1.0); }
"""
    lut = np.zeros((4, 4, 4), dtype=np.float32)
    lut[..., 1] = 1.0  # green
    lut[..., 3] = 1.0
    outs = render_effect(frag, 16, 16, [{"image": _img(16, 16), "uniforms": {}}], extra_textures={"u_lut": lut})
    assert np.abs(outs[0][..., 1] - 1.0).max() < 1.0 / 255.0
    assert np.abs(outs[0][..., 0]).max() < 1.0 / 255.0


def test_render_effect_none_image_reuses_previous_frame():
    jobs = [
        {"image": _img(value=0.5), "uniforms": {"u_mix": 0.0, "u_time": 0.0}},
        {"image": None, "uniforms": {"u_mix": 0.0, "u_time": 0.0}},
    ]
    outs = render_effect(_UNIFORM_MIX_FRAG, 32, 32, jobs)
    assert np.abs(outs[1][..., :3] - 0.5).max() < 1.0 / 255.0


def test_render_effect_first_job_requires_image():
    import pytest
    with pytest.raises(ValueError, match="first job"):
        render_effect(_UNIFORM_MIX_FRAG, 32, 32, [{"image": None, "uniforms": {}}])


def test_resolve_params_coerces_non_numeric_to_default():
    cat = load_catalog(refresh=True)
    eff = cat.effects["noise_distortion"]
    u = resolve_params(eff, json.dumps({"u_amount": "bad"}))
    assert u["u_amount"] == pytest.approx(0.06)


import torch

from comfy_extras.nodes_shader_effects import ShaderEffect


def _run_node(image, effect="noise_distortion", params="{}", time=0.0, duration=0.0, fps=4, seed=42):
    # Execute the classmethod directly; hidden unique_id is only used for the ui preview.
    class _Hidden:
        unique_id = "test"
    ShaderEffect.hidden = _Hidden
    return ShaderEffect.execute(image, effect, params, time, duration, fps, seed)


def test_node_still_returns_single_frame():
    img = torch.rand(1, 48, 64, 3)
    out = _run_node(img).args[0]
    assert out.shape == (1, 48, 64, 3)


def test_node_duration_returns_frame_batch_that_animates():
    img = torch.rand(1, 32, 32, 3)
    out = _run_node(img, duration=1.0, fps=4).args[0]
    assert out.shape == (4, 32, 32, 3)
    assert (out[0] - out[3]).abs().max() > 1.0 / 255.0  # noise_distortion is animated


def test_node_batch_input_keeps_frame_count():
    img = torch.rand(3, 32, 32, 3)
    out = _run_node(img, duration=99.0).args[0]  # duration must be ignored
    assert out.shape == (3, 32, 32, 3)


def test_node_unknown_effect_raises():
    import pytest
    with pytest.raises(ValueError, match="bogus"):
        _run_node(torch.rand(1, 16, 16, 3), effect="bogus")


def test_node_frame_cap_guards_memory():
    import pytest
    with pytest.raises(ValueError, match="frames requested"):
        _run_node(torch.rand(1, 16, 16, 3), duration=60.0, fps=60)
