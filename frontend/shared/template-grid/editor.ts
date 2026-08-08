/** Editor interaction math: pointer/drag/resize snapping against the grid.
 * Lives next to the resolver so there is exactly one definition of how
 * regions map to pixels — the canvas converts pointer deltas to template
 * space and these helpers do the rest. */

import { regionToRect } from './grid'
import type { GridMetrics, Rect } from './grid'
import type { ElementV2, Region, SectionV3 } from './types'

/** Pixel rect of a section's box on the given metrics — what the editor draws
 * as the section frame/handle. The same drag/resize helpers operate on
 * `section.region` to move/resize the box on the fine grid. */
export function sectionBoundsOf(section: SectionV3, m: GridMetrics): Rect {
  return regionToRect(section.region, m)
}

/** Template-space point → 1-based cell coordinates (clamped). */
export function pointToCell(x: number, y: number, m: GridMetrics): { col: number; row: number } {
  const col = Math.floor((x - m.originX) / (m.cellW + m.gutterX)) + 1
  const row = Math.floor((y - m.originY) / (m.cellH + m.gutterY)) + 1
  return {
    col: Math.min(m.cols, Math.max(1, col)),
    row: Math.min(m.rows, Math.max(1, row)),
  }
}

/** Move a region by a template-px delta, snapped to whole cells. Span preserved.
 *
 * Clamped by default (used for section-frame dragging — `SectionV3` has no
 * `overhang` semantics, see resolve.ts, so a section's box must always stay
 * on the grid). Pass `{ unclamped: true }` for element dragging, which
 * mirrors `nudgeSelected`'s bounds math exactly (useGridEditor.ts): the same
 * `[1, cols-colSpan+1]` in-bounds range is widened to a generous sanity clamp
 * `[min-2*cols, max+2*cols]` so a runaway drag can't fly off to infinity, but
 * the region is otherwise allowed past the canvas edge — the caller is
 * responsible for setting/clearing `el.overhang` from the result (see
 * `regionInBounds` below). */
export function dragRegion(
  start: Region, dxPx: number, dyPx: number, m: GridMetrics, opts?: { unclamped?: boolean },
): Region {
  const dCols = Math.round(dxPx / (m.cellW + m.gutterX))
  const dRows = Math.round(dyPx / (m.cellH + m.gutterY))
  const minCol = 1
  const maxCol = m.cols - start.colSpan + 1
  const minRow = 1
  const maxRow = m.rows - start.rowSpan + 1
  if (opts?.unclamped) {
    const col = Math.max(minCol - 2 * m.cols, Math.min(maxCol + 2 * m.cols, start.col + dCols))
    const row = Math.max(minRow - 2 * m.rows, Math.min(maxRow + 2 * m.rows, start.row + dRows))
    return { ...start, col, row }
  }
  const col = Math.min(maxCol, Math.max(minCol, start.col + dCols))
  const row = Math.min(maxRow, Math.max(minRow, start.row + dRows))
  return { ...start, col, row }
}

/** Whether a region's box is fully on the grid (no overhang) — the same
 * in-bounds test `nudgeSelected` inlines (useGridEditor.ts:594-604), pulled
 * out here so the mouse-drag path can apply the identical auto-overhang rule
 * a keyboard nudge does. */
export function regionInBounds(r: Region, m: GridMetrics): boolean {
  const minCol = 1
  const maxCol = m.cols - r.colSpan + 1
  const minRow = 1
  const maxRow = m.rows - r.rowSpan + 1
  return r.col >= minCol && r.col <= maxCol && r.row >= minRow && r.row <= maxRow
}

/** Auto-`overhang` rule for an element drag/nudge — shared by the keyboard
 * path (`nudgeSelected`, useGridEditor.ts) and the mouse-drag path
 * (`onElementPointerMove`, GridEditorCanvas.vue) so both apply it
 * identically. `overhang` is a single flag on the element, not scoped per
 * format/output, but `setRegion` writes to one of THREE different places
 * depending on scope (`el.region` on the master with 'class' scope,
 * `el.regionByClass[cls]` on a non-master format with 'class' scope, or
 * `el.overrides[oid].region` with 'output' scope) — see setRegion's own
 * precedence. An off-grid edit at ANY scope always SETS the flag (so the
 * canvas draws the clip), but it can only be auto-CLEARED when the edit that
 * just landed in-bounds wrote the MASTER region: clearing it from a
 * class/output-scoped edit would wrongly un-flag a master region that's
 * still off-grid on another format/output. Pass `wroteMasterRegion` as
 * whatever the caller computed setRegion's target to be (mirror its own
 * `regionScope !== 'output' && isMaster` check). */
export function applyOverhangFlag(
  el: Pick<ElementV2, 'overhang'>, region: Region, m: GridMetrics, wroteMasterRegion: boolean,
): void {
  if (regionInBounds(region, m)) {
    if (wroteMasterRegion && el.overhang) delete el.overhang
  } else {
    el.overhang = true
  }
}

/** Resize a region from a corner handle by a template-px delta, snapped to
 * cells. The opposite edges stay fixed; spans never go below 1. */
// Corner handles (nw/ne/sw/se) resize both axes; edge handles (n/s/e/w) resize
// a single axis, leaving the orthogonal axis untouched (drag width or height
// alone). A dir only affects an axis when it names that axis's side.
export function resizeRegion(
  start: Region, dir: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
  dxPx: number, dyPx: number, m: GridMetrics,
): Region {
  const dCols = Math.round(dxPx / (m.cellW + m.gutterX))
  const dRows = Math.round(dyPx / (m.cellH + m.gutterY))
  let { col, colSpan, row, rowSpan } = start
  if (dir.includes('e')) {
    colSpan = Math.max(1, Math.min(m.cols - col + 1, start.colSpan + dCols))
  } else if (dir.includes('w')) {
    const newCol = Math.min(start.col + start.colSpan - 1, Math.max(1, start.col + dCols))
    colSpan = start.colSpan + (start.col - newCol)
    col = newCol
  }
  if (dir.includes('s')) {
    rowSpan = Math.max(1, Math.min(m.rows - row + 1, start.rowSpan + dRows))
  } else if (dir.includes('n')) {
    const newRow = Math.min(start.row + start.rowSpan - 1, Math.max(1, start.row + dRows))
    rowSpan = start.rowSpan + (start.row - newRow)
    row = newRow
  }
  return { col, colSpan, row, rowSpan }
}
