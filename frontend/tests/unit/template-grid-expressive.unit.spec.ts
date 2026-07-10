import { describe, expect, it } from 'vitest'
import { gridExpressiveLayout, expressiveVOffset } from '~~/shared/template-grid/expressive'
import type { ExpressiveParams } from '~~/shared/text-layout/expressive'

function params(p: Partial<ExpressiveParams> = {}): ExpressiveParams {
  return { wordsPerLine: 1, placement: 'random', jitterX: 0, jitterY: 0, seed: 1, ...p }
}

describe('gridExpressiveLayout', () => {
  it('uses the CHAR_W estimate so editor and export agree (word width = len·fontSize·0.55)', () => {
    // 'edges', 2 words, jitter 0: word 0 → x 0; word 1 → x = boxWidth - w1.
    // 'right' = 5 chars → 5 * 20 * 0.55 = 55px wide → x = 300 - 55 = 245.
    const lay = gridExpressiveLayout({
      content: 'left right', fontSize: 20, boxWidth: 300, lineHeight: 1.2,
      params: params({ placement: 'edges', wordsPerLine: 2 }),
    })
    expect(lay.words[0]!.x).toBeCloseTo(0)
    expect(lay.words[1]!.x).toBeCloseTo(245)
  })

  it('derives line band height from fontSize × lineHeight', () => {
    const lay = gridExpressiveLayout({
      content: 'a b', fontSize: 20, boxWidth: 300, lineHeight: 1.5,
      params: params({ wordsPerLine: 1 }),
    })
    // two lines, band height = 20 * 1.5 = 30
    expect(lay.words[1]!.y).toBeCloseTo(30)
    expect(lay.height).toBeCloseTo(60)
  })
})

describe('expressiveVOffset', () => {
  it('top → 0', () => {
    expect(expressiveVOffset(200, 60, 'top')).toBe(0)
  })
  it('middle → half the slack', () => {
    expect(expressiveVOffset(200, 60, 'middle')).toBe(70)
  })
  it('bottom → all the slack', () => {
    expect(expressiveVOffset(200, 60, 'bottom')).toBe(140)
  })
  it('never negative when the block is taller than the box', () => {
    expect(expressiveVOffset(50, 120, 'middle')).toBe(0)
    expect(expressiveVOffset(50, 120, 'bottom')).toBe(0)
  })
})
