# Scene3D — edge rounding for cylinder, cone, prism, pyramid

**Date:** 2026-07-20
**Status:** Design approved, awaiting spec review

## Problem

The 3D Studio's `box` primitive already exposes a **Corner** slider (`cornerRadius`) and
a **Corner sides** smoothness knob (`cornerSides`) via `RoundedBoxGeometry`. No other
primitive can round its sharp edges. Users want the same corner-rounding control on the
other hard-edged primitives — most notably `cylinder`, `cone`, `prism`, and `pyramid`.

The rounded spheres/torus/polyhedra don't have sharp rim edges in the same way, so they
are out of scope for this change.

## Goals

- Add a **Corner** (`cornerRadius`) + **Corner sides** (`cornerSides`) control to
  `cylinder`, `cone`, `prism`, and `pyramid`, matching the box's ranges and semantics.
- Cylinder & cone: round the **rim** (where the side meets the top/bottom cap).
- Prism & pyramid: round **both** the vertical edges (between flat faces) and the rim.
- Keep the flat n-gon faces flat (standard fillet — a rounded hexagonal prism still
  reads as hexagonal; no barrelling).
- `cornerRadius = 0` reproduces today's geometry exactly (no visual regression).

## Non-goals / accepted tradeoffs

Decided during brainstorming:

- **Rounding wins over taper on polygonal shapes.** When `cornerRadius > 0`, prism and
  pyramid render with a *straight* (constant) cross-section. Consequences:
  - A rounded **pyramid loses its apex** and becomes a rounded n-gon prism.
  - A rounded **prism ignores `radiusTop`** (no taper) while rounded.
  These only apply when rounding is active; at `cornerRadius = 0` the shapes are
  unchanged (pyramid keeps its point, prism keeps its taper).
- No generic bevel modifier for arbitrary geometry (icosahedron, torus, etc.) — that was
  considered and rejected as high-risk / low-reward.
- No bespoke rounded *frustum* geometry (would preserve taper + full rounding
  simultaneously) — rejected as a large geometry effort for niche value.

## Approach

Two techniques, split by whether the primitive's cross-section is round. Both mirror the
existing box pattern: a `cornerRadius = 0` fast path returns the current geometry, and any
positive radius switches to the rounded builder.

### Cylinder & cone → rounded-profile `LatheGeometry`

These have only a rim edge. Build the silhouette **profile** in the (radius, y) plane and
revolve it around the y-axis:

```
(0, -0.5) → (rBottom, -0.5) → (rTop, +0.5) → (0, +0.5)
```

Fillet the two **outer rim corners** — `(rBottom, -0.5)` and `(rTop, +0.5)` — with a
quarter-ish arc of radius `cornerRadius` and `cornerSides` segments. A corner whose outer
radius is ~0 (e.g. a cone's top at `rTop = 0`, which sits on the axis) is skipped, since
there is no rim there — only an apex.

`THREE.LatheGeometry(profilePoints, radialSegments, 0, phiLength)`:
- `radialSegments = detail`
- `phiLength = rad(arc)` — the existing `arc` param carries over for free.
- `openEnded`: when set, the profile does **not** return to the axis (drop the
  `(0, y)` endpoints), producing a rounded-over lip on a hollow tube. Rim rounding still
  applies to the outer edge.
- `radiusTop` / `radiusBottom` carry over as the profile's `rTop` / `rBottom`.

At `cornerRadius = 0`, return today's `CylinderGeometry(...)` unchanged.

### Prism & pyramid → rounded-polygon `ExtrudeGeometry`

Build a regular n-gon (`n = detail`) as a `THREE.Shape` with each corner filleted by
`cornerRadius` (arc/`absarc` corners) → rounds the **vertical** edges while keeping the
faces flat. Extrude with a bevel to round the **rim**:

```
ExtrudeGeometry(shape, {
  depth,               // height minus 2*bevelThickness so total height stays 1
  bevelEnabled: true,
  bevelSegments: cornerSides,
  bevelSize:      cornerRadius,   // horizontal rounding at top/bottom
  bevelThickness: cornerRadius,   // vertical rounding at top/bottom
  curveSegments: cornerSides,     // segments along each vertical fillet arc
})
```

Then recentre and rotate so it matches the current prism/pyramid orientation and unit
size (circumradius 0.5, height 1, centred on origin). Straight cross-section — `radiusTop`
is ignored while rounded.

At `cornerRadius = 0`, return today's `CylinderGeometry(...)` unchanged (pyramid keeps its
apex, prism keeps its taper).

## Parameters

Add a shared spec builder in `primParams.ts`, matching the box exactly:

```ts
const corner = (): ParamSpec[] => [
  { key: 'cornerRadius', label: 'Corner', hint: 'Rounds off the edges', min: 0, max: 0.49, step: 0.01, default: 0 },
  { key: 'cornerSides', label: 'Corner sides', hint: 'How smooth each rounded edge looks', min: 1, max: 8, step: 1, default: 2 },
]
```

Append `...corner()` to the `cylinder`, `cone`, `prism`, and `pyramid` spec lists in
`PRIMITIVE_PARAMS`. (Box keeps its own inline rows — its hint wording differs slightly and
it's already shipped; not worth churning.)

## Files touched

1. **`frontend/app/lib/scene3d/primParams.ts`**
   - Add the `corner()` builder; append its two rows to `cylinder`, `cone`, `prism`,
     `pyramid`. No changes to `resolveParam` / `sanitizeBag` (they're schema-driven).

2. **`frontend/app/lib/scene3d/engine.ts`**
   - Two module-level helpers: `roundedLatheGeometry(...)` and `roundedPolyGeometry(...)`.
   - In `geometryFor`, the `cylinder`/`cone` cases call `roundedLatheGeometry` when
     `p('cornerRadius') > 0`; the `prism`/`pyramid` cases call `roundedPolyGeometry` when
     `p('cornerRadius') > 0`. Otherwise the existing `CylinderGeometry` path runs.

**No panel changes.** `Scene3DStudioSurface.vue` iterates `PRIMITIVE_PARAMS[kind]`
(line ~434) and renders each spec generically, so the new sliders appear automatically.
Everything downstream (`modifiers`, shading variants in `buildGeometry`, the outline pass
in `outlines.ts`) already flows through `geometryFor`, so no other code changes.

## Testing

Unit tests for the two helpers (`engine` or a new `roundedGeometry.test.ts`):

- **Baseline parity:** `cornerRadius = 0` → helper is not called / falls back to the
  `CylinderGeometry` path (or, if called, returns geometry matching the baseline vertex
  count). No visual regression.
- **Validity when rounded:** for a sampling of `cornerRadius`/`cornerSides`, the returned
  `BufferGeometry` has all-finite positions, a `normal` attribute, a `uv` attribute, and a
  bounding box within the unit shape's extents (no runaway vertices).
- **Cone apex:** `rTop = 0` + rounding produces no degenerate/NaN vertices at the axis.
- **Drift check:** every kind that declares `cornerRadius`/`cornerSides` in
  `PRIMITIVE_PARAMS` is actually consumed by `geometryFor` (guards against a spec row that
  no builder reads).

## Persistence & compatibility

`cornerRadius`/`cornerSides` are plain numbers stored in the primitive's `params` bag, the
same shape `sanitizeParams` already round-trips. Scenes saved before this change simply
lack the keys → `resolveParam` returns the `0` default → identical geometry. No migration
needed.
