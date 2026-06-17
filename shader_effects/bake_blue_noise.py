"""Bake a tileable 64x64 blue-noise tile via Ulichney's void-and-cluster.

Run once (output committed): .venv/bin/python shader_effects/bake_blue_noise.py
Deterministic (seeded) so re-runs produce identical bytes. Needs numpy + scipy + PIL.
"""
import os
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

SIZE = 64
SIGMA = 1.9  # energy spread; ~1.5-2.0 gives good blue-noise spectra at this size


def _energy(binary: np.ndarray) -> np.ndarray:
    # Toroidal gaussian energy of the binary point set.
    return gaussian_filter(binary.astype(np.float64), SIGMA, mode="wrap")


def void_and_cluster(size: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = size * size
    binary = np.zeros((size, size), dtype=bool)
    init = max(1, n // 10)
    binary.flat[rng.choice(n, init, replace=False)] = True

    # Phase 0: relax the initial pattern until tightest cluster == largest void.
    while True:
        c = int(np.where(binary, _energy(binary), -np.inf).argmax())
        binary.flat[c] = False
        v = int(np.where(~binary, _energy(binary), np.inf).argmin())
        binary.flat[v] = True
        if c == v:
            break

    rank = np.full(n, -1, dtype=np.int64)

    # Phase 1: rank the initial ones (remove tightest clusters), descending.
    work = binary.copy()
    ones = int(work.sum())
    for r in range(ones - 1, -1, -1):
        c = int(np.where(work, _energy(work), -np.inf).argmax())
        work.flat[c] = False
        rank[c] = r

    # Phase 2: rank the rest (fill largest voids), ascending.
    work = binary.copy()
    for r in range(ones, n):
        v = int(np.where(~work, _energy(work), np.inf).argmin())
        work.flat[v] = True
        rank[v] = r

    return rank.reshape(size, size)


def main() -> None:
    rank = void_and_cluster(SIZE, seed=12345)
    thresh = np.floor((rank + 0.5) / (SIZE * SIZE) * 256.0).clip(0, 255).astype(np.uint8)
    rgb = np.dstack([thresh, thresh, thresh])
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "blue_noise.png")
    Image.fromarray(rgb, "RGB").save(out)
    print(f"wrote {out}  ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
