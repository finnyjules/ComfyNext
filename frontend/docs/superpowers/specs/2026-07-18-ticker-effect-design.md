# Ticker effect + transparent colors — design

Date: 2026-07-18
Status: approved, ready for implementation plan

## Summary

Add a new Space Type effect, **Ticker**: flat, 2D-minded rows of text that marquee
along a path, with optional alternating direction per row and an optional wavy path.
Separately, extend the Type Studio color pickers to support transparency.

## Why not extend `ribbon`

The existing `ribbon` effect superficially covers the same ground (`ribbonCount`,
`alternate`, `snakeAmplitude`), but two structural choices make it wrong for a 2D
ticker:

1. **UVs are uniform in the curve parameter `t`, not arc length**
   (`lib/spacetype/ribbonGeometry.ts:54`, `const u = t * p.uRepeat`). When the
   centerline snakes, bends are physically longer than straights yet receive the
   same slice of texture, so glyphs stretch through curves and bunch on flats.
   This is the "deformer" look we explicitly do not want.
2. **The band sweeps along world Z** (`c.z ± half`,
   `lib/spacetype/ribbonGeometry.ts:50`) while waving in Y, so the strip is
   edge-on in depth — a 3D object by construction.

Ticker therefore gets its own geometry builder rather than a flag on ribbon's.

## Section 1 — Ticker geometry

New module `lib/spacetype/tickerGeometry.ts`, parallel to `ribbonGeometry.ts`.
`ribbonGeometry.ts` is not modified.

### Centerline

```
x = (t - 0.5) * length
y = amplitude * sin(2π * frequency * t + phase + waveSpeed * t01 * 2π)
z = 0
```

`waveSpeed = 0` gives a frozen curve that text flows through; raising it makes the
curve itself travel while text scrolls.

### Band sweep

At each sample, compute the in-plane tangent, take its perpendicular
`(-ty, tx)`, and emit two verts at `center ± normal * (height / 2)`. Band width
stays constant around bends and the band lies in the XY plane, facing camera.

### Arc-length UVs

Walk samples accumulating segment length into a prefix array, then:

```
u = (arcLen[i] / totalArcLen) * uRepeat
```

A glyph occupies the same physical run of band on a curve as on a straight, so
text rides the path and rotates with the tangent instead of being distorted by it.

### Known consequences

- **Arc length exceeds straight-line length** as amplitude rises — roughly +30% at
  high amplitude and frequency. Hold glyph size constant and scale `uRepeat` with
  arc length, so increasing the wave adds text repeats rather than resizing glyphs.

  `uRepeat` is deliberately left **fractional**; do not round it. Because `u` runs
  0 → `uRepeat` monotonically from one end of the band to the other, the fractional
  remainder is a partial copy truncated at the band's end — where glyphs are already
  scrolling out of view — not a discontinuity mid-band. Rounding to whole repeats
  would require a compensating glyph-size nudge, which pops visibly as the rounded
  count ticks over while dragging the wave slider.

  This holds only for an **open** band. If a closed-ring band mode is ever added,
  the two ends meet and a fractional `uRepeat` becomes a visible hard seam; that
  mode would need whole-repeat quantization.

  The rejected alternative — holding the repeat count fixed and letting glyphs
  scale — makes glyph size *grow* with wave amplitude (a longer path gives each
  glyph more room), coupling the wave and type-size controls. Rejected for that
  coupling, not for the scale direction.
- **Self-intersection** occurs at high `amplitude * frequency` on tight bends.
  Clamp the amplitude/frequency product. Do not build a miter-joint solver.

## Section 2 — Rows and motion

Reuse ribbon's per-instance model (`lib/spacetype/ribbonGeometry.ts:75`):
`rowCount`, `rowSpacing`, `rowPhase`, `alternate` (on/off, flips direction on odd
rows).

Per-row content uses the existing N-row text atlas and `textVariantForBand`: each
row shows its own string from the `textList`, driven by a single global `speed`
with alternating direction. Rows are **not** independently speed-controlled.

`update(t01)` advances each row's `map.offset.x` by `dir * speed * t01`.

`loopRates` returns the scroll rates so seamless export works.

> Note: the node-card preview currently ignores `loopRates`
> (`components/vue-canvas/SpaceTypeNode.vue:101` renders one loop with no `k`
> factor), so Ticker will loop correctly in the Type Studio modal and the timeline
> but may stutter on the node card. Fixing that driver is out of scope here.

### Controls

Every control's `group` must be in `SPACE_TYPE_SECTIONS`
(`lib/spacetype/sections.ts:1`) or it is silently dropped from the UI.

| Group | Keys |
|---|---|
| Type | `text`, `font`, `typeHeight`, `tracking`, `textRepeat` |
| Ribbon | `bandHeight`, `bandLength`, `rowCount`, `rowSpacing`, `rowPhase`, `alternate` |
| Wave | `segments`, `waveAmplitude`, `waveFrequency`, `waveSpeed` |
| Motion | `speed` |
| Color | `fills` |

Band transparency is expressed through the fill's own alpha (Section 3), not a
separate opacity slider — one mechanism, not two.
| Transform | standard `scale`, `rotateX/Y/Z` block |

## Section 3 — Transparent colors

### Current state

There is no alpha anywhere in the color pipeline. Colors are 6-digit hex,
`lib/spacetype/fills.ts` builds opaque textures, and effect shaders hard-write
`vec4(rgb, 1.0)` (e.g. `lib/spacetype/effects/ribbon.ts:91`). Transparent *scene
background* already exists and is unrelated (`lib/spacetype/engine.ts:98`).

Full per-color alpha across all 24 effects would require auditing 24 hand-written
GLSL blocks plus resolving sorting and depth-write for correct blending. That is
out of scope.

### Scope for this project

- **Format:** extend to 8-digit `#rrggbbaa`. Six-digit remains valid and means
  opaque, so all saved scenes keep working.
- **`StudioColor`** (`components/vue-canvas/studio/StudioColor.vue`): add an alpha
  slider, a checkerboard behind the swatch, and a one-click "transparent" action.
- **Honored in:** Ticker's band fill — this is what produces the text-only row,
  where the band is present but its fill is fully transparent — and any plain
  `color` control feeding a material that can take `transparent: true` without
  sorting artifacts.
- **Elsewhere:** alpha is stored and round-trips through save/load, but renders
  opaque until each effect is individually converted. No silent data loss.

Blanket transparency across every effect is a separate project.

## Registration

Per the effect plugin contract (`lib/spacetype/effect.ts:57`), adding the effect
requires only:

1. `lib/spacetype/effects/ticker.ts` exporting `tickerEffect`.
2. Two lines in `lib/spacetype/effects/index.ts` — the import and the array entry.

Param UI, gallery thumbnails, scene defaults, timeline playback, and export bake
all follow automatically.

## Testing

- Unit-test `tickerGeometry.ts` directly: arc-length UVs are monotonic and
  near-uniform in physical spacing; band width is constant along the curve;
  `waveSpeed = 0` is time-invariant; the self-intersection clamp holds.
- Unit-test 8-digit hex round-tripping in `lib/color/convert`, including that
  6-digit input still parses as opaque.
- Extend `tests/unit/spacetype-sections.unit.spec.ts` coverage so every Ticker
  control's `group` is asserted present in `SPACE_TYPE_SECTIONS`.
- Visual check in Type Studio: wave off reads as a clean flat ticker; wave on
  shows undistorted glyphs riding the curve; alternating rows travel opposite
  ways; band fill at alpha 0 leaves text only.
