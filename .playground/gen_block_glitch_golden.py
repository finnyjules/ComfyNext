"""One-off: render ONLY block_glitch goldens, reusing existing fixtures.
Avoids regenerating (and churning) the other 100+ GPU-dependent goldens."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from unittest.mock import MagicMock
sys.modules.setdefault("nodes", MagicMock())

import numpy as np
from PIL import Image
from comfy_extras._shader_effects import load_catalog, render_effect, resolve_params

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "tests-unit", "shaderfx_golden")
GOLDEN_TIME, GOLDEN_SEED, SIZES = 0.7, 42.0, (128, 256)

def load_png(p): return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0
def save_png(a, p): Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)).save(p)

cat = load_catalog(refresh=True)
eff = cat.effects["block_glitch"]
print("loaded effect:", eff.id)
for size in SIZES:
    fixture = load_png(os.path.join(GOLDEN, f"fixture_{size}.png"))
    uniforms = resolve_params(eff, "{}")
    jobs = [{"image": fixture, "uniforms": {**uniforms, "u_time": GOLDEN_TIME, "u_seed": GOLDEN_SEED, "u_hasInput": 1.0}}]
    out = render_effect(eff.source, size, size, jobs, extra_textures={}, passes=eff.passes)[0]
    save_png(out[..., :3], os.path.join(GOLDEN, f"block_glitch_{size}.png"))
    print(f"wrote block_glitch_{size}.png  range=[{out.min():.3f},{out.max():.3f}]")
print("OK")
