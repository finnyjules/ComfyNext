import { describe, expect, it } from 'vitest'
import { layoutExpressive } from '~~/shared/text-layout/expressive'
import { layoutExpressiveBoxes } from '~~/shared/text-layout/boxes'

const measure = (w: string) => w.length * 10

describe('layoutExpressive — horizontal justify', () => {
  it('spreads a line’s words edge-to-edge, overriding placement + X jitter', () => {
    // widths a=10 bb=20 ccc=30, total 60 in a 300 box → gap (300-60)/2 = 120
    const out = layoutExpressive({
      text: 'a bb ccc', boxWidth: 300, lineHeight: 40, measure,
      params: { wordsPerLine: 3, placement: 'random', jitterX: 1, jitterY: 0, seed: 9 },
      justifyX: true,
    })
    const xs = out.words.map(w => w.x)
    expect(xs[0]).toBeCloseTo(0)      // first word flush left
    expect(xs[1]).toBeCloseTo(130)    // 0 + 10 + 120
    expect(xs[2]).toBeCloseTo(270)    // 130 + 20 + 120
    expect(out.words[2]!.x + out.words[2]!.w).toBeCloseTo(300)  // last word flush right
  })
  it('single word per line sits flush left under justify', () => {
    const out = layoutExpressive({
      text: 'solo', boxWidth: 300, lineHeight: 40, measure,
      params: { wordsPerLine: 1, placement: 'random', jitterX: 1, jitterY: 0, seed: 3 },
      justifyX: true,
    })
    expect(out.words[0]!.x).toBeCloseTo(0)
  })
})

describe('layoutExpressive — vertical justify', () => {
  it('spreads line bands from top to bottom of the box height, overriding Y jitter', () => {
    // 3 lines in a 200px box, lineHeight 40 → bands at i/2*(200-40) = 0, 80, 160
    const out = layoutExpressive({
      text: 'a b c', boxWidth: 300, boxHeight: 200, lineHeight: 40, measure,
      params: { wordsPerLine: 1, placement: 'scatter' as any, jitterX: 0, jitterY: 1, seed: 2 },
      justifyY: true,
    })
    expect(out.words.map(w => w.y)).toEqual([0, 80, 160])
    expect(out.height).toBe(200)   // fills the box → consumer applies no extra vOffset
  })
  it('single line under vertical justify pins to the top', () => {
    const out = layoutExpressive({
      text: 'one two', boxWidth: 300, boxHeight: 200, lineHeight: 40, measure,
      params: { wordsPerLine: 2, placement: 'random', jitterX: 0, jitterY: 1, seed: 1 },
      justifyY: true,
    })
    expect(out.words.every(w => w.y === 0)).toBe(true)
  })
})

describe('layoutExpressiveBoxes — justify', () => {
  const four = [
    { id: 'a', w: 80, h: 60 }, { id: 'b', w: 80, h: 60 },
    { id: 'c', w: 80, h: 60 }, { id: 'd', w: 80, h: 60 },
  ]
  it('justifyX distributes objects edge-to-edge across the width', () => {
    const out = layoutExpressiveBoxes({
      items: four, boxWidth: 400, boxHeight: 300,
      params: { placement: 'scatter', jitter: 1, rotation: 0, seed: 5, justifyX: true },
    })
    // x_i = i/3 * (400-80)
    expect(out.map(b => b.x)).toEqual([0, expect.closeTo(106.667, 2), expect.closeTo(213.333, 2), 320])
  })
  it('justifyY distributes objects edge-to-edge down the height', () => {
    const out = layoutExpressiveBoxes({
      items: four, boxWidth: 400, boxHeight: 300,
      params: { placement: 'scatter', jitter: 1, rotation: 0, seed: 5, justifyY: true },
    })
    // y_i = i/3 * (300-60)
    expect(out.map(b => b.y)).toEqual([0, 80, 160, 240])
  })
  it('a single object under justify sits at the origin corner', () => {
    const out = layoutExpressiveBoxes({
      items: [{ id: 'x', w: 80, h: 60 }], boxWidth: 400, boxHeight: 300,
      params: { placement: 'scatter', jitter: 1, rotation: 0, seed: 5, justifyX: true, justifyY: true },
    })
    expect([out[0]!.x, out[0]!.y]).toEqual([0, 0])
  })
})
