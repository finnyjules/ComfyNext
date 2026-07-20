import { describe, expect, it } from 'vitest'
import { gridExpressiveLayout, expressiveVOffset, mergeExpressivePatch } from '~~/shared/template-grid/expressive'
import { estimateWordEm } from '~~/shared/template-grid/text'
import type { ExpressiveParams } from '~~/shared/text-layout/expressive'

function params(p: Partial<ExpressiveParams> = {}): ExpressiveParams {
  return { wordsPerLine: 1, placement: 'random', jitterX: 0, jitterY: 0, seed: 1, ...p }
}

describe('estimateWordEm — per-glyph width estimate', () => {
  // Ground-truth widths below were measured in Chrome (canvas measureText at
  // 100px) across the curated families (Inter, Space Grotesk, Playfair
  // Display, Bebas Neue, Anton) × weights 400/700. The estimate must never
  // under-measure any of them: an under-measured word gets edge-anchored too
  // far right and its glyphs clip at the element box ("the text is cut off").
  it('covers wide-glyph words the flat 0.55 average under-measured', () => {
    // Real 'new': Inter 1.974em, Space Grotesk 1.996em. Flat estimate was
    // 3 × 0.55 = 1.65em → placed ~26px too far right at 80px font → clipped.
    expect(estimateWordEm('new')).toBeGreaterThanOrEqual(1.996)
    // …but not wastefully wide (would visibly inset justified lines).
    expect(estimateWordEm('new')).toBeLessThanOrEqual(2.3)
  })

  it('covers wide caps', () => {
    expect(estimateWordEm('WOW')).toBeGreaterThanOrEqual(2.735) // Inter real
  })

  it('covers Bebas small-caps rendering of narrow lowercase', () => {
    // Bebas renders lowercase as small caps: its real 'ill' is 0.88em.
    expect(estimateWordEm('ill')).toBeGreaterThanOrEqual(0.88)
    // Flat estimate said 1.65em — twice the real width.
    expect(estimateWordEm('ill')).toBeLessThanOrEqual(1.1)
  })

  it('falls back to the base letter for accented characters', () => {
    expect(estimateWordEm('éé')).toBeCloseTo(estimateWordEm('ee'), 5)
  })
})

describe('gridExpressiveLayout', () => {
  it('an edge-anchored wide word keeps its REAL width inside the box (no clip)', () => {
    // The exact regression: "A new kind of skincare is coming" at 80px with
    // edge placement put 'new' at boxWidth − 132 (flat estimate) while the
    // real glyphs span ~158px → 26px clipped by overflow:hidden.
    const lay = gridExpressiveLayout({
      content: 'left new', fontSize: 80, boxWidth: 800, lineHeight: 1.1,
      params: params({ placement: 'edges', wordsPerLine: 2 }),
    })
    const REAL_NEW = 1.996 * 80 // widest curated rendering (Space Grotesk)
    expect(lay.words[1]!.x + REAL_NEW).toBeLessThanOrEqual(800 + 1e-6)
  })

  it('edge placement snaps word 0 to x=0 and word 1 flush to its estimated width', () => {
    const lay = gridExpressiveLayout({
      content: 'left right', fontSize: 20, boxWidth: 300, lineHeight: 1.2,
      params: params({ placement: 'edges', wordsPerLine: 2 }),
    })
    expect(lay.words[0]!.x).toBeCloseTo(0)
    expect(lay.words[1]!.x).toBeCloseTo(300 - estimateWordEm('right') * 20)
    expect(lay.words[1]!.x).toBeCloseTo(300 - lay.words[1]!.w)
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
    // maxLeft = boxWidth - the word's estimated width
    expect(lay.words[1]!.x).toBeCloseTo(300 - estimateWordEm('beta') * 20)
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
