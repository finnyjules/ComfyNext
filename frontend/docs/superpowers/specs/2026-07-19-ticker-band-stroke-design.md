# Ticker band stroke — design

Date: 2026-07-19
Status: approved, ready for implementation plan

## Summary

Give the Ticker effect's bands an outline along their two long edges — "rails" —
with an adjustable stroke weight and its own colour.

## Scope

**Ticker only.** The `ribbon` effect is explicitly out of scope. Ribbon sweeps its
band along world Z with t-parameterized UVs, so its edges are different curves
computed in a different module (`lib/spacetype/ribbonGeometry.ts`); a stroke there
would be a second, independent implementation. If it turns out to be wanted, it
gets its own spec after this one ships and the look has been seen for real.

## Decisions

**Rails, not a silhouette.** The stroke runs along the two long edges as
independent open lines that stop where the band ends. It does not close around the
short end caps. The band's ends are already where glyphs scroll out of view, so
closing the outline there would draw attention to a boundary the design otherwise
treats as soft.

**Adjustable weight, built as triangle strips.** WebGL line width is effectively
locked to 1px on nearly all platforms — `THREE.LineBasicMaterial.linewidth` is
silently ignored — so a line-based stroke would ship a width slider that does
nothing. The rails are therefore swept quads, offset along the same in-plane
normal the band already computes.

**Stroke is centred on the edge.** Half the rail sits on the band, half outside, so
the stroke reads as sitting *on* the boundary rather than inflating the silhouette.

## Geometry

New export in `lib/spacetype/tickerGeometry.ts`:

```ts
buildTickerStrokeData(p: TickerGeoParams, strokeWidth: number): TickerStrokeData
```

It reuses the existing centreline sampling and in-plane normal computation, so the
rails follow a wavy path exactly rather than approximating it.

Per centreline sample it emits four vertices — two per rail:

- outer rail: `centre + normal * (half + w/2)` and `centre + normal * (half - w/2)`
- inner rail: `centre - normal * (half - w/2)` and `centre - normal * (half + w/2)`

where `half = height / 2` and `w = strokeWidth`. Each rail is indexed as its own
triangle strip; the two rails share one buffer but do not share triangles.

**No UVs.** The rails are flat colour, not textured, so none of the band's
arc-length parameterization or `uRepeat` machinery applies. This is the main reason
the stroke builder is substantially simpler than `buildTickerGeometryData`.

### Z-fighting

The band sits at `z = 0`. Coplanar rails would z-fight along their inner half —
flickering speckle as the camera moves. The stroke geometry is therefore emitted at
`z = STROKE_Z` (0.001), a hair in front of the band. At Ticker's scale this is
invisible and it is more predictable across drivers than `polygonOffset`.

## Effect wiring

Two controls, both in the `Stroke` group (already a member of
`SPACE_TYPE_SECTIONS`, so they will render):

| Key | Kind | Range | Default |
|---|---|---|---|
| `strokeWidth` | slider | 0 – 0.4, step 0.01 | **0** |
| `strokeColor` | color | — | `#000000` |

Defaulting `strokeWidth` to 0 means existing saved scenes render byte-identically.

**At width 0, no stroke mesh is built at all** — the same shape as
`waveAmplitude 0` skipping the wave rebuild. Not a hidden mesh, not a zero-scale
mesh: absent.

`strokeWidth` is **structural**, not a live key — changing it rebuilds geometry.

`strokeColor` goes through `stripAlpha` before reaching `THREE.Color`, and its
alpha drives a `transparent` material with `depthWrite` off below 1, consistent
with how the band's own alpha is handled.

The rails re-bake inside the existing `bakedPhase` gate in `update()`, so a
travelling wave carries them along with the band and a still wave costs nothing.

`loopRates` is unaffected — the stroke introduces no new motion.

## Testing

Unit tests on `buildTickerStrokeData` directly, matching the existing
`tickerGeometry` coverage:

- rail width is constant along the curve, including through bends
- rails sit exactly at the band's edges — each rail's centre is `half` from the
  centreline
- vertex and index counts are correct for the sample count
- `strokeWidth` 0 produces empty geometry
- rails are flat in the stroke plane (constant z)

Then a runtime pass in `pages/dev/spacetype-harness.vue?effect=ticker`:

- stroke renders at all, at a visible weight
- no z-fighting speckle against the band
- with the wave on, rails stay glued to the band's edges rather than drifting
- stroke colour alpha behaves (including fully transparent = no stroke visible)

The runtime pass is not optional. Z-fighting and rail drift are precisely the class
of defect unit tests cannot observe, and this project has already had two bugs
(in_frame double-application, and the `defineModel` alpha clobber) that only a
click-through caught.
