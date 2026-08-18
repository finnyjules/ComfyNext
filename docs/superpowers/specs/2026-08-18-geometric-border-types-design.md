# Geometric Border Types — Design Spec

**Date:** 2026-08-18
**Status:** Approved, ready for implementation plan
**Builds on:** docs/superpowers/specs/2026-08-17-torn-paper-edge-design.md (shipped) — see `frontend/app/lib/compositor/tornEdge.ts`

## Plain-language summary

The Compositor already gives a layer a "torn paper" edge. This adds **geometric
border types** to the same feature: scalloped, zigzag/pinking, wavy, and
dots/perforated. Unlike the torn edge (irregular, organic), these are regular,
crisp patterns that repeat evenly around the edge. They are **inscribed inside
the layer**: the bumps/teeth/crests reach out to the original layer edge and the
valleys between them cut inward — so the effect only ever *removes* material and
never invents pixels outside the layer. They work on any shape (image cut-out,
ellipse, vector), with the pattern following the contour and closing seamlessly.

## Overview

Generalize the shipped per-layer edge effect from "torn paper" into a unified
**edge treatment** with two families sharing one field, one render entry point,
one panel, and one agent command:

- **Organic family** (`ripped`, `deckle`, `shredded`) — as shipped: 2D-noise
  boundary displacement + optional grain dissolve + optional lip. Works on any
  alpha because it needs no position-along-edge.
- **Geometric family** (`scalloped`, `zigzag`, `wavy`, `dots`) — NEW: a regular
  periodic profile driven by **arc-length along the contour**, crisp (no grain),
  **inscribed** (peaks at the original edge, valleys cut in by `depth`),
  removes-material-only. No grain, no lip.

The internal names stay `layer.tornEdge` / `TornEdgeSpec` / `setLayerTornEdge`
(zero migration for the just-shipped field). Only the discriminator widens and
one field is added. User-facing label is "Edge". (See **Naming** below.)

## Data model (extend, don't rename)

Extend the shipped `TornEdgeSpec` in `frontend/app/lib/compositor/tornEdge.ts`:

```ts
export type TornEdgeStyle =
  | 'ripped' | 'deckle' | 'shredded'          // organic (shipped)
  | 'scalloped' | 'zigzag' | 'wavy' | 'dots'  // geometric (new)

export interface TornEdgeSpec {
  style: TornEdgeStyle
  amount: number        // organic: tear depth. (unused by geometric)
  roughness: number     // organic only
  grain: number         // organic only
  grainTexture: number  // organic only
  lipWidth: number      // organic only
  lipVariation: number  // organic only
  lipColor: string      // organic only
  seed: number          // organic only (geometric is deterministic w/o seed)
  size: number          // NEW — geometric period (px between repeats). organic ignores.
  depth: number         // NEW — geometric valley depth (px cut inward). organic ignores.
}
```

Add `GEOMETRIC_STYLES: readonly TornEdgeStyle[] = ['scalloped','zigzag','wavy','dots']`
and a helper `isGeometricEdge(style)`. `sanitizeTornEdge` clamps the new fields
(`size` 6..200, `depth` 1..120) and still defaults everything.

`DEFAULT_TORN_EDGE` unchanged (style `shredded`); a separate
`DEFAULT_GEOMETRIC_EDGE` (or defaults applied when switching type in the UI)
supplies sensible `size: 40, depth: 18` for geometric.

**Control relevance:** which fields matter depends on family. The panel and the
agent hint must gate accordingly (organic → roughness/grain/grainTexture/lip*;
geometric → size/depth). Follow the existing studio control-relevance gating
pattern; do not show torn controls for a geometric type or vice versa.

## The new machinery: arc-length along the contour

The organic pass samples 2D noise and needs no perimeter coordinate. The
geometric pass needs, for each near-edge pixel, the **arc-length position of its
nearest boundary point** so the periodic profile repeats evenly and follows the
shape. Computed only when `isGeometricEdge(style)` — the organic fast path is
untouched.

Steps (inside `applyTornEdgeToData`, geometric branch), reusing the existing
alpha scan + bbox:

1. **Trace contours.** From the binary alpha mask, extract ordered boundary
   pixel loops (Moore-neighbor boundary tracing / marching-squares). Each loop
   is one contour; a shape may have several (disconnected regions, holes) — each
   is parameterized independently so its pattern closes on itself.
2. **Arc-length per contour.** Walk each loop accumulating Euclidean step length
   into `sArc` per boundary pixel; record the contour's total `perim`.
3. **Seamless count-snap.** Per contour: `count = max(3, round(perim / size))`,
   `eff = perim / count`. Guarantees the pattern meets seamlessly (no broken
   repeat at a seam or corner).
4. **Feature transform.** Each inside pixel within the band needs its nearest
   boundary pixel. Extend the existing chamfer pass to propagate the nearest
   boundary pixel's index alongside distance (a standard feature/Voronoi
   transform), OR run a jump-flood. Then per pixel: nearest boundary pixel →
   its `(sArc, contourId)`.
