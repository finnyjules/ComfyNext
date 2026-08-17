# Shape Studio — "Pieces" fill mode (overlap/overprint coloring)

**Date:** 2026-08-16
**Status:** Approved (design agreed in dialogue), ready for implementation plan

## Plain-language summary

Today Shape Studio has two ways to color a mark: **Single** (all clones fold into
one shape with negative-space *holes* where they overlap) and **Per clone** (each
clone is its own solid color, so overlapping clones just hide each other).

This adds a third way, **Pieces**: cut the mark into all its little pieces — every
*solo* area (where one shape sits) **and** every *overlap* area (where shapes
cross) becomes its own colored piece. Because the pieces are separate and don't
touch, every color always shows — nothing hides anything, and it never collapses
to one color the way stacked per-clone shapes do.

Two things the user can control per mark:

1. **Order the shape colors** — hand the shape colors out in a spatial order
   (made-order / left→right / top→bottom / center-out / around the circle) instead
   of the arbitrary creation order, so the palette flows across the mark.
2. **Color the overlaps** — either from the *same* one palette as the shapes (a
   switch OFF), or give overlaps their *own* separate palette (switch ON). Overlaps
   are colored by how deep they are: 2 shapes crossing = first overlap color, 3
   crossing = second, and so on.

Set fillOrder to "by depth" with the switch OFF and you get the classic
riso/overprint poster look (solo = color 1, 2-deep = color 2, 3-deep = color 3).

## Where this sits

`geoshape` pipeline: `arrange` → `composite` (paper.js) → `render`. All new work
is in `composite` (a new pieces branch) plus config + controls + surface UI. The
render layer already draws N paint-carrying `GeoVectorShape`s, so **no render code
changes** — pieces are just more paint-carrying shapes with `fillRule: 'nonzero'`.

## A. Config (`lib/geoshape/config.ts`)

Replace the boolean `perShapeFill` with a 3-way strategy, and add the order + overlap fields:

- `fillStrategy: 'single' | 'perClone' | 'pieces'` — default `'single'`.
- `fills: Paint[]` — **kept as-is** (the shape/base palette; used by perClone and pieces).
- `fillOrder: 'created' | 'depth' | 'leftRight' | 'topBottom' | 'centerOut' | 'around' | 'rows' | 'columns'`
  — default `'created'`. Governs the order colors are assigned (see §C). `rows` =
  reading order (top row, left→right, then next row down); `columns` = first column
  top→bottom, then next column right.
- `overlapSeparate: boolean` — default `false`. The switch: when `true`, overlap
  pieces use `overlapFills`; when `false`, everything draws from `fills`.
- `overlapFills: Paint[]` — default `['#ffffff']`. The **separate** overlap palette
  (pieces mode only). Distinct from the pre-existing `overlapFill` (a single Paint
  used by `overlapMode: 'shape'` in Single mode) — document the distinction in-file.

**Migration** in `mergeConfig` (old saved nodes have `perShapeFill`, not
`fillStrategy`): `fillStrategy = oneOf(o.fillStrategy, [...], derived)` where
`derived` = `'perClone'` if `o.perShapeFill === true`, else `'single'`.
`fillOrder` via `oneOf`; `overlapSeparate` via `bool`; `overlapFills` via the
existing `paintList` validator (guarantees non-empty, same as `fills`).

`Paint` stays a type-only import (reuse `PAINT_TYPES`/`paintOrNull`/`paintList`).

## B. Ranking helper (`lib/geoshape/arrange.ts` or a small new `order.ts`)

A pure function shared by perClone and pieces:

```
interface Ranked { cx: number; cy: number; i: number }   // centroid + original index
function rankOrder(items: Ranked[], order: FillOrder): number[]
```

Returns, for each input item, its **rank** (0-based position) under `order`:
- `created` → rank = original index `i`
- `leftRight` → sort by `cx` asc
- `topBottom` → sort by `cy` asc
- `centerOut` → sort by `hypot(cx, cy)` asc
- `around` → sort by `atan2(cy, cx)` asc
- `rows` → reading order: bucket `cy` into rows (quantize by a band = a fraction of
  the item spread, or the grid row height when `layout === 'grid'`), then sort by
  `(rowBand asc, cx asc)`
