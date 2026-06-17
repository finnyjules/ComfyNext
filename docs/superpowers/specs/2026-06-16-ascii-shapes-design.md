# ASCII with shapes — design

**Date:** 2026-06-16
**Base branch:** `feat/gradient-studio` (where the enum-param schema + Shader Studio + Dither live; not on `main` yet)
**Comp:** Morflax Studio's "ASCII" stylized effect — a **Shape** dropdown of geometric + character-set dither cells, plus Brightness / Spacing / Invert / Color Mode.

## Goal

Evolve the `ascii_dither` effect (id kept for back-compat) into a Morflax-style **"ASCII"**
effect with a **14-entry Shape dropdown**, reusing the enum-param machinery built for the
Dither work. The default shape reproduces the current ASCII ramp exactly (zero visual
regression). "Custom" is deferred to v2.

## Decisions (locked during brainstorming)

1. **All shapes, Custom deferred.** 7 geometric (procedural) + 7 character sets (atlas), no
   user-typed Custom (it needs runtime text→atlas generation that breaks bake-and-commit +
   server parity).
2. **Default = current ramp.** Default `u_shape` points at the atlas row holding the existing
   `" .:-=+*#%@"` ramp, so existing `ascii_dither` nodes render bit-identically and goldens
   don't move.
3. **First-class shaderfx effect** reusing the existing enum-param schema (no schema changes).

## Shape catalog (`u_shape` enum, values 0–13)

Two families dispatched inside one shader:

**Geometric (0–6) — procedural, no atlas.** Each cell draws a shape with coverage/size ∝ the
cell's (adjusted) luminance, halftone-style:
- 0 **Mixed** — per-cell pseudo-random pick among shapes 1–6 (via the shader's integer hash on
  the cell coord), for a varied texture.
- 1 **Blocks** (filled square), 2 **Circles** (disc/SDF), 3 **Lines** (horizontal bar, height ∝
  luminance), 4 **Diagonal** (diagonal bar), 5 **Cross** (plus), 6 **Diamond** (rotated-square SDF).

**Character sets (7–13) — multi-row glyph atlas.** `row = u_shape − 7` selects the atlas row;
luminance selects the column (10-step ramp, dark→bright by ink coverage):
- 7 **Hash** = the current `" .:-=+*#%@"` ramp (atlas row 0, **DEFAULT**, back-compat).
- 8 **Matrix** (katakana + digits), 9 **Binary** (`01`), 10 **Braille** (⠁…⣿ by dot count),
  11 **Morse** (`. - —` spacing), 12 **Dots** (`· ∙ ● ⬤`), 13 **Slashes** (`/ \ X` density).

Menu order (manifest `options`) mirrors Morflax: Mixed, Blocks, Circles, Lines, Diagonal,
Cross, Diamond, Hash, Matrix, Binary, Braille, Morse, Dots, Slashes (values 0–13). Default = 7.

## Architecture

Mirrors the Dither pattern work ([[project-shader-effects]] 2026-06-16 update).

### Shader — `shader_effects/ascii_dither.frag`

Keep the 2:3 cell downsample, the integer `pcg`/`hash2` noise (already parity-safe), and
`u_colored`. Add:
- `u_shape` (float, cast `int(u_shape+0.5)`) — dispatch.
- `u_brightness` (luminance bias: `g = clamp(lum + u_brightness, 0, 1)` before mapping).
- `u_spacing` (cell inset/gap: shrink the drawn glyph/shape toward the cell center; 0 = full).
- `u_invert` (`g = 1.0 - g` when > 0.5).
- A geometric branch: compute in-cell coordinate `p` (centered, spacing-inset), draw each shape
  as a coverage/SDF test against a radius/threshold derived from `g`.
- The char-set branch: sample the multi-row atlas — `v = (row + inCell.y) / u_glyphRows`,
  `u = (gi + inCell.x) / u_glyphCount`. Because extra textures bind **NEAREST**, sampling row 0
  with `v = inCell.y / R` lands on byte-identical texels to the old single-row atlas → the
  default (Hash/row 0) output is unchanged.

New uniform `u_glyphRows` (rows in the atlas) supplied via the manifest texture's
`extraUniforms` (like the existing `u_glyphCount`).

### Atlas — `shader_effects/assets/generate_glyph_atlas.py`

