import { describe, expect, it } from 'vitest'
import { fineGridDims, formatDims, gridMetrics } from '~~/shared/template-grid/grid'
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

function v2(): TemplateV2 { return { version: 2, ...base, elements: [] } }
function v3(): TemplateV3 { return { version: 3, ...base, elements: [], sections: [] } }

describe('fineGridDims', () => {
  it('v3 derives a fine grid where one unit ≈ baseline px (master)', () => {
    // (1080 - 2*72) / 12 = 936 / 12 = 78
    expect(fineGridDims(v3(), v3().formats['1x1']!)).toEqual({ cols: 78, rows: 78 })
  })

  it('v3 portrait is finer on the long axis', () => {
    // cols: (1080-144)/12 = 78 ; rows: (1920-144)/12 = 148
    expect(fineGridDims(v3(), v3().formats['9x16']!)).toEqual({ cols: 78, rows: 148 })
  })

  it('v2 keeps coarse class dimensions (square 6×6)', () => {
    expect(fineGridDims(v2(), v2().formats['1x1']!)).toEqual({ cols: 6, rows: 6 })
    expect(fineGridDims(v2(), v2().formats['1x1']!)).toEqual(formatDims(v2().formats['1x1']!))
  })

  it('gridMetrics uses the fine grid for v3', () => {
    const m = gridMetrics(v3(), '1x1')
    expect(m.cols).toBe(78)
    expect(m.rows).toBe(78)
  })

  it('gridMetrics still coarse for v2', () => {
    const m = gridMetrics(v2(), '1x1')
    expect(m.cols).toBe(6)
    expect(m.rows).toBe(6)
  })
})
