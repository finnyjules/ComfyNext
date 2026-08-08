# Space Type — Loft refinements (shape picker · fill control · spacing)

**Date:** 2026-08-08
**Status:** Design approved, pre-plan
**Builds on:** [2026-08-07-spacetype-loft-effect-design.md](2026-08-07-spacetype-loft-effect-design.md) (the Loft effect, already shipped)

## Plain-language summary

Three refinements to the shipped Loft effect, driven by user feedback:
1. **Pick a shape.** Today there's no shape menu — you dial an abstract "Sides"
   slider. Add a real **Shape** picker: Oval, Capsule, Rectangle, Polygon,
   Star, Word.
2. **Colour like every other effect.** Loft bakes colour from per-stop pickers;
   every other effect uses the shared **fill control** (solid / gradient /
   ombre). Add that as the default, and keep per-stop colour as an option.
3. **Spacing between elements.** Some references show the swept copies as
   discrete rings with gaps, not one continuous surface. Add a **Spacing**
   control that breaks the sweep into discrete cross-section slices.

New-loft defaults: **Oval shape, Fill colour source with a gradient, a small
default spacing** (so a fresh loft shows discrete stacked rings immediately).

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Shape set | **Oval · Capsule · Rectangle · Polygon · Star · Word** — a global picker (one shape per loft; per-stop keyframes size/roll only). Replaces the current `profileKind: shape\|word`. |
| Per-stop Sides/Radius | **Removed** from the stop model — they were the confusing indirect control. Shape identity + its params are global. Stops keep x, y, z, width, height, roll, colour. |
| Colour model | **Shared fill control (solid/gradient/ombre) as default, PLUS a per-stop colour mode.** A `colorSource: fill \| stops` toggle. |
| Fill vocabulary | Colour fills (solid/gradient/ombre) mapped ALONG the sweep. Patterned fills (grid/noise/shader) degrade to their primary colour along the sweep; full surface-tiling patterns are a later follow-up. |
| Spacing | **Discrete cross-section slices with gaps** (stacked rings/discs). A `spacing` slider (0 = continuous surface as today) + an `elements` count. |
| Defaults | Oval · Fill+gradient · small spacing. Spine preset stays helix. |

## A. Shape picker

Replace the `profileKind` control with a **`shape`** select:
`oval | capsule | rectangle | polygon | star | word`.

Shape-specific GLOBAL params, revealed via `showIf` on `shape`:
- `rectRadius` (slider 0..1) — corner radius, shown for `rectangle`.
- `polySides` (slider 3..16, integer) — shown for `polygon` and `star`.
- `starDepth` (slider 0..0.9) — inner-radius depth, shown for `star`.
- `text` + `font` — shown for `word` (unchanged from today).
- Oval and Capsule need no extra params (width/height per-stop define them).

**Geometry.** A new pure function replaces the per-stop `parametricProfileContour`:

```ts
export function shapeContour(
  shape: 'oval' | 'capsule' | 'rectangle' | 'polygon' | 'star',
  params: { rectRadius: number; polySides: number; starDepth: number; aspect: number },
  points: number,
): Vec2[]   // unit-space contour, |pt| <= ~1, resampled to `points`
```
- `oval` — unit ellipse (superellipse n=2); width/height scale it downstream.
- `capsule` — stadium: a rectangle of the given aspect with semicircular ends.
- `rectangle` — rounded rect with `rectRadius` (0 = sharp, 1 = fully rounded → capsule/ellipse limit).
- `polygon` — regular `polySides`-gon.
- `star` — `polySides`-point star; alternate vertices pulled in by `starDepth`.

The base contour is built ONCE from the global shape (constant along the
spine); per-station **width/height** scale it and **roll** rotates it, exactly
as `buildLoftGeometry` already does. So `loftContours` changes from
`parametricProfileContour(interpStopProps(stops,0), P)` to
`shapeContour(shape, shapeParams, P)`. Word mode still uses
`wordContoursFromShapes`. `interpStopProps` drops `sides`/`radius`.

**Stop model migration.** `LoftStop` drops `sides` and `radius`.
`parseStops`/`sanitizeStop` simply stop reading them (old saved docs parse fine
— extra fields ignored). Old `profileKind` values migrate at load: `shape` →
`oval`, `word` → `word` (handle in the effect's param read / a small migrate at
the applyMotion/config choke point, mirroring how other effects migrate).

## B. Colour = shared fill control + per-stop option

Add to the effect:
- `colorSource` (select `fill | stops`, default `fill`, group Color).
- `fills` (kind `fillList`, `default: defaultFillsFor(1, 'loft')`, group Color,
  `showIf: { key: 'colorSource', equals: 'fill' }`) — reuses the shared control
  (`parseFills`/`fillPrimary` from `../fills`, `defaultFillsFor` from
  `../palette`), same as blend/cascade/ball.

