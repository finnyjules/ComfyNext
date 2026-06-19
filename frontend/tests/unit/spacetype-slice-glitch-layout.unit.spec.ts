import { describe, it, expect } from 'vitest'
import {
  revealGlitch, ease, churnSeed, bandLayout, segmentRow, scaleXForGlitch,
  pickTypeColor, stripOffsets, lineLayout, blockSegments, fontJitter, sceneMotion, type CharBox,
} from '../../app/lib/spacetype/sliceGlitchLayout'
import { mulberry32 } from '../../app/lib/spacetype/rng'

function mulRng(seed: number) { return mulberry32(seed) }

describe('revealGlitch', () => {
  it('ramps 0→1 over the reveal fraction then holds at 1', () => {
    expect(revealGlitch(0, 0.4)).toBeCloseTo(0)
    expect(revealGlitch(0.2, 0.4)).toBeCloseTo(0.5)
    expect(revealGlitch(0.4, 0.4)).toBeCloseTo(1)
    expect(revealGlitch(0.8, 0.4)).toBeCloseTo(1)
  })
  it('reveal fraction 0 means always fully glitched', () => {
    expect(revealGlitch(0, 0)).toBeCloseTo(1)
  })
})

describe('ease', () => {
  it('fixes endpoints at 0 and 1 for every mode', () => {
    for (const m of ['linear', 'in', 'out', 'in-out'] as const) {
      expect(ease(0, m)).toBeCloseTo(0)
      expect(ease(1, m)).toBeCloseTo(1)
    }
  })
  it('linear is the identity', () => {
    expect(ease(0.3, 'linear')).toBeCloseTo(0.3)
  })
  it('ease-in lags below linear (slow start), ease-out leads above (snappy)', () => {
    expect(ease(0.3, 'in')).toBeLessThan(0.3)
    expect(ease(0.3, 'out')).toBeGreaterThan(0.3)
  })
  it('clamps out-of-range input', () => {
    expect(ease(-1, 'out')).toBeCloseTo(0)
    expect(ease(2, 'in')).toBeCloseTo(1)
  })
})

describe('sceneMotion', () => {
  it('starts on scene 0 with no burst', () => {
    expect(sceneMotion(0, 4, 0.3, 1, 'in-out')).toEqual({ scene: 0, burst: 0 })
  })
  it('loops: end of the cycle returns to scene 0, burst 0 (matches the start)', () => {
    const end = sceneMotion(0.9999, 4, 0.3, 1, 'linear')
    expect(end.scene).toBe(0)
    expect(end.burst).toBeCloseTo(0, 2)
  })
  it('speed 0 or single scene is frozen on scene 0', () => {
    expect(sceneMotion(0.5, 4, 0.3, 0, 'linear')).toEqual({ scene: 0, burst: 0 })
    expect(sceneMotion(0.5, 1, 0.3, 1, 'linear')).toEqual({ scene: 0, burst: 0 })
  })
  it('holds the scene index outside the transition window', () => {
    // 4 scenes, transition 0.3 → scene 1 holds for t in [0.25, 0.25+0.7*0.25)
    expect(sceneMotion(0.30, 4, 0.3, 1, 'linear').scene).toBe(1)
    expect(sceneMotion(0.30, 4, 0.3, 1, 'linear').burst).toBe(0)
  })
  it('bursts during the transition and visits all scenes across the cycle', () => {
    const scenes = new Set<number>()
    let maxBurst = 0
    for (let k = 0; k < 200; k++) {
      const m = sceneMotion(k / 200, 4, 0.4, 1, 'linear')
      scenes.add(m.scene); maxBurst = Math.max(maxBurst, m.burst)
    }
    expect(scenes).toEqual(new Set([0, 1, 2, 3]))
    expect(maxBurst).toBeGreaterThan(0.9)
  })
})

describe('churnSeed', () => {
  it('quantizes time into churnRate steps and mixes with base seed', () => {
    expect(churnSeed(0.00, 4, 9)).toBe(churnSeed(0.10, 4, 9))
    expect(churnSeed(0.00, 4, 9)).not.toBe(churnSeed(0.30, 4, 9))
  })
  it('churnRate 0 → static (base seed every frame)', () => {
    expect(churnSeed(0.7, 0, 9)).toBe(churnSeed(0.1, 0, 9))
  })
})

describe('bandLayout', () => {
  it('divides height into N contiguous bands covering [0,height]', () => {
    const bands = bandLayout(4, 1000)
    expect(bands).toHaveLength(4)
    expect(bands[0]!.y).toBe(0)
    expect(bands[3]!.y + bands[3]!.h).toBeCloseTo(1000)
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.y).toBeCloseTo(bands[i - 1]!.y + bands[i - 1]!.h)
  })
})

