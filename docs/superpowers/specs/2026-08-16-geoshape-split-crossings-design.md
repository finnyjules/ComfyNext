# Shape Studio Pieces — "Split crossings" mode

**Date:** 2026-08-16
**Status:** Approved (design agreed in dialogue + side-by-side preview), ready for plan

## Plain-language summary

Pieces mode splits a mark into solo areas + overlap regions. Today every overlap
of the same depth is ONE merged piece (all 2-shape crossings are a single depth-2
piece → a single colour, no matter the colour order). This adds a **Crossings**
choice inside Pieces mode:

- **Depth** (today, default) — overlaps merged by depth; each depth level is one
  colour. Clean overprint; "2-deep is always colour 2."
- **Split** — each individual crossing becomes its OWN piece, and the crossings
  flow through the palette by the chosen colour order (Rows / Around / …) alongside
  the shapes. Adjacent crossings get different colours instead of all being the same.

Verified as a side-by-side preview: a 7-hexagon ring's single red depth-2 band
(Depth) becomes 7 separately-coloured crossings (Split).

## Design

### A. Config (`lib/geoshape/config.ts`)

- `crossingMode: 'depth' | 'split'` — default `'depth'` (preserves today's look).
  Add `CROSSING_MODES` enum list; validate via `oneOf`. Only meaningful when
  `fillStrategy === 'pieces'`; ignored otherwise. `GeoCrossingMode` type export.

### B. Composite (`lib/geoshape/boolean.ts`, the `pieces` branch)

Solo pieces (per clone, depth 1) and the nested-`atLeast` → exact-depth bands are
computed exactly as today (the disjoint-partition fix stays). Then:

- **`crossingMode === 'depth'`** (unchanged): overlaps = the merged depth bands, one
  `Piece` per depth `d ≥ 2`. Colour as today:
  - `overlapSeparate === false` → `fills[(d-1) % fills.length]`
  - `overlapSeparate === true` → `overlapFills[(d-2) % overlapFills.length]`

- **`crossingMode === 'split'`**: split each exact-depth band into its CONNECTED
  FACES (see §C) — one `Piece` per crossing, carrying its `depth` and centroid.
  Colour:
  - `overlapSeparate === false` — treat solo + crossings as ONE piece set drawn from
    `fills`:
    - `fillOrder` spatial (`leftRight|topBottom|rows|columns|centerOut|around`):
      `rankOrder` over ALL pieces' centroids → `fills[rank % len]` (the crossings
      flow with the shapes — the Split preview).
    - `fillOrder === 'depth'`: colour by depth — solo → `fills[0]`, crossing depth d
      → `fills[(d-1) % len]` (matches Depth mode, but per-face).
    - `fillOrder === 'created'`: solo by clone rank; crossings by depth
      (`fills[(d-1) % len]`) — crossings have no creation index.
  - `overlapSeparate === true` — solo from `fills` (ranked by `fillOrder`), crossings
    from `overlapFills`:
    - `fillOrder` spatial: `rankOrder` over CROSSING centroids → `overlapFills[rank % ovlen]`.
    - `fillOrder` `depth`/`created`: `overlapFills[(d-2) % ovlen]`.

Pieces stay a disjoint partition in BOTH modes (splitting a band into faces does not
change the covered area). The `PIECES_MAX_CLONES` cap and clip-mask step are unchanged.

### C. Face split (`splitFaces`, in `boolean.ts`)

`splitFaces(band): paper.PathItem[]` — split one exact-depth band (a `Path` or
`CompoundPath`, possibly containing HOLES where a deeper region was subtracted out)
into connected faces, each an outer contour WITH its holes re-attached (so the
partition and disjointness hold — a hole belongs to the deeper piece, not this one):

1. A plain `Path` (no children) → `[band]`.
2. A `CompoundPath`: for each child contour classify outer vs hole by containment —
   a child is a HOLE if its interior point lies inside an ODD number of sibling
   contours (for crossings this is one level: hole ⇔ inside exactly one sibling).
   Outers → inside 0 siblings.
3. Each outer becomes a face: a `CompoundPath` of the cloned outer + every hole whose
   interior point is inside that outer; `fillRule` copied from the band. Centroid =
   the outer's bounds centre.

Nested holes-in-holes are out of scope (rare for crossings); document it.

### D. Controls + UI

- `controls.ts`: add a `crossingMode` **select** (`Crossings`, options
  `depth`/`split`), gated `when: isPieces`. Extend `GEO_GUIDANCE` with one sentence
  (real key only). No drift-guard exclusion (it has a control).
- `ShapeStudioSurface.vue`: no bespoke UI — a plain select renders generically from
  GEO_CONTROLS (like `fillOrder`). Only the helper text under the fills list may note
  the two modes if useful.

### E. Testing

- **Config:** `crossingMode` round-trips; junk → `'depth'`; absent → `'depth'`.
- **splitFaces:** a band of N disjoint lenses → N faces; a band with a HOLE (a
  depth-2 ring around a depth-3 island) → ONE face that still contains the hole
  (assert the face does NOT cover the hole's interior point, i.e. the hole survived).
- **Composite split:** a config whose depth-2 band has ≥3 separate crossings →
  `crossingMode:'split'` returns MORE pieces than `'depth'`, and (spatial order) the
  crossings carry ≥2 distinct paints where depth mode gives them 1. Partition still
  exact (sum piece areas ≈ union area) in split mode. Depth mode output unchanged
  (regression).
- **Controls:** `crossingMode` visible only for pieces; has a control (drift guard).
- **Live proof:** the 7-hexagon ring — Depth → one red crossing band; Split →
  crossings vary by Rows/Around; pixel-check the crossings carry ≥2 hues in split and
  1 in depth. Verify with a broken control (revert the split branch → preview reverts
  to the single-colour band).

## Risks / watch-items

- **Hole re-attachment** is the crux — a naive child-per-face split turns a hole into
  a spurious filled piece that overlaps the deeper piece (re-breaking the partition).
  Test the holed-crossing case explicitly.
- Paper winding/`area` sign conventions: classify outer vs hole by CONTAINMENT
  (point-in-sibling), not by area sign, to stay convention-independent.
- Split mode is per-face `contains` work (O(children²) within a band) — bounded by
  the existing `PIECES_MAX_CLONES` cap; typical bands have few faces.
