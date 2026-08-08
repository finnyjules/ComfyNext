# Space Type — Loft: stroke width + fill distribution (round 3a)

**Date:** 2026-08-08
**Status:** Design approved, pre-plan
**Builds on:** the shipped Loft effect + [refinements](2026-08-08-spacetype-loft-refinements-design.md)

## Plain-language summary

Two render refinements to the Loft effect:
1. **Stroke width** — in stroke mode you currently can't control line thickness
   (WebGL ignores GL line width). Make strokes real, adjustable-width **ribbons**.
2. **Fill distribution** — the colour fill currently only uses the first fill and
   always spans the whole sweep. Let the **fills list spread across the sweep**
   (fill 1 → start, last fill → end), with a **Blend vs Per-circle** toggle:
   smooth gradient across the whole composition, or hard-edged solid colour bands.
3. **Filled cross-sections** — Fill mode currently makes hollow tube walls, not
   solid filled circles. Cap the cross-section face so fill produces solid discs
   (and each spaced ring becomes a solid coin).

Deferred to round 3b (separate spec): the on-preview bezier spine editor and the
"edit all stops at once" master controls.

## A. Stroke width

**Control:** new `strokeWidth` slider — `min 0.005, max 0.3, step 0.005,
default 0.04`, group Style, `showIf render === 'stroke'`. Units are profile-space
(a fraction of the cross-section size, which per-stop width/height then scale).

**Geometry:** today stroke mode emits contour outline **line loops** rendered as
`THREE.LineSegments` (GL lines — width ignored). Replace with thin **ribbon**
geometry rendered as a `Mesh` with the SAME `ShaderMaterial`, so the colour ramp
and live `flow` still apply. For each ring's contour (P points in the cross-section
plane, already scaled by the station's width/height and rolled), offset each point
to an inner and outer edge by `±strokeWidth/2` along the **in-plane contour
normal** (perpendicular to the local outline direction, within the station's
normal/binormal plane), forming a 2·P-vertex ribbon loop; triangulate as a closed
strip. Place into 3D via the station frame exactly as fill does.

This applies to BOTH geometry paths — `buildLoftGeometry` (continuous stroke) and
`buildSlicedLoftGeometry` (sliced stroke). Factor the outline→ribbon expansion into
one shared helper so both call it.

- `aAlong` per ribbon vertex = the same value the line-loop vertex had (station `t`
  continuous, band centre `tc` sliced), so the gradient maps identically.
- **Known limitation:** the in-plane offset can self-intersect at very sharp
  concave corners (star points) at large widths — acceptable for v1; note it.
- **Fallback if the ribbon math proves fragile:** thick `LineMaterial`
  (`three/examples/jsm/lines`, as `boost.ts` uses, world-unit width) with the ramp
  baked as per-vertex colours — but this loses live `flow` on strokes and adds a
  second material path, so it is a fallback, not the plan.

**Render object:** with strokes now ribbons, both modes build a `Mesh`. Keep the
`render` param; the difference is stroke = outline ribbons, fill = skinned surface.
`disposeRoot`'s `isLineSegments` clause (added earlier) becomes unnecessary for
loft but stays harmless (other future line effects may use it) — leave it.

## B. Fill distribution

**Controls:**
- new `fillMode` select — options `['blend', 'steps']`, default `'blend'`, group
  Color, `showIf colorSource === 'fill'`. `blend` = smooth gradient across the
  whole composition; `steps` = hard-edged bands (per-circle solid colours).
- the existing `fills` (`fillList`) already supports adding multiple fills — no
  control change; the ramp now consumes ALL of them.

**Ramp (`rampFromFill` rewrite):** flatten the fills list into an ordered list of
**colour stops**, then build the 256×1 ramp from them:
- Each fill contributes stop(s): a **solid** or pattern (grid/noise/shader) fill →
  1 stop (its primary colour); a **gradient/ombre** fill → 2 stops (`a` then `b`).
- Concatenate stops across all fills in list order → `M` stops at evenly spaced
  `t = j/(M-1)`.
- **`blend`**: linear-interpolate colour between adjacent stops across `t`.
- **`steps`**: piecewise-constant — stop `j` owns `t ∈ [j/M, (j+1)/M)` (hard bands).
- Degenerate: 0 stops → flat mid-grey (unchanged tolerance).

