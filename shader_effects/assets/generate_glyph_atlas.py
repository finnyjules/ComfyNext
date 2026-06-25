"""Generate the 7-row glyph atlas for the ASCII effect.

Each glyph is rendered CRISP at the full cell resolution from a vector font (no
render-tiny-then-upscale), so characters stay sharp when drawn into large ASCII
cells. Row 0 = the classic ' .:-=+*#%@' ramp in a monospace face; rows 1-6 are
character sets (Matrix/Binary/Braille/Morse/Dots/Slashes) from Unicode fonts, each
a COLS-glyph ramp ordered dark->bright by measured ink coverage. The bake raises
if a required glyph renders as a .notdef box. The shader samples this atlas
bilinearly, so the antialiased grayscale edges give clean characters at any size.

Usage: .venv/bin/python shader_effects/assets/generate_glyph_atlas.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
# High-res cells so glyphs stay crisp when a cell is rendered large. 2:3 aspect
# (kept from the original 32x48) — the shader's CW/CH consts must match these.
CELL_W, CELL_H = 192, 288
COLS = 10
GLYPH_PX = int(CELL_H * 0.9)  # font size; leaves a small margin inside the cell

ROW0_RAMP = " .:-=+*#%@"  # classic luminance ramp (dark -> dense)

# Monospace face for the default Hash ramp (row 0) — crisp, even glyph weight.
MONO_FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/Library/Fonts/Courier New.ttf",
]

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


def draw_centered(draw: ImageDraw.ImageDraw, x0: int, ch: str, font) -> None:
    """Draw `ch` centered (by ink bbox) within the CELL_W cell starting at x0."""
    bbox = draw.textbbox((0, 0), ch, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((x0 + (CELL_W - w) // 2 - bbox[0], (CELL_H - h) // 2 - bbox[1]), ch, fill=255, font=font)


def render_glyph(ch: str, font) -> Image.Image:
    img = Image.new("L", (CELL_W, CELL_H), 0)
    draw_centered(ImageDraw.Draw(img), 0, ch, font)
    return img


def build_row0() -> Image.Image:
    """Classic ramp rendered crisp in a monospace face."""
    n = len(ROW0_RAMP)
    font = load_font(GLYPH_PX, MONO_FONT_CANDIDATES)
    strip = Image.new("L", (n * CELL_W, CELL_H), 0)
    draw = ImageDraw.Draw(strip)
    for i, ch in enumerate(ROW0_RAMP):
        draw_centered(draw, i * CELL_W, ch, font)
    return strip


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
    strip = Image.new("L", (COLS * CELL_W, CELL_H), 0)
    for i in range(COLS):
        idx = round(i * (len(scored) - 1) / (COLS - 1)) if len(scored) > 1 else 0
        strip.paste(scored[idx][1], (i * CELL_W, 0))
    return strip


def main() -> None:
    rows = [build_row0()]
    labels = ["hash"]
    default_font = load_font(GLYPH_PX, UNICODE_FONT_CANDIDATES)
    font_used = next((p for p in UNICODE_FONT_CANDIDATES if os.path.exists(p)), None)
    print(f"Unicode font: {font_used}")

    for label, pool, font_candidates in SETS:
        if font_candidates is not None:
            font = load_font(GLYPH_PX, font_candidates)
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
