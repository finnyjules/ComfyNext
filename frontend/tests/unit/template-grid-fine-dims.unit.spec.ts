import { describe, expect, it } from 'vitest'
import { fineGridDims, formatDims, gridMetrics, gutterBox, marginBox } from '~~/shared/template-grid/grid'
import type { TemplateV2, TemplateV3 } from '~~/shared/template-grid/types'

const base = {
  id: 't', name: 't', master: '1x1',
  formats: {
    '1x1': { w: 1080, h: 1080 },
    '9x16': { w: 1080, h: 1920 },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
}

function v2(): TemplateV2 { return { version: 2, ...structuredClone(base), elements: [] } }
function v3(): TemplateV3 { return { version: 3, ...structuredClone(base), elements: [], sections: [] } }

describe('fineGridDims', () => {
  it('v3 derives the subdivision count from the master (canvas ÷ baseline)', () => {
    // (1080 - 2*72) / 12 = 936 / 12 = 78
    expect(fineGridDims(v3(), v3().formats['1x1']!)).toEqual({ cols: 78, rows: 78 })
  })

  it('v3 is a FIXED canvas subdivision — every format shares the master N×N', () => {
    // Identity reflow: an element at unit 40/78 sits at the same fraction on
    // every format, so placement converts cleanly. Portrait no longer gets its
    // own (finer) row count.
    expect(fineGridDims(v3(), v3().formats['9x16']!)).toEqual({ cols: 78, rows: 78 })
  })

  it('v3 honours explicit grid.columns / grid.rows, fixed across formats', () => {
    const t = v3(); (t.grid as any).columns = 12; (t.grid as any).rows = 8
    expect(fineGridDims(t, t.formats['1x1']!)).toEqual({ cols: 12, rows: 8 })
    expect(fineGridDims(t, t.formats['9x16']!)).toEqual({ cols: 12, rows: 8 })
  })

  it('v3 still lets a per-format f.cols/f.rows win', () => {
    const t = v3(); t.formats['9x16']!.cols = 4; t.formats['9x16']!.rows = 8
    expect(fineGridDims(t, t.formats['9x16']!)).toEqual({ cols: 4, rows: 8 })
  })

  it('v2 keeps coarse class dimensions (square 6×6)', () => {
    expect(fineGridDims(v2(), v2().formats['1x1']!)).toEqual({ cols: 6, rows: 6 })
    expect(fineGridDims(v2(), v2().formats['1x1']!)).toEqual(formatDims(v2().formats['1x1']!))
  })

  it('gridMetrics uses the fine grid for v3, fixed across formats', () => {
    expect(gridMetrics(v3(), '1x1').cols).toBe(78)
    expect(gridMetrics(v3(), '1x1').rows).toBe(78)
    // Portrait shares the same subdivision count now.
    expect(gridMetrics(v3(), '9x16').cols).toBe(78)
    expect(gridMetrics(v3(), '9x16').rows).toBe(78)
  })

  it('gridMetrics still coarse for v2', () => {
    const m = gridMetrics(v2(), '1x1')
    expect(m.cols).toBe(6)
    expect(m.rows).toBe(6)
  })
})

describe('gutter + per-side margins (v3)', () => {
  it('v3 gutter stays 0 on a derived grid, activates on an explicit grid', () => {
    // Legacy derived grid (no columns/rows) — byte-identical, gutterless.
    expect(gridMetrics(v3(), '1x1').gutter).toBe(0)
    // Explicit coarse grid — gutter now applies.
    const t = v3(); t.grid.columns = 12; t.grid.rows = 12
    expect(gridMetrics(t, '1x1').gutter).toBeGreaterThan(0)
  })

  it('gutter is capped so it can never drive cells non-positive', () => {
    const t = v3(); t.grid.columns = 12; t.grid.rows = 12; t.grid.gutter = 100000
    const m = gridMetrics(t, '1x1')
    expect(m.cellW).toBeGreaterThan(0)
    expect(m.cellH).toBeGreaterThan(0)
  })

  it('per-side margins offset the grid origin independently (master scale 1)', () => {
    const t = v3(); t.grid.columns = 12; t.grid.rows = 12
    t.grid.margins = { top: 10, left: 20, right: 0, bottom: 0 }
    const m = gridMetrics(t, '1x1')
    expect(m.originX).toBe(20)
    expect(m.originY).toBe(10)
    expect(m.marginRight).toBe(0)
    expect(m.marginBottom).toBe(0)
  })

  it('marginBox falls back to the uniform margin for any unset side', () => {
    const t = v3(); t.grid.margin = 50; t.grid.margins = { top: 10 }
    expect(marginBox(t)).toEqual({ top: 10, right: 50, bottom: 50, left: 50 })
  })

  it('column and row gutters resolve independently', () => {
    const t = v3(); t.grid.columns = 12; t.grid.rows = 12
    t.grid.gutters = { column: 20, row: 4 }
    const m = gridMetrics(t, '1x1')   // master scale = 1
    expect(m.gutterX).toBe(20)
    expect(m.gutterY).toBe(4)
    expect(m.gutter).toBe(m.gutterX)   // back-compat: `gutter` = column gutter
  })

  it('gutterBox falls back to the uniform gutter per axis', () => {
    const t = v3(); t.grid.gutter = 8; t.grid.gutters = { column: 20 }
    expect(gutterBox(t)).toEqual({ column: 20, row: 8 })
  })
})
