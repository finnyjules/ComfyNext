# Scene3D — Sculpt and Merge

**Date:** 2026-08-04
**Status:** Design approved, not yet planned

Give the 3D Studio two capabilities it has no form of today: **molding a shape by
hand like clay**, and **merging shapes into one**. Both produce geometry that no
parameter bag can describe, so both need the same new thing — a primitive whose
geometry comes from stored vertices rather than a factory call.

---

## 1. Decisions

Recorded first, because everything below follows from them.

| Decision | Chosen | Rejected |
|---|---|---|
| What "clay" means | Direct brush sculpting — drag on the surface, it deforms under the cursor | Blobby soft-merge with sliders; hard booleans alone |
| Parametric identity after sculpting | **Lost.** The object becomes a `mesh` primitive; Geometry sliders go away | Stroke-replay over live parameters; freeze-with-unlock |
| Where vertex data lives | **Inline in the doc** — quantised, delta+varint packed, deflated, base64. 40k-vertex cap, 20k default | Uploaded as an asset with a URL in `content` |
| Topology during sculpting | **Fixed, with a manual Remesh action** | Fixed forever; dynamic topology (dyntopo) |
| Merge semantics | **Voxel field** — union/subtract/intersect with a Blend fillet | Exact mesh CSG (`three-bvh-csg`); both behind a toggle |
| Masking | Out of scope for v1 | — |

### Why parametric identity is lost, not preserved

Stroke replay is the tempting option — it fits the studio's "declare the
parameters, derive the capability" instinct, and it would keep the doc small.
It does not survive contact with the problem:

- Brush strokes are **order- and state-dependent**. A smooth brush averages
  whatever the previous strokes left. Replay means re-running the entire stroke
  history on every parameter tick.
- Strokes address **positions**, not vertices. Change the base geometry and the
  same stroke list lands somewhere else, silently producing a different shape
  than the one the user drew.
- Sculpting requires a **uniform dense mesh**, which the primitives are not — a
  sphere pinches at the poles, a box is twelve triangles. Entering sculpt mode
  must remesh regardless. The parametric identity is already gone at that point;
  locking the sliders is just saying so.

---

## 2. Data model

One new `PrimitiveKind`. **Not** a new `SceneObject` kind — that would mean
touching ~67 `kind === …` switch sites across the frontend, and would inherit
none of the primitive machinery.

```ts
// lib/scene3d/config.ts
export type PrimitiveKind =
  | 'box' | 'sphere' | … | 'text' | 'shape' | 'svgPath'
  | 'mesh'                                    // NEW — appended, never reordered

export interface PrimitiveContent {
  text?: string
  font?: string
  path?: string
  pathKey?: string
  fillRule?: 'nonzero' | 'evenodd'

  /** `mesh` only. Quantised vertex buffer: deflate + base64. See §3. */
  mesh?: string
  /** Digest of `mesh`, standing in for it inside `geoKeyFor`. Derived at parse
   *  time from `mesh`, NEVER trusted from the document — exactly the rule
   *  `pathKey` already follows, and for the same reason: a stored digest that
   *  disagreed with its payload would make the engine serve cached geometry for
   *  a shape the object no longer has, silently and persistently. */
  meshKey?: string
}
```

Supporting table edits, all one-liners:

- `PRIMITIVE_KINDS` — append `'mesh'` (appending only; stored indices are a
  persistence contract and a `PRIM_GROUPS` drift test asserts canonical order).
- `NOT_PLACEABLE_KINDS` — add `'mesh'` alongside `'svgPath'`. There is no blank
  mesh to place from the add-menu; a mesh only ever arrives carrying data.
- `PRIMITIVE_PARAMS.mesh = []` — the Geometry panel renders empty with no new
  branch in the component.
- `PRIM_GROUPS` — unchanged. The drift test covers *placeable* kinds only.
- `parseContent` — accept `mesh` as a string, derive `meshKey` from it.

### Why this is the whole integration surface

`buildGeometry` is `geometryFor(kind, params, content, font)` fed into
`applyModifiers(…)` (`lib/scene3d/engine.ts`). Adding one `case 'mesh'` to
`geometryFor` that decodes `content.mesh` means a mesh primitive inherits,
with no further work:

