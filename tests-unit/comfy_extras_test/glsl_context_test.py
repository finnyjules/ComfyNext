"""GL context smoke test: a backend initializes and a passthrough shader round-trips."""
import sys
from unittest.mock import MagicMock

# Prevent CUDA/server init during import (established pattern, see image_stitch_test.py)
sys.modules.setdefault("nodes", MagicMock())

import numpy as np

from comfy_extras.nodes_glsl import (
    DEFAULT_FRAGMENT_SHADER,
    GLContext,
    _render_shader_batch,
)


def test_gl_context_initializes_on_this_platform():
    ctx = GLContext()
    assert ctx._backend in ("glfw", "egl", "osmesa", "cgl")


def test_passthrough_shader_roundtrips_image():
    rng = np.random.default_rng(7)
    img = rng.random((64, 64, 3), dtype=np.float32)
    outs = _render_shader_batch(DEFAULT_FRAGMENT_SHADER, 64, 64, [[img]], [], [])
    out = outs[0][0]
    assert out.shape == (64, 64, 4)
    assert np.abs(out[..., :3] - img).max() < 1.0 / 255.0
