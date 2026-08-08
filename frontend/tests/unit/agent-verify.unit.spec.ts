import { describe, it, expect } from 'vitest'
import type { TemplateV3, ElementV2 } from '~~/shared/template-grid/types'
import { verifySmartLayout, parseColor, contrastRatio } from '~/lib/agent/verify'

function base(elements: ElementV2[], extra: Partial<TemplateV3> = {}): TemplateV3 {
  return {
    version: 3,
    id: 't1',
    name: 'Test',
    master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 48, baseline: 12 },
    typeScale: { base: 16, ratio: 1.25 },
    elements,
    sections: [],
    ...extra,
  }
}

const COLS = (() => {
  // derive the fine-grid width once so tests stay in sync with the real metric
  const t = base([])
  const snapGrid = Math.round((1080 - 2 * 48) / 12)
  return snapGrid
})()

describe('colour helpers', () => {
  it('parses hex and rgb, rejects gradients/names', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#0057FF')).toEqual({ r: 0, g: 87, b: 255 })
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(parseColor('linear-gradient(#fff,#000)')).toBeNull()
    expect(parseColor('rebeccapurple')).toBeNull()
  })

  it('contrast ratio is ~21 for black vs white', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeGreaterThan(20)
  })
})

describe('verifySmartLayout', () => {
  const txt = (over: Partial<ElementV2> = {}): ElementV2 => ({
    id: 'h', type: 'text', content: 'Hi', level: 'body', priority: 1,
    region: { col: 1, colSpan: 4, row: 1, rowSpan: 2 }, ...over,
  } as ElementV2)

  it('flags an element that extends off-canvas', () => {
    const r = verifySmartLayout(base([txt({ region: { col: 1, colSpan: COLS + 20, row: 1, rowSpan: 2 } })]))
    expect(r.some(i => /off-canvas/i.test(i.message))).toBe(true)
  })

  it('does NOT flag off-canvas when bleed is set (intentional)', () => {
    const r = verifySmartLayout(base([txt({ bleed: true, region: { col: 1, colSpan: COLS + 20, row: 1, rowSpan: 2 } })]))
    expect(r.some(i => /off-canvas/i.test(i.message))).toBe(false)
  })

  // FIX 6: a declared `overhang` (2a Task 10/5's off-canvas placement, e.g. a
  // deliberately nudged/dragged element) is intentional too — same as bleed.
  // Region is genuinely off-grid (col < 1) so this exercises the actual
  // off-canvas branch, not a no-op.
  it('does NOT flag off-canvas when overhang is set (declared, e.g. via nudge/drag)', () => {
    const r = verifySmartLayout(base([txt({ overhang: true, region: { col: -3, colSpan: 2, row: 1, rowSpan: 2 } } as any)]))
    expect(r.some(i => /off-canvas/i.test(i.message))).toBe(false)
  })

  it('still flags off-canvas when neither bleed nor overhang is set (control)', () => {
    const r = verifySmartLayout(base([txt({ region: { col: -3, colSpan: 2, row: 1, rowSpan: 2 } } as any)]))
    expect(r.some(i => /off-canvas/i.test(i.message))).toBe(true)
  })

  it('flags low-contrast text (dark text on the default dark canvas)', () => {
    const r = verifySmartLayout(base([txt({ style: { color: '#111111' } } as Partial<ElementV2>)]))
    expect(r.some(i => /contrast/i.test(i.message))).toBe(true)
  })

  it('does NOT flag white text on the dark canvas', () => {
    const r = verifySmartLayout(base([txt({ style: { color: '#ffffff' } } as Partial<ElementV2>)]))
    expect(r.some(i => /contrast/i.test(i.message))).toBe(false)
  })

  it('resolves brand tokens for contrast (brand.foreground = dark on dark canvas → flag)', () => {
    const r = verifySmartLayout(base([txt({ style: { color: '{{ brand.foreground }}' } } as Partial<ElementV2>)], { brand: { foreground: '#0a0a0a' } }))
    expect(r.some(i => /contrast/i.test(i.message))).toBe(true)
  })

  it('flags a narrow display headline', () => {
    const r = verifySmartLayout(base([txt({ level: 'display', region: { col: 1, colSpan: 4, row: 1, rowSpan: 2 } })]))
    expect(r.some(i => /narrow|headline/i.test(i.message))).toBe(true)
  })

  it('a full-width white display headline on dark is clean', () => {
    const r = verifySmartLayout(base([txt({ level: 'display', style: { color: '#ffffff' }, region: { col: 1, colSpan: COLS, row: 1, rowSpan: 10 } } as Partial<ElementV2>)]))
    expect(r).toEqual([])
  })

  it('skips contrast when the background is a gradient (cannot reason)', () => {
    const r = verifySmartLayout(base([txt({ style: { color: '#222' } } as Partial<ElementV2>)], { background: { fill: 'linear-gradient(#fff,#000)' } }))
    expect(r.some(i => /contrast/i.test(i.message))).toBe(false)
  })
})

