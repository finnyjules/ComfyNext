"""Timeline golden-frame tooling.

Regenerate goldens:   .venv/bin/python scripts/timeline_golden.py
Goldens live in tests-unit/timeline_golden/<fixture-stem>/f<NNN>.png and are
committed. tests-unit/comfy_extras_test/timeline_golden_test.py re-renders the
fixtures and diffs against them — the gate that keeps the Python exporter
(and, from Phase 1, the WebGL preview engine) pixel-stable.

Only regenerate when a pixel-math change is INTENDED, and eyeball the new
frames before committing.
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FIXTURES_DIR = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures")
GOLDEN_DIR = os.path.join(REPO_ROOT, "tests-unit", "timeline_golden")

# Anything beyond quantisation rounding is a visible drift.
TOL_MAX = 2.0 / 255.0
TOL_MEAN = 0.5 / 255.0

_NT = None


def load_nodes_timeline():
    """Import comfy_extras/nodes_timeline.py once and cache it — re-executing
    the module per call is slow and would re-register server routes when a
    PromptServer exists."""
    global _NT
    if _NT is not None:
        return _NT
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_golden", os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _NT = module
    return _NT


def fixture_paths() -> list[str]:
    return sorted(
        os.path.join(FIXTURES_DIR, f)
        for f in os.listdir(FIXTURES_DIR)
        if f.endswith(".json")
    )


def load_fixture(path: str) -> tuple[dict, list[int]]:
    """Read a fixture EditState, absolutize clip paths, flatten for the export
    renderer. Returns (flat_state, golden_frames)."""
    with open(path) as fh:
        raw = json.load(fh)
    frames = list(raw.get("_golden", {}).get("frames", []))
    for track in raw.get("tracks", []):
        for clip in track.get("clips", []):
            p = clip.get("path")
            if p and not os.path.isabs(p):
                clip["path"] = os.path.join(FIXTURES_DIR, p)
    nt = load_nodes_timeline()
    return nt._adapt_edit_state(raw), frames


def render_fixture_frames(path: str) -> dict[int, np.ndarray]:
    """Render every golden-sampled frame of one fixture. {frame: float32 HxWx3}."""
    nt = load_nodes_timeline()
    state, frames = load_fixture(path)
    clips = nt._prepare_render_clips(state)
    try:
        return {f: nt.render_frame_np(state, clips, f) for f in frames}
    finally:
        nt._close_render_clips(clips)


def golden_path(fixture_path: str, frame: int) -> str:
    stem = os.path.splitext(os.path.basename(fixture_path))[0]
    return os.path.join(GOLDEN_DIR, stem, f"f{frame:03d}.png")


def main() -> None:
    for fp in fixture_paths():
        rendered = render_fixture_frames(fp)
        for frame, arr in rendered.items():
            out = golden_path(fp, frame)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            Image.fromarray((arr * 255.0).round().astype(np.uint8)).save(out, optimize=False)
            print(f"wrote {os.path.relpath(out, REPO_ROOT)}")


if __name__ == "__main__":
    main()
