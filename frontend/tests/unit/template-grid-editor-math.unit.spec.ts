import { describe, expect, it } from 'vitest'
import { dragRegion, pointToCell, regionInBounds, resizeRegion } from '~~/shared/template-grid/editor'
import { gridMetrics } from '~~/shared/template-grid/grid'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  elements: [],
}
// 6×6 grid, cell 136, gutter 24, origin 72. Cell stride = 160.
const m = gridMetrics(T, '1x1')

describe('pointToCell', () => {
  it('maps template-space points to 1-based cells', () => {
    expect(pointToCell(72, 72, m)).toEqual({ col: 1, row: 1 })
    expect(pointToCell(72 + 160, 72, m)).toEqual({ col: 2, row: 1 })
    expect(pointToCell(540, 540, m)).toEqual({ col: 3, row: 3 })
  })
  it('clamps out-of-bounds points', () => {
    expect(pointToCell(-50, 5000, m)).toEqual({ col: 1, row: 6 })
    expect(pointToCell(5000, -50, m)).toEqual({ col: 6, row: 1 })
  })
})

describe('dragRegion', () => {
  const r = { col: 2, colSpan: 2, row: 2, rowSpan: 2 }
  it('snaps deltas to whole cells (stride 160)', () => {
    expect(dragRegion(r, 70, 0, m)).toEqual(r)                       // < half stride → no move
    expect(dragRegion(r, 90, 0, m)).toEqual({ ...r, col: 3 })        // ≥ half stride → 1 col
    expect(dragRegion(r, -330, 170, m)).toEqual({ ...r, col: 1, row: 3 })
  })
  it('clamps so the span stays on the grid', () => {
    expect(dragRegion(r, 5000, 5000, m)).toEqual({ ...r, col: 5, row: 5 })
    expect(dragRegion(r, -5000, -5000, m)).toEqual({ ...r, col: 1, row: 1 })
  })

  // Round-2a Task 10 fix round 1: mouse drag past the canvas edge must set
  // `overhang`, matching keyboard nudge (`nudgeSelected`, useGridEditor.ts).
  // `{ unclamped: true }` is the element-drag path's opt-in; the default
  // (no opts, asserted above) stays clamped for section-frame dragging.
  describe('unclamped option (element drag, Task 10 fix)', () => {
    it('goes past the left/top edge into negative col/row instead of snapping to the edge', () => {
      // dCols = round(-500/160) = -3 → col = 2-3 = -1 (well short of the
      // sanity cap at col -11, so this proves the edge itself is no longer
      // a wall, not just that the sanity cap eventually kicks in).
      expect(dragRegion(r, -500, -500, m, { unclamped: true })).toEqual({ ...r, col: -1, row: -1 })
    })
    it('still bounds a runaway drag at the ±2× grid-span sanity cap', () => {
      // Same huge delta as the clamped case above (5000/-5000) — clamped
      // lands at the edge (col 5 / col 1); unclamped lands at the sanity
      // cap instead: maxCol(5)+2*cols(12)=17, minCol(1)-2*cols(12)=-11.
      expect(dragRegion(r, 5000, 5000, m, { unclamped: true })).toEqual({ ...r, col: 17, row: 17 })
      expect(dragRegion(r, -5000, -5000, m, { unclamped: true })).toEqual({ ...r, col: -11, row: -11 })
    })
    it('in-bounds drags are byte-identical to the clamped form', () => {
      // Same deltas as the "snaps deltas to whole cells" test above (minus
      // the -330 col delta, which lands col at 0 — out of bounds, so it's
      // not a fair "in-bounds" comparison) — nothing changes while the
      // result stays on the grid.
      expect(dragRegion(r, 70, 0, m, { unclamped: true })).toEqual(r)
      expect(dragRegion(r, 90, 0, m, { unclamped: true })).toEqual({ ...r, col: 3 })
      expect(dragRegion(r, 0, 170, m, { unclamped: true })).toEqual({ ...r, row: 3 })
    })
  })
})

describe('regionInBounds', () => {
  it('is true for a region fully on the grid, including flush against an edge', () => {
    expect(regionInBounds({ col: 2, colSpan: 2, row: 2, rowSpan: 2 }, m)).toBe(true)
    expect(regionInBounds({ col: 1, colSpan: 2, row: 1, rowSpan: 2 }, m)).toBe(true)      // flush top-left
    expect(regionInBounds({ col: 5, colSpan: 2, row: 5, rowSpan: 2 }, m)).toBe(true)      // flush bottom-right (6x6)
  })
  it('is false once the region extends past any edge', () => {
    expect(regionInBounds({ col: -1, colSpan: 2, row: 2, rowSpan: 2 }, m)).toBe(false)    // past left
    expect(regionInBounds({ col: 2, colSpan: 2, row: -1, rowSpan: 2 }, m)).toBe(false)    // past top
    expect(regionInBounds({ col: 6, colSpan: 2, row: 2, rowSpan: 2 }, m)).toBe(false)     // past right (6x6, span 2 → max col 5)
    expect(regionInBounds({ col: 2, colSpan: 2, row: 6, rowSpan: 2 }, m)).toBe(false)     // past bottom
  })
})

describe('resizeRegion', () => {
  const r = { col: 2, colSpan: 2, row: 2, rowSpan: 2 }
  it('grows from the south-east handle', () => {
    expect(resizeRegion(r, 'se', 170, 330, m)).toEqual({ col: 2, colSpan: 3, row: 2, rowSpan: 4 })
  })
  it('shrinks but never below span 1', () => {
    expect(resizeRegion(r, 'se', -5000, -5000, m)).toEqual({ col: 2, colSpan: 1, row: 2, rowSpan: 1 })
  })
  it('north-west handle moves origin and keeps the far edge fixed', () => {
    const out = resizeRegion(r, 'nw', -160, -160, m)
    expect(out).toEqual({ col: 1, colSpan: 3, row: 1, rowSpan: 3 })
    // far edge: col + colSpan - 1 unchanged
    expect(out.col + out.colSpan - 1).toBe(r.col + r.colSpan - 1)
  })
  it('nw shrink cannot invert the region', () => {
    const out = resizeRegion(r, 'nw', 5000, 5000, m)
    expect(out).toEqual({ col: 3, colSpan: 1, row: 3, rowSpan: 1 })
  })
  it('clamps growth at the grid edge', () => {
    expect(resizeRegion(r, 'se', 5000, 5000, m)).toEqual({ col: 2, colSpan: 5, row: 2, rowSpan: 5 })
  })

  // Single-axis edge handles: each touches ONLY its own axis, ignoring the
  // orthogonal delta (so dragging an edge changes width or height alone).
  it('east edge grows only the width, ignoring the vertical delta', () => {
    expect(resizeRegion(r, 'e', 170, 330, m)).toEqual({ col: 2, colSpan: 3, row: 2, rowSpan: 2 })
  })
  it('west edge moves/grows only the width, ignoring the vertical delta', () => {
    expect(resizeRegion(r, 'w', -160, 330, m)).toEqual({ col: 1, colSpan: 3, row: 2, rowSpan: 2 })
  })
  it('south edge grows only the height, ignoring the horizontal delta', () => {
    expect(resizeRegion(r, 's', 330, 330, m)).toEqual({ col: 2, colSpan: 2, row: 2, rowSpan: 4 })
  })
  it('north edge moves/grows only the height, ignoring the horizontal delta', () => {
    expect(resizeRegion(r, 'n', 330, -160, m)).toEqual({ col: 2, colSpan: 2, row: 1, rowSpan: 3 })
  })
})