- all six modifiers — taper, twist, bend, noise, jitter, cloner
- every material type, including `shaderFill` and surface `relief`
- the `facet` shading variant and its per-face extent attributes
- object motion tracks, hierarchy and grouping
- selection outlines, the three render passes, rebake and export

There is **no server-side renderer for Scene3D** — bakes are three client-side
passes — so this feature is entirely frontend. No Python.

### Encoding

`lib/scene3d/mesh.ts`, a small pure module:

- positions quantised to `uint16` against the mesh's own bounding box, with the
  box stored as six `float32`
- **positions delta-encoded per component against the previous vertex, zigzagged,
  then varint-packed**
- **indices delta-encoded against the previous index, zigzagged, varint-packed**
- normals **not** stored — recomputed on decode, which is cheaper than the bytes
- `deflate` → base64

**The delta+varint step is load-bearing, not an optimisation.** Measured on
`SphereGeometry` at four densities (`three@0.171`, `zlib.deflateSync` level 9,
base64 length):

| Vertices | uint16 + deflate | delta + zigzag varint + deflate |
|---:|---:|---:|
| 6.3k | 106KB | **15KB** |
| 13k | 226KB | **42KB** |
| 26k | 450KB | **91KB** |
| 52k | 917KB | **186KB** |

Naive quantise-and-deflate is ~5× worse and puts a single sculpt near a
megabyte of base64 in the `scene_state` widget — not viable. Index buffers
dominate the raw size and are the part that delta-encodes best; surface-nets
output is grid-scan ordered, so its vertex and index locality is at least as
good as the sphere measured here.

Both caps sit at remesh time, the only place vertex count can grow:
**40k vertices hard cap** (~150–190KB encoded) with the **default remesh target
at ~20k** (~70KB encoded). The Remesh control shows the resulting vertex count
and encoded size so the cost is never invisible.

### Decode is asynchronous — use the `text` placeholder precedent

`deflate` is only available in browsers through `DecompressionStream`, which is
async, and `geometryFor` is synchronous and runs on every engine sync. So decode
cannot happen inline.

This is already a solved problem in this file: the `text` primitive needs an
async font load, so `geometryFor` peeks a synchronous cache and falls back to a
0.3 placeholder cube on a miss, with the async load triggering a re-sync
moments later. `mesh` follows exactly that shape — a `meshKey → MeshData`
cache, a placeholder box on a miss, and a re-sync when the decode lands.

### Two performance traps this creates

Both are real and both must be handled in the same change that adds the kind:

1. **Decode cache.** `baseSizeFor` and `baseVertexCountFor` (`engine.ts`) call
   `buildGeometry` on *every slider tick* to report size and clone cost. Without
   a cache keyed on `meshKey`, that decodes ~90KB per tick. A small
   `meshKey → BufferGeometry` LRU fixes it.
2. **Cloner budget.** `applyModifiers`' `VERTEX_BUDGET` (300k) throttles
   *subdivision* only; `cloneCount` is deliberately never reduced because it is
   user-visible. The real caps are `cloneCount` 12 (linear) and 5×5×5 = 125
   copies (grid), so a 40k-vertex mesh reaches 480k vertices linear and **5M in
   grid mode** — both over the 300k budget, grid catastrophically so.
   Mesh primitives need the clone count clamped against the budget,
   with the clamp surfaced in the existing clone-cost warning rather than
   applied silently.

---

## 3. The voxel module

`lib/scene3d/voxel.ts` — mesh → signed distance grid → surface nets → mesh.
This is the hard part of the feature and the schedule risk. It is also the
module that pays for itself three times over: **Remesh**, **Merge**, and brush
ray picking all run through it.

### Signing without a new dependency

1. Bin triangles into a uniform grid (built once; reused for ray picking).
2. Rasterise triangles to mark a surface band of cells.
3. **Flood-fill the exterior** inward from the grid boundary. Cells the fill
   never reaches are interior. This avoids generalised winding numbers entirely.
4. Unsigned distance per cell from closest-point-on-triangle over the bins;
   sign it from step 3.
