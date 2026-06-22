"""Visual preview: run block_glitch on a REQUESTS text card (the reference scenario),
alone and chained with bayer_dither + duotone. Outputs PNGs into .playground/."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from unittest.mock import MagicMock
sys.modules.setdefault("nodes", MagicMock())

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from comfy_extras._shader_effects import load_catalog, render_effect, resolve_params

OUT = os.path.dirname(__file__)
SIZE = 512
PAPER = (232, 226, 223)

def text_card(size):
    img = Image.new("RGB", (size, size), PAPER)
    d = ImageDraw.Draw(img)
    rows = 5
    pad = int(size * 0.03)
    rowh = (size - pad * 2) / rows
    # find a bold font
    cand = ["/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
    fp = next((c for c in cand if os.path.exists(c)), None)
    word = "REQUESTS"
    for r in range(rows):
        fs = int(rowh * 1.05)
        font = ImageFont.truetype(fp, fs) if fp else ImageFont.load_default()
        bb = d.textbbox((0, 0), word, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        # horizontally scale to fill width: draw on temp then resize
        tmp = Image.new("L", (max(1, tw + 8), max(1, th + 8)), 0)
        ImageDraw.Draw(tmp).text((4 - bb[0], 4 - bb[1]), word, fill=255, font=font)
        tmp = tmp.resize((size - pad * 2, int(rowh * 0.92)))
        y = int(pad + rowh * r + rowh * 0.04)
        blk = Image.new("RGB", tmp.size, (13, 12, 12))
        img.paste(blk, (pad, y), tmp)
    return np.asarray(img, dtype=np.float32) / 255.0

def save(a, name):
    Image.fromarray(np.clip(a[..., :3] * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name))
    print("wrote", name)

def run(cat, eid, img, overrides=None):
    eff = cat.effects[eid]
    u = resolve_params(eff, "{}")
    u.update({"u_time": 0.7, "u_seed": 42.0, "u_hasInput": 1.0})
    if overrides: u.update(overrides)
    return render_effect(eff.source, SIZE, SIZE, [{"image": img, "uniforms": u}], extra_textures={}, passes=eff.passes)[0][..., :3]

cat = load_catalog(refresh=True)
base = text_card(SIZE)
save(base, "pv_0_source.png")

g = run(cat, "block_glitch", base, {"u_style": 3.0})  # mixed
save(g, "pv_1_glitch.png")

gd = run(cat, "bayer_dither", g, {"u_scale": 0.02})
save(gd, "pv_2_glitch_dither.png")

gdt = run(cat, "duotone", gd, {"u_shadowHue": 0.97, "u_lightHue": 0.06, "u_contrast": 0.5})
save(gdt, "pv_3_full_stack.png")
print("OK")
