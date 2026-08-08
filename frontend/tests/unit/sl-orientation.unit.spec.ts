import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV2 } from '~~/shared/template-grid/types'

// A TALL narrow region (1 col × 5 rows on the square master's 6x6 grid) — a
// vertical title running up the edge: 136px wide, 776px tall. Long enough
// copy that horizontal flow (2-3 chars per line at 136px) needs a heavy
// shrink to fit its many lines within the 776px budget, while vertical
// (swapped: 776px "line length" / 136px stacking budget) needs far less.
function fixture(orientation?: 'horizontal' | 'up' | 'down'): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      {
        id: 'title', type: 'text', content: 'Artisan Roasted Coffee Beans From The Highlands',
        level: 'display', priority: 1,
        region: { col: 1, colSpan: 1, row: 1, rowSpan: 5 },
        ...(orientation ? { style: { orientation } } : {}),
      },
    ],
  }
}

describe('resolveFormat: text orientation', () => {
  it('vertical "up" carries rotation: -90 on the resolved entry', () => {
    const r = resolveFormat(fixture('up'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.culled).toBe(false)
    expect(title.rotation).toBe(-90)
  })

  it('vertical "down" carries rotation: 90 on the resolved entry', () => {
    const r = resolveFormat(fixture('down'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.rotation).toBe(90)
  })

  it('default/horizontal orientation leaves rotation undefined', () => {
    const r = resolveFormat(fixture(), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.rotation).toBeUndefined()
  })

  it('the element rect stays the region rect (unswapped) — rotation is around center', () => {
    const control = resolveFormat(fixture(), '1x1')
    const vertical = resolveFormat(fixture('up'), '1x1')
    const controlEl = control.elements.find(e => e.el.id === 'title')!
    const verticalEl = vertical.elements.find(e => e.el.id === 'title')!
    expect(verticalEl.rect).toEqual(controlEl.rect)
  })

  it('vertical text fits a LARGER font than horizontal in the same tall narrow region — the fit used the swapped axis', () => {
    const horizontal = resolveFormat(fixture(), '1x1')
    const vertical = resolveFormat(fixture('up'), '1x1')
    const hEl = horizontal.elements.find(e => e.el.id === 'title')!
    const vEl = vertical.elements.find(e => e.el.id === 'title')!
    expect(hEl.culled).toBe(false)
    expect(vEl.culled).toBe(false)
    expect(vEl.text!.fontSize).toBeGreaterThan(hEl.text!.fontSize)
  })

  it('horizontal (default) resolve is byte-identical to a template with no style at all — no behaviour change', () => {
    const strip = (r: ReturnType<typeof resolveFormat>) =>
      r.elements.map(e => ({ region: e.region, rect: e.rect, culled: e.culled, text: e.text, rotation: e.rotation }))
    const withStyle = resolveFormat(fixture('horizontal'), '1x1')
    const noStyle = resolveFormat(fixture(), '1x1')
    expect(strip(withStyle)).toEqual(strip(noStyle))
  })
})