5. Surface nets over the signed grid → an indexed triangle mesh with uniform,
   well-conditioned triangles.

### Open geometry — a stated limitation, not a silent failure

Flood-fill leaks through holes, and several primitives are legitimately open:
`plane`, `ring`, an open-ended `cylinder`, an arc'd or swept `sphere`. Remeshing
or merging an open surface is undefined.

Detection falls out of the fill itself. For a closed mesh the un-reached set is
the object's interior volume — a substantial cell count. For an open mesh the
fill leaks inside and the un-reached set collapses to nearly nothing.

**Rule:** compare the un-reached cell count against the volume implied by the
mesh's bounding box. If it is below a small fraction of that (start at 5%, tune
against the open primitives listed above), treat the input as open. Do not
proceed. Offer a **Solidify (thickness)** step — extrude the surface into a
shell — and let the user decide. Producing garbage quietly is the failure mode
to design against here.

### Ray picking

Brute-force `THREE.Raycaster` against 80k triangles on every `pointermove` is
5–15ms plus garbage — unusable at 60Hz. The triangle bin grid from step 1 gives
grid-marched ray picking instead, at a fraction of the cost. This is a third
reason the voxel module earns its place rather than an optional extra.

---

## 4. Sculpt session

`lib/scene3d/sculpt/` — `session.ts`, `brushes.ts`, `symmetry.ts`.

### The persistence constraint

**A stroke must never write `scene_state`.** Each stroke changes ~90KB of
base64; writing that per stroke would drive the doc through the persistence
recency guard and the 409 stale-write path on every pointer move.

The session therefore owns a mutable working buffer — a `Float32Array` of
positions plus the index buffer — mutated in place for the whole sculpt session.
It encodes back into `content.mesh` only on **commit**: exiting sculpt mode, or
an explicit Apply. The doc is marked dirty at that point, once.

### Brushes

Six share a single falloff loop over a spatial hash of the working positions:

| Brush | Displacement |
|---|---|
| Draw | along the averaged surface normal at the brush centre; Alt inverts to carve |
| Smooth | toward the average of each vertex's neighbours |
| Inflate | along each vertex's *own* normal |
| Flatten | projected toward a local best-fit plane |
| Pinch | toward the brush centre, sharpening a ridge |
| Crease | pinch and displace together, cutting a sharp line |

**Grab** is separate. It tracks a screen-space drag rather than surface normals:
grab the region under the cursor at pointer-down and carry it with the pointer.
Different interaction model, its own code path.

Vertex normals are recomputed **once per stroke end**, not per pointermove.

### Symmetry

Mirror (across the object's local X) and radial (N-fold about an axis) both
expand one brush centre into K centres before the falloff loop runs. Same
machinery — once mirror exists, radial is a loop bound.

### Undo

Per stroke, snapshot only `{ index, oldPosition }` for the vertices that stroke
actually touched, into a 32-deep ring buffer. Bounded memory; never a full mesh
copy. Cmd+Z inside sculpt mode steps one stroke back.

---

## 5. Merge

`lib/scene3d/merge.ts`, thin over `voxel.ts`.

Take a multi-selection, bake each object's world-space geometry (transform +
modifiers applied) into a shared grid, then combine fields:

- **Union** — `min(a, b)`
- **Subtract** — `max(a, -b)`, first selected object is the base
- **Intersect** — `max(a, b)`
- **Blend** radius > 0 swaps `min`/`max` for their smooth counterparts, giving a
  fillet where the shapes meet — the clay-press look

Surface-nets the result into one new `mesh` object. The result is already a
clean uniform mesh, so it is immediately sculptable — the reason voxel merge was
chosen over exact CSG.

**Cost accepted:** sharp edges soften at grid resolution. Merging a box into a
box will not give a crisp corner. If crisp hard-surface booleans are wanted
later, `three-bvh-csg` slots in behind the same action with a Blend-at-zero
route, but it is explicitly not in this design.

