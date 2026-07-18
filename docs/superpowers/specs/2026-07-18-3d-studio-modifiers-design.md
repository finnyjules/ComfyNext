# 3D Studio — geometry modifier stack

**Date:** 2026-07-18
**Status:** approved in principle ("yes, please proceed"); the design decisions
below were made autonomously while Julien was asleep and are flagged for review.
**Scope:** non-destructive deformations applied on top of any primitive —
subdivide, taper, twist, bend, noise displacement, and array/repeat — plus the
panel to drive them. Frontend-only; no backend change.

## Why

Parametric primitives (shipped 2026-07-18) made the shape picker deep. Modifiers
are what make it feel like a design tool: the same fourteen shapes become
ribbons, horns, lumpy organic blobs and radial arrangements without adding a
single primitive kind.

## Decisions made without the user (review these first)

| Decision | Rationale | Alternative rejected |
|---|---|---|
| **CPU vertex deformation**, applied when geometry is built | `passes.ts` renders depth and normal with `scene.overrideMaterial`, so a GPU/vertex-shader deformation would be invisible in two of the three exported outputs — silently. Raycasting (selection, gizmo), bounding boxes, shadows and the gradient bbox uniforms would all see the undeformed shape too. | Vertex-shader deformation via `onBeforeCompile`. Free per frame, but wrong everywhere that matters here. |
| **Fixed pipeline order**: subdivide → taper → twist → bend → noise → array | Covers almost all intent with no reordering UI, no drag-and-drop, no per-object stack model. Each stage is identity at its default, so the "stack" is just which knobs are non-zero. | A reorderable stack list. Deferred to a later phase; the order above is the one that composes most predictably. |
| **Modifiers are a flat numeric bag** `modifiers?: Record<string, number>` on `PrimitiveObject`, driven by a shared `MODIFIER_SPECS: ParamSpec[]` | Reuses the exact schema/resolve/sanitize machinery built for geometry params — the resolver is generalized to take a spec list rather than a kind. One UI renderer serves both. | A typed per-modifier interface. More code, no benefit, and it would fork the panel renderer. |
| **Array merges into one geometry** (`mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js`, already installed) | Preserves the one-mesh-per-object invariant that the gizmo, raycasting, the passes, the facet variant and the gradient bbox refresh all rely on. | `InstancedMesh`. More efficient, but breaks every one of those assumptions. |
| **Subdivide is part of the stack** (midpoint triangle split, implemented locally) | Twist and bend need vertices along the axis to deform; a box has one segment per side and would not move at all. Three no longer ships a subdivision modifier, so this is ~30 lines of local code. | Adding segment params to every primitive. Changes the shipped param table and defaults for a problem only modifiers have. |
| **Normals are recomputed only when a modifier is active** | Zero modifiers means the geometry is byte-identical to what ships today — back-compat by construction. Deformed geometry must have normals recomputed or the lighting is simply wrong. | Always recomputing. Would silently change the shading of every existing scene. |
| **Primitives only** | GLB objects are a tree of arbitrary meshes; deforming them means walking and rewriting each child, with no shared bounds to deform against. | Including GLBs. Deferred. |

## Model

`PrimitiveObject` gains `modifiers?: Record<string, number>`, sanitized on parse
exactly like `params` (unknown keys dropped, non-finite dropped, clamped,
`undefined` when empty so absent stays absent).

`ParamSpec` (primParams.ts) gains one field so a spec can render as a small
segmented control:

```ts
  control?: 'slider' | 'toggle' | 'options'
  options?: string[]   // required when control === 'options'; the value is the index
```

The existing resolver generalizes so both bags share it:

```ts
export function resolveParam(specs: ParamSpec[], bag: Record<string, number> | undefined, key: string): number
export function sanitizeBag(specs: ParamSpec[], raw: unknown): Record<string, number> | undefined
// paramValue(kind, params, key) === resolveParam(PRIMITIVE_PARAMS[kind], params, key)
// modifierValue(modifiers, key) === resolveParam(MODIFIER_SPECS, modifiers, key)
```

### MODIFIER_SPECS

