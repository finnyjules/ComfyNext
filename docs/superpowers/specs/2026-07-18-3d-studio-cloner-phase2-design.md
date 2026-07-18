# 3D Studio — Cloner phase 2: grid mode and step transforms

**Date:** 2026-07-18
**Status:** approved ("yes please" to grid mode + per-clone step transforms)
**Scope:** a third clone mode (grid) and transforms that accumulate across
copies (step rotation, step scale), plus a copy/vertex readout so the cost of a
big clone set is visible before it bites. Frontend-only.

## Why

The Cloner became its own section so it could grow. Grid and step transforms are
the two additions that change what it can produce: grid gives floor/wall arrays,
and step transforms give the spiral staircase, the fanned deck of cards and the
shrinking tower — the arrangements that make a cloner feel like MoGraph rather
than a duplicate button.

## Decisions

| Decision | Rationale |
|---|---|
| `cloneMode` **appends** `'grid'` at index 2 | Option order is a persistence contract (the stored value is the index). Appending keeps every saved `linear`/`radial` scene correct; inserting would silently remap them. |
| Grid gets its own `cloneSpacingX/Y/Z` rather than reusing `cloneOffsetX/Y/Z` | The linear offsets default to `(1.2, 0, 0)`, so reusing them would place a grid with zero spacing on Y and Z — every copy stacked. Separate keys also match the different meanings: an offset is a per-copy vector, a spacing is a per-axis pitch. |
| Step transforms apply in **every** mode | The interesting arrangements come from combining them: step rotation on a radial ring makes a fan, on a linear run makes a helix, on a grid makes a rippling field. |
| Step scale is **geometric** (`scale^i`), step rotation is **linear** (`step·i`) | Matches how these read: a repeated rotation accumulates evenly, while a repeated scale that added would go negative. Geometric scale gives the natural tapering-tower look and can never invert. |
| Counts capped at 5 per grid axis (125 copies) and the cost is **shown, not clamped** | Consistent with the vertex-budget correction already made: detail and counts are user-visible slider values, so silently reducing them would make the readout lie. Instead the panel shows the copy and vertex totals so an expensive combination is visible while dragging. |
| No per-clone colour or material variation | Clones are merged into one mesh with one material — the invariant the gizmo, passes, facet variant and gradient bbox all rely on. Per-clone material needs a different model (instancing or child meshes) and is out of scope. |

## Model — new `MODIFIER_SPECS` entries

`cloneMode` becomes `options: ['linear', 'radial', 'grid']`, `max: 2`. Its hint
becomes "Repeat in a line, around a circle, or across a grid".

Appended after the existing clone keys:

| key | control | range | default | label — hint |
|---|---|---|---|---|
| `cloneCountX` | slider | 1–5, step 1 | 3 | Columns — "How many copies across X" |
| `cloneCountY` | slider | 1–5, step 1 | 1 | Rows — "How many copies up Y" |
| `cloneCountZ` | slider | 1–5, step 1 | 3 | Layers — "How many copies deep in Z" |
| `cloneSpacingX` | slider | 0–4, step 0.05 | 1.2 | Spacing X — "Gap between grid columns" |
| `cloneSpacingY` | slider | 0–4, step 0.05 | 1.2 | Spacing Y — "Gap between grid rows" |
| `cloneSpacingZ` | slider | 0–4, step 0.05 | 1.2 | Spacing Z — "Gap between grid layers" |
| `cloneStepRotX` | slider | -180–180, step 1 | 0 | Step rotate X — "Extra X rotation added to each successive copy" |
| `cloneStepRotY` | slider | -180–180, step 1 | 0 | Step rotate Y — "Extra Y rotation added to each successive copy" |
| `cloneStepRotZ` | slider | -180–180, step 1 | 0 | Step rotate Z — "Extra Z rotation added to each successive copy" |
| `cloneStepScale` | slider | 0.5–1.5, step 0.01 | 1 | Step scale — "Each copy is scaled by this much again — below 1 shrinks away, above 1 grows" |