Source objects are removed from the doc (the merge is undoable through the
studio's existing doc-level undo).

---

## 6. UI

### Sculpt mode

Select a `mesh` object → **Sculpt**. The mode swaps the panel and the viewport
interaction:

- gizmo hidden, brush cursor ring drawn on the surface
- Geometry panel replaced by: brush palette, Size, Strength, Alt-inverts hint,
  Symmetry (off / mirror / radial + count), **Remesh** (with a resolution
  control and the resulting vertex count), Apply, Exit
- everything outside the Geometry panel — material, transform, motion — stays
  live and untouched

### The orbit-lock hazard

While a stroke is live, orbit must be off. `lib/scene3d/interaction.ts` is
emphatic on this point: two concerns already contend for `orbit.enabled`
(`cameraLocked` and `gizmoDragging`), each owns a private field, and
`orbit.enabled` is always recomputed as the AND-negation of both through
`updateOrbitEnabled`. Nothing may write `orbit.enabled` directly — a per-frame
writer that did so has already shipped as a bug once in this file.

Sculpt is a **third** such concern. It adds its own private field and routes
through `updateOrbitEnabled`. It does not write `orbit.enabled`, and it does not
call `orbit.enabled = …` from a render loop.

### Other entry points

- **Convert to mesh** — on any primitive, in the object context menu. Remeshes
  at a default resolution and replaces the object in place, preserving name,
  transform, material, modifiers, motion and parent.
- **Merge** — on a multi-selection of two or more objects.

---

## 7. Testing

Headless unit tests (vitest) cover everything except the pointer loop:

- `mesh.ts` — encode/decode round-trip fidelity within the quantisation bound;
  digest stability; cap enforcement
- `voxel.ts` — remeshing a unit sphere preserves volume and bounding box within
  tolerance; a known open surface (a `plane`) is correctly *detected* as open;
  boolean field combinations against analytic shapes
- `brushes.ts` — each brush's displacement direction on a flat patch with a
  known normal; falloff monotonicity; **symmetry verified with a deliberately
  asymmetric stroke**, so a broken mirror cannot pass by coincidence
- `session.ts` — undo restores exact prior positions; stroke does not touch the
  doc; commit produces a decodable buffer
- `config.ts` — a `mesh` object survives `parseDoc(serializeDoc(doc))` exactly;
  `meshKey` is re-derived and a tampered stored digest is ignored
- `merge.ts` — union of two overlapping spheres has one connected component;
  subtract removes volume

The pointer loop, mode switching, and the orbit lock need a live browser check —
they are the part unit tests cannot reach.

---

## 8. Phasing

Each phase is independently shippable.

| Phase | Delivers | Verifiable by |
|---|---|---|
| 1 | `mesh` primitive: `config.ts` edits, `mesh.ts` (delta+varint codec), `geometryFor` case, async decode cache + placeholder, cloner budget clamp, **Convert to mesh** | A converted sphere round-trips through save, takes modifiers and materials, animates, and exports |
| 2 | `voxel.ts` + **Remesh** + open-surface detection + Solidify | Remeshing known shapes preserves volume; a plane is refused, not mangled |
| 3 | Sculpt mode: session, working buffer, core four brushes, mirror symmetry, per-stroke undo, orbit lock | Sculpting by hand in the studio |
| 4 | Grab, pinch, crease, radial symmetry, **Merge** | Full brush set and merge |

**Confirm at the end of phase 2**, once Remesh can produce real sculpt-density
meshes: the `scene_state` size for a doc with several mesh objects. The §2 table
measures the encoder on `SphereGeometry`, which is smooth and coherently
ordered; a *sculpted* mesh has displaced vertices and will encode somewhat
worse. The budget to check against is ~70KB at the 20k default and ~190KB at the
40k cap. If real sculpts land well above that, or a realistic scene pushes
`scene_state` past a few hundred KB and project saves feel it, the asset-URL
route slots in behind the same `content.mesh` field without touching anything
else in this design.

---

## 9. Scope boundaries

Explicitly **not** in this design:

- masking / protected regions
- dynamic topology (per-stroke subdivision and collapse)
- exact mesh CSG with crisp edges
- multi-resolution sculpting or subdivision levels
- vertex colour painting
- sculpting on GLB imports (they are a different `SceneObject` kind; a
  Convert-to-mesh path for GLBs is a plausible follow-on, not part of this)