| key | control | range / options | default | label — hint |
|---|---|---|---|---|
| `subdivide` | slider | 0–3, step 1 | 0 | Subdivide — "Splits each face into smaller ones so bends and twists stay smooth" |
| `taper` | slider | -1–1, step 0.01 | 0 | Taper — "Narrows or widens the shape toward one end" |
| `taperAxis` | options | x,y,z | 1 (y) | Taper axis — "Which direction the taper runs along" |
| `twist` | slider | -360–360, step 1 | 0 | Twist — "Winds the shape progressively around an axis" |
| `twistAxis` | options | x,y,z | 1 (y) | Twist axis — "The axis the shape winds around" |
| `bend` | slider | -180–180, step 1 | 0 | Bend — "Curves the whole shape around an axis" |
| `bendAxis` | options | x,y,z | 2 (z) | Bend axis — "The axis the shape curves around" |
| `noise` | slider | 0–0.5, step 0.005 | 0 | Noise — "Pushes the surface in and out for an organic, lumpy look" |
| `noiseScale` | slider | 0.5–8, step 0.1 | 2 | Noise scale — "Size of the lumps — higher means finer detail" |
| `noiseSeed` | slider | 0–99, step 1 | 0 | Noise seed — "Shuffles the lumps into a different arrangement" |
| `cloneCount` | slider | 1–12, step 1 | 1 | Count — "How many copies of the shape to repeat" |
| `cloneMode` | options | linear, radial | 0 (linear) | Mode — "Repeat in a straight line or around a circle" |
| `cloneOffsetX` | slider | -3–3, step 0.05 | 1.2 | Offset X — "Gap between copies along X" |
| `cloneOffsetY` | slider | -3–3, step 0.05 | 0 | Offset Y — "Gap between copies along Y" |
| `cloneOffsetZ` | slider | -3–3, step 0.05 | 0 | Offset Z — "Gap between copies along Z" |
| `cloneRadius` | slider | 0–5, step 0.05 | 1.5 | Radius — "How far each copy sits from the centre" |
| `cloneAxis` | options | x,y,z | 1 (y) | Around — "The axis the copies are arranged around" |

## The pipeline — `frontend/app/lib/scene3d/modifiers.ts`

```ts
export function applyModifiers(
  geo: THREE.BufferGeometry,
  modifiers: Record<string, number> | undefined,
): THREE.BufferGeometry
```

Returns `geo` unchanged (same object, untouched) when no modifier is active, so
the no-modifier path costs nothing and stays byte-identical. Otherwise it works
on a non-indexed clone and disposes nothing it did not create — the caller owns
the input.

`hasModifiers(modifiers)` is the cheap predicate: any of `subdivide`, `taper`,
`twist`, `bend`, `noise` non-zero, or `cloneCount > 1`.

**Stages, in fixed order:**

1. **Subdivide** — each triangle splits into four at its edge midpoints,
   repeated `subdivide` times. Only runs when a deforming stage is active
   (taper/twist/bend/noise); subdividing alone changes nothing visible and would
   only cost vertices.
2. **Taper** — scale the two axes perpendicular to `taperAxis` by
   `1 + taper · t`, where `t` is the vertex's normalized position along
   `taperAxis` in `[-0.5, 0.5]` relative to the geometry's bounding box.
   Negative taper narrows toward the positive end, positive widens it.
3. **Twist** — rotate each vertex about `twistAxis` by `twist · t` degrees, with
   `t` normalized the same way.
4. **Bend** — bend about `bendAxis` by `bend` degrees total across the extent.
   Implemented as the standard circular bend: for bend axis `z`, points are
   mapped onto an arc of radius `extent / angle` in the XY plane. Guarded
   against `angle → 0` (falls through as identity).
5. **Noise** — displace each vertex along its normal by
   `noise · valueNoise(position · noiseScale + seedOffset)`, using a local
   deterministic 3D value noise (integer hash + smoothstep interpolation, no
   dependency). Same seed always produces the same shape.
6. **Cloner** — `cloneCount` copies merged into one geometry. Linear mode offsets
   copy `i` by `i · (offsetX, offsetY, offsetZ)`. Radial mode places copy `i` at
   angle `i · 360/count` around `cloneAxis` at distance `cloneRadius`, each copy
   rotated to face outward. Count is always honoured exactly.

**Vertex budget.** The subdivide stage stops early once the projected total
(`vertexCount · 4 · cloneCount`) would exceed roughly 300 000 vertices, so a
high-detail sphere subdivides fewer times rather than freezing the editor. The
number of iterations actually applied is not surfaced — the slider simply stops
having an effect, which matches how detail sliders behave at their ceiling.

This bounds *subdivision only*, not the final geometry. Both of the other terms,
primitive detail and array count, are user-visible values shown on their own
sliders, and silently reducing either would mean the readout lies about what is
rendered — so neither yields to the budget. The product is therefore bounded
only by the parameter ranges: the reachable worst case is a torus knot at detail
256 repeated twelve times, at 589 824 vertices and roughly 58 ms per rebuild
(~28 MB), which makes modifier sliders visibly chug while staying stable and
leak-free. Every other combination measured is comfortably interactive — the
same knot at its default detail is 147 000 vertices and about 14 ms. If that
ceiling ever needs lowering, the honest fix is to narrow the detail range for
the densest primitives, not to silently override what a slider reads.