This makes: one ombre fill → `a→b` gradient (blend) or two hard bands (steps);
two solid fills → colour1→colour2 gradient (blend) or two hard bands (steps) — i.e.
"fill 1 on the first circles, fill 2 on the last." Because each discrete ring
samples the ramp at its centre, `steps` yields distinct solid-coloured rings and
`blend` yields rings that step smoothly through the gradient.

`rampFromFill` gains a `mode: 'blend' | 'steps'` parameter; the effect passes
`params.fillMode`. Everything downstream (DataTexture, `aAlong` sampling, `flow`)
is unchanged.

## C. Filled cross-sections (solid discs) — the "Fill doesn't make filled circles" fix

**Problem:** fill mode today skins only the **side wall** between consecutive
cross-sections (`buildLoftGeometry`/`buildSlicedLoftGeometry` connect ring→ring
around the contour). The cross-section **face is never triangulated**, so a
discrete ring is a hollow washer/tube-segment, not a solid filled disc — and the
continuous tube has open ends.

**Fix:** in fill mode, **cap the cross-section** by fan-triangulating the contour
interior from its centroid (centroid + each contour edge → one triangle):
- **Sliced (spacing > 0):** cap BOTH rings of each band → each element becomes a
  solid **puck/coin** (side wall + two end caps). This is the "filled circles".
- **Continuous (spacing = 0):** cap the first and last cross-section → a closed
  solid tube (no open ends). Interior cross-sections stay uncapped (capping them
  would create internal walls).
- The centroid fan is valid for every parametric shape (oval/capsule/rectangle/
  polygon/star are all star-shaped from their centre). Cap vertices reuse the
  station's frame + `aAlong` so the gradient/flow still apply.
- **Word caveat:** a word's multi-contour glyphs (letters + holes) are NOT
  star-shaped, so the centroid fan would fill counters and overlap. Word-mode fill
  keeps the swept-wall look for now (proper glyph triangulation via
  `THREE.ShapeGeometry`/earcut is a follow-up) — note it, don't cap words.

This is stroke-independent and applies whether or not `strokeWidth` (A) is used.

## Files

**Modify:**
- `app/lib/spacetype/loftGeometry.ts` — (A) add the outline→ribbon helper + wire it
  into the stroke path of `buildLoftGeometry` and `buildSlicedLoftGeometry`
  (a `strokeWidth` field on their opts); (B) rewrite `rampFromFill` for multi-fill
  stops + `mode`; (C) add centroid-fan cross-section **cap** emission to the fill
  path of both builders (both caps per band when sliced; end caps only when
  continuous), skipped for word contours.
- `app/lib/spacetype/effects/loft.ts` — add `strokeWidth`, `fillMode` controls;
  pass `strokeWidth` into the geometry builders (stroke) and `fillMode` into
  `rampFromFill`; both render modes now build a `Mesh`.

**New/updated tests:**
- `rampFromFill`: multi-fill blend (endpoints = first/last stop; midpoint between);
  multi-fill steps (hard band boundaries; band j colour = stop j); single ombre
  blend vs steps; malformed tolerant.
- ribbon helper: a contour → 2·P vertices, inner/outer offset by ±width/2, closed
  strip index count; `aAlong` preserved.
- stroke geometry: `buildLoftGeometry`/`buildSlicedLoftGeometry` with `strokeWidth`
  emit ribbon Mesh geometry (vertex/index counts), not line indices.
- cross-section caps: sliced fill emits 2 caps per band (each cap = centroid + P
  fan triangles → P triangles); continuous fill emits exactly 2 caps total (ends);
  cap vertices carry the band/station `aAlong`; word contours emit NO caps.
- effect: `strokeWidth`/`fillMode` controls present with correct `showIf`; stroke
  build produces a Mesh; `fillMode` switches the ramp.

## Compatibility

- New controls default to current behaviour: `fillMode='blend'` = today's smooth
  gradient; `strokeWidth=0.04` is a sane thin default (old saved lofts had no
  `strokeWidth` → the default applies; strokes just gain a little body).
- Old saved lofts with a single fill render identically under `blend`.

## Out of scope (round 3b)

- On-preview bezier spine editor.
- "Edit all stops" master Width/Height/Roll/Colour controls.
- Per-fill assignment to specific named rings (fills spread evenly only).
- Surface-tiling patterns (grid/noise still degrade to primary as a stop colour).
