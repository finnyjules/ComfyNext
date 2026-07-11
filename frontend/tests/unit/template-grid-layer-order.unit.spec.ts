import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../../shared/template-grid/resolve'
import { effectiveOrder } from '../../shared/template-grid/sections'
import type { TemplateV3 } from '../../shared/template-grid/types'

function tpl(order?: string[]): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 },
    typeScale: { base: 16, ratio: 1.25 },
    order,
    elements: [
      { id: 'e1', type: 'shape', shape: 'rect', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 } },
    ],
    sections: [{
      id: 's1', name: 'frame', style: { fill: '#222' },
      region: { col: 1, colSpan: 10, row: 1, rowSpan: 10 },
      children: [
        { id: 'c1', type: 'shape', shape: 'rect', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 } },
      ],
    }],
  }
}

const idsOf = (r: ReturnType<typeof resolveFormat>) => r.elements.map(e => e.el.id)

describe('unified layer order', () => {
  it('effectiveOrder falls back to elements-then-sections when order absent', () => {
    expect(effectiveOrder(tpl(undefined))).toEqual(['e1', 's1'])
  })

  it('effectiveOrder honours order and appends unlisted ids', () => {
    expect(effectiveOrder(tpl(['s1']))).toEqual(['s1', 'e1'])
  })

  it('resolver renders ungrouped element BELOW the frame by default', () => {
    const ids = idsOf(resolveFormat(tpl(undefined), 'sq'))
    expect(ids.indexOf('e1')).toBeLessThan(ids.indexOf('s1__frame'))
  })

  it('order can put the frame BEHIND the element', () => {
    const ids = idsOf(resolveFormat(tpl(['s1', 'e1']), 'sq'))
    expect(ids.indexOf('s1__frame')).toBeLessThan(ids.indexOf('e1'))
    expect(ids.indexOf('c1')).toBeLessThan(ids.indexOf('e1'))
  })
})
