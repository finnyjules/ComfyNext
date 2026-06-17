"""Generate the 7-row glyph atlas for the ASCII effect.

Row 0 = the original ' .:-=+*#%@' ramp (PIL default font), rendered with the exact
original code path so the row-0 pixels are byte-identical to the pre-shape atlas
(back-compat: the default ASCII shape is unchanged). Rows 1-6 are character sets
(Matrix/Binary/Braille/Morse/Dots/Slashes) from Unicode fonts, each a COLS-glyph
ramp ordered dark->bright by measured ink coverage. The bake raises if a required
glyph renders as a .notdef box.

Usage: .venv/bin/python shader_effects/assets/generate_glyph_atlas.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CELL_W, CELL_H = 32, 48
SCALE = 4
COLS = 10
SMALL_W, SMALL_H = CELL_W // SCALE, CELL_H // SCALE

ROW0_RAMP = " .:-=+*#%@"  # original ramp — DO NOT change (back-compat)

UNICODE_FONT_CANDIDATES = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Apple Symbols.ttf",
]

BRAILLE_FONT_CANDIDATES = [
    "/System/Library/Fonts/Apple Braille.ttf",
    "/System/Library/Fonts/Apple Braille Outline 6 Dot.ttf",
    "/System/Library/Fonts/Apple Braille Pinpoint 6 Dot.ttf",
]

# (label, candidate pool, font_candidates_override or None to use UNICODE_FONT_CANDIDATES)
# Rows 1..6; sampled to COLS by ink coverage.
SETS = [
    ("matrix", "0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾆﾊﾐﾑﾒﾓﾔﾗﾘﾜﾝ", None),
    ("binary", " 0011", None),
    ("braille", "⠀⠁⠃⠇⠏⠟⠿⡿⣿", BRAILLE_FONT_CANDIDATES),
    ("morse", " .·-—=≡", None),
    ("dots", " ·∙•◦○◌●", None),
    ("slashes", " /\\X#", None),
]


def load_font(px: int, candidates: list) -> ImageFont.FreeTypeFont:
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, px)
            except Exception:
                continue
    raise SystemExit(f"ASCII atlas: no font found in candidates: {candidates}")


def render_glyph(ch: str, font) -> Image.Image:
    img = Image.new("L", (SMALL_W, SMALL_H), 0)
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), ch, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((SMALL_W // 2 - w // 2 - bbox[0], SMALL_H // 2 - h // 2 - bbox[1]), ch, fill=255, font=font)
    return img


def build_row0() -> Image.Image:
    """Exact original rendering of ROW0_RAMP so row 0 stays byte-identical."""
    n = len(ROW0_RAMP)
    small = Image.new("L", (n * SMALL_W, SMALL_H), 0)
    draw = ImageDraw.Draw(small)
    font = ImageFont.load_default()
    for i, ch in enumerate(ROW0_RAMP):
        bbox = draw.textbbox((0, 0), ch, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((i * SMALL_W + (SMALL_W - w) // 2 - bbox[0], (SMALL_H - h) // 2 - bbox[1]), ch, fill=255, font=font)
    return small.resize((n * CELL_W, CELL_H), Image.NEAREST)


def ramp_row(pool: str, font) -> Image.Image:
    nd = list(render_glyph(chr(0xE123), font).getdata())  # private-use codepoint = the font notdef box
    scored = []
    for ch in pool:
        g = render_glyph(ch, font)
        data = list(g.getdata())
        if ch.strip() != "" and data == nd:
            raise SystemExit(f"ASCII atlas: glyph {ch!r} renders as .notdef in the Unicode font")
        scored.append((sum(data) / len(data), g))
    scored.sort(key=lambda t: t[0])
    strip = Image.new("L", (COLS * SMALL_W, SMALL_H), 0)
    for i in range(COLS):
        idx = round(i * (len(scored) - 1) / (COLS - 1)) if len(scored) > 1 else 0
        strip.paste(scored[idx][1], (i * SMALL_W, 0))
    return strip.resize((COLS * CELL_W, CELL_H), Image.NEAREST)


def main() -> None:
    rows = [build_row0()]
    labels = ["hash"]
    default_font = load_font(SMALL_H, UNICODE_FONT_CANDIDATES)
    font_used = None
    for p in UNICODE_FONT_CANDIDATES:
        if os.path.exists(p):
            font_used = p
            break
    print(f"Unicode font: {font_used}")

    for label, pool, font_candidates in SETS:
        if font_candidates is not None:
            font = load_font(SMALL_H, font_candidates)
            used = next(p for p in font_candidates if os.path.exists(p))
            print(f"  row '{label}': using {used}")
        else:
            font = default_font
        rows.append(ramp_row(pool, font))
        labels.append(label)

    atlas = Image.new("L", (COLS * CELL_W, len(rows) * CELL_H), 0)
    for r, strip in enumerate(rows):
        atlas.paste(strip, (0, r * CELL_H))
    atlas.save(os.path.join(HERE, "glyph_atlas.png"))
    with open(os.path.join(HERE, "glyph_atlas.json"), "w", encoding="utf-8") as f:
        json.dump({"count": COLS, "cellWidth": CELL_W, "cellHeight": CELL_H,
                   "rows": len(rows), "rowLabels": labels, "row0Ramp": ROW0_RAMP}, f, indent=2)
    print(f"glyph_atlas.png: {len(rows)} rows x {COLS} glyphs at {CELL_W}x{CELL_H}")


if __name__ == "__main__":
    main()
