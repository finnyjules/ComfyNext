import { describe, it, expect } from 'vitest'
import { stackPositions, lineStaggerOffsets } from '../../app/lib/spacetype/elasticLayout'

describe('stackPositions', () => {
  it('returns one y per line, top→bottom, centered on origin', () => {
    const ys = stackPositions(4, 2, 0) // step = 2, total = 8, centered
    expect(ys).toEqual([3, 1, -1, -3])
  })
  it('respects leading as extra gap between lines', () => {
    const ys = stackPositions(2, 2, 1) // step = 3
    expect(ys).toEqual([1.5, -1.5])
  })
  it('single line sits at origin', () => {
    expect(stackPositions(1, 2, 0)).toEqual([0])
  })
})

describe('lineStaggerOffsets', () => {
  it('centers the stagger so the stack stays balanced (sum ≈ 0)', () => {
    const xs = lineStaggerOffsets(4, 2) // mid = 1.5 → (i-1.5)*2
    expect(xs).toEqual([-3, -1, 1, 3])
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10)
  })
  it('zero stagger → all zero', () => {
    expect(lineStaggerOffsets(3, 0)).toEqual([0, 0, 0])
  })
})
