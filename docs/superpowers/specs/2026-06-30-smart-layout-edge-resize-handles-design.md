# Smart Layout — Single-Axis Edge Resize Handles

**Date:** 2026-06-30
**Status:** Design — approved, implementing

## Goal

Let users resize a Smart Layout element's width or height independently by dragging a single edge — not only its corners. Today the editor renders only 4 corner handles, so every drag moves both axes at once, which feels like a locked aspect ratio.

There is **no actual ratio lock** in the code: `resizeRegion` (shared/template-grid/editor.ts) already changes columns and rows independently. The gap is purely UI (no edge handles) plus one logic fix so an edge handle touches only its own axis.

## Scope

- **All element types** (text, shape, image) get the Figma-standard 8 handles: 4 existing corners + 4 new edges.
- v3 Stack/section boxes are **out of scope** (keep their current corner-only handles). `resizeRegion` is shared, but section markup only emits corner dirs, so sections are unaffected.

## Changes

### 1. `resizeRegion` (shared/template-grid/editor.ts)
- Extend the `dir` param type from `'nw'|'ne'|'sw'|'se'` to also accept `'n'|'s'|'e'|'w'`.
- Horizontal axis: change columns **only if** `dir.includes('e')` (grow east) or `dir.includes('w')` (move/grow west). If neither (pure `'n'`/`'s'`), leave `col`/`colSpan` unchanged.
- Vertical axis: change rows **only if** `dir.includes('s')` or `dir.includes('n')`. If neither (pure `'e'`/`'w'`), leave `row`/`rowSpan` unchanged.
- Corners (`nw`/`ne`/`sw`/`se`) behave exactly as before. Existing clamping (`Math.max`/`min` against grid bounds) is retained.

### 2. Canvas markup (app/components/templates/GridEditorCanvas.vue)
- Widen the local `HandleDir` type to include the four edges.
- Render 8 handles for a selected, unlocked element: the existing 4 corners plus 4 edge handles positioned at the mid-points of each edge.
- Cursors: `ew-resize` for `e`/`w`, `ns-resize` for `n`/`s` (corners keep `nwse`/`nesw`).
- The existing `onHandlePointerDown/Move/Up` flow is unchanged — it already forwards `dir` to `resizeRegion`.

### 3. Tests (shared/template-grid/editor unit spec)
- `e` grows only `colSpan`; `w` moves/grows only `col`+`colSpan`; `n`/`s` change only rows; each leaves the other axis identical to the start region.
- Regression: the four corner dirs still change both axes as before.

## Non-goals
Section/stack box edge resize; aspect-lock toggles; free-pixel (off-grid) resize. Resize stays cell-snapped exactly as today.

## Verification
Unit tests for `resizeRegion` edge cases; in-app visual check that dragging an image's edge changes one dimension while the other holds.
