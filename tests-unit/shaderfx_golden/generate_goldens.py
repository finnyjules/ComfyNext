"""(Re)generate shader-effect golden PNGs: procedural fixture + server render per effect.

Usage: .venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py
Goldens are machine-calibrated (GPU-dependent); regenerate on the machine that runs the tests.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from unittest.mock import MagicMock

sys.modules.setdefault("nodes", MagicMock())

import numpy as np
from PIL import Image

from comfy_extras._shader_effects import load_catalog, render_effect, resolve_params

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN_TIME = 0.7
GOLDEN_SEED = 42.0
SIZES = (128, 256)


def make_fixture(size: int) -> np.ndarray:
    """Deterministic colorful test card: gradients + two soft discs. No resampling anywhere."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64) / (size - 1)
    r = np.clip(1.0 - np.hypot(x - 0.35, y - 0.4) / 0.25, 0, 1)
    g = np.clip(1.0 - np.hypot(x - 0.7, y - 0.65) / 0.35, 0, 1)
    img = np.stack(
        [0.2 + 0.8 * x, 0.15 + 0.7 * y, 0.5 + 0.5 * np.sin(2.0 * np.pi * (x + y))], axis=-1
    )
    img[..., 0] = np.maximum(img[..., 0], r)
    img[..., 1] = np.maximum(img[..., 1], g)
    return np.clip(img, 0, 1).astype(np.float32)


def save_png(arr: np.ndarray, path: str) -> None:
    Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)).save(path)


def load_png(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def main() -> None:
    catalog = load_catalog(refresh=True)
    for size in SIZES:
        fixture_path = os.path.join(HERE, f"fixture_{size}.png")
        save_png(make_fixture(size), fixture_path)
        fixture = load_png(fixture_path)  # round-trip through 8-bit, same as the browser sees
        for eff in catalog.effects.values():
            uniforms = resolve_params(eff, "{}")
            textures = {}
            for t in eff.textures:
                from comfy_extras._shader_effects import ASSETS_DIR
                tex = Image.open(os.path.join(ASSETS_DIR, t["file"])).convert("RGBA")
                textures[t["uniform"]] = np.asarray(tex, dtype=np.float32) / 255.0
                for k, v in t.get("extraUniforms", {}).items():
                    uniforms[k] = float(v)
            jobs = [{"image": fixture, "uniforms": {**uniforms, "u_time": GOLDEN_TIME, "u_seed": GOLDEN_SEED}}]
            out = render_effect(eff.source, size, size, jobs, extra_textures=textures, passes=eff.passes)[0]
            save_png(out[..., :3], os.path.join(HERE, f"{eff.id}_{size}.png"))
            print(f"golden: {eff.id}_{size}.png")


if __name__ == "__main__":
    main()