**Normals.** After any deforming stage the pipeline calls
`computeVertexNormals()`. The caller's facet variant treatment (`toNonIndexed` +
`computeVertexNormals` + `addFaceExtentAttributes`) still runs afterwards and is
unaffected.

## Engine integration — `engine.ts`

- `buildGeometry(kind, params, variant)` becomes
  `buildGeometry(kind, params, modifiers, variant)`, applying modifiers between
  `geometryFor` and the facet treatment. This is the single build path, so the
  creation branch and the rebuild branch of `syncObject` both get modifiers.
- `geoKey` gains the modifier values (`MODIFIER_SPECS` order), so a modifier
  change swaps `mesh.geometry` in place exactly like a param change — material
  instance and transform preserved.
- `baseSizeFor(kind, params, modifiers)` measures the modified geometry, so the
  Size row stays truthful when a bend or an array changes the object's extent.
- The gradient bounding-box refresh added for parametric primitives already runs
  after every geometry rebuild and therefore covers modifiers with no change.

## UI — `Scene3DStudioSurface.vue`

One new **Modifiers** `<details>` sub-group, a peer of Geometry and the material
sub-groups, using the same uppercase-label-plus-chevron styling, **collapsed by
default** (modifiers are secondary; Geometry stays open). Inside, a single
Subdivide slider followed by five labelled mini-blocks — Taper, Twist, Bend,
Noise — using the existing micro-label style already used for Axis and
Shading in this panel.

The clone controls are **not** one of those groups. They are presented as their
own **Cloner** `<details>` section, a peer of Geometry and Modifiers placed
immediately after Modifiers and likewise collapsed by default, because the
section is intended to grow with further clone options rather than stay a
five-knob block inside Modifiers. It is a flat list — no inner micro-labels.
That is also why the keys are named `clone*` rather than `array*`; scenes saved
with the old `array*` names are remapped on load by `sanitizeModifiers`.

Rendering is the same schema-driven `v-for` as Geometry, extended for the
`options` control, which renders a `StudioSegmented` (props: `options: string[]`,
string `v-model`) mapping index ↔ label. The Cloner's offset sliders show only
in linear mode; radius and axis only in radial.

The section is shown for primitives only. Duplicating an object copies the
modifier bag (the parametric-primitives fix taught us this the hard way).

## Error handling

Nothing asynchronous and nothing that can fail: all stages are pure numeric
transforms over a BufferGeometry. Degenerate inputs are guarded — a zero bend
angle is identity, a zero-extent axis (a flat plane bent along its own normal)
divides by a guarded extent, and array count 1 skips the merge entirely.

## Testing

- **Unit (modifiers):** `hasModifiers` predicate; identity when nothing is set
  (same object returned, untouched); subdivide multiplies triangle count by 4
  per iteration and preserves the bounding box; taper narrows one end and leaves
  the other; twist leaves the midpoint plane in place and rotates the extremes
  in opposite directions; bend curves the extent (endpoints move toward each
  other, bounding box shrinks along the bend axis); noise is deterministic for a
  given seed and different for a different seed, and displacement magnitude
  respects the amount; array produces exactly `count ×` the vertices, linear
  offsets are evenly spaced, radial places copies on a circle of the given
  radius; the vertex budget caps subdivide iterations rather than the count.
- **Unit (model):** `MODIFIER_SPECS` all have hints, sane ranges, defaults in
  range, unique keys, and `options` present wherever `control === 'options'`;
  `sanitizeBag` round-trips and drops junk; the generalized resolver still backs
  `paramValue` identically (existing param tests must pass untouched).
- **Unit (engine):** a modified object's `geoKey` changes with the modifier bag;
  no-modifier geometry is identical to today's; `baseSizeFor` reflects an array.
- **Browser (real interactions):** each modifier visibly deforms a shape; a
  twisted box needs subdivide to move (proving the tessellation dependency);
  array linear and radial both look right; sliders stay responsive; a gradient
  object keeps its ramp across a modified shape; save/reopen restores; duplicate
  carries modifiers; Export bake matches the viewport; depth and normal passes
  show the deformed shape (the reason this is CPU-side).
- **Gates:** scene3d vitest green; `vue-tsc --noEmit | grep -i scene3d` clean.

## Out of scope

Reorderable stacks, per-modifier enable toggles (an amount of zero is the
toggle), modifiers on GLB objects, mirror/symmetry, shell/thickness, lattice or
curve-driven deformation, and animating modifiers over time.
