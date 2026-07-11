import { describe, expect, it } from 'vitest'
import { gridExpressiveLayout, expressiveVOffset, mergeExpressivePatch } from '~~/shared/template-grid/expressive'
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

describe('word nudges', () => {
  const base = () => gridExpressiveLayout({
    content: 'alpha beta', fontSize: 20, boxWidth: 300, boxHeight: 400, lineHeight: 1.5,
    params: params(),
  })
  const nudged = (nudges: any, boxWidth = 300) => gridExpressiveLayout({
    content: 'alpha beta', fontSize: 20, boxWidth, boxHeight: 400, lineHeight: 1.5,
    params: params({ nudges } as any),
  })

  it('moves the nudged word by dx×boxWidth / dy×boxHeight, leaves others alone', () => {
    const lay = nudged({ 1: { dx: 0.1, dy: 0.05 } })
    expect(lay.words[0]).toEqual(base().words[0])
    expect(lay.words[1]!.x).toBeCloseTo(base().words[1]!.x + 30)   // 0.1 × 300
    expect(lay.words[1]!.y).toBeCloseTo(base().words[1]!.y + 20)   // 0.05 × 400
  })

  it('scales proportionally with the box (same fraction, bigger box → bigger px)', () => {
    const at300 = nudged({ 1: { dx: 0.1, dy: 0 } }, 300).words[1]!.x - base().words[1]!.x
    const at600base = gridExpressiveLayout({
      content: 'alpha beta', fontSize: 20, boxWidth: 600, boxHeight: 400, lineHeight: 1.5, params: params(),
    })
    const at600 = nudged({ 1: { dx: 0.1, dy: 0 } }, 600).words[1]!.x - at600base.words[1]!.x
    expect(at300).toBeCloseTo(30)
    expect(at600).toBeCloseTo(60)
  })

  it('clamps to the box: a word can touch but never escape', () => {
    const lay = nudged({ 0: { dx: -5, dy: -5 }, 1: { dx: 5, dy: 5 } })
    expect(lay.words[0]!.x).toBe(0)
    expect(lay.words[0]!.y).toBe(0)
    // maxLeft = boxWidth - wordWidth ('beta' = 4 × 20 × 0.55 = 44 → 256)
    expect(lay.words[1]!.x).toBeCloseTo(256)
    // y max = boxHeight - lineBand = 400 - 30 = 370
    expect(lay.words[1]!.y).toBeCloseTo(370)
  })

  it('ignores out-of-range indices and non-finite values', () => {
    expect(nudged({ 7: { dx: 0.5, dy: 0.5 } }).words).toEqual(base().words)
    expect(nudged({ 1: { dx: Number.NaN, dy: undefined } }).words).toEqual(base().words)
  })

  it('no nudges / empty nudges → identical output', () => {
    expect(nudged({}).words).toEqual(base().words)
  })
})

describe('mergeExpressivePatch', () => {
  const cur = () => ({ ...params(), nudges: { 0: { dx: 0.1, dy: 0.2 } } })

  it('drops nudges when an engine param changes', () => {
    for (const patch of [{ seed: 2 }, { placement: 'edges' as const }, { wordsPerLine: 2 }, { jitterX: 0.5 }, { jitterY: 0.5 }]) {
      const merged = mergeExpressivePatch(cur(), patch)
      expect(merged.nudges).toBeUndefined()
      expect(merged).toMatchObject(patch)
    }
  })

  it('keeps nudges for non-engine patches (e.g. writing nudges themselves)', () => {
    const merged = mergeExpressivePatch(cur(), { nudges: { 1: { dx: 0.3, dy: 0 } } })
    expect(merged.nudges).toEqual({ 1: { dx: 0.3, dy: 0 } })
    expect(merged.seed).toBe(1)
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