Grid defaults are deliberately non-identity (3 × 1 × 3 with 1.2 spacing) so
choosing grid mode immediately shows a floor grid. That is safe because grid
defaults only take effect once the mode is grid, and the default mode is linear.

## Pipeline — `modifiers.ts`

```ts
/** Total copies the cloner will produce for these settings. */
export function totalClones(modifiers: Record<string, number> | undefined): number
```
Linear and radial return `cloneCount`; grid returns `countX · countY · countZ`.
`hasModifiers` uses it: the cloner is active when `totalClones > 1`, which makes
grid mode activate correctly without touching `cloneCount`.

`applyCloner` takes the mode and produces, for copy index `i`, the matrix

```
M(i) = place(i) · rotationStep(i) · scaleStep(i)
```

- `scaleStep(i)` = uniform `cloneStepScale ^ i`
- `rotationStep(i)` = Euler `(stepRotX·i, stepRotY·i, stepRotZ·i)` in degrees
- `place(i)`:
  - **linear** — translate by `offset · i` (unchanged)
  - **radial** — the existing ring transform (translate out by radius, rotate
    about `cloneAxis` by `i/count · 2π`), unchanged
  - **grid** — index `i` decomposes to `(ix, iy, iz)` and translates by
    `((ix − (countX−1)/2) · spacingX, …)`, so the grid is **centred on the
    object's origin** rather than growing away from it in one direction

Centring the grid is a deliberate difference from linear mode, which keeps its
existing corner-anchored behaviour so old scenes are unchanged.

## UI — the Cloner section

The mode-dependent key list gains a third branch:

- **linear** — Count, Mode, Offset X/Y/Z
- **radial** — Count, Mode, Radius, Around
- **grid** — Mode, Columns, Rows, Layers, Spacing X/Y/Z (no Count — the three
  axis counts replace it)

Below the mode-specific controls, in every mode, a **Step** block: Step rotate
X/Y/Z and Step scale.

At the bottom of the section, a small read-only line showing the totals, e.g.
`27 copies · ~331k verts`, muted by default and amber past 500 000 vertices. The
vertex figure is `baseVertexCount · totalClones`, taken from the same geometry
the Size row already measures, so it costs nothing extra to compute.

## Error handling

Nothing new. All values are clamped numeric params; a count of 1 in every axis is
a no-op; `cloneStepScale` cannot reach 0 (its floor is 0.5), so copies never
collapse to a degenerate size.

## Testing

- **Unit (specs):** the new keys exist with the documented ranges; `cloneMode`
  has exactly three options with `grid` at index 2 and `max: 2`; existing
  linear/radial index values still resolve to the same labels.
- **Unit (pipeline):** `totalClones` for each mode; `hasModifiers` true for a
  grid with counts > 1 and false when every count is 1; grid produces
  `countX·countY·countZ` copies, is centred on the origin, and spans
  `(count−1)·spacing` plus the object on each axis; step rotation makes copy `i`
  rotated `i ×` the step (checked against a known vertex); step scale is
  geometric, so copy 2 is `scale²`; step transforms compose with all three
  modes; a step scale of 1 and zero step rotation reproduce the phase-1 output
  exactly (back-compat).
- **Browser (real interactions):** grid mode produces a centred grid and the
  three count sliders each add a dimension; step rotation on a linear run makes
  a helix and on a radial ring makes a fan; step scale shrinks copies along the
  run; the readout matches the visible copy count and updates live; save/reopen
  restores; a phase-1 scene (linear or radial, no step values) is visually
  unchanged; Export bake shows the full clone set.
- **Gates:** scene3d vitest green; `vue-tsc --noEmit | grep -i scene3d` clean.

## Out of scope

Per-clone colour/material variation, effectors (falloff-driven modulation),
cloning onto another object's vertices or along a spline, randomised
per-clone jitter with a seed, and any clone count large enough to need
instancing.
