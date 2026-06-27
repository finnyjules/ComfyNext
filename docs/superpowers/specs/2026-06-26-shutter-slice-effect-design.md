# Shutter slice effect — design

**Date:** 2026-06-26
**Studio:** Type Studio (Space Type)
**Status:** Approved, ready for implementation plan

## Goal

Add a new Type Studio effect, `shutter`, that recreates a classic shuttered /
venetian halftone-line treatment: the text is cut into horizontal slices and
slice-groups are sheared sideways, with optional thin vertical gaps between
slices. A single master **progress** knob morphs from intact text (`0`) to fully
sliced and offset (`1`). The effect supports both a static parked look and a
seamless animated reveal.

Reference: bold flat letters sliced into horizontal bands, each group of ~4
slices offset horizontally by a stepped amount, with thin white lines between
slices.

## Render approach

2D-matte → shader, following the existing `tear.ts` / `elastic.ts` pattern.

- `buildScene()` creates a flat `PlaneGeometry` sized to the text bounds with a
  `ShaderMaterial` that samples the pre-baked text atlas (`uniform sampler2D
  uText`). The atlas is baked with the **standard shared text fill**, so the
  shader only displaces UVs — it does no color work, and the effect inherits
  solid / gradient / Vessell fills for free.
- Fragment shader logic:
  - `band = floor(vUv.y * uSlices)` — which horizontal slice this pixel is in.
  - `group = floor(band / uGroupSize)` — which offset-group the slice belongs to.
  - `offset(group)` is computed per the selected **pattern** (see below), scaled
    by `uOffset` and by effective `progress`.
  - Sample the matte at `vUv.x - offset`. UVs outside `[0,1]` read transparent
    (clamp-to-transparent border), so sheared slices slide cleanly off the edge
    revealing nothing.
  - **Vertical gap:** within each band, the bottom `uGap * progress` fraction of
    the band's height is clipped to transparent (alpha = 0). This produces the
    thin white lines without squishing the glyphs — the slice keeps its original
    strip of text and just gains a transparent bottom margin.
  - Slice and gap edges use `smoothstep` for anti-aliasing.

### Offset patterns (`pattern` select)

Computed in-shader from `group` (and total group count where needed):

- **Diagonal lean** (default): `offset = uOffset * group * progress` (optionally
  normalized so the maximum lean stays bounded). The column leans into a
  quantized parallelogram — steps down the height.
- **Random**: seeded pseudo-random offset per group (hash of `group + uSeed`),
  signed, scaled by `uOffset * progress`. Re-roll via `seed`.
- **Sine**: `offset = uOffset * sin(group * k) * progress` — smooth ripple down
  the column.
- **Alternating**: groups alternate sign (`group even → +`, `odd → -`).

## Controls

A new `'Slice'` section is added to `SPACE_TYPE_SECTIONS` (and its guard unit
test) since no existing section fits.

| Control | kind | group | Default | Notes |
|---|---|---|---|---|
| Text | textList | Type | (sample) | standard |
| Font | font | Type | standard | standard |
| Fill | fillList | Style | solid black | standard shared fill, bakes into matte |
| Slices | slider | Slice | ~40 | number of horizontal cuts |
| Group size | slider | Slice | 4 | slices per offset step |
| Pattern | select | Slice | `diagonal` | diagonal / random / sine / alternating |
| Offset amount | slider | Slice | tuned | max horizontal shear (UV units) |
| Gap | slider | Slice | small | vertical separation between slices |
| Seed | slider | Slice | 1 | re-roll for Random pattern |
| Progress | slider | Slice | 1 | master 0→1, static amount |
| Animation | select | Motion | `static` | static / sweep-in / loop (in-out) |

(Exact section assignment for Text/Font/Fill follows whatever sibling effects
already do; the table reflects intent.)

## Static vs animated

- `Animation = static` → `update()` uses the `progress` param directly. The look
  is parked at whatever the Progress slider says. No time dependence.
- `Animation = sweep-in` → `t01` drives effective progress `0 → progress` over
  the loop (text assembles into slices).
- `Animation = loop` → `t01` drives a ping-pong `0 → progress → 0`, giving a
  seamless in-and-out. `progress` acts as the peak amplitude.
- `loopRates()` returns `[1]` (single motion cycle) so seamless-loop export
  renders correctly.
- `liveKeys` includes all slice/offset/gap/progress/pattern/seed params and the
  animation mode, so dragging sliders mutates uniforms without a scene rebuild.
  Structural changes (text, font, fill, slice count if it changes geometry)
  trigger rebuild.

## Files touched

- `frontend/app/lib/spacetype/effects/shutter.ts` — NEW effect module.
- `frontend/app/lib/spacetype/effects/index.ts` — import + register in
  `SPACE_TYPE_EFFECTS`.
- `frontend/app/lib/spacetype/sections.ts` — add `'Slice'` to
  `SPACE_TYPE_SECTIONS`.
- `frontend/tests/unit/spacetype-sections.unit.spec.ts` (or the existing
  sections guard test) — cover the new section / new effect's control groups.

## Testing

- Unit: the sections guard test confirms every `shutter` control's `group` is in
  the allow-list (no silently-dropped controls).
- Unit: defaults round-trip (`defaultsFromControls`) and `getEffect('shutter')`
  resolves.
- Visual (per the project's "verify visuals with screenshots" rule): standalone
  render across formats and progress values (0, 0.5, 1) and each pattern; get
  look sign-off before considering done. Do NOT ship on unit tests alone.

## Out of scope

- Per-letter independent slicing (whole-word matte is sliced as one field).
- Color/animation of the gaps themselves.
- Editor/timeline keyframing beyond the existing seamless-loop export rails.
