import { describe, expect, it } from 'vitest'
import { layoutExpressiveBoxes, MAX_BOX_ROTATION_DEG } from '~~/shared/text-layout/boxes'
import type { ExpressiveBoxParams } from '~~/shared/text-layout/boxes'

function params(p: Partial<ExpressiveBoxParams> = {}): ExpressiveBoxParams {
  return { placement: 'scatter', jitter: 0, rotation: 0, seed: 1, ...p }
}
// 4 equal boxes in a 400×300 container.
const four = [
  { id: 'a', w: 80, h: 60 }, { id: 'b', w: 80, h: 60 },
  { id: 'c', w: 80, h: 60 }, { id: 'd', w: 80, h: 60 },
]
const overlaps = (p: { x: number; y: number }, q: { x: number; y: number }, w = 80, h = 60) =>
  p.x < q.x + w && p.x + w > q.x && p.y < q.y + h && p.y + h > q.y

describe('layoutExpressiveBoxes — grid (collision-free)', () => {
  it('places 4 items into a 2×2 grid, centered in each cell', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'grid', columns: 2 }) })
    // cells 200×150; item 80×60 centered → offset (60,45)
    expect(out.map(b => [b.x, b.y])).toEqual([[60, 45], [260, 45], [60, 195], [260, 195]])
  })
  it('auto-derives columns = ceil(sqrt(n)) when unset', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'grid' }) })
    // ceil(sqrt(4)) = 2 → same 2×2 layout
    expect(out.map(b => b.x)).toEqual([60, 260, 60, 260])
  })
  it('never overlaps for grid, even with jitter', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'grid', columns: 2, jitter: 1, seed: 7 }) })
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(overlaps(out[i]!, out[j]!)).toBe(false)
  })
})

describe('layoutExpressiveBoxes — scatter', () => {
  it('centers every item when jitter is 0', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', jitter: 0 }) })
    for (const b of out) { expect(b.x).toBeCloseTo(160); expect(b.y).toBeCloseTo(120) }
  })
  it('keeps every item inside the box with jitter', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', jitter: 1, seed: 4 }) })
    for (const b of out) {
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + 80).toBeLessThanOrEqual(400 + 1e-9)
      expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + 60).toBeLessThanOrEqual(300 + 1e-9)
    }
  })
})

describe('layoutExpressiveBoxes — corners', () => {
  it('sends 4 items to the 4 corners when jitter is 0', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'corners' }) })
    const pts = out.map(b => [b.x, b.y])
    expect(pts).toContainEqual([0, 0])
    expect(pts).toContainEqual([320, 0])
    expect(pts).toContainEqual([0, 240])
    expect(pts).toContainEqual([320, 240])
  })
})

describe('layoutExpressiveBoxes — rotation', () => {
  it('is 0 for every item when rotation is 0', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ rotation: 0 }) })
    for (const b of out) expect(b.rotation).toBe(0)
  })
  it('stays within ±(rotation × MAX) degrees', () => {
    const out = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', rotation: 0.5, jitter: 1, seed: 3 }) })
    for (const b of out) expect(Math.abs(b.rotation)).toBeLessThanOrEqual(0.5 * MAX_BOX_ROTATION_DEG + 1e-9)
  })
})

describe('layoutExpressiveBoxes — determinism & edges', () => {
  it('same seed → identical output', () => {
    const mk = () => layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', jitter: 1, rotation: 1, seed: 9 }) })
    expect(mk()).toEqual(mk())
  })
  it('reroll (new seed) changes positions', () => {
    const a = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', jitter: 1, seed: 1 }) })
    const b = layoutExpressiveBoxes({ items: four, boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', jitter: 1, seed: 2 }) })
    expect(a.map(p => p.x)).not.toEqual(b.map(p => p.x))
  })
  it('empty items → empty output', () => {
    expect(layoutExpressiveBoxes({ items: [], boxWidth: 400, boxHeight: 300, params: params() })).toEqual([])
  })
  it('clamps an item wider than the box to x = 0', () => {
    const out = layoutExpressiveBoxes({ items: [{ id: 'big', w: 600, h: 60 }], boxWidth: 400, boxHeight: 300, params: params({ placement: 'scatter', jitter: 1, seed: 5 }) })
    expect(out[0]!.x).toBe(0)
  })
})
