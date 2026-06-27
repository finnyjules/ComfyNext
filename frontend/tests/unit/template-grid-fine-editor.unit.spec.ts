import { describe, expect, it } from 'vitest'
import { gridMetrics, regionToRect } from '~~/shared/template-grid/grid'
import { dragRegion, sectionBoundsOf } from '~~/shared/template-grid/editor'
import type { SectionV3, TemplateV3 } from '~~/shared/template-grid/types'

function v3(): TemplateV3 {
  return {
    version: 3, id: 't3', name: 't3', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [], sections: [],
  }
}

describe('fine-grid editor math', () => {
  it('drags by exactly one fine unit on a fine metrics object', () => {
    const m = gridMetrics(v3(), '1x1')   // 78×78, gutter 0, cell ≈ 12px
    const start = { col: 10, colSpan: 5, row: 10, rowSpan: 5 }
    // move right+down by one cell width/height → +1 col, +1 row
    const moved = dragRegion(start, m.cellW + m.gutter, m.cellH + m.gutter, m)
    expect(moved.col).toBe(11)
    expect(moved.row).toBe(11)
    expect(moved.colSpan).toBe(5)   // span preserved
  })

  it('sectionBoundsOf returns the section box pixel rect', () => {
    const m = gridMetrics(v3(), '1x1')
    const section: SectionV3 = {
      id: 's', name: 's',
      region: { col: 1, colSpan: 40, row: 1, rowSpan: 40 },
      children: [],
    }
    expect(sectionBoundsOf(section, m)).toEqual(regionToRect(section.region, m))
  })
})
