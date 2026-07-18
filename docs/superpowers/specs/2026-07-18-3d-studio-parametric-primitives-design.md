# 3D Studio — parametric primitives

**Date:** 2026-07-18
**Status:** approved (brainstorm with Julien)
**Scope:** give every primitive its own geometry parameters (detail, corner
radius, arcs, tube, winding, radii), driven by a single schema table; rename the
Scale row to Size in scene units. Frontend-only; no backend change.

## Problem

The 14 primitives are frozen geometry — a box is always 1×1×1, a torus always
has a 0.18 tube — and object scale is the only size control, so it distorts
rather than rebuilds. Spline's geometry panel (reference screenshot) is
per-shape parameters: `Detail` is segment count, `Corner`/`Corner Sides` are a
rounded-box radius and its bevel resolution. Parameters multiply the existing 14
shapes into roughly 40 without adding a single new type.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Where to start on geometry | Parametric primitives first. Modifier stack (twist/bend/taper/array) and new shape types (extrude-from-Shape-Studio, 3D text) are later phases. Booleans/CSG and editable-mesh box modeling are out. |
| Size vs geometry | Spline's model: Size XYZ is the existing `scale` displayed in scene units. The gizmo keeps writing to `scale`; no gizmo rework. Accepted cost: corner radius stretches under non-uniform scale, same as Spline. |
| Menu | Keep all 14 entries, each gains parameters. No unification, no migration. Overlap (a cone with a top radius resembles a cylinder) is harmless — they are different starting points. |
| Subdivision | One Detail slider per shape. Refinement: Detail **is** the integer segment count with a per-shape range, not a normalized 0–1, so the readout is honest and you can land on exactly 6 sides. This gets the rejected "Advanced expander" benefit without the extra UI. |

## Architecture — a parameter schema table

One table describes every parameter; the engine and the UI both read from it.
Adding a parameter later is one row, not new code in two files.

```ts
// config.ts
export interface ParamSpec {
  key: string
  label: string
  hint: string                     // one-liner for the StudioSlider tooltip
  min: number; max: number; step: number
  default: number                  // reproduces today's geometry exactly
  control?: 'slider' | 'toggle'    // default 'slider'; toggle stores 0|1
}
export const PRIMITIVE_PARAMS: Record<PrimitiveKind, ParamSpec[]>
```

`PrimitiveObject` gains `params?: Record<string, number>`. A helper
`paramValue(kind, params, key): number` resolves a value or its spec default —
the single read path for engine and UI alike.

## Parameter table

Defaults are chosen to reproduce today's geometry exactly (verified against the
current `geometryFor` calls, noted per row).

