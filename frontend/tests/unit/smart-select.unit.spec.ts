import { describe, it, expect } from 'vitest'
import {
  samplePointsFromStroke, layerAffine, invertAffine, applyAffine,
  luminanceToAlpha, alphaBounds, cutoutPlacement, pickSamSegments, type Pt, type MaskCandidate,
} from '~/lib/compositor/smartSelect'

describe('samplePointsFromStroke', () => {
  it('returns the single point for a click', () => {
    expect(samplePointsFromStroke([{ x: 10, y: 20 }])).toEqual([{ x: 10, y: 20 }])
  })
  it('spreads ≤ max points evenly along a long stroke', () => {
    const stroke: Pt[] = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0 }))
    const pts = samplePointsFromStroke(stroke, { max: 8 })
    expect(pts.length).toBe(8)
    // Even arc-length coverage: first sample in the first eighth, last in the last eighth.
    expect(pts[0]!.x).toBeLessThan(200 / 8)
    expect(pts[7]!.x).toBeGreaterThan(200 - 200 / 8)
    // Strictly increasing (no bunching/backtracking on a monotone stroke).
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x).toBeGreaterThan(pts[i - 1]!.x)
  })
  it('drops samples closer than minDist (tiny scribble → fewer points)', () => {
    const stroke: Pt[] = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: 0 })) // 4.9px long
    const pts = samplePointsFromStroke(stroke, { max: 8, minDist: 6 })
    expect(pts.length).toBe(1)
  })
})

describe('affine (artboard ↔ image)', () => {
  // Layer centered at (0.5, 0.5) of a 1000×800 artboard, box 400×300 artboard px
  // (w,h width-normalized: 0.4, 0.3), rotated 30°, image capped at 1024×768.
  const layer = { x: 0.5, y: 0.5, w: 0.4, h: 0.3, rotation: 30 }
  const m = layerAffine(layer, 1000, 800, 1024, 768)
  it('maps the layer center to the image center', () => {
    const p = applyAffine(m, { x: 500, y: 400 })
    expect(p.x).toBeCloseTo(512, 6)
    expect(p.y).toBeCloseTo(384, 6)
  })
  it('round-trips through the inverse', () => {
    const inv = invertAffine(m)
    const q = applyAffine(inv, applyAffine(m, { x: 123, y: 456 }))
    expect(q.x).toBeCloseTo(123, 6)
    expect(q.y).toBeCloseTo(456, 6)
  })
  it('matches runRegionFill for the unrotated case: layer top-left corner → image (0,0)', () => {
    const m0 = layerAffine({ x: 0.5, y: 0.5, w: 0.4, h: 0.3, rotation: 0 }, 1000, 800, 1024, 768)
    const p = applyAffine(m0, { x: 500 - 200, y: 400 - 150 })
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })
})

describe('luminanceToAlpha', () => {
  it('white → opaque white, black → transparent, gray → partial', () => {
    //                     white          black        mid gray (opaque source alpha)
    const d = new Uint8ClampedArray([255,255,255,255,  0,0,0,255,  128,128,128,255])
    luminanceToAlpha(d)
    expect([d[0], d[1], d[2], d[3]]).toEqual([255, 255, 255, 255])
    expect(d[7]).toBe(0)
    expect(d[11]).toBeGreaterThan(100)
    expect(d[11]).toBeLessThan(160)
    // RGB forced white so the mask composites as a pure silhouette.
    expect([d[4], d[5], d[6]]).toEqual([255, 255, 255])
  })
})

describe('alphaBounds', () => {
  it('finds the tight bbox of alpha above threshold', () => {
    const w = 4, h = 3
    const d = new Uint8ClampedArray(w * h * 4)
    const set = (x: number, y: number, a: number) => { d[(y * w + x) * 4 + 3] = a }
    set(1, 0, 255); set(2, 2, 255); set(3, 1, 10) // 10 is below default thresh 20
    expect(alphaBounds(d, w, h)).toEqual({ minX: 1, minY: 0, maxX: 2, maxY: 2 })
  })
  it('returns null when empty', () => {
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })
})