- `columns` → the transpose: bucket `cx` into columns, then sort by `(colBand asc, cy asc)`
- `depth` → not spatial; callers in pieces mode handle depth directly (for perClone,
  `depth` falls back to `created`).

Ties broken by original index (stable) so the result is deterministic. The row/column
band size is derived, not a user knob — the plan pins the exact quantum (grid uses
exact cell rows/cols; other layouts use a band ≈ median shape size).

## C. Composite — new `pieces` branch (`lib/geoshape/boolean.ts`)

Add a branch for `fillStrategy === 'pieces'`, parallel to the existing per-shape
branch, placed before the unified fold. Keep the existing `perShapeFill`→now-
`perClone` branch (renamed to trigger on `fillStrategy === 'perClone'`), and add
the ranking so perClone honors `fillOrder` (a free win).

**perClone** (updated): rank the clones by `fillOrder` over their placement
centroids (`pl.x, pl.y`); clone with rank `r` → `fills[r % fills.length]`. `depth`
order falls back to `created`. (Symmetry/clip unchanged from today's per-shape branch.)

**pieces** (new):

1. **Solo pieces** — for each clone `i`: `solo_i = clone_i − union(all other clones)`.
   Carries `{ centroid: (pl_i.x, pl_i.y), cloneIndex: i, depth: 1 }`. Drop empties
   (bounds ≤ 1e-6). Union-of-others is O(N) per clone → O(N²) total.
2. **Overlap depth bands** — exact-depth regions for depth `d ≥ 2`, via the
   incremental band algorithm:
   ```
   bands: PathItem[] = []            // bands[d-1] = exactly-depth-d region
   for (const c of clones) {
     const prevCovered = union(bands) // BEFORE mutating (may be null)
     for (let d = bands.length; d >= 1; d--) {
       const band = bands[d-1]; if (!band) continue
       const moved = band ∩ c
       if (nonEmpty(moved)) {
         bands[d-1] = band − c                             // stays at depth d
         bands[d]   = bands[d] ? bands[d] ∪ moved : moved  // promoted to depth d+1
       }
     }
     const fresh = prevCovered ? (c − prevCovered) : c.clone()
     bands[0] = bands[0] ? bands[0] ∪ fresh : fresh        // new depth-1 area
   }
   ```
   Use `bands[1..]` (depth ≥ 2). Each band carries `{ centroid: bounds.center,
   depth: d }`. (`bands[0]` is the solo *union* — discarded; step 1's per-clone
   solo pieces are used instead so spatial order can address each shape.)
3. **Coloring:**
   - **Solo pieces:** rank by `fillOrder` (§B) → `fills[rank % fills.length]`.
     (`depth` order → all solo are depth-1 → all `fills[0]`.)
   - **Overlap bands (depth d):**
     - `overlapSeparate === false` → `fills[(d - 1) % fills.length]`
       (depth2→fills[1], depth3→fills[2] … → the overprint ramp; with
       `fillOrder: 'depth'` this makes the whole mark pure option A).
     - `overlapSeparate === true` → `overlapFills[(d - 2) % overlapFills.length]`
       (depth2→overlapFills[0], depth3→overlapFills[1] …).
4. Every piece → `GeoVectorShape { commands, paint, fill: solidOf(paint), stroke,
   strokeWidth, fillRule: 'nonzero' }`. Pieces are disjoint → draw order irrelevant.

Paper scope discipline unchanged (`sc.project.clear()` in `finally`). Clip mask, if
set, intersects every piece (same as the per-shape branch). Symmetry in pieces mode:
mirror the clones **before** splitting (append mirrored clones to the clone list) so
the split sees the full mirrored set — reuse the per-shape clone-level mirror.

**Performance guard:** solo pieces are O(N²) unions and bands are O(N × maxDepth).
Cheap for typical counts (≤ ~24). `count` is already clamped to 1..200; for pieces
mode add a soft cap (e.g. skip/So log if `count > 60`) so a 200-clone pieces mark
can't wedge the UI. Exact cap TBD in the plan; must `log`/note, never silently drop.

## D. UI (`ShapeStudioSurface.vue` + `controls.ts`)

- `controls.ts`:
  - Replace the `perShapeFill` switch control with a `fillStrategy` **select**
    (`Single` / `Per clone` / `Pieces`).
  - Add a `fillOrder` **select** (`Made order` / `By depth` / `Left → right` /
    `Top → bottom` / `Rows` / `Columns` / `Center out` / `Around`), visible when
    strategy ≠ single.
    (`By depth` is meaningful only for pieces; still selectable for perClone where
    it falls back to made-order.)
  - Add an `overlapSeparate` **switch**, visible only when strategy = pieces.
  - `fills` and `overlapFills` stay **excluded** from the GEO_CONTROLS drift guard
    (both edited by bespoke list editors). Update the drift-guard exclusion set +
    its comment.
  - Single-mode `fill`/`overlapFill` controls: gate `when` strategy = single (as
    the per-shape work already gated them off perShapeFill).
- `ShapeStudioSurface.vue` Paint section:
  - The `fillStrategy` select + (when ≠ single) the `fillOrder` select.
  - `fills` list editor: shown for perClone **and** pieces (reuse the existing
    editor built for per-shape).
  - When strategy = pieces: the `overlapSeparate` switch; when it's ON, a **second**
    fills-list editor bound to `overlapFills` (same component, same add/remove-≥1/
    drag/updateFill helpers, new setter target) with helper text "Overlap colors —
    by how many shapes cross (2, 3, …)."
  - Helper text under the shape list adapts: pieces mode → "Solo areas cycle these,
    in the chosen order."

## E. Testing

- **Config:** `fillStrategy` round-trip + migration (`{perShapeFill:true}` →
  `'perClone'`, absent → `'single'`, explicit `fillStrategy` wins); `fillOrder`
  round-trip + junk→default; `overlapSeparate` bool; `overlapFills` non-empty
  guarantee (reuse paintList arms).
- **Ranking (`rankOrder`):** each order returns the expected rank permutation on a
  hand-placed set (e.g. 3 points), ties broken by index; `depth`→identity.
- **Composite pieces:** with 3 overlapping clones + `overlapSeparate:false` +
  `fillOrder:'depth'` → solo pieces paint `fills[0]`, a depth-2 band paints
  `fills[1]`, a depth-3 band paints `fills[2]` (assert a band at each depth exists,
  paints as specified). With `overlapSeparate:true` → depth-2 band paints
  `overlapFills[0]`. With `fillOrder:'leftRight'` → solo pieces' paints follow x
  order. Pieces are disjoint (pairwise intersection area ≈ 0) — assert on a simple
  2-clone case. perClone honors `fillOrder` (rank permutation drives the cycle).
  Single + unified-fold path unchanged (regression).
- **Live render-proof:** in the studio, Pieces mode on the 3-diamond stack →
  pixel check finds solo/2-deep/3-deep as **distinct** hues (overprint); flip
  `overlapSeparate` on with a vivid overlap palette → the crossing regions change to
  the overlap colors while solo areas stay put; switch `fillOrder` to Around on a
  radial ring → solo hues sweep around. Verify with a broken control (revert one arm
  → proof fails), per house rule.

## Risks / watch-items

- **Naming collision:** new `overlapFills`/`overlapSeparate` vs pre-existing
  `overlapFill`/`overlapMode` (the Single-mode even-odd 'shape' overlap). Different
  features — must be documented in config.ts so a future reader doesn't conflate them.
- **Depth-band correctness** is the crux: `prevCovered` must be captured *before* the
  inner loop mutates `bands`; the `fresh` (new depth-1) add must use it. Test each
  depth explicitly on a known 3-clone overlap.
- **Disconnected bands:** a depth-d band may be several separate lenses; v1 treats a
  whole depth band as one colored group (colored by depth, not per-lens spatial
  order). Spatial ordering addresses the **solo** pieces (per clone); per-lens
  spatial ordering of intersections is a deliberate v2, not v1.
- **Migration:** existing per-shape unit tests reference `perShapeFill` — they move
  to `fillStrategy`. The migration arm must keep old saved marks rendering.
- **Perf:** O(N²) solo unions; guard large counts with a logged cap.