**Ramp source (one code path).** The effect builds the 256×1 colour ramp from
whichever source is active:
- `stops` → `buildRamp(stops, 256)` (today's per-stop behaviour).
- `fill` → a new `rampFromFill(three, fill, 256)`:
  - solid → flat primary colour.
  - gradient / ombre → the fill's A→B sampled across the ramp (reuse the
    A/B colours; ombre's angle is moot along a 1-D sweep, treat as A→B).
  - grid / noise / shader → flat primary colour (patterns deferred).

The ramp is still sampled by the `aAlong` attribute + `uFlow` uniform, so flow
and seamless-loop keep working unchanged.

**Editor.** `ProfileStopsEditor.vue` drops the Sides & Radius sliders (declutter).
It keeps the per-stop colour picker (used in `stops` mode; harmless in `fill`
mode). No new prop needed — the editor only ever edits the stop array.

## C. Spacing → discrete slices

Add:
- `spacing` (slider 0..0.9, default a small value e.g. 0.35, group Layout) —
  fraction of each element's span that is empty gap. 0 = continuous surface.
- `elements` (slider 4..120, integer, group Layout, `showIf: spacing > 0` via a
  `notEquals: 0` check, or always shown) — number of discrete slices.

**Geometry.** When `spacing === 0`, render the continuous skinned surface exactly
as today (`buildLoftGeometry`). When `spacing > 0`, render `elements` discrete
**slices**: for each element `i`, take its centre position `t_i = i/elements`
along the spine and skin a THIN band from `t_i` to `t_i + (1-spacing)/elements`
of the spine (the remaining `spacing/elements` is the gap). Each band is a short
loft segment (a ring/disc with slight thickness) in fill mode, or its outline
rings in stroke mode. Colour: each band samples the ramp at `t_i`, so the
gradient still runs across the stack.

Implement as a `buildSlicedLoftGeometry(...)` sibling to `buildLoftGeometry`,
reusing `sampleSpine` (sample at fine resolution, then group into bands) +
`shapeContour` + the same position/roll placement math. Both stroke and fill
supported. `aAlong` per vertex = the band's `t_i` (so flow shifts which ramp
colour each ring shows).

## Files

**Modify:**
- `app/lib/spacetype/loftStops.ts` — drop `sides`/`radius` from `LoftStop` +
  `sanitizeStop`; presets stop setting them.
- `app/lib/spacetype/loftGeometry.ts` — add `shapeContour`, `rampFromFill`,
  `buildSlicedLoftGeometry`; `interpStopProps` drops sides/radius;
  `parametricProfileContour` retired (or kept only as oval's helper).
- `app/lib/spacetype/effects/loft.ts` — new controls (`shape` + shape params,
  `colorSource`, `fills`, `spacing`, `elements`); `buildScene` branches on
  shape, ramp source, and continuous-vs-sliced; new defaults; param migration
  for old `profileKind`.
- `app/components/vue-canvas/ProfileStopsEditor.vue` — remove Sides/Radius rows.

**New tests:**
- `shapeContour` per shape (vertex counts, bounds, capsule aspect, star depth).
- `rampFromFill` (solid flat, gradient endpoints, pattern→primary).
- `buildSlicedLoftGeometry` (element count, gap correctness — bands don't touch,
  aAlong per band; stroke vs fill counts).
- effect: shape select drives the contour; colorSource switches ramp source;
  spacing>0 produces discrete geometry; old-`profileKind` doc migrates.

## Migration & compatibility

- Saved lofts with `profileKind: 'shape'|'word'` → map to `shape: 'oval'|'word'`
  at param read (default `oval` if absent).
- Saved stops with `sides`/`radius` → ignored (parseStops drops them).
- Saved lofts had per-stop colour and no `colorSource` → default `colorSource`
  to `stops` when a doc predates the fill control? Simpler: default `fill` for
  everyone and let old per-stop colours sit unused until the user flips to
  `stops`. **Decision: default `colorSource='fill'`;** old lofts re-colour via
  the new gradient default (acceptable — colour is easily re-set, and the fill
  default matches the new-loft default). Note this in the plan so it's a
  conscious change, not a silent regression.

## Out of scope (YAGNI)

- Per-stop shape morphing (oval→star along the sweep). Shape is global.
- Surface-tiling patterns (grid/noise/shader across the loft surface) — colour
  fills only for now; patterns degrade to primary colour.
- Dashed-ribbon-segment spacing (the other spacing model) — slices only.
- Per-element independent colour beyond the ramp.
