/** Editor interaction math: pointer/drag/resize snapping against the grid.
 * Lives next to the resolver so there is exactly one definition of how
 * regions map to pixels — the canvas converts pointer deltas to template
 * space and these helpers do the rest. */

import { regionToRect } from './grid'
import type { GridMetrics, Rect } from './grid'
import type { Region, SectionV3 } from './types'

/** Pixel rect of a section's box on the given metrics — what the editor draws
 * as the section frame/handle. The same drag/resize helpers operate on
 * `section.region` to move/resize the box on the fine grid. */
export function sectionBoundsOf(section: SectionV3, m: GridMetrics): Rect {
  return regionToRect(section.region, m)
}

/** Template-space point → 1-based cell coordinates (clamped). */
export function pointToCell(x: number, y: number, m: GridMetrics): { col: number; row: number } {
  const col = Math.floor((x - m.originX) / (m.cellW + m.gutter)) + 1
  const row = Math.floor((y - m.originY) / (m.cellH + m.gutter)) + 1
  return {
    col: Math.min(m.cols, Math.max(1, col)),
    row: Math.min(m.rows, Math.max(1, row)),
  }
}

/** Move a region by a template-px delta, snapped to whole cells. Span preserved. */
export function dragRegion(start: Region, dxPx: number, dyPx: number, m: GridMetrics): Region {
  const dCols = Math.round(dxPx / (m.cellW + m.gutter))
  const dRows = Math.round(dyPx / (m.cellH + m.gutter))
  const col = Math.min(m.cols - start.colSpan + 1, Math.max(1, start.col + dCols))
  const row = Math.min(m.rows - start.rowSpan + 1, Math.max(1, start.row + dRows))
  return { ...start, col, row }
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
  const dCols = Math.round(dxPx / (m.cellW + m.gutter))
  const dRows = Math.round(dyPx / (m.cellH + m.gutter))
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
