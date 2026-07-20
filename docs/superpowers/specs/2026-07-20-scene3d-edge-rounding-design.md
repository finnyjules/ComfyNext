# Scene3D — geometry enhancements: edge rounding + crystallize

**Date:** 2026-07-20
**Status:** Design approved, awaiting spec review

Two related geometry features for the 3D Studio, brainstormed together:

- **Feature 1 — edge rounding** for `cylinder`, `cone`, `prism`, `pyramid`.
- **Feature 2 — crystallize**: a `jitter` modifier plus a deeper `subdivide` cap, for
  faceted crystal/gem shapes.

They touch overlapping files (`primParams.ts`, and the geometry/modifier pipeline) and are
small, so they share one spec and one implementation plan.

---

# Feature 1 — edge rounding for cylinder, cone, prism, pyramid

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

## Files touched (Feature 1)

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

## Testing (Feature 1)

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

---

# Feature 2 — crystallize (jitter modifier + deeper subdivision)

## Problem

Users want faceted, crystal/gem shapes. The pipeline already has a `subdivide` modifier and
a `noise` modifier, but neither produces crystals:

- `noise` displaces each vertex along its normal using **smooth, continuous value-noise**
  → neighbouring vertices move together → organic rolling lumps, the opposite of a crystal.
- `subdivide` (capped at 3) splits triangles but, on its own, is only a smoothing aid for
  the deform stages.

Crystals need the *other* kind of displacement: **per-vertex random jitter** (uncorrelated
between neighbours) so faces split into sharp angular facets, plus enough subdivision to
give those facets density, viewed with flat shading.

## Goals

- Add a **`jitter`** modifier that randomly displaces vertices for a faceted look.
- Two modes (segmented toggle): scatter each vertex in a random direction, or push it
  in/out along its normal.
- A seed to reshuffle the arrangement.
- Raise the `subdivide` cap so low-poly bases can reach high facet density.
- Reuse the existing subdivision + flat-shading machinery — no new subdivision code.

## Non-goals / accepted tradeoffs

- No new "flat shading" control — the studio already has a per-object shading toggle; the
  crystal recipe is *jitter + subdivide + flat shading*, surfaced via the `jitter` hint.
- `jitter` is intentionally distinct from `noise` (kept as a separate modifier), because the
  two produce opposite looks (angular vs organic) and users may want both.

## Approach

### The `jitter` modifier

New rows in `MODIFIER_SPECS` (`primParams.ts`), placed next to `noise`:

```ts
{ key: 'jitter', label: 'Jitter', hint: 'Randomly offsets each vertex for a faceted, crystalline look — pair with Subdivide and flat shading', min: 0, max: 0.5, step: 0.005, default: 0 },
{ key: 'jitterMode', label: 'Jitter mode', hint: 'Random scatters vertices into chaotic gems; Along normal pushes them in/out for spikes', min: 0, max: 1, step: 1, default: 0, control: 'options', options: ['random', 'normal'] },
{ key: 'jitterSeed', label: 'Jitter seed', hint: 'Shuffles the jitter into a different arrangement', min: 0, max: 99, step: 1, default: 0 },
```

`options: ['random', 'normal']` is a persistence contract (stored value is the index) —
append-only, never reorder.

### `applyJitter` (modifiers.ts)

Per-vertex deterministic displacement, keyed on the vertex's **quantized position** (not its
index), so vertices coincident in space hash identically and move together — the mesh stays
welded/watertight, it just facets. Reuses the existing `hash3`:

- **random mode:** offset `= (h(seed), h(seed+1), h(seed+2)) · amount`, each `h ∈ [-1, 1]`
  from `hash3` on the quantized position → a random offset per vertex.
- **normal mode:** offset `= normal · h(seed) · amount`, `h ∈ [-1, 1]` → random in/out along
  the surface normal. Computes vertex normals first if absent (like `applyNoise`).

Because it hashes raw per-vertex values (no smoothing/interpolation), neighbours are
uncorrelated → sharp facets. Contrast with `valueNoise`, which interpolates between lattice
points → smooth.

### Pipeline integration

- `hasModifiers`: add `|| m('jitter') !== 0`.
- `deforms` gate: add `|| jitter !== 0`. **This is what makes subdivision "just work"** — with
  `jitter` counted as a deform, the existing subdivide loop activates when jitter is on, no
  new subdivision code.
- Stage order becomes: `subdivide → taper → twist → bend → noise → jitter → cloner`.
  `applyJitter` runs on real CPU vertices; the existing post-deform `computeVertexNormals`
  then recomputes facet normals.

### Deeper subdivision

Raise `subdivide`'s `max` from **3 to 8** in `MODIFIER_SPECS`. No other change: the existing
`VERTEX_BUDGET` guard (300k ÷ clone count, checked before each iteration) already caps
runaway, so the higher ceiling only benefits low-poly bases (box, icosahedron) that have
headroom; dense bases (sphere) still stop at ~3–4 rounds on their own. Heavy rebuilds already
defer to pointer-release via the existing `deferGeometry` path.

## Panel

`Scene3DStudioSurface.vue` renders modifiers from `MODIFIER_GROUPS`. Add one entry:

```ts
{ label: 'Jitter', keys: ['jitter', 'jitterMode', 'jitterSeed'] },
```

The `subdivide` slider already reads its `min`/`max`/`step` from the spec, so the raised cap
needs no panel edit. No other UI changes — sliders and the mode segmented control render
generically.

## Files touched (Feature 2)

1. **`frontend/app/lib/scene3d/primParams.ts`** — three `jitter*` rows in `MODIFIER_SPECS`;
   change `subdivide.max` 3 → 8.
2. **`frontend/app/lib/scene3d/modifiers.ts`** — `applyJitter` helper; add `jitter` to
   `hasModifiers` and the `deforms` gate; call it after `noise` in `applyModifiers`.
3. **`frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`** — one `MODIFIER_GROUPS`
   entry.

## Testing (Feature 2)

- **Determinism:** same `(amount, mode, seed)` → identical positions; changing `seed`
  changes them.
- **Watertight:** two vertices at the same position receive the same offset (welded mesh
  stays closed).
- **Normal mode:** produces no NaN/Inf; computes vertex normals when absent.
- **Gate:** `hasModifiers` and `deforms` become true when only `jitter` is set, and the
  subdivide loop runs (facet count increases) with jitter alone.
- **Budget:** `subdivide = 8` on a dense base still respects `VERTEX_BUDGET` (stops early,
  no freeze).

---

## Persistence & compatibility

`cornerRadius`/`cornerSides` are plain numbers stored in the primitive's `params` bag, and
`jitter`/`jitterMode`/`jitterSeed` are plain numbers in the `modifiers` bag — the same shapes
`sanitizeParams` / `sanitizeModifiers` already round-trip. Scenes saved before this change
simply lack the keys → `resolveParam` returns each default (`0`) → identical geometry. The
raised `subdivide.max` only widens the clamp range, so any previously stored value stays
valid. No migration needed.
