import { describe, expect, it } from 'vitest'
import { fitText, typeSize, wrapLines } from '~~/shared/template-grid/text'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: {
    '1x1':    { w: 1080, h: 1080 },
    '728x90': { w: 728, h: 90 },
    '320x50': { w: 320, h: 50 },
    '160x600': { w: 160, h: 600 },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  elements: [],
}

describe('typeSize', () => {
  it('resolves the modular scale on the master', () => {
    expect(typeSize('caption', T, '1x1')).toBe(28)
    expect(typeSize('body', T, '1x1')).toBe(Math.round(28 * 1.414))
    expect(typeSize('display', T, '1x1')).toBe(Math.round(28 * 1.414 ** 4))
  })
  it('applies min-dim scaling with strip/skyscraper multipliers', () => {
    expect(typeSize('display', T, '728x90')).toBe(Math.round(28 * 1.414 ** 4 * (90 / 1080) * 3))
    expect(typeSize('display', T, '160x600')).toBe(Math.round(28 * 1.414 ** 4 * (160 / 1080) * 2))
  })
  it('never goes below the floor', () => {
    expect(typeSize('caption', T, '320x50')).toBeGreaterThanOrEqual(10)
  })
})

describe('wrapLines', () => {
  it('wraps greedily by estimated chars per line', () => {
    // 200px at 20px font → cpl = floor(200 / (20*0.55)) = 18
    const lines = wrapLines('single origin espresso delivered monthly', 20, 200)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(18)
  })
  it('hard-breaks overlong words', () => {
    const lines = wrapLines('a'.repeat(50), 20, 200)
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('fitText', () => {
  it('keeps the max size when copy fits', () => {
    const r = fitText({ content: 'Hi', maxFontSize: 80, w: 900, h: 200, lineHeight: 1.1, overflow: 'shrink' })
    expect(r.fontSize).toBe(80)
    expect(r.clipped).toBe(false)
  })
  it('shrinks long copy', () => {
    const long = 'word '.repeat(40).trim()
    const r = fitText({ content: long, maxFontSize: 80, w: 400, h: 120, lineHeight: 1.1, overflow: 'shrink' })
    expect(r.fontSize).toBeLessThan(80)
  })
  it('truncates with an ellipsis when even the floor overflows', () => {
    const long = 'word '.repeat(300).trim()
    const r = fitText({ content: long, maxFontSize: 80, w: 200, h: 40, lineHeight: 1.1, overflow: 'shrink-then-truncate' })
    expect(r.fontSize).toBe(10)
    expect(r.content.endsWith('…')).toBe(true)
    expect(r.clipped).toBe(false)
  })
  it('marks clipped under plain shrink when floor overflows', () => {
    const long = 'word '.repeat(300).trim()
    const r = fitText({ content: long, maxFontSize: 80, w: 200, h: 40, lineHeight: 1.1, overflow: 'shrink' })
    expect(r.clipped).toBe(true)
  })
  it('respects maxLines', () => {
    const long = 'word '.repeat(40).trim()
    const r = fitText({ content: long, maxFontSize: 30, w: 300, h: 500, lineHeight: 1.1, overflow: 'shrink-then-truncate', maxLines: 2 })
    expect(r.lines.length).toBeLessThanOrEqual(2)
  })
})
