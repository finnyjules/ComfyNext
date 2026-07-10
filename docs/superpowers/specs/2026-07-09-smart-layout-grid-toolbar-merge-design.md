# Smart Layout — merged grid toolbar + canvas-subdivision grid

**Date:** 2026-07-09
**Surface:** Smart Layout editor modal (`SmartLayoutEditorModal` → `GridEditorShell` → `GridEditorCanvas`)
**Harness:** `/dev/sl-modal`

## Problem

The v2/v3 grid editor's bottom toolbar exposes three separate grid-related
controls that all describe the same underlying grid:

- **Grid** — toggles the fine placement lattice (`fineGridOn`)
- **Columns** — toggles the column/section guides (`columnGuidesOn`)
- **Settings** — a popover with cols / rows / gutter / margin

They read as unrelated buttons even though "Columns" (a toggle) and "Settings"
(the cols/rows count that *defines* those columns) are the same concept split
apart. And there is no way to toggle **row** guides independently — the column
guide flag draws both the vertical column bands and the horizontal row lines
together (`GridEditorCanvas.vue` `gridCells.cols` + `gridCells.rowLines`).

## Goal

Collapse the three controls into **one Figma-style "Grid" control**, and while
we're in there, make the fine grid a **canvas subdivision** so free placement
converts cleanly across ad formats.

## Part 1 — Merged Grid popover (toolbar UI)

Replace the three toolbar buttons with **one `Grid` button** (icon `Grid2x2`),
highlighted whenever any overlay is visible. Clicking opens a single popover
(same bottom-anchored popover chrome as Background / Brand today):

### Overlays — three eye-toggle rows (Figma "Layout grid" idiom)

Each row: an eye icon (visibility), a small type glyph, a label, and the row's
unit inline on the right. Clicking the row toggles visibility (eye fills/empties,
row dims when off).

| Row       | Toggle flag        | Inline unit                    |
| --------- | ------------------ | ------------------------------ |
| Columns   | `columnGuidesOn`   | column count (per format)      |
| Rows      | `rowGuidesOn` *(new)* | row count (per format)      |
| Grid      | `fineGridOn`       | canvas subdivision count (Part 2) |

### Spacing — shared section (unchanged)

`Gutter` / `Margin` master-px inputs + the live "gutter · margin · cell" readout.
The old "Dimensions" block folds into the Columns/Rows rows above.

### Behavior

- **Rows becomes independently toggleable.** New persisted setting
  `ComfyNext.SmartLayout.RowGuides`, default **on** (nothing disappears vs.
  today). Wired through the same `comfynext:setting-changed` event path the
  other two toggles use, so shell toolbar and canvas stay in sync without prop
  plumbing.
- In `GridEditorCanvas.vue`, gate `gridCells.rowLines` behind `rowGuidesOn` and
  keep `gridCells.cols` under `columnGuidesOn` (today they share one flag).
- Defaults preserved: Columns on, Rows on, Grid on.

## Part 2 — Grid as a fixed canvas subdivision

### Why

Placement is stored as grid **cells** (`Region { col, colSpan, row, rowSpan }`),
not pixels, so it is already resolution-independent. The v3 fine grid is
"baseline-derived": one fine unit ≈ `grid.baseline` master px, and each format
derives its own fine cell count via `fineGridDims()`. `reScaleRegion()` reflows a
region between formats proportionally (`sc = to.cols / from.cols`).

Exposing the fine grid as an **absolute px size** (the first mockup's framing)
is the wrong unit for cross-format work: 8px is a different proportion on a
1080px vs a 1920px canvas. A **canvas subdivision count** is the right unit — and
if that count is **fixed across every format**, `from.cols === to.cols`, so
`reScaleRegion` becomes an **identity** map: an element at unit `6/24` sits at
25% in a square, portrait, or landscape alike. Zero drift.

### Change

- The Grid row's unit is a **subdivision count `N`** (e.g. 24), applied to every
  format on both axes. Internally, force the fine grid dims to a constant `N×N`
  per format (via `fineGridDims` / the format's fine cols·rows) rather than
  `round(canvas / baseline)`. `baseline` is then derived from `N` for legacy
  reads: `baseline = masterDimension / N`.
- Free placement snaps to this `N×N` lattice (drag/resize already snap to grid
  cells via `editor.ts` + `metrics`; the metrics now come from the fixed count).
- **Trade-off (accepted):** on a non-square canvas the lattice cells are not
  square (N across an unequal width vs. height). This is cosmetic for a
  placement guide and is the price of identity reflow.

### Migration

Existing templates carry a `grid.baseline` (master px). On load, convert to a
starting subdivision count `N = round(masterDimension / baseline)` clamped to a
sane range (e.g. 4–96), defaulting to a sensible value (e.g. 24) when absent.
Templates never re-saved keep working because `baseline` is still written back,
derived from `N`.

## Out of scope

- Per-axis independent subdivision counts (Nx ≠ Ny). Single `N` for both axes.
- Per-grid color pickers (Figma has them; not needed here).
- Any change to Background / Brand / Long copy / Text·Image·Shape·Stack / zoom.

## Files

- `frontend/app/components/templates/GridEditorShell.vue` — replace 3 buttons
  with 1 Grid button + combined popover; add `rowGuidesOn` + subdivision-count
  state and handlers.
- `frontend/app/components/templates/GridEditorCanvas.vue` — split `rowLines`
  behind `rowGuidesOn`; consume the `RowGuides` setting via the setting-changed
  event.
- `frontend/shared/template-grid/grid.ts` — `fineGridDims` honors a fixed
  subdivision count; baseline↔count conversion helpers.
- Migration touch wherever the template is first read into the editor
  (`useGridEditor` composable).

## Verification

Drive `/dev/sl-modal`: open the Grid popover, toggle each overlay independently,
confirm the canvas overlays match, change the subdivision count and confirm the
lattice re-densifies, switch formats and confirm a placed element holds its
proportional position. Screenshot each state for sign-off.
