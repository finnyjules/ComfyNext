"""Generate the glyph atlas for ASCII/Glyph Dither: 10 glyphs in a brightness ramp.

Uses PIL's built-in bitmap font (deterministic across machines), nearest-upscaled
for a chunky retro look. Cells are CELL_W x CELL_H, glyphs ordered dark -> bright.
Usage: .venv/bin/python shader_effects/assets/generate_glyph_atlas.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RAMP = " .:-=+*#%@"
CELL_W, CELL_H = 32, 48
SCALE = 4  # render small, upscale NEAREST


def main() -> None:
    n = len(RAMP)
    small_w, small_h = CELL_W // SCALE, CELL_H // SCALE
    atlas = Image.new("L", (n * small_w, small_h), 0)
    draw = ImageDraw.Draw(atlas)
    font = ImageFont.load_default()
    for i, ch in enumerate(RAMP):
        bbox = draw.textbbox((0, 0), ch, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((i * small_w + (small_w - w) // 2 - bbox[0], (small_h - h) // 2 - bbox[1]), ch, fill=255, font=font)
    atlas = atlas.resize((n * CELL_W, CELL_H), Image.NEAREST)
    atlas.save(os.path.join(HERE, "glyph_atlas.png"))
    with open(os.path.join(HERE, "glyph_atlas.json"), "w", encoding="utf-8") as f:
        json.dump({"count": n, "cellWidth": CELL_W, "cellHeight": CELL_H, "ramp": RAMP}, f, indent=2)
    print(f"glyph_atlas.png: {n} glyphs at {CELL_W}x{CELL_H}")


if __name__ == "__main__":
    main()
