# Scene3D — corner rounding for the convex polyhedra

**Date:** 2026-07-20
**Status:** Design approved, implementing

## Problem

Edge rounding shipped for box/cylinder/cone/prism/pyramid (see
[edge-rounding design](2026-07-20-scene3d-edge-rounding-design.md)), but the three polyhedra
— `icosahedron`, `octahedron`, `dodecahedron` — have no Corner slider. Users want the same
edge rounding on them. Those earlier shapes each had a cheap trick (lathe of a filleted
profile, or a rounded-polygon extrude); the polyhedra have neither an axis of revolution nor
an extrudable cross-section, so they need a different technique.

## Goal

Give the three polyhedra the same **Corner** (`cornerRadius`) + **Corner sides**
(`cornerSides`) controls (ranges matched to the box), rounding their edges and corners while
keeping the flat faces flat. `cornerRadius = 0` reproduces today's geometry exactly.

## Approach — convex offset via `ConvexGeometry`

All three polyhedra are **convex**, which admits a clean construction: the **Minkowski sum of
the solid with a small sphere of radius r** is exactly the rounded solid — flat faces offset
outward by r, edges become cylindrical arcs, corners become spherical caps. We approximate it
with a convex hull of a point cloud:

For each unique base vertex `v` with incident face-normal set `N = {n₁…nₖ}`:
- Add `v + r·nᵢ` for each incident face normal → **guarantees flat faces** (the three offset
  vertices of a face are the extreme points in that face's normal direction, so the hull face
  through them is the flat offset face).
- Add `v + r·slerp(nᵢ, nⱼ, t)` for `cornerSides` steps between each pair of incident normals
  → **rounds the edges** (arc across the dihedral).
- Add `v + r·normalize(Σnᵢ)` → seeds the **corner** spherical cap.

`ConvexGeometry(allPoints)` builds the hull. `ConvexHull` emits only triangles with per-face
normals (verified: no coplanar merging), so flat faces render crisp and rounded regions read
as faceted arcs that smooth as `cornerSides` rises.

Two finishing steps:
- **Scale to preserve size.** The offset grows the solid by ~r; scale the hull so its bounding
  radius matches the base's, so the shape doesn't balloon as Corner is dragged (matching how
  `RoundedBoxGeometry` keeps the box 1×1×1).
- **Add spherical UVs.** `ConvexGeometry` sets position + normal but **no UV**, and the plain
  polyhedra have UVs — so project spherical UVs (`u = atan2(z,x)`, `v = asin(y)`) to keep
  gradient/image materials working. (Seam at the ±x wrap is acceptable — the plain polyhedron
  UVs are also utilitarian.)

## Non-goals / accepted tradeoffs

- **Convex only.** The technique is invalid for non-convex shapes; the three polyhedra are all
  convex, so this is fine. It is deliberately *not* a general edge-beveler.
- **Faceted rounding.** Rounded edges/corners are a faceted approximation; `cornerSides` is the
  smoothness. At large `cornerRadius` the shape approaches a sphere — same as a heavily-rounded
  box.
- **Detail interaction.** With `detail > 0` (geodesic subdivision) the base is already
  near-spherical; rounding it works but adds little. Heavy `detail`+`cornerSides` combos
  produce large point clouds; the existing `deferGeometry` (rebuild-on-release) path absorbs
  the cost. No special cap.

## Parameters

Append the existing shared `corner()` builder (Corner `0–0.49`/step `0.01`/default `0`; Corner
sides `1–8`/step `1`/default `2`) to the `icosahedron`, `octahedron`, `dodecahedron` spec
lists in `primParams.ts`. Panel renders them automatically (it iterates `PRIMITIVE_PARAMS[kind]`).

## Files

1. **`frontend/app/lib/scene3d/roundedGeometry.ts`** — new `roundedHullGeometry(base,
   cornerRadius, cornerSides)` and an `addSphericalUV(geo)` helper.
2. **`frontend/app/lib/scene3d/primParams.ts`** — `...corner()` on the three polyhedra.
3. **`frontend/app/lib/scene3d/engine.ts`** — `geometryFor` builds the plain polyhedron, and
   when `cornerRadius > 0` wraps it with `roundedHullGeometry` (disposing the temp base).
4. Tests: `scene3d-rounded-geometry.unit.spec.ts` (helper), `scene3d-engine.unit.spec.ts`
   (parity + wiring), `scene3d-params.unit.spec.ts` (spec rows).

No panel changes.

## Testing

- **Parity:** `cornerRadius = 0` → the exact `IcosahedronGeometry`/`OctahedronGeometry`/
  `DodecahedronGeometry(0.55, detail)`; the existing engine parity test extends to the three.
- **Validity:** at mid and extreme `cornerRadius` (incl. 0.49) and `cornerSides` 1/8, the hull
  has finite positions, `normal`, and `uv`; position count > 0.
- **Size preserved:** rounded bounding radius ≈ the base's (scale-back works).
- **Flat faces:** at a small `cornerRadius`, some triangles share an exactly-equal face normal
  (flat faces survive) — a proxy that the offset-face points landed coplanar.
- **Smoothness:** higher `cornerSides` → more vertices (smoother arcs).
- The existing "builds every kind at both ends of every parameter range" now exercises
  `cornerRadius: 0.49` on the three polyhedra through the wiring.

## Persistence

`cornerRadius`/`cornerSides` are plain numbers in the primitive `params` bag, already
round-tripped by `sanitizeParams`. Scenes saved before this change lack the keys → default 0 →
identical geometry. No migration.
