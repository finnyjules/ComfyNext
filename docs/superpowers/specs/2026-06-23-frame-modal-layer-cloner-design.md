# Frame Modal — Layer Cloner

**Date:** 2026-06-23
**Status:** Approved (review gate waived by user — implement directly)

## Goal

When a layer is selected in the Frame modal (`CompositorModal.vue`), offer a
**linked, non-destructive cloner** that repeats the layer in one direction, both
directions (grid), or around a circle — with optional per-clone falloff
(rotation, scale, opacity). Works on **both** wired layers (images from connected
nodes, composited server-side) and local layers (text/shapes/images/paths,
baked client-side).

"Linked" = the layer stays a single selectable object; the renderer stamps it N
times. Clones do **not** count against the 16-layer cap. Editing the original
updates every clone live.

## Data model

One cloner config, stored two ways:

```ts
interface Cloner {
  enabled: boolean
  mode: 'linear' | 'radial'
  // linear / grid
  countX: number; countY: number          // ≥1 each; both 1 = no clones
  spacingX: number; spacingY: number       // canvas-fraction (same units as layer x/y)
  // radial
  count: number                            // ≥1
  radius: number                           // canvas-WIDTH fraction
  startAngle: number; sweepAngle: number   // degrees; 360 sweep = full ring, no overlap
  faceCenter: boolean                      // rotate each clone to point outward
  // falloff (cumulative per clone index k)
  stepRotation: number                     // +deg per clone
  stepScale: number                        // × per clone (1 = none)
  stepOpacity: number                      // × per clone (1 = none)
}
```

- **Wired layers:** packed as one JSON string widget `layer{i}_cloner` (optional,
  default `""`), appended last in `define_schema` so existing widget positions
  don't shift — mirrors the existing `motion_params` pattern.
- **Local layers:** a `cloner?: Cloner` property on `LayerCommon`, persisted with
  `localLayers` like every other layer field.

## Shared expansion — single source of truth, mirrored TS ↔ Python

`expandClones(cloner, aspect) → CloneTransform[]` — pure, no rendering.

```ts
interface CloneTransform { dx: number; dy: number; drot: number; dscale: number; dopacity: number }
```

- `aspect = W / H` (used only by radial so the ring is circular on screen, since
  x maps to W and y maps to H).
- **linear:** walk `countY × countX`; clone index `k = iy*countX + ix`;
  `dx = ix*spacingX`, `dy = iy*spacingY`.
- **radial:** walk `count`; angle `θ = startAngle + sweepAngle·(i/denom)` where
  `denom = count` for a full 360° ring else `count-1`; `dx = radius·cosθ`,
  `dy = radius·aspect·sinθ`; `faceCenter` adds θ to the clone's rotation.
- **falloff** accumulates by index `k`: `drot = k·stepRotation`,
  `dscale = stepScale^k`, `dopacity = stepOpacity^k`. Index 0 = the original
  (identity: `{0,0,0,1,1}`).
- **draw order:** returned **back-to-front** (highest k first, original last) so
  the full-opacity original lands on top and falloff reads as a trail behind it.

Disabled/absent cloner ⇒ returns a single identity transform ⇒ today's behavior
exactly.

The caller applies each transform as: `x+dx`, `y+dy`, `rotation+drot`,
`scale·dscale`, `opacity·dopacity`.

## Rendering

Both client and server already loop per layer, so we inject the expansion at the
existing chokepoints:

- **Client — local:** loop inside `paintLayer` (the universal local chokepoint:
  fast path, effects path, masked path all reach it). Falloff rotation/scale are
  applied about the layer's own center (where `paintLayer` already translates).
  Because `bakeOverlay` renders through `paintLayer`, clones appear in the final
  generated output for free. (The Kinetic-Slates motion painter is a separate
  path; cloner + per-layer motion don't compose for now — documented limitation.)
- **Client — wired:** loop inside `drawWiredImageLayer` (shared by modal + Frame
  node previews). Add `cloner?` to `WiredTransform`.
- **Server — wired:** add `_expand_clones(layer, aspect)` in
  `nodes_compositor.py`; in the gather loop expand each wired layer into N
  composite entries (offset x/y, stepped rot/scl/op, same z/blend/mask), inserted
  back-to-front. `_composite_layers` and `_protect_coverage` then work unchanged.

Because clone offsets are added to `x`/`y` on both sides identically, and the
existing x/y→pixel mapping already matches between client and server, clone
geometry stays in lock-step automatically.

## UI

A collapsible **Cloner** section in the selected-layer inspector (right panel),
following the existing control primitives:

- Enable toggle.
- Mode segmented control: **Linear** / **Radial**.
- Linear: Count X, Count Y, Spacing X, Spacing Y.
- Radial: Count, Radius, Start angle, Sweep, Face center toggle.
- Falloff group (shared): Rotation step, Scale step, Opacity step.

Live as you drag. The selection box and transform handles stay on the original;
moving/scaling/rotating the layer moves the whole array.

## Persistence & testing

- Wired persists via the graph widget; local persists with `localLayers`;
  motion-bake picks up clones client-side automatically.
- **TS unit test** (`tests/unit/cloner.unit.spec.ts`): linear/grid/radial counts,
  falloff accumulation, draw order, disabled = identity, full-ring no-overlap.
- **Python parity test**: `_expand_clones` produces the same offsets as the TS
  golden values.
- **Screenshot verification** of the look in the running app before sign-off
  (standing rule: never ship a visual change on unit tests alone).

## Out of scope (YAGNI)

- Per-clone independent editing (that's the "bake to copies" path we rejected).
- Cloner composing with per-layer Kinetic-Slates motion.
- 3D / depth cloners, effector falloff fields.
