import { describe, expect, it } from 'vitest'
import { dragRegion, pointToCell, resizeRegion } from '~~/shared/template-grid/editor'
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
