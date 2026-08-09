# Space Type — Loft: Illustrator-style 2-D blend colour (round 3c)

**Date:** 2026-08-08
**Status:** Design approved, pre-plan
**Builds on:** the Loft effect + [round 3a stroke/fill](2026-08-08-spacetype-loft-stroke-fill-design.md)

## Plain-language summary

Make the loft's colour work **exactly like Illustrator's blend tool**. Today the
colour runs **lengthwise** (a 1-D ramp along the sweep, each cross-section one
flat colour). What we want: **each fill paints a whole circle's face** (a gradient
fill = a gradient *across* the circle at its own angle), the fills map **first →
last**, and the circles between **blend** their fills. So: first circle = blue→pink
gradient across its face, last circle = white, everything between morphs from the
gradient to white.

This is a 2-D colour model — colour varies **across** the cross-section (the fill,
incl. its gradient) AND **along** the sweep (which fill / how far between two).

## The model (precise)

- The `fills` list are **keyframe fills** placed evenly along the sweep: fill `i`
  at along-position `t = i/(N-1)` (fill 0 → first circle, fill N-1 → last).
- At any along-position `t`, the active fill = **interpolate** the two bracketing
  keyframe fills, stop-by-stop. A **solid** fill is treated as a 2-stop gradient of
  one colour, so interpolating a gradient (blue→pink) with a solid (white) yields a
  gradient (lightblue→lightpink) — Illustrator's behaviour.
- Within a circle, the fill is painted **across** the cross-section along the fill's
  **gradient angle**.
- `fillMode`: **blend** = smooth interpolation along the sweep (as above); **steps**
  = hard along-bands (each keyframe fill owns a contiguous block of circles, still
  painted across its face).

## Architecture

Colour becomes a **2-D ramp texture** sampled by two per-vertex coordinates:
- `aAcross ∈ [0,1]` — the vertex's position **across the cross-section** along the
  gradient axis.
- `aAlong ∈ [0,1]` — the vertex's position **along the sweep** (unchanged from today;
  the existing attribute).

**A. `aAcross` geometry attribute.** Every vertex-emitting path in
`loftGeometry.ts` (both builders × fill / stroke-ribbon / cap) also writes
`aAcross`. For a unit contour point, `aAcross` is its coordinate along the fill's
gradient direction, normalised to the contour's extent:
```
across(pt2d, angleDeg) = ( (pt2d.x*sin(angle) + pt2d.y*cos(angle)) + 1 ) / 2   // ∈ ~[0,1]
```
where `angle` is the representative gradient angle (see below). Cap centroid
vertices use `across = 0.5`. The angle is a build-time scalar (see loft.ts), so
`aAcross` is a plain float attribute — no per-fill angle in the shader.

**B. 2-D ramp texture.** New `build2DFillRamp(three, fillsJson, mode, acrossSize,
alongSize)` → `Uint8ClampedArray` of `acrossSize*alongSize*4` (row-major, one row
per along-position). Build:
- Flatten each fill into an **across-sampler**: `solid`/pattern → constant colour;
  `gradient`/`ombre` → `lerp(a, b, u)` for `u ∈ [0,1]` across.
- Keyframe fills at along `v_i = i/(N-1)`. For each along-row `v`: bracket
  (`fill_lo`, `fill_hi`, factor `f`); in **steps** mode snap to the nearest keyframe
  (`f→0/1`, hard bands). For each across-col `u`: `color = lerp(fill_lo.sample(u),
  fill_hi.sample(u), f)`.
- 1 fill → every row is that fill's across-sampler (uniform along, gradient across).
- The `colorSource='stops'` path stays per-stop-colour along the sweep but is
  extended to the same 2-D texture with a **flat across** row per along-position
  (reuse `buildRamp`'s along colours, replicate across `acrossSize`). One texture
  path for both sources.

**C. Shader + texture.** `loft.ts` builds a `DataTexture(acrossSize × alongSize)`
(e.g. 64 × 256) instead of 256 × 1, stores it on `root.userData.tex`. The material:
- VERT: add `attribute float aAcross; varying float vAcross;` and set `vAcross`.
- FRAG: `vec3 c = texture2D(uRamp, vec2(vAcross, fract(vAlong + uFlow))).rgb;`
  (across on U, along on V; `flow` still scrolls along V).

**Representative angle:** use the angle of the FIRST gradient/ombre fill in the
list (fall back to 90° = vertical-across if none). Per-fill differing angles are a
follow-up; v1 uses one angle so `aAcross` stays a static attribute. Note it.

## Files

**Modify:**
- `app/lib/spacetype/loftGeometry.ts` — add `aAcross` to `LoftGeometry` and to
  every vertex write in `buildLoftGeometry` + `buildSlicedLoftGeometry` (fill,
  stroke-ribbon, cap); add `build2DFillRamp` (+ a `fillsAngle(fillsJson)` helper);
  keep `rampFromFill` only if still referenced, else supersede. Extend the
  `colorSource='stops'` ramp to 2-D (flat across) — a small `stretchAcross(ramp1d,
  acrossSize)` helper or a 2-D variant of `buildRamp`.
- `app/lib/spacetype/effects/loft.ts` — build the 2-D `DataTexture`; add the
  `aAcross` attribute to the `BufferGeometry`; update VERT/FRAG; pass the fills
  angle into the geometry builders so they can compute `aAcross`.

## Tests

- `build2DFillRamp`: dimensions `acrossSize*alongSize*4`; 1 gradient fill → each
  along-row is the same a→b across (uniform along); 2 fills [gradient, solid-white]
  → row 0 = a→b across, last row = white across, a middle row = the two averaged
  (fade toward white); `steps` mode → hard along-band boundary.
- geometry: every builder path (fill/stroke/cap, continuous + sliced) emits an
  `aAcross` value per vertex in `[0,1]`; cap centroids = 0.5; a contour point at the
  gradient-axis extremes maps to ~0 and ~1.
- effect: buildScene produces a 2-D `DataTexture` (`image.width>1 && image.height>1`)
  on `userData.tex`; the geometry has an `aAcross` attribute; both `colorSource`
  values still produce a texture.
- runtime (controller): first circle shows the gradient across its face, last shows
  white, middles blend; toggling `fillMode` steps→hard bands; adding/removing fills
  re-maps first→last.

## Compatibility

- `aAlong` and `flow` are unchanged. Existing saved lofts render under the new
  model automatically (their fills re-interpreted as keyframes). A single-fill loft
  looks the same as a sensible "gradient across / uniform along" — acceptable and
  arguably more correct than the old lengthwise ramp.
- `fillMode`/`colorSource`/`copies`/`spacing` controls unchanged.

## Out of scope (follow-ups)

- Per-fill differing gradient **angles** interpolated along the sweep (v1 uses one
  representative angle).
- Interpolating gradient **stop positions/counts** beyond a→b (v1 treats every
  gradient as 2 stops).
- Pattern (grid/noise/shader) fills across the face (still collapse to primary).
- The on-preview bezier editor + edit-all master controls (round 3b, still queued).
