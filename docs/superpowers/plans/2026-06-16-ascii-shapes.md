# ASCII with shapes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the `ascii_dither` effect (id kept) into a Morflax-style "ASCII" effect with a 14-entry Shape dropdown — 7 procedural geometric shapes + 7 character-set rows in a rebaked 7-row glyph atlas — plus Brightness/Spacing/Invert, reusing the existing enum-param schema.

**Architecture:** A rebaked 7-row glyph atlas (row 0 = the existing ramp, byte-identical for back-compat; rows 1-6 = character sets from a Unicode font, ordered by ink coverage). The shader's new `u_shape` enum dispatches to a procedural geometric branch (shapes 0-6) or an atlas-row branch (shapes 7-13). The enum param machinery (types/Python/UIs) already exists from the Dither work — this just adds a new enum-param instance.

**Tech Stack:** GLSL ES 3.00, Python (PIL/numpy, `.venv/bin/python`), the existing shaderfx enum schema, the golden harness. No frontend schema or UI changes (the enum `<select>` already renders).

**Reference files (read first):**
- Spec: `docs/superpowers/specs/2026-06-16-ascii-shapes-design.md`
- `shader_effects/ascii_dither.frag`, `shader_effects/manifest.json` (`ascii_dither` entry)
- `shader_effects/assets/generate_glyph_atlas.py`, `glyph_atlas.png`, `glyph_atlas.json`
- `comfy_extras/_shader_effects.py` (load_catalog/resolve_params/render_effect), `nodes_shader_effects.py` (`_load_effect_textures`)
- `tests-unit/shaderfx_golden/generate_goldens.py`
- The Dither plan `docs/superpowers/plans/2026-06-16-dither-patterns.md` (same shape of work, for reference)

**Conventions:** repo root `/Users/julien/Documents/GitHub/ComfyNext`. Python = `.venv/bin/python` (or the absolute main-venv path when in a worktree). No purple accents (N/A — no UI changes). Commit after each task. Keep id `ascii_dither`; default `u_shape=7` (Hash = row 0) preserves the current look.

---

## Prerequisite: Isolated branch

Create a worktree off `feat/gradient-studio` HEAD (use `superpowers:using-git-worktrees`). Branch: `feat/ascii-shapes`. In a worktree, run Python via the absolute main-venv path `/Users/julien/Documents/GitHub/ComfyNext/.venv/bin/python` with cwd = the worktree (the worktree has no `.venv`).

---

## File structure

**Modify:**
- `shader_effects/assets/generate_glyph_atlas.py` — rebake a 7-row atlas
- `shader_effects/assets/glyph_atlas.png` / `glyph_atlas.json` — regenerated (committed)
- `shader_effects/ascii_dither.frag` — `u_shape` dispatch + brightness/spacing/invert
- `shader_effects/manifest.json` — `ascii_dither` entry: name "ASCII", `u_glyphRows`, `u_shape` enum + 3 params
- `tests-unit/shaderfx_golden/ascii_dither_{128,256}.png` — regenerated goldens (likely unchanged)

No frontend or schema files change.

---

## Task 1: Rebake the 7-row glyph atlas

**Files:**
- Modify: `shader_effects/assets/generate_glyph_atlas.py`
- Regenerate: `shader_effects/assets/glyph_atlas.png`, `glyph_atlas.json`

