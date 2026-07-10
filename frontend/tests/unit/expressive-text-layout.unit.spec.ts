import { describe, expect, it } from 'vitest'
import { layoutExpressive } from '~~/shared/text-layout/expressive'
import type { ExpressiveParams } from '~~/shared/text-layout/expressive'

// Monospace-ish measure: 10px per character. Keeps the expected geometry easy
// to reason about in assertions.
const measure = (w: string) => w.length * 10

function params(p: Partial<ExpressiveParams> = {}): ExpressiveParams {
  return { wordsPerLine: 1, placement: 'random', jitterX: 0, jitterY: 0, seed: 1, ...p }
}

describe('layoutExpressive — grouping', () => {
  it('groups words into lines by wordsPerLine', () => {
    const out = layoutExpressive({ text: 'a b c d', boxWidth: 300, lineHeight: 40, measure, params: params({ wordsPerLine: 2 }) })
    expect(out.lines).toBe(2)
    expect(out.words).toHaveLength(4)
    expect(out.words.map(w => w.line)).toEqual([0, 0, 1, 1])
  })

  it('a trailing partial line still counts (5 words / 2 per line = 3 lines)', () => {
    const out = layoutExpressive({ text: 'a b c d e', boxWidth: 300, lineHeight: 40, measure, params: params({ wordsPerLine: 2 }) })
    expect(out.lines).toBe(3)
    expect(out.words.map(w => w.line)).toEqual([0, 0, 1, 1, 2])
  })

  it('reports width = boxWidth and height = lines * lineHeight', () => {
    const out = layoutExpressive({ text: 'a b c d', boxWidth: 300, lineHeight: 40, measure, params: params({ wordsPerLine: 2 }) })
    expect(out.width).toBe(300)
    expect(out.height).toBe(80)
  })

  it('empty / whitespace-only text yields no words and zero lines', () => {
    const out = layoutExpressive({ text: '   \n  ', boxWidth: 300, lineHeight: 40, measure, params: params() })
    expect(out.words).toHaveLength(0)
    expect(out.lines).toBe(0)
    expect(out.height).toBe(0)
  })

  it('splits on any whitespace including newlines (expressive owns wrapping)', () => {
    const out = layoutExpressive({ text: 'one\ntwo  three', boxWidth: 300, lineHeight: 40, measure, params: params({ wordsPerLine: 3 }) })
    expect(out.words.map(w => w.text)).toEqual(['one', 'two', 'three'])
    expect(out.lines).toBe(1)
  })
})

describe('layoutExpressive — vertical bands', () => {
  it('places each line at line * lineHeight when jitterY is 0', () => {
    const out = layoutExpressive({ text: 'a b c d', boxWidth: 300, lineHeight: 40, measure, params: params({ wordsPerLine: 2 }) })
    expect(out.words[0]!.y).toBe(0)
    expect(out.words[2]!.y).toBe(40)
  })
})

describe('layoutExpressive — no overflow', () => {
  it('never positions a word past the box edges', () => {
    const out = layoutExpressive({ text: 'alpha beta gamma delta epsilon zeta', boxWidth: 200, lineHeight: 40, measure, params: params({ placement: 'random', jitterX: 1, seed: 3 }) })
    for (const wd of out.words) {
      expect(wd.x).toBeGreaterThanOrEqual(0)
      expect(wd.x + wd.w).toBeLessThanOrEqual(200 + 1e-9)
    }
  })

  it('clamps a word wider than the box to x = 0', () => {
    const out = layoutExpressive({ text: 'supercalifragilistic', boxWidth: 50, lineHeight: 40, measure, params: params({ jitterX: 1, seed: 9 }) })
    expect(out.words[0]!.x).toBe(0)
  })
})

describe('layoutExpressive — placement: random', () => {
  it('centers a single word in its cell when jitterX is 0', () => {
    // 'hello' = 50px wide in a 300px box → centered at (300-50)/2 = 125
    const out = layoutExpressive({ text: 'hello', boxWidth: 300, lineHeight: 40, measure, params: params({ placement: 'random', wordsPerLine: 1, jitterX: 0 }) })
    expect(out.words[0]!.x).toBeCloseTo(125)
  })
})

describe('layoutExpressive — placement: edges', () => {
  it('snaps two words to opposite edges when jitterX is 0', () => {
    // 'left' = 40px → x 0; 'right' = 50px → x 300-50 = 250
    const out = layoutExpressive({ text: 'left right', boxWidth: 300, lineHeight: 40, measure, params: params({ placement: 'edges', wordsPerLine: 2, jitterX: 0 }) })
    expect(out.words[0]!.x).toBeCloseTo(0)
    expect(out.words[1]!.x).toBeCloseTo(250)
  })
})

describe('layoutExpressive — determinism & reroll', () => {
  it('is deterministic: same seed + inputs → identical positions', () => {
    const mk = () => layoutExpressive({ text: 'the quick brown fox jumps', boxWidth: 260, lineHeight: 40, measure, params: params({ placement: 'random', jitterX: 1, seed: 42 }) })
    expect(mk().words.map(w => [w.x, w.y])).toEqual(mk().words.map(w => [w.x, w.y]))
  })

  it('reroll (new seed) changes positions for a randomized layout', () => {
    const a = layoutExpressive({ text: 'the quick brown fox jumps', boxWidth: 260, lineHeight: 40, measure, params: params({ placement: 'random', jitterX: 1, seed: 1 }) })
    const b = layoutExpressive({ text: 'the quick brown fox jumps', boxWidth: 260, lineHeight: 40, measure, params: params({ placement: 'random', jitterX: 1, seed: 2 }) })
    expect(a.words.map(w => w.x)).not.toEqual(b.words.map(w => w.x))
  })
})
