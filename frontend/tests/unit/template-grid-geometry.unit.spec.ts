import { describe, expect, it } from 'vitest'
import {
  bleedToEdges, classifyFormat, formatDims, gridMetrics, regionToRect, remapRegion,
} from '~~/shared/template-grid/grid'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: {
    '1x1':    { w: 1080, h: 1080 },
    '9x16':   { w: 1080, h: 1920, safeArea: { top: 270, bottom: 380 } },
    '728x90': { w: 728, h: 90 },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  elements: [],
}

describe('classifyFormat', () => {
  it('classifies by ratio with spec boundaries', () => {
    expect(classifyFormat({ w: 1080, h: 1080 })).toBe('square')
    expect(classifyFormat({ w: 1080, h: 1350 })).toBe('square')      // 4:5 = 0.8 boundary
    expect(classifyFormat({ w: 300, h: 250 })).toBe('square')         // 1.2
    expect(classifyFormat({ w: 1080, h: 1920 })).toBe('portrait')     // 0.5625
    expect(classifyFormat({ w: 300, h: 600 })).toBe('portrait')       // 0.5
    expect(classifyFormat({ w: 1920, h: 1080 })).toBe('landscape')
    expect(classifyFormat({ w: 728, h: 90 })).toBe('strip')           // 8.09
    expect(classifyFormat({ w: 970, h: 250 })).toBe('strip')          // 3.88
    expect(classifyFormat({ w: 160, h: 600 })).toBe('skyscraper')     // 0.267
  })
  it('explicit class wins', () => {
    expect(classifyFormat({ w: 1080, h: 1080, class: 'strip' })).toBe('strip')
  })
})

describe('formatDims', () => {
  it('uses class defaults, allows overrides', () => {
    expect(formatDims({ w: 1080, h: 1080 })).toEqual({ cols: 6, rows: 6 })
    expect(formatDims({ w: 728, h: 90 })).toEqual({ cols: 12, rows: 1 })
    expect(formatDims({ w: 160, h: 600 })).toEqual({ cols: 3, rows: 10 })
    expect(formatDims({ w: 1080, h: 1080, cols: 12, rows: 8 })).toEqual({ cols: 12, rows: 8 })
  })
})

describe('gridMetrics', () => {
  it('computes master metrics: margins, gutters, cell sizes', () => {
    const m = gridMetrics(T, '1x1')
    expect(m.cols).toBe(6)
    expect(m.margin).toBe(72)
    expect(m.gutter).toBe(24)
    expect(m.originX).toBe(72)
    // inner = 1080 - 144 = 936; cells = (936 - 5*24)/6 = 136
    expect(m.cellW).toBeCloseTo(136, 5)
    expect(m.cellH).toBeCloseTo(136, 5)
  })
  it('scales metrics by min-dimension and applies safe areas', () => {
    const m = gridMetrics(T, '9x16')   // s = 1080/1080 = 1
    expect(m.originY).toBe(270 + 72)
    // innerH = 1920 - 270 - 380 - 144 = 1126; rows=8 → cellH = (1126 - 7*24)/8
    expect(m.cellH).toBeCloseTo((1126 - 7 * 24) / 8, 5)
  })
  it('floors gutter/margin on tiny formats', () => {
    const m = gridMetrics(T, '728x90')   // s = 90/1080 = 0.0833 → gutter 2, margin 6
    expect(m.gutter).toBeCloseTo(2, 5)
    expect(m.margin).toBeCloseTo(6, 5)
  })
})

describe('regionToRect', () => {
  it('maps a region to pixels on the master grid', () => {
    const m = gridMetrics(T, '1x1')
    const r = regionToRect({ col: 1, colSpan: 6, row: 4, rowSpan: 2 }, m)
    expect(r.x).toBe(72)
    expect(r.w).toBeCloseTo(936, 5)
    expect(r.y).toBeCloseTo(72 + 3 * (136 + 24), 5)
    expect(r.h).toBeCloseTo(2 * 136 + 24, 5)
  })
  it('clamps out-of-range regions instead of overflowing', () => {
    const m = gridMetrics(T, '1x1')
    const r = regionToRect({ col: 5, colSpan: 9, row: 1, rowSpan: 1 }, m)
    expect(r.x + r.w).toBeLessThanOrEqual(1080 - 72 + 0.001)
  })
})

describe('bleedToEdges', () => {
  it('full-grid region covers the whole canvas', () => {
    const m = gridMetrics(T, '1x1')
    const region = { col: 1, colSpan: 6, row: 1, rowSpan: 6 }
    const rect = regionToRect(region, m)
    const bled = bleedToEdges(rect, region, m, 1080, 1080)
    expect(bled).toEqual({ x: 0, y: 0, w: 1080, h: 1080 })
  })
  it('left-half full-height bleeds left/top/bottom, keeps grid line on right', () => {
    const m = gridMetrics(T, '1x1')
    const region = { col: 1, colSpan: 3, row: 1, rowSpan: 6 }
    const rect = regionToRect(region, m)
    const bled = bleedToEdges(rect, region, m, 1080, 1080)
    expect(bled.x).toBe(0)
    expect(bled.y).toBe(0)
    expect(bled.h).toBe(1080)
    // right edge stays at rect.x + rect.w (the grid line, not the canvas edge)
    expect(bled.x + bled.w).toBeCloseTo(rect.x + rect.w, 5)
  })
  it('inner region (not touching any edge) is unchanged', () => {
    const m = gridMetrics(T, '1x1')
    const region = { col: 2, colSpan: 4, row: 2, rowSpan: 4 }
    const rect = regionToRect(region, m)
    const bled = bleedToEdges(rect, region, m, 1080, 1080)
    expect(bled).toEqual(rect)
  })
  it('ignores safe areas — full-bleed reaches platform UI zones', () => {
    // 9x16 has top: 270, bottom: 380 safe areas. A full-grid bleed should
    // still cover the entire 1080×1920, not just the safe-area-inset box.
    const m = gridMetrics(T, '9x16')
    const region = { col: 1, colSpan: 4, row: 1, rowSpan: 8 }
    const rect = regionToRect(region, m)
    const bled = bleedToEdges(rect, region, m, 1080, 1920)
    expect(bled).toEqual({ x: 0, y: 0, w: 1080, h: 1920 })
  })
})

describe('remapRegion', () => {
  it('remaps proportionally with rounding (6x6 → 4x8)', () => {
    const out = remapRegion(
      { col: 1, colSpan: 6, row: 4, rowSpan: 2 },
      { cols: 6, rows: 6 }, { cols: 4, rows: 8 },
    )
    expect(out).toEqual({ col: 1, colSpan: 4, row: 5, rowSpan: 3 })
  })
  it('is the identity on same dims', () => {
    const r = { col: 2, colSpan: 3, row: 1, rowSpan: 2 }
    expect(remapRegion(r, { cols: 6, rows: 6 }, { cols: 6, rows: 6 })).toEqual(r)
  })
  it('never produces zero spans', () => {
    const out = remapRegion(
      { col: 6, colSpan: 1, row: 1, rowSpan: 1 },
      { cols: 6, rows: 6 }, { cols: 3, rows: 1 },
    )
    expect(out.colSpan).toBeGreaterThanOrEqual(1)
    expect(out.col).toBeLessThanOrEqual(3)
    expect(out.rowSpan).toBe(1)
  })
})