describe('Swiss restraint checks', () => {
  const t = (over: Partial<ElementV2> = {}, id = 'e'): ElementV2 => ({
    id, type: 'text', content: 'x', level: 'body', priority: 1,
    region: { col: 1, colSpan: 30, row: 1, rowSpan: 2 }, ...over,
  } as ElementV2)

  it('flags a busy palette (> 4 distinct colours)', () => {
    const els = [
      t({ id: 'a', style: { color: '#ffffff' } } as Partial<ElementV2>, 'a'),
      { id: 's1', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 4, row: 4, rowSpan: 1 }, style: { fill: '#FF0000' } },
      { id: 's2', type: 'shape', shape: 'rect', priority: 3, region: { col: 1, colSpan: 4, row: 5, rowSpan: 1 }, style: { fill: '#00FF00' } },
      { id: 's3', type: 'shape', shape: 'rect', priority: 4, region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 }, style: { fill: '#0000FF' } },
      { id: 's4', type: 'shape', shape: 'rect', priority: 5, region: { col: 1, colSpan: 4, row: 7, rowSpan: 1 }, style: { fill: '#FFFF00' } },
    ] as ElementV2[]
    const r = verifySmartLayout(base(els, { background: { fill: '#101010' } }))
    expect(r.some(i => /colours in use|restraint/i.test(i.message))).toBe(true)
  })

  it('flags too many type sizes', () => {
    const els = [
      t({ id: 'a', level: 'display' } as Partial<ElementV2>, 'a'),
      t({ id: 'b', level: 'headline' } as Partial<ElementV2>, 'b'),
      t({ id: 'c', level: 'subhead' } as Partial<ElementV2>, 'c'),
      t({ id: 'd', level: 'body' } as Partial<ElementV2>, 'd'),
    ] as ElementV2[]
    const r = verifySmartLayout(base(els))
    expect(r.some(i => /type scale|different text sizes/i.test(i.message))).toBe(true)
  })

  it('flags no clear hierarchy when two texts share a size', () => {
    const r = verifySmartLayout(base([t({ id: 'a' }, 'a'), t({ id: 'b' }, 'b')]))
    expect(r.some(i => /hierarchy/i.test(i.message))).toBe(true)
  })

  it('flags an all-centred composition', () => {
    const els = [
      t({ id: 'a', level: 'display', style: { align: 'center' } } as Partial<ElementV2>, 'a'),
      t({ id: 'b', level: 'body', style: { align: 'center' } } as Partial<ElementV2>, 'b'),
    ] as ElementV2[]
    const r = verifySmartLayout(base(els))
    expect(r.some(i => /centred|flush-left/i.test(i.message))).toBe(true)
  })

  it('a restrained, hierarchical, flush-left layout is clean', () => {
    const els = [
      t({ id: 'h', level: 'display', region: { col: 1, colSpan: 70, row: 1, rowSpan: 4 }, style: { color: '#ffffff', align: 'left' } } as Partial<ElementV2>, 'h'),
      t({ id: 'b', level: 'body', region: { col: 1, colSpan: 50, row: 6, rowSpan: 2 }, style: { color: '#ffffff', align: 'left' } } as Partial<ElementV2>, 'b'),
    ] as ElementV2[]
    const r = verifySmartLayout(base(els, { background: { fill: '#0a0a0a' } }))
    expect(r).toEqual([])
  })
})
