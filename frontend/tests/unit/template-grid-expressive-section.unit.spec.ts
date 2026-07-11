import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV3, ExpressiveBoxParams, ElementV2 } from '~~/shared/template-grid/types'

function shape(id: string, col: number, row: number): ElementV2 {
  return { id, type: 'shape', shape: 'rect', priority: 1,
    region: { col, colSpan: 18, row, rowSpan: 18 }, style: { fill: '#fff' } } as ElementV2
}

function tpl(expressive: ExpressiveBoxParams): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1000, h: 1000 } },
    grid: { gutter: 0, margin: 0, baseline: 10 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#000' },
    elements: [],
    sections: [{
      id: 'sec', name: 'sec',
      region: { col: 1, colSpan: 100, row: 1, rowSpan: 100 },
      expressive,
      children: [shape('a', 1, 1), shape('b', 30, 1), shape('c', 1, 30), shape('d', 30, 30)],
    }],
  }
}

function childRects(t: TemplateV3) {
  const r = resolveFormat(t, '1x1')
  return r.elements.filter(e => ['a', 'b', 'c', 'd'].includes(e.el.id) && !e.culled)
}
const overlap = (p: any, q: any) =>
  p.rect.x < q.rect.x + q.rect.w && p.rect.x + p.rect.w > q.rect.x &&
  p.rect.y < q.rect.y + q.rect.h && p.rect.y + p.rect.h > q.rect.y

describe('expressive section placement', () => {
  it('resolves all four children, each inside the section box', () => {
    const rects = childRects(tpl({ placement: 'scatter', jitter: 1, rotation: 0, seed: 3 }))
    expect(rects).toHaveLength(4)
    for (const e of rects) {
      expect(e.rect.x).toBeGreaterThanOrEqual(-1e-6)
      expect(e.rect.y).toBeGreaterThanOrEqual(-1e-6)
      expect(e.rect.x + e.rect.w).toBeLessThanOrEqual(1000 + 1e-6)
      expect(e.rect.y + e.rect.h).toBeLessThanOrEqual(1000 + 1e-6)
    }
  })

  it('grid placement never overlaps children', () => {
    const rects = childRects(tpl({ placement: 'grid', columns: 2, jitter: 1, rotation: 0, seed: 8 }))
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(overlap(rects[i], rects[j])).toBe(false)
  })

  it('carries a derived rotation when rotation > 0', () => {
    const rects = childRects(tpl({ placement: 'scatter', jitter: 0.5, rotation: 1, seed: 5 }))
    expect(rects.some(e => (e.rotation ?? 0) !== 0)).toBe(true)
  })

  it('no rotation field when rotation is 0', () => {
    const rects = childRects(tpl({ placement: 'grid', jitter: 0, rotation: 0, seed: 1 }))
    expect(rects.every(e => e.rotation === undefined)).toBe(true)
  })
})
