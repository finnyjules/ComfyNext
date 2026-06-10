"""Deterministic synthetic media for the timeline golden fixtures.

Regenerate with:  .venv/bin/python tests-unit/timeline_fixtures/generate_assets.py
Outputs are committed; regeneration must stay byte-stable — pure numpy ramps,
no text/fonts, no randomness, no timestamps.
"""
import os

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
W, H = 320, 180


def _save(name: str, arr: np.ndarray) -> None:
    Image.fromarray(arr.astype(np.uint8)).save(os.path.join(OUT, name), optimize=False)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    x = np.linspace(0.0, 255.0, W)[None, :].repeat(H, 0)
    y = np.linspace(0.0, 255.0, H)[:, None].repeat(W, 1)
    zeros = np.zeros((H, W))

    _save("gradient_a.png", np.stack([x, zeros, 255.0 - x], axis=-1))          # red → blue, horizontal
    _save("gradient_b.png", np.stack([255.0 - y, y, 255.0 - y], axis=-1))      # magenta → green, vertical
    cell = (np.add.outer(np.arange(H) // 24, np.arange(W) // 24) % 2) * 255.0
    _save("checker.png", np.stack([cell, cell, cell], axis=-1))
    _save("solid_orange.png", np.broadcast_to(np.array([255.0, 140.0, 0.0]), (H, W, 3)).copy())


if __name__ == "__main__":
    main()
