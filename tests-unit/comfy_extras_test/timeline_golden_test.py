"""Golden-frame gate: re-render every fixture frame and diff against the
committed goldens. This is the parity contract the Phase-1 WebGL engine will
also be held to (via the Playwright harness). Regenerate goldens ONLY for
intended pixel-math changes: .venv/bin/python scripts/timeline_golden.py
"""
import importlib.util
import os
import sys

import numpy as np
import pytest
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_golden_tools():
    spec = importlib.util.spec_from_file_location(
        "timeline_golden", os.path.join(REPO_ROOT, "scripts", "timeline_golden.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


G = _load_golden_tools()


def _load_png(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


@pytest.mark.parametrize("fixture_path", G.fixture_paths(), ids=os.path.basename)
def test_render_matches_committed_goldens(fixture_path):
    rendered = G.render_fixture_frames(fixture_path)
    assert rendered, f"fixture {fixture_path} declares no golden frames"
    for frame, arr in rendered.items():
        gp = G.golden_path(fixture_path, frame)
        assert os.path.exists(gp), f"missing golden {gp} — run scripts/timeline_golden.py"
        golden = _load_png(gp)
        assert golden.shape == arr.shape
        diff = np.abs(arr - golden)
        assert diff.max() <= G.TOL_MAX, (
            f"{os.path.basename(fixture_path)} frame {frame}: max diff "
            f"{diff.max():.5f} > {G.TOL_MAX:.5f}")
        assert diff.mean() <= G.TOL_MEAN, (
            f"{os.path.basename(fixture_path)} frame {frame}: mean diff "
            f"{diff.mean():.5f} > {G.TOL_MEAN:.5f}")


def test_gate_catches_divergence():
    """Negative control: a perturbed render MUST fail the tolerance — proves
    the harness can actually catch preview/export drift."""
    fp = G.fixture_paths()[0]
    state, frames = G.load_fixture(fp)
    # Halve the first clip's opacity — a typical "math drifted" bug.
    state["clips"][0]["opacity"] = state["clips"][0].get("opacity", 1.0) * 0.5
    nt = G.load_nodes_timeline()
    clips = nt._prepare_render_clips(state)
    try:
        arr = nt.render_frame_np(state, clips, frames[0])
    finally:
        nt._close_render_clips(clips)
    golden = _load_png(G.golden_path(fp, frames[0]))
    assert np.abs(arr - golden).max() > G.TOL_MAX