| Kind | Parameters (min–max, step, default) | Reproduces |
|---|---|---|
| box | cornerRadius 0–0.49/.01/**0**, cornerSides 1–8/1/**2** | `BoxGeometry(1,1,1)` when radius 0 |
| sphere | detail 4–64/1/**48**, arc 30–360/1/**360**, sweep 10–180/1/**180** | `SphereGeometry(0.5,48,32)` — height segments = `round(detail·2/3)` |
| cylinder | detail 3–64/1/**48**, radiusTop 0–1/.01/**0.5**, radiusBottom 0–1/.01/**0.5**, arc 30–360/1/**360**, openEnded toggle/**0** | `CylinderGeometry(0.5,0.5,1,48)` |
| cone | detail 3–64/1/**48**, radiusTop 0–1/.01/**0**, radiusBottom 0–1/.01/**0.5**, arc, openEnded | `ConeGeometry(0.5,1,48)` |
| torus | detail 8–64/1/**64**, tube 0.02–0.45/.01/**0.18**, arc 30–360/1/**360** | `TorusGeometry(0.5,0.18,24,64)` — radial = `round(detail·0.375)` |
| torusKnot | detail 32–256/1/**128**, tube 0.02–0.3/.01/**0.12**, p 1–8/1/**2**, q 1–8/1/**3** | `TorusKnotGeometry(0.4,0.12,128,16)` — radial = `round(detail/8)` |
| plane | detail 1–32/1/**1** | `PlaneGeometry(2,2)` |
| capsule | detail 4–32/1/**24**, radius 0.1–0.5/.01/**0.35**, length 0–2/.05/**0.5** | `CapsuleGeometry(0.35,0.5,8,24)` — cap = `round(detail/3)` |
| pyramid | detail 3–12/1/**4**, radiusTop 0–1/.01/**0** | `ConeGeometry(0.55,1,4,1).rotateY(π/4)` — the π/4 rotation stays applied at every side count |
| prism | detail 3–24/1/**3**, radiusTop 0–1/.01/**0.5** | `CylinderGeometry(0.5,0.5,1,3)` |
| ring | detail 3–64/1/**48**, innerRadius 0–0.49/.01/**0.22**, arc 30–360/1/**360** | `RingGeometry(0.22,0.5,48)` |
| icosahedron | detail 0–3/1/**0** | `IcosahedronGeometry(0.55)` |
| octahedron | detail 0–3/1/**0** | `OctahedronGeometry(0.55)` |
| dodecahedron | detail 0–3/1/**0** | `DodecahedronGeometry(0.55)` |

Notes:
- **Rounded box** uses `RoundedBoxGeometry` from `three/examples/jsm/geometries/`
  (already installed — zero new dependencies), matching the project's existing
  jsm import style. `cornerRadius 0` falls back to `BoxGeometry` because
  RoundedBox degenerates at radius 0.
- **Arc** is authored in degrees and converted to radians at build time.
  Sphere arc → `phiLength`, sweep → `thetaLength`; cylinder/cone/ring arc →
  `thetaLength`; torus arc → `arc`.
- **Toggles** store 0/1 so `params` stays a flat number map (simple parse,
  simple round-trip).

## Engine — `geometryFor(kind, params)` and geometry-only rebuilds

`geometryFor` takes the resolved params and applies the per-kind segment
formulas above.

The current `sourceKey` (`primitive:box` / `glb:<url>`) governs full teardown and
stays as-is. A new **geometry key** governs an in-place geometry swap:

```
geoKey = `${kind}|${JSON.stringify(sortedParams)}|${variant}`   // variant: 'smooth' | 'facet'
```

The existing `geoVariant` block in `syncObject` (engine.ts:210-229) generalizes
into this: when `geoKey` changes, build the new geometry, apply the facet
treatment when the variant calls for it (`toNonIndexed` +
`computeVertexNormals` + `addFaceExtentAttributes`), assign `mesh.geometry`,
dispose the old one. The material instance, its in-place update path, and the
transform are all preserved — parameters never force a material rebuild.

At these polygon counts a rebuild is well under a millisecond, so sliders scrub
live without debouncing.

## UI — Geometry section

A new `StudioSection` titled **Geometry** in the Selection panel, between
Transform and Material, rendered only for primitives (GLB objects have no
meaningful parameters and the section is omitted for them). Its body is a
`v-for` over `PRIMITIVE_PARAMS[kind]` emitting a `StudioSlider` with the spec's
label, range, step and `hint` — reusing the tooltip support added in `b352b9867`
— or a toggle control where `control === 'toggle'`. No bespoke markup per shape.

Writes go through a `paramProxy(key)` computed in the same spirit as the
existing `matParam` helper: read resolves through `paramValue`, write assigns
into `obj.params` (creating the object on first write).

### Size row

The Transform section's **Scale** row becomes **Size**, showing
`scale · baseDimensions` in scene units at 2 decimals. Base dimensions come from
the geometry's bounding box, recomputed on every geometry rebuild and cached on
the mesh (changing a torus tube changes its overall size). Editing a Size field
writes `scale = value / base`. The gizmo continues to write `scale` directly, so
handle drags update the numbers reactively and vice versa. Position and
Rotation° rows are unchanged.

## Error handling

Parsing follows the existing tolerant pattern in `parseDoc`: `params` is copied
key-by-key, unknown keys dropped, non-finite values dropped, in-range values
clamped to the spec's min/max. Absent stays absent so serialize→parse
round-trips exactly. A primitive whose params are entirely absent renders
today's geometry.

## Testing

- **Unit (config):** `PRIMITIVE_PARAMS` has an entry for every `PrimitiveKind`
  (drift guard, same shape as the existing `PRIM_GROUPS` test); every spec's
  default lies within its own min/max; round-trip a doc with params set on
  several kinds; unknown/garbage keys dropped; out-of-range clamped; absent
  stays absent.
- **Unit (engine):** defaults reproduce today's geometry — snapshot the vertex
  count and bounding box of all 14 kinds at defaults and assert they match the
  values produced before this change; parameters actually change the mesh
  (detail 6 on a cylinder yields a hexagonal footprint; corner radius > 0
  switches to RoundedBox; arc 180 halves the sweep); the facet variant still
  gets `aFaceMin`/`aFaceMax` after a parameter-driven rebuild.
- **Browser (real interactions):** drag detail, corner radius and arc and watch
  the viewport rebuild live; confirm gizmo drags update Size and typed Size
  values move the object; a faceted-gradient object survives a parameter change
  with its shading intact; Save/reopen restores parameters; Export bake matches
  the viewport.
- **Gates:** scene3d vitest green; `vue-tsc --noEmit | grep -i scene3d` clean.

## Out of scope

Modifier stack (twist/bend/taper/noise/array/mirror), new shape types
(extrude-from-Shape-Studio, 3D text via SpaceType, tube-along-path, lathe,
helix, terrain), boolean/CSG operations, editable-mesh box modeling, and
per-parameter animation. Also deferred: baking scale into geometry to
un-stretch corners ("Apply size"), which the chosen Size model makes
unnecessary for now.
