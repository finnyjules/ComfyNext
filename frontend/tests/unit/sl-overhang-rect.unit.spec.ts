import { describe, expect, it } from 'vitest'
import { gridMetrics, regionToRect, regionToRectRaw } from '~~/shared/template-grid/grid'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV2 } from '~~/shared/template-grid/types'

// Same fixture shape as template-grid-geometry.unit.spec.ts: 1x1 master,
// gutter 24 / margin 72 / baseline 12 → originX 72, cellW/cellH 136, gutterX 24.
const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  elements: [],
}

describe('regionToRectRaw', () => {
  it('walks the exact same arithmetic as regionToRect, unclamped — col ≤ 0 goes negative', () => {
    const m = gridMetrics(T, '1x1')
    expect(m.originX).toBe(72)
    expect(m.cellW).toBeCloseTo(136, 5)
    expect(m.gutterX).toBeCloseTo(24, 5)

    const r = regionToRectRaw({ col: -1, colSpan: 6, row: 1, rowSpan: 2 }, m)
    // x = originX + (col - 1) * (cellW + gutterX) = 72 + (-2) * (136 + 24)
    expect(r.x).toBeCloseTo(72 + -2 * (136 + 24), 5)
    expect(r.x).toBeLessThan(0)
    expect(r.w).toBeCloseTo(6 * 136 + 5 * 24, 5)
    expect(r.y).toBeCloseTo(m.originY, 5)
    expect(r.h).toBeCloseTo(2 * 136 + 24, 5)
  })

  it('does not clamp spans past the grid', () => {
    const m = gridMetrics(T, '1x1')   // 6 cols
    const r = regionToRectRaw({ col: 1, colSpan: 20, row: 1, rowSpan: 1 }, m)
    expect(r.w).toBeCloseTo(20 * 136 + 19 * 24, 5)
    expect(r.x + r.w).toBeGreaterThan(1080)   // well past the canvas
  })

  it('still rounds fractional col/row/spans', () => {
    const m = gridMetrics(T, '1x1')
    const r = regionToRectRaw({ col: 2.6, colSpan: 2.4, row: 1, rowSpan: 1 }, m)
    const expected = regionToRectRaw({ col: 3, colSpan: 2, row: 1, rowSpan: 1 }, m)
    expect(r).toEqual(expected)
  })

  it('still floors spans at 1 (zero/negative spans are nonsensical, not overhang)', () => {
    const m = gridMetrics(T, '1x1')
    const r = regionToRectRaw({ col: 1, colSpan: 0, row: 1, rowSpan: -3 }, m)
    expect(r.w).toBeCloseTo(136, 5)   // 1 * cellW
    expect(r.h).toBeCloseTo(136, 5)   // 1 * cellH
  })

  it('matches regionToRect for an in-grid region (same arithmetic, clamp is a no-op)', () => {
    const m = gridMetrics(T, '1x1')
    const region = { col: 2, colSpan: 3, row: 2, rowSpan: 2 }
    expect(regionToRectRaw(region, m)).toEqual(regionToRect(region, m))
  })
})

// --- Resolver: overhang wiring -----------------------------------------

function resolverFixture(): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      { id: 'hero', type: 'image', content: '{{ props.image_layer_1 }}', priority: 4,
        region: { col: 1, colSpan: 6, row: 1, rowSpan: 6 } },
      { id: 'headline', type: 'text', content: 'Brew bold', level: 'display', priority: 1,
        region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 } },
    ],
  }
}

describe('resolveFormat: overhang', () => {
  it('an overhang element ~50% off-canvas is NOT culled, and its rect uses raw (unclamped) math', () => {
    const t = resolverFixture()
    // cols 4..9 on a 6-col grid: only cols 4-6 (half the span) land on-canvas.
    ;(t.elements[0] as any).region = { col: 4, colSpan: 6, row: 1, rowSpan: 6 }
    ;(t.elements[0] as any).overhang = true
    const r = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.culled).toBe(false)
    const raw = regionToRectRaw({ col: 4, colSpan: 6, row: 1, rowSpan: 6 }, r.metrics)
    expect(hero.rect).toEqual(raw)
    expect(hero.rect.x + hero.rect.w).toBeGreaterThan(1080)   // hangs off the right edge
  })

  it('the same region WITHOUT overhang resolves clamped exactly as today', () => {
    const t = resolverFixture()
    ;(t.elements[0] as any).region = { col: 4, colSpan: 6, row: 1, rowSpan: 6 }
    const r = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.culled).toBe(false)
    const clamped = regionToRect({ col: 4, colSpan: 6, row: 1, rowSpan: 6 }, r.metrics)
    expect(hero.rect).toEqual(clamped)
    expect(hero.rect.x + hero.rect.w).toBeLessThanOrEqual(1080 + 0.001)
  })

  it('overhang:false byte-matches the baseline resolve\'s geometry (an inert schema addition)', () => {
    const strip = (r: ReturnType<typeof resolveFormat>) =>
      r.elements.map(e => ({ id: e.el.id, region: e.region, rect: e.rect, culled: e.culled, cullReason: e.cullReason }))
    const baseline = resolveFormat(resolverFixture(), '1x1', { image_layer_1: 'http://x/i.png' })
    const t = resolverFixture()
    ;(t.elements[0] as any).overhang = false
    ;(t.elements[1] as any).overhang = false
    const withFlag = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    expect(strip(withFlag)).toEqual(strip(baseline))
  })

  it('an overhang element culled anyway when its on-canvas intersection is empty', () => {
    const t = resolverFixture()
    ;(t.elements[0] as any).region = { col: 20, colSpan: 6, row: 1, rowSpan: 6 }   // entirely off-canvas
    ;(t.elements[0] as any).overhang = true
    const r = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.culled).toBe(true)
    expect(hero.cullReason).toBe('too-small')
  })
})