describe('segmentRow', () => {
  it('partitions [0,width] into segments whose widths sum to width', () => {
    const segs = segmentRow(mulRng(1), 0, 900, 3, 6)
    const sum = segs.reduce((a, s) => a + s.w, 0)
    expect(sum).toBeCloseTo(900)
    expect(segs.every(s => s.colorIndex >= 0 && s.colorIndex < 6)).toBe(true)
  })
  it('is deterministic for the same seed', () => {
    expect(segmentRow(mulRng(5), 0, 900, 3, 6)).toEqual(segmentRow(mulRng(5), 0, 900, 3, 6))
  })
})

describe('lineLayout', () => {
  it('centers the advances within W and carries widths/space flags', () => {
    const boxes = lineLayout([100, 50, 100], [false, true, false], 400)
    expect(boxes[0]!.x).toBeCloseTo(75)        // (400 - 250) / 2
    expect(boxes[1]!.x).toBeCloseTo(175)
    expect(boxes[1]!.isSpace).toBe(true)
    expect(boxes[2]!.x + boxes[2]!.w).toBeCloseTo(325)
  })
})

describe('blockSegments', () => {
  // "AB C": A,B glyphs, a space, then C
  const boxes: CharBox[] = [
    { x: 0, w: 50, isSpace: false }, { x: 50, w: 50, isSpace: false },
    { x: 100, w: 30, isSpace: true }, { x: 130, w: 50, isSpace: false },
  ]
  it('line → one full-width block', () => {
    const segs = blockSegments('line', boxes, 900, mulRng(1), 3, 6)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.x).toBe(0); expect(segs[0]!.w).toBe(900)
  })
  it('word → one block per run of non-space chars', () => {
    const segs = blockSegments('word', boxes, 900, mulRng(1), 3, 6)
    expect(segs).toHaveLength(2)
    expect(segs[0]!.x).toBe(0); expect(segs[0]!.w).toBe(100)   // "AB"
    expect(segs[1]!.x).toBe(130); expect(segs[1]!.w).toBe(50)  // "C"
  })
  it('character → one block per non-space char', () => {
    const segs = blockSegments('character', boxes, 900, mulRng(1), 3, 6)
    expect(segs).toHaveLength(3)
    expect(segs.map(s => s.w)).toEqual([50, 50, 50])
  })
  it('random → partition summing to W', () => {
    const segs = blockSegments('random', boxes, 900, mulRng(1), 4, 6)
    expect(segs.reduce((a, s) => a + s.w, 0)).toBeCloseTo(900)
  })
})

describe('fontJitter', () => {
  it('zero amounts → base weight, no slant', () => {
    const j = fontJitter(3, 1, 400, 0, 0)
    expect(j.weight).toBe(400)
    expect(j.slant).toBeCloseTo(0)
  })
  it('same unitId+seed is deterministic; different unitId diverges', () => {
    expect(fontJitter(2, 9, 400, 1, 1)).toEqual(fontJitter(2, 9, 400, 1, 1))
    expect(fontJitter(2, 9, 400, 1, 1).weight).not.toBe(fontJitter(5, 9, 400, 1, 1).weight)
  })
  it('weight stays within [100,900] and slant within ±0.35', () => {
    for (let u = 0; u < 50; u++) {
      const j = fontJitter(u, 7, 500, 1, 1)
      expect(j.weight).toBeGreaterThanOrEqual(100); expect(j.weight).toBeLessThanOrEqual(900)
      expect(Math.abs(j.slant)).toBeLessThanOrEqual(0.35)
    }
  })
})

describe('scaleXForGlitch', () => {
  it('is 1 at glitch=0 and natW→targetW at glitch=1', () => {
    expect(scaleXForGlitch(100, 300, 0)).toBeCloseTo(1)
    expect(scaleXForGlitch(100, 300, 1)).toBeCloseTo(3)
    expect(scaleXForGlitch(100, 300, 0.5)).toBeCloseTo(2)
  })
})

describe('pickTypeColor', () => {
  it('white mode always returns -1 (= white)', () => {
    expect(pickTypeColor(mulRng(1), 'white', 6)).toBe(-1)
  })
  it('palette mode returns a valid palette index', () => {
    const idx = pickTypeColor(mulRng(1), 'palette', 6)
    expect(idx).toBeGreaterThanOrEqual(0); expect(idx).toBeLessThan(6)
  })
})

describe('stripOffsets', () => {
  const base = { height: 1000, sliceH: 10, glitch: 1, seed: 3, bandShift: 80, tearAmount: 30, tearFrequency: 24 }
  it('returns one offset per strip', () => {
    expect(stripOffsets(base)).toHaveLength(100)
  })
  it('all-zero at glitch=0', () => {
    expect(stripOffsets({ ...base, glitch: 0 }).every(o => o === 0)).toBe(true)
  })
  it('max magnitude scales with glitch', () => {
    const m = (g: number) => Math.max(...stripOffsets({ ...base, glitch: g }).map(Math.abs))
    expect(m(1)).toBeGreaterThan(m(0.5))
  })
  it('is deterministic for the same seed', () => {
    expect(stripOffsets(base)).toEqual(stripOffsets(base))
  })
})