Rebake `glyph_atlas.png` as a **7-row** atlas (each row a 10-glyph ramp, `CELL_W×CELL_H`
cells):
- **Row 0 (Hash)** keeps the EXACT current rendering (PIL default font, `" .:-=+*#%@"`) so its
  pixels are byte-identical to today's atlas → back-compat.
- Rows 1–6 render the other sets from reliable Unicode/monospace fonts (Arial Unicode / Hiragino
  for katakana, Apple Braille / Apple Symbols for braille, a monospace for the rest). The bake
  **verifies each glyph actually renders** (not a `.notdef` box) and errors if a required glyph
  is missing, so a font swap can't silently produce blanks.
- Each set defines an ordered 10-glyph ramp (dark→bright by coverage); sets with fewer distinct
  glyphs (Binary `01`) repeat/space to fill 10 slots.
- `glyph_atlas.json` gains `rows` metadata (count, per-row label + ramp). The atlas PNG is
  committed; fonts only matter at bake time.

### Manifest — `shader_effects/manifest.json` (`ascii_dither` entry)

- `name` → **"ASCII"**; texture `u_glyphs` gains `extraUniforms.u_glyphRows = 7` (keep
  `u_glyphCount = 10`).
- Add `u_shape` enum (14 options, default 7), `u_brightness` (−1..1, default 0), `u_spacing`
  (0..0.6, default 0), `u_invert` (0/1, default 0). Keep `u_cell` (Size), `u_jitter`, `u_speed`,
  `u_colored`.
- Keep the id `ascii_dither`.

### Color Mode

Effect keeps the Mono/Colored toggle (`u_colored`). "Duotone" = the existing Shader Studio
Duotone pass (no color logic added to the effect), same as Dither.

### Reuse (no schema work)

Enum params already flow end-to-end (types.ts / `_shader_effects.py` / catalog route / both
UIs render `<select>`). This adds one more enum-param instance.

## Components & responsibilities

| Unit | Change | Depends on |
|------|--------|-----------|
| `ascii_dither.frag` | shape dispatch (geometric + atlas rows) + brightness/spacing/invert | renderer contract, enum schema |
| `generate_glyph_atlas.py` | 7-row atlas, glyph-coverage verification | PIL, system fonts |
| `glyph_atlas.png` / `.json` | rebaked 7-row atlas + metadata | bake script |
| `manifest.json` (ascii_dither) | name, u_glyphRows, shape enum + 3 params | enum schema |

## Testing

- **Python render:** all 14 shapes render (compile + finite); geometric and char shapes are
  pairwise-distinct on a fixture. (Parity-safe integer hashing already in the shader.)
- **Back-compat golden:** regenerate `ascii_dither_{128,256}.png`; default (shape=7, row 0)
  should be **bit-identical** → goldens don't move. If they do move, investigate the row-0
  v-remap before accepting.
- **Atlas bake check:** the bake errors if any required glyph is `.notdef`; a unit/CI-style
  assertion confirms `glyph_atlas.png` has the expected 7 rows and dimensions, and the metadata
  json matches.
- **In-app:** open ASCII (studio + standalone), confirm the Shape dropdown (14), switch through
  all shapes, confirm Matrix/Braille render real glyphs, and Brightness/Spacing/Invert behave;
  Duotone stacks in the studio.

## Risks / open items

- **Row-0 bit-identity** depends on NEAREST atlas sampling + identical row-0 pixels + the
  `v = inCell.y/R` remap landing on the same texels. Verified by the golden regen (must be no-op).
- **Matrix/Braille fonts** at bake time — confirmed present on this machine; the bake's
  `.notdef` verification is the guard against a font swap producing blanks.
- **"Mixed" definition** is a product choice (per-cell random pick among geometric shapes) — not
  a 1:1 reverse-engineer of Morflax's Mixed.
- Atlas grows 7× taller (still tiny); NEAREST sampling avoids inter-row bleed.

## Non-goals (this pass)

- **Custom** shape (runtime user-typed text → atlas) — deferred to v2.
- Per-shape golden coverage (default-only golden + Python all-shape render check, as with Dither).
- Color modes beyond Mono/Colored + the studio Duotone pass.
- Renaming the effect id (`ascii_dither` kept).
