import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../../shared/template-grid/resolve'
import type { TemplateV3 } from '../../shared/template-grid/types'

function tpl(layout?: TemplateV3['sections'][0]['layout']): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 },
    typeScale: { base: 16, ratio: 1.25 },
    elements: [],
    sections: [{
      id: 's1', name: 'stack',
      region: { col: 1, colSpan: 10, row: 1, rowSpan: 20 },
      layout,
      children: [
        { id: 'a', type: 'shape', shape: 'rect', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 } },
        { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 4, row: 6, rowSpan: 4 } },
      ],
    }],
  }
}

describe('resolveFormat — auto-layout stacks', () => {
  it('stacks children vertically (b below a) when layout present', () => {
    const r = resolveFormat(tpl({
      direction: 'vertical', padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0, mainAlign: 'start', crossAlign: 'stretch',
    }), 'sq')
    const a = r.elements.find(e => e.el.id === 'a')!
    const b = r.elements.find(e => e.el.id === 'b')!
    expect(a.culled).toBe(false)
    expect(b.rect.y).toBeGreaterThanOrEqual(a.rect.y + a.rect.h - 0.01) // b starts at/after a's bottom
    // With gap=0, start align: b packs immediately after a (no proportional gap preserved)
    expect(b.rect.y).toBeCloseTo(a.rect.y + a.rect.h, 1) // stacked tightly, not gap-preserving
    expect(a.rect.x).toBeCloseTo(b.rect.x) // cross stretch → same x
  })

  it('layout-less section is byte-identical to today (proportional projection)', () => {
    const withoutLayout = resolveFormat(tpl(undefined), 'sq')
    // snapshot the resolved child rects so any change to the existing path is caught
    const rects = withoutLayout.elements.map(e => ({ id: e.el.id, ...e.rect }))
    expect(rects).toMatchSnapshot()
  })
})