- [ ] **Step 1: Save the current atlas for the back-compat check**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && cp shader_effects/assets/glyph_atlas.png /tmp/old_glyph_atlas.png && .venv/bin/python -c "from PIL import Image; print(Image.open('/tmp/old_glyph_atlas.png').size)"`
Expected: prints `(320, 48)` (10 glyphs × 32 wide, 1 row × 48 tall).

- [ ] **Step 2: Rewrite the generator**

Replace the entire contents of `shader_effects/assets/generate_glyph_atlas.py`:

```python
"""Generate the 7-row glyph atlas for the ASCII effect.

Row 0 = the original ' .:-=+*#%@' ramp (PIL default font), rendered with the exact
original code path so the row-0 pixels are byte-identical to the pre-shape atlas
(back-compat: the default ASCII shape is unchanged). Rows 1-6 are character sets
(Matrix/Binary/Braille/Morse/Dots/Slashes) from a Unicode font, each a COLS-glyph
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

# (label, candidate pool) for rows 1..6; sampled to COLS by ink coverage.
SETS = [
    ("matrix", "0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾆﾊﾐﾑﾒﾓﾔﾗﾘﾜﾝ"),
    ("binary", " 0011"),
    ("braille", "⠀⠁⠃⠇⠏⠟⠿⡿⣿"),
    ("morse", " .·-—=≡"),
    ("dots", " ·∙•●⬤"),
    ("slashes", " /\\X#"),
]


def load_unicode_font(px: int) -> ImageFont.FreeTypeFont:
    for p in UNICODE_FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, px)
            except Exception:
                continue
    raise SystemExit("ASCII atlas: no Unicode font found for rows 1-6")


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
    ufont = load_unicode_font(SMALL_H)
    for label, pool in SETS:
        rows.append(ramp_row(pool, ufont))
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
```

- [ ] **Step 3: Run the bake**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python shader_effects/assets/generate_glyph_atlas.py`
Expected: prints `glyph_atlas.png: 7 rows x 10 glyphs at 32x48` (no `.notdef` SystemExit). If it raises a `.notdef` error, the chosen font lacks a glyph — adjust `UNICODE_FONT_CANDIDATES` (try `/System/Library/Fonts/Apple Symbols.ttf` or a Hiragino font) and report.

- [ ] **Step 4: Verify dimensions, 7 rows, and row-0 byte-identity**

Run:
```bash
cd /Users/julien/Documents/GitHub/ComfyNext
.venv/bin/python -c "
import numpy as np
from PIL import Image
new = np.asarray(Image.open('shader_effects/assets/glyph_atlas.png').convert('L'))
old = np.asarray(Image.open('/tmp/old_glyph_atlas.png').convert('L'))
print('new size:', new.shape)        # (336, 320) = 7*48 x 10*32
assert new.shape == (7*48, 10*32), new.shape
# row 0 region must equal the old single-row atlas exactly
row0 = new[0:48, 0:320]
print('row0 == old atlas:', np.array_equal(row0, old), '| max diff:', int(np.abs(row0.astype(int)-old.astype(int)).max()))
assert np.array_equal(row0, old), 'row 0 not byte-identical — back-compat broken'
# rows 1-6 must be non-empty (something rendered)
for r in range(1,7):
    band = new[r*48:(r+1)*48, :]
    assert band.max() > 0, f'row {r} is blank'
print('all 7 rows present, rows 1-6 non-empty, row 0 byte-identical')
"
```
Expected: `row0 == old atlas: True`, then `all 7 rows present, rows 1-6 non-empty, row 0 byte-identical`. If row 0 differs, STOP — the row-0 code path was altered.

- [ ] **Step 5: Commit**

```bash
git add shader_effects/assets/generate_glyph_atlas.py shader_effects/assets/glyph_atlas.png shader_effects/assets/glyph_atlas.json
git commit -m "feat(ascii): rebake 7-row glyph atlas (row 0 unchanged + 6 char sets)"
```

---

## Task 2: Shader dispatch + manifest

**Files:**
- Modify: `shader_effects/ascii_dither.frag` (full rewrite)
- Modify: `shader_effects/manifest.json` (`ascii_dither` entry)

- [ ] **Step 1: Rewrite the shader**

Replace the entire contents of `shader_effects/ascii_dither.frag`:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uint pcg(uint v) { v = v * 747796405u + 2891336453u; v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (v >> 22u) ^ v; }
float hash2(vec2 ip, float seed) {
    uvec2 q = uvec2(ivec2(ip) + 32768);
    uint h = pcg(q.x ^ pcg(q.y ^ pcg(uint(int(seed)))));
    return float(h) * (1.0 / 4294967295.0);
}

uniform sampler2D u_glyphs;
uniform float u_glyphCount;
uniform float u_glyphRows;
uniform float u_cell;
uniform float u_jitter;
uniform float u_speed;
uniform float u_colored;
uniform float u_shape;
uniform float u_brightness;
uniform float u_spacing;
uniform float u_invert;

// Geometric coverage: 1 inside the shape, 0 outside. q is centered in [-1,1], t = luminance.
float geoShape(int shp, vec2 q, float t, vec2 cell) {
    if (shp == 0) shp = 1 + int(floor(hash2(cell, u_seed + 7.0) * 6.0)); // Mixed: pick 1..6 per cell
    float r = length(q);
    if (shp == 1) return step(max(abs(q.x), abs(q.y)), t);          // Blocks
    if (shp == 2) return step(r, t);                                // Circles
    if (shp == 3) return step(abs(q.y), t);                         // Lines
    if (shp == 4) return step(abs(q.x - q.y) * 0.70710678, t);      // Diagonal
    if (shp == 5) return step(min(abs(q.x), abs(q.y)), t * 0.5);    // Cross
    return step((abs(q.x) + abs(q.y)) * 0.70710678, t);            // Diamond (6)
}

void main() {
    vec2 cellPx = vec2(max(u_cell * u_resolution.y, 2.0));
    cellPx.x *= 2.0 / 3.0; // glyph cells are 2:3
    vec2 cell = floor(v_texCoord * u_resolution / cellPx);
    vec2 cuv = (cell + 0.5) * cellPx / u_resolution;
    vec3 col = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float tick = floor(u_time * u_speed * 8.0);
    float jitter = u_jitter * (hash2(cell + tick * 101.0, u_seed) - 0.5);
    float g = clamp(lum + jitter + u_brightness, 0.0, 1.0);
    if (u_invert > 0.5) g = 1.0 - g;

    // In-cell coordinate. At u_spacing == 0 this is byte-for-byte the original fract()
    // (no inset round-trip), so the default shape stays identical.
    vec2 inCell = fract(v_texCoord * u_resolution / cellPx);
    if (u_spacing > 0.0) inCell = (inCell - 0.5) / max(1.0 - u_spacing, 1e-3) + 0.5;

    int shp = int(u_shape + 0.5);
    float glyph;
    if (shp < 7) {
        glyph = geoShape(shp, (inCell - 0.5) * 2.0, g, cell);
    } else {
        float gi = min(floor(g * u_glyphCount), u_glyphCount - 1.0);
        float row = float(shp - 7);
        glyph = texture(u_glyphs, vec2((gi + inCell.x) / u_glyphCount, (row + inCell.y) / u_glyphRows)).r;
    }

    vec3 ink = mix(vec3(1.0), col / max(lum, 1e-3), step(0.5, u_colored));
    fragColor0 = vec4(clamp(ink * glyph, 0.0, 1.0), 1.0);
}
```

Notes: at defaults (`u_shape=7`, `u_brightness=0`, `u_spacing=0`, `u_invert=0`) the char-set branch with `row=0` and the untouched `inCell` reproduces the original output; the glyph atlas binds NEAREST so `(0+inCell.y)/u_glyphRows` lands on the same row-0 texels. Integer `pcg`/`hash2` keep server/browser bit-stable (unchanged from the original).

- [ ] **Step 2: Update the manifest entry**

In `shader_effects/manifest.json`, replace the `ascii_dither` effect object (keep its array position) with:

```json
    {
      "id": "ascii_dither",
      "name": "ASCII",
      "category": "stylize",
      "animated": true,
      "passes": 1,
      "centerParam": null,
      "textures": [
        { "uniform": "u_glyphs", "file": "glyph_atlas.png", "extraUniforms": { "u_glyphCount": 10, "u_glyphRows": 7 } }
      ],
      "generative": false,
      "params": [
        {
          "uniform": "u_shape",
          "label": "Shape",
          "type": "enum",
          "default": 7,
          "options": [
            { "label": "Mixed", "value": 0 },
            { "label": "Blocks", "value": 1 },
            { "label": "Circles", "value": 2 },
            { "label": "Lines", "value": 3 },
            { "label": "Diagonal", "value": 4 },
            { "label": "Cross", "value": 5 },
            { "label": "Diamond", "value": 6 },
            { "label": "Hash", "value": 7 },
            { "label": "Matrix", "value": 8 },
            { "label": "Binary", "value": 9 },
            { "label": "Braille", "value": 10 },
            { "label": "Morse", "value": 11 },
            { "label": "Dots", "value": 12 },
            { "label": "Slashes", "value": 13 }
          ]
        },
        { "uniform": "u_cell", "label": "Size", "type": "float", "min": 0.01, "max": 0.1, "default": 0.03, "step": 0.002 },
        { "uniform": "u_brightness", "label": "Brightness", "type": "float", "min": -1.0, "max": 1.0, "default": 0.0, "step": 0.02 },
        { "uniform": "u_spacing", "label": "Spacing", "type": "float", "min": 0.0, "max": 0.6, "default": 0.0, "step": 0.02 },
        { "uniform": "u_invert", "label": "Invert", "type": "float", "min": 0.0, "max": 1.0, "default": 0.0, "step": 1.0 },
        { "uniform": "u_jitter", "label": "Jitter", "type": "float", "min": 0.0, "max": 0.5, "default": 0.08, "step": 0.01 },
        { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 1.0, "step": 0.05 },
        { "uniform": "u_colored", "label": "Colored", "type": "float", "min": 0.0, "max": 1.0, "default": 1.0, "step": 1.0 }
      ]
    }
```

- [ ] **Step 3: Verify catalog parses + all 14 shapes render + default matches old**

Run:
```bash
cd /Users/julien/Documents/GitHub/ComfyNext
.venv/bin/python -c "
import sys, os, itertools, numpy as np
from unittest.mock import MagicMock
sys.modules.setdefault('nodes', MagicMock())
from PIL import Image
from comfy_extras._shader_effects import load_catalog, render_effect, resolve_params, ASSETS_DIR
c = load_catalog(refresh=True)
e = c.effects['ascii_dither']
assert e.name == 'ASCII', e.name
sp = next(p for p in e.params if p.uniform=='u_shape')
assert sp.type=='enum' and len(sp.options)==14 and sp.default==7, (sp.type, len(sp.options), sp.default)
tex = {'u_glyphs': np.asarray(Image.open(os.path.join(ASSETS_DIR,'glyph_atlas.png')).convert('RGBA'), np.float32)/255.0}
extra = {'u_glyphCount':10.0,'u_glyphRows':7.0}
fix = np.random.default_rng(0).random((96,96,3)).astype(np.float32)
outs=[]
for shp in range(14):
    u = resolve_params(e, '{\"u_shape\": %d}' % shp); u.update(extra)
    job=[{'image':fix,'uniforms':{**u,'u_time':0.0,'u_seed':42.0,'u_hasInput':1.0}}]
    o = render_effect(e.source, 96, 96, job, extra_textures=tex, passes=e.passes)[0]
    assert np.isfinite(o).all(), shp
    outs.append(o)
for a,b in itertools.combinations(range(14),2):
    assert not np.allclose(outs[a], outs[b]), (a,b)
print('catalog OK; all 14 shapes render finite + distinct')
"
```
Expected: `catalog OK; all 14 shapes render finite + distinct`. If two shapes are not distinct, report the pair (some geometric shapes can coincide at extreme params — if so, note it; the fixture is random so genuine coincidence is unlikely).

- [ ] **Step 4: Commit**

```bash
git add shader_effects/ascii_dither.frag shader_effects/manifest.json
git commit -m "feat(ascii): 14-shape ASCII dispatch + manifest enum + brightness/spacing/invert"
```

---

## Task 3: Regenerate goldens

**Files:**
- Modify (regenerated): `tests-unit/shaderfx_golden/ascii_dither_{128,256}.png`

The goldens render at default params (`u_shape=7`, row 0). With the row-0 atlas byte-identical and the default in-cell math untouched, the output should be unchanged (or differ only by sub-ULP float noise).

- [ ] **Step 1: Regenerate**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py`
Expected: prints a `golden: <id>_<size>.png` line per effect including `ascii_dither_128.png` / `_256.png`.

- [ ] **Step 2: Confirm only ascii_dither goldens (if any) changed, and the diff is tiny**

Run:
```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git status --short tests-unit/shaderfx_golden/
.venv/bin/python -c "
import numpy as np, subprocess
from PIL import Image
import io
for size in (128,256):
    new = np.asarray(Image.open(f'tests-unit/shaderfx_golden/ascii_dither_{size}.png').convert('RGB'), int)
    old = np.asarray(Image.open(io.BytesIO(subprocess.check_output(['git','show',f'HEAD:tests-unit/shaderfx_golden/ascii_dither_{size}.png']))).convert('RGB'), int)
    print(f'{size}: max abs diff = {np.abs(new-old).max()}')
"
```
Expected: `git status` shows at most the two `ascii_dither_*` PNGs (no other effect's goldens moved — if others changed, STOP and investigate). The printed max abs diff should be 0 (or ≤ 1–2 from float rounding). A larger diff means the default path changed — investigate before committing.

- [ ] **Step 3: Commit (only if the goldens actually changed)**

```bash
git add tests-unit/shaderfx_golden/ascii_dither_128.png tests-unit/shaderfx_golden/ascii_dither_256.png
git commit -m "test(ascii): regenerate ASCII goldens (shader rewritten)" || echo "goldens unchanged — nothing to commit"
```

---

## Task 4: Suites green + finish

- [ ] **Step 1: Python golden idempotence + catalog**

Run:
```bash
cd /Users/julien/Documents/GitHub/ComfyNext
.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py >/dev/null
git status --short tests-unit/shaderfx_golden/   # expect empty (idempotent)
.venv/bin/python -m pytest tests-unit/test_shader_effects_enum.py -q   # expect 7 passed (unchanged)
```
Expected: empty golden status; 7 passed.

- [ ] **Step 2: Frontend unit suite (no schema/UI changes, sanity only)**

Run: `cd frontend && npm run test:unit -- shaderfx-params shaderstudio`
Expected: green (29 tests; unchanged — this feature adds no frontend code).

- [ ] **Step 3: In-app verification (manual, GPU-gated)**

Restart ComfyUI so the rewritten shader + manifest + atlas reload — per the dev-environment setup, `kill` the ComfyUI PID (the supervisor respawns it); do NOT start a new instance. Then hard-refresh the browser (the frontend caches the catalog per page load).
- Add a ShaderEffect node (or use Shader Studio), pick "ASCII".
- Confirm a **Shape** dropdown with 14 entries + Size/Brightness/Spacing/Invert/Speed/Colored controls.
- Switch through all shapes: geometric (Blocks/Circles/Lines/Diagonal/Cross/Diamond/Mixed) render as shape grids; Matrix shows katakana, Braille shows braille dots, Binary shows 0/1, etc.
- Confirm Brightness/Spacing/Invert behave; the default (Hash) looks like the old ASCII; Duotone stacks in the studio.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`. Then update memory: append the ASCII-shapes work to the [[project-shader-effects]] memory (14-shape ASCII, 7-row atlas, reused enum schema).

---

## Spec coverage self-check

- 14 shapes (7 geometric procedural + 7 char-set rows) → Task 2 shader + manifest, Task 1 atlas. ✓
- Default = current ramp (Hash/row 0), back-compat → Task 1 row-0 byte-identity + Task 3 golden no-op. ✓
- Brightness/Spacing/Invert → Task 2 uniforms + manifest params. ✓
- Multi-row atlas from Unicode fonts, ink-sorted ramps, `.notdef` guard → Task 1. ✓
- Reuse enum schema (no schema/UI work) → confirmed (no frontend changes). ✓
- Color Mode = Mono/Colored toggle + studio Duotone pass → `u_colored` kept, no new color logic. ✓
- Keep id `ascii_dither`, name "ASCII" → Task 2 manifest. ✓
- Testing: all-14 render + default golden + atlas checks + in-app → Tasks 2/3/4. ✓

**Non-goals:** Custom shape (runtime text→atlas), per-shape golden coverage, color modes beyond Mono/Colored + Duotone, id rename.
```