describe('cutoutPlacement', () => {
  it('a full-image bbox reproduces the source layer transform', () => {
    const layer = { x: 0.3, y: 0.6, w: 0.4, h: 0.3, rotation: 25 }
    const p = cutoutPlacement({ minX: 0, minY: 0, maxX: 1023, maxY: 767 }, layer, 1024, 768, 1000, 800)
    expect(p.x).toBeCloseTo(0.3, 6)
    expect(p.y).toBeCloseTo(0.6, 6)
    expect(p.w).toBeCloseTo(0.4, 6)
    expect(p.h).toBeCloseTo(0.3, 6)
    expect(p.rotation).toBe(25)
  })
  it('an unrotated quarter crop lands at the right sub-position', () => {
    // Layer: center (500,400)px, box 400×300 artboard px. Crop = top-left quadrant
    // of the 1024×768 image → its center is at artboard (500-100, 400-75).
    const layer = { x: 0.5, y: 0.5, w: 0.4, h: 0.3, rotation: 0 }
    const p = cutoutPlacement({ minX: 0, minY: 0, maxX: 511, maxY: 383 }, layer, 1024, 768, 1000, 800)
    expect(p.x).toBeCloseTo(400 / 1000, 6)
    expect(p.y).toBeCloseTo(325 / 800, 6)
    expect(p.w).toBeCloseTo(0.2, 6)
    expect(p.h).toBeCloseTo(0.15, 6)
  })
})

describe('pickSamSegments', () => {
  /** Build a tiny opaque RGBA mask; `isWhite(x,y)` decides white vs black per pixel. */
  function mkMask(w: number, h: number, whitePixels: Array<[number, number]> | ((x: number, y: number) => boolean)): MaskCandidate {
    const data = new Uint8ClampedArray(w * h * 4)
    const isWhite = typeof whitePixels === 'function'
      ? whitePixels
      : (x: number, y: number) => whitePixels.some(([wx, wy]) => wx === x && wy === y)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const white = isWhite(x, y)
      data[o] = white ? 255 : 0
      data[o + 1] = white ? 255 : 0
      data[o + 2] = white ? 255 : 0
      data[o + 3] = 255
    }
    return { data, w, h }
  }

  // Probe trio: mask_0 = background (~84% white, with a black hole where the
  // object sits), mask_1 = the object (~16% white), mask_2 = a tiny subpart
  // inside the object (1 pixel).
  const w = 10, h = 10
  function probeTrio() {
    const object = mkMask(w, h, (x, y) => x >= 3 && x <= 6 && y >= 3 && y <= 6)
    const background = mkMask(w, h, (x, y) => !(x >= 3 && x <= 6 && y >= 3 && y <= 6))
    const subpart = mkMask(w, h, [[5, 5]])
    return [background, object, subpart]
  }

  it('assigns a fg point on the object body (outside the subpart) to the object segment', () => {
    const idxs = pickSamSegments(probeTrio(), [{ x: 3, y: 3 }], [], w, h)
    expect(idxs).toEqual([1])
  })

  it('a fg point landing inside the subpart too unions both (smallest wins per point)', () => {
    const idxs = pickSamSegments(probeTrio(), [{ x: 3, y: 3 }, { x: 5, y: 5 }], [], w, h)
    expect(idxs).toEqual([1, 2])
  })

  it('a stray fg point only the (oversized) background contains contributes nothing', () => {
    // (9,9) is white only in the background segment, which exceeds maxWhiteFrac
    // and is never assignable — the point is simply ignored.
    const idxs = pickSamSegments(probeTrio(), [{ x: 3, y: 3 }, { x: 9, y: 9 }], [], w, h)
    expect(idxs).toEqual([1])
  })

  it('a bg point removes the segment it claims from the fg-selected set', () => {
    const idxs = pickSamSegments(probeTrio(), [{ x: 3, y: 3 }], [{ x: 4, y: 4 }], w, h)
    expect(idxs).toEqual([])
  })

  it('unions two disjoint object segments hit by different fg points', () => {
    const segA = mkMask(w, h, (x, y) => x >= 0 && x <= 1 && y >= 0 && y <= 1)
    const segB = mkMask(w, h, (x, y) => x >= 8 && x <= 9 && y >= 8 && y <= 9)
    const idxs = pickSamSegments([segA, segB], [{ x: 0, y: 0 }, { x: 9, y: 9 }], [], w, h)
    expect(idxs).toEqual([0, 1])
  })

  it('returns [] for empty fgPoints', () => {
    const idxs = pickSamSegments(probeTrio(), [], [], w, h)
    expect(idxs).toEqual([])
  })

  it('maps points fractionally when a candidate has a different resolution than the prompt image', () => {
    // Prompt image is 10x10; point (5,5) is the exact center (fraction 0.5,0.5).
    // Candidate is 20x20 — the same fractional center is pixel (10,10).
    const cand = mkMask(20, 20, (x, y) => x >= 6 && x <= 14 && y >= 6 && y <= 14)
    const idxs = pickSamSegments([cand], [{ x: 5, y: 5 }], [], 10, 10)
    expect(idxs).toEqual([0])
  })
})