5. **Profile + keep test.** With `u = frac(sArc / eff)` and `dEdge` = signed
   distance inside (from the existing distance transform):

   ```
   inset(u) =
     scalloped: depth * (1 - sqrt(max(0, 1 - (2u-1)^2)))   // round lobes reach edge
     zigzag:    depth * abs(2u - 1)                          // tooth tips reach edge
     wavy:      depth * (0.5 - 0.5*cos(2*pi*u))              // crests reach edge
   keep = dEdge > inset(u)     // crisp, no grain
   ```

   `inset = 0` at the peak (material kept to the original edge) and `= depth` at
   the valley (cut inward). Only removes material; never touches pixels outside
   the alpha.
6. **Dots / perforated** is a 2D variant: holes of radius `depth` centered on the
   boundary at each `k*eff` arc-length. Per near-edge pixel, from its nearest
   boundary point's `sArc` compute the nearest dot arc `round(sArc/eff)*eff`,
   fetch that contour point's coordinate, and remove the pixel if within `depth`.
   Check the ±1 neighboring dot indices to avoid seam misses.

Retina scale `s`: `size` and `depth` are px in the layer's rendered space, so
multiply by `s` for device pixels exactly as `amount`/`grain`/`lipWidth` already
do. Arc-length is measured in device pixels (the mask is device-sized), so the
count-snap stays consistent.

## Render integration

Same entry point — `applyTornEdge(off, spec, {scale})` in `paintLayer`, already
wired. Inside `applyTornEdgeToData`, branch:

- `isGeometricEdge(style)` → geometric pass (contour arc-length + inset keep
  test above). Crisp; ignores grain/lip.
- else → the shipped organic pass, unchanged (byte-identical for existing
  torn layers).

Shared, computed once: alpha scan, bbox, and the chamfer distance transform
(the feature-transform extension only runs in the geometric branch). Preview and
export parity is automatic (single `paintLayer` path), same as the torn edge.

## UI (extend the shipped panel)

`CompositorTornEdgePanel.vue` gains the four geometric options in the type
select and two controls (Size, Depth) shown only for geometric types; the
torn-only controls (Roughness, Grain, Grain texture, Lip width, Lip width var,
Lip color, reseed) hide for geometric types. Panel title stays "Edge". Switching
into a geometric type for the first time seeds `size`/`depth` defaults.

## Agent

Extend the shipped `setLayerTornEdge` command (do not add a second op):
- Widen the `style` vocabulary in the hint to the seven types, describing the
  geometric family as crisp/inscribed/cut-in and naming `size` + `depth`.
- `sanitizeTornEdge` already the clamp funnel — add `size`/`depth` clamps.
- `describeCompositor` reports the type and, for geometric, `size`/`depth`.
Phrase mapping: "scalloped edge" → scalloped; "pinked/zigzag edge" → zigzag;
"perforated / stamp edge" → dots; "wavy edge" → wavy.

## Naming

Internal identifiers stay `tornEdge` / `TornEdgeSpec` / `setLayerTornEdge` /
`style` to avoid a rename + migration of a field shipped the same week. This is
a deliberate trade: a mild internal misnomer (a `TornEdgeSpec` holding
`style: 'scalloped'`) in exchange for zero churn across render/persist/agent/UI
and no back-compat shim. User-facing copy says "Edge". A future rename to
`EdgeSpec`/`edge` is a clean, separate refactor if desired.

## Performance

Geometric adds, per geometric layer per render: one contour trace
(O(perimeter)) + the feature-transform extension over the band (same order as
the existing distance transform, both bbox-bounded). Organic layers are
unaffected. Same caching follow-up applies (memoize the mask keyed on
spec + alpha + size) and remains optional for v1.

## Scope boundaries (YAGNI)

- Geometric = **cut-material-only, inscribed within the layer**. No outward
  painting, no border-fill color, no invented pixels.
- Geometric = **no grain, no lip** (kept separate from the torn family, per
  decision).
- Per-layer only; no motion (seed/animation unchanged from torn).
- Four geometric types only (scalloped/zigzag/wavy/dots).

## Open implementation questions

1. **Feature transform method.** Recommend extending the existing chamfer to
   carry the nearest-boundary pixel index (cheap, reuses the two passes) over a
   separate jump-flood. Plan should pick one.
2. **Multiple contours / holes.** Trace and arc-length every boundary loop;
   apply the pattern to all (inner holes get the treatment too). If a shape's
   alpha is noisy (anti-aliased speckle) the trace may find spurious tiny
   contours — threshold alpha and ignore contours below a minimum length.
3. **Very small `size` vs anti-aliasing.** Clamp `size` so `count` stays
   sane relative to `perim`; sub-pixel repeats should degrade gracefully.

## Testing

- Unit: `sanitizeTornEdge` clamps `size`/`depth`; `isGeometricEdge` correct;
  `DEFAULT_GEOMETRIC_EDGE` round-trips.
- Unit: geometric `applyTornEdgeToData` on a synthetic filled square — assert
  interior opaque, valleys cut in (some near-edge pixels transparent at the
  right arc-length phase), peaks reach the edge, deterministic, and count-snap
  seamless (first and last repeat match). A transparent buffer is untouched.
- Unit: dots removes circular holes on the boundary at the expected spacing.
- Visual/manual: verify each type on a rectangle AND a non-rectangular alpha
  (cut-out image / ellipse) that spacing follows the contour and closes; verify
  preview == export; verify with a broken control (drag Size/Depth).
