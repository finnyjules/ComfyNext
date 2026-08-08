import { describe, expect, it } from 'vitest'
import { gridMetrics, regionToRect, regionToRectRaw, remapRegion, remapRegionRaw } from '~~/shared/template-grid/grid'
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

// --- Finding 1: overhang must still go through proportional remap ----------

describe('remapRegionRaw', () => {
  it('walks the exact same rescale arithmetic as remapRegion, unclamped', () => {
    const from = { cols: 6, rows: 6 }
    const to = { cols: 8, rows: 4 }
    const region = { col: 2, colSpan: 3, row: 2, rowSpan: 2 }
    // In-bounds region: clamping in remapRegion is a no-op, so the two agree.
    expect(remapRegionRaw(region, from, to)).toEqual(remapRegion(region, from, to))
  })

  it('does not clamp col to 1 — negative/off-canvas columns pass through', () => {
    const from = { cols: 6, rows: 6 }
    const to = { cols: 8, rows: 4 }
    const region = { col: -1, colSpan: 2, row: 1, rowSpan: 1 }
    const clamped = remapRegion(region, from, to)
    const raw = remapRegionRaw(region, from, to)
    expect(clamped.col).toBe(1)          // remapRegion floors to the grid
    expect(raw.col).toBeLessThan(1)      // remapRegionRaw preserves the off-canvas placement
  })

  it('does not clamp spans past the target grid', () => {
    const from = { cols: 6, rows: 6 }
    const to = { cols: 8, rows: 4 }
    const region = { col: 5, colSpan: 4, row: 1, rowSpan: 1 }   // runs off the right edge
    const clamped = remapRegion(region, from, to)
    const raw = remapRegionRaw(region, from, to)
    expect(clamped.col + clamped.colSpan - 1).toBeLessThanOrEqual(to.cols)
    expect(raw.col + raw.colSpan - 1).toBeGreaterThan(to.cols)
  })

  it('still floors spans at 1 (zero/negative spans are nonsensical, not overhang)', () => {
    const raw = remapRegionRaw({ col: 1, colSpan: 0, row: 1, rowSpan: -3 }, { cols: 6, rows: 6 }, { cols: 8, rows: 4 })
    expect(raw.colSpan).toBe(1)
    expect(raw.rowSpan).toBe(1)
  })
})

// A V2 template with a square master (6×6) and a landscape format (8×4) —
// the two class grids are differently shaped, so an overhang element must be
// proportionally rescaled between them, not have its master-grid coordinates
// applied directly to the landscape grid.
function multiFormatFixture(): TemplateV2 {
  return {
    version: 2, id: 't2', name: 't2', master: 'square',
    formats: {
      square: { w: 1080, h: 1080 },        // class 'square' → 6 cols × 6 rows
      landscape: { w: 1920, h: 1080 },     // class 'landscape' → 8 cols × 4 rows
    },
    grid: { gutter: 0, margin: 0, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      { id: 'hero', type: 'image', content: '{{ props.image_layer_1 }}', priority: 1, overhang: true,
        region: { col: 1, colSpan: 3, row: 1, rowSpan: 6 } },
    ],
  }
}

describe('resolveFormat: overhang across V2 formats (proportional reflow)', () => {
  it('rescales master-grid coordinates into the landscape class grid — fraction preserved', () => {
    const t = multiFormatFixture()
    const r = resolveFormat(t, 'landscape', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.culled).toBe(false)
    // Master: col 1..3 of 6 → the left half of the canvas (0%..50%).
    // Bypassing remapRegion (the pre-fix bug) would apply col 1/colSpan 3 of
    // 6 directly onto the landscape's 8-col grid — 0%..37.5%, not 50%.
    expect(hero.rect.x).toBeCloseTo(0, 1)
    expect(hero.rect.w / r.format.w).toBeCloseTo(0.5, 1)
    // Wiring check: the resolver's rect must be exactly the raw-remap → raw-rect
    // pipeline (remapRegionRaw then regionToRectRaw), not some other path.
    const expectRegion = remapRegionRaw(t.elements[0]!.region, { cols: 6, rows: 6 }, { cols: 8, rows: 4 })
    const expectRect = regionToRectRaw(expectRegion, r.metrics)
    expect(hero.rect).toEqual(expectRect)
  })

  it('an off-canvas overhang region preserves its off-canvas (negative) placement after remap', () => {
    const t = multiFormatFixture()
    ;(t.elements[0] as any).region = { col: -1, colSpan: 2, row: 1, rowSpan: 6 }
    const r = resolveFormat(t, 'landscape', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    // Master fraction: (col - 1) / cols = (-1 - 1) / 6 ≈ -0.333 (off-canvas left).
    // A clamped remap (the pre-fix bug) would floor this to col 1 → x = 0,
    // losing the off-canvas placement entirely.
    expect(hero.rect.x).toBeLessThan(0)
    expect(hero.rect.x / r.format.w).toBeCloseTo(-0.333, 1)
  })
})

// --- Finding 2: strip/skyscraper class-slot precedence over overhang -------

// A strip-class format: overhang must NOT bypass the hand-authored slot
// table (defaultClassRegion) — slots are always in-bounds, so overhang is
// moot there, but skipping the slot path loses the authored placement and
// the `taken` reservation.
function stripFixture(overhang: boolean): TemplateV2 {
  return {
    version: 2, id: 't3', name: 't3', master: 'strip',
    formats: { strip: { w: 2400, h: 200 } },   // ratio 12 → class 'strip', 12 cols × 1 row
    grid: { gutter: 0, margin: 0, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      { id: 'headline', type: 'text', content: 'Brew bold', level: 'display', priority: 1, overhang,
        // An arbitrary authored region — irrelevant to the strip path, which
        // ignores `region` entirely in favour of the slot table. If overhang
        // wrongly bypassed the slot path, this raw region would leak through.
        region: { col: 1, colSpan: 1, row: 1, rowSpan: 1 } },
    ],
  }
}

describe('resolveFormat: overhang on strip/skyscraper class formats', () => {
  it('an overhang element on a strip format resolves via the slot path — same rect as the non-overhang control', () => {
    const control = resolveFormat(stripFixture(false), 'strip')
    const withOverhang = resolveFormat(stripFixture(true), 'strip')
    const controlEl = control.elements.find(e => e.el.id === 'headline')!
    const overhangEl = withOverhang.elements.find(e => e.el.id === 'headline')!
    expect(controlEl.culled).toBe(false)
    expect(overhangEl.culled).toBe(false)
    expect(overhangEl.rect).toEqual(controlEl.rect)
    expect(overhangEl.region).toEqual(controlEl.region)
  })
})
