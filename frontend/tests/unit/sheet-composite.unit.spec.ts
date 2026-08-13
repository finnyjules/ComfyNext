import { describe, expect, it } from 'vitest'
import {
  COMPOSITE_H, COMPOSITE_W, compositeLayout, coverFitCrop,
} from '~/lib/characters/sheetComposite'

describe('compositeLayout', () => {
  const rects = compositeLayout()

  it('has exactly the 5 canonical rects', () => {
    expect(rects).toEqual([
      { slot: 'body-front', x: 0, y: 0, w: 420, h: 1080 },
      { slot: 'body-back', x: 420, y: 0, w: 420, h: 1080 },
      { slot: 'portrait', x: 840, y: 0, w: 660, h: 1080 },
      { slot: 'face-neutral', x: 1500, y: 0, w: 420, h: 540 },
      { slot: 'face-smile', x: 1500, y: 540, w: 420, h: 540 },
    ])
  })

  it('full coverage — areas sum to exactly W×H', () => {
    const sum = rects.reduce((acc, r) => acc + r.w * r.h, 0)
    expect(sum).toBe(COMPOSITE_W * COMPOSITE_H)
  })

  it('every rect is fully within the sheet bounds', () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(COMPOSITE_W)
      expect(r.y + r.h).toBeLessThanOrEqual(COMPOSITE_H)
    }
  })

  it('no pairwise overlap', () => {
    function overlaps(a: typeof rects[number], b: typeof rects[number]): boolean {
      return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false)
      }
    }
  })

  it('portrait is the widest single rect', () => {
    const portrait = rects.find(r => r.slot === 'portrait')!
    const widest = rects.reduce((max, r) => r.w > max.w ? r : max, rects[0]!)
    expect(widest.slot).toBe('portrait')
    expect(portrait.w).toBeGreaterThan(rects.find(r => r.slot === 'body-front')!.w)
    expect(portrait.w).toBeGreaterThan(rects.find(r => r.slot === 'body-back')!.w)
  })

  it('the two face panels share one column, stacked (same x/w, split y/h)', () => {
    const neutral = rects.find(r => r.slot === 'face-neutral')!
    const smile = rects.find(r => r.slot === 'face-smile')!
    expect(neutral.x).toBe(smile.x)
    expect(neutral.w).toBe(smile.w)
    expect(neutral.y + neutral.h).toBe(smile.y) // neutral sits directly above smile
    expect(neutral.h + smile.h).toBe(COMPOSITE_H)
  })
})

describe('coverFitCrop', () => {
  it('source exactly matches destination aspect — no crop', () => {
    expect(coverFitCrop(100, 100, 200, 200)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 })
  })

  it('source wider than destination — crops left/right, centered', () => {
    // 200x100 source (2:1) into a 1:1 destination → crop to 100x100, centered horizontally.
    const { sx, sy, sw, sh } = coverFitCrop(200, 100, 100, 100)
    expect(sw).toBe(100)
    expect(sh).toBe(100)
    expect(sx).toBe(50)
    expect(sy).toBe(0)
  })

  it('source taller than destination — crops top/bottom, centered', () => {
    // 100x200 source (1:2) into a 1:1 destination → crop to 100x100, centered vertically.
    const { sx, sy, sw, sh } = coverFitCrop(100, 200, 100, 100)
    expect(sw).toBe(100)
    expect(sh).toBe(100)
    expect(sx).toBe(0)
    expect(sy).toBe(50)
  })
})
