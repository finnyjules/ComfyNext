import { describe, it, expect } from 'vitest'
import { elasticOffset, ELASTIC_MODES, TAU, type ElasticMode, type ElasticParams } from '../../app/lib/spacetype/elasticMath'

const P: ElasticParams = { intensity: 1, stretch: 0.4, shear: 0.6, waveLength: 2 }
// A spread of sample points (px, py, lineT) covering the plane + stack.
const SAMPLES: [number, number, number][] = [
  [-1, 0.8, 0], [0.5, -0.5, 0.5], [1, 0.2, 1], [-0.3, -0.9, 0.25], [0.7, 0.6, 0.75],
]

describe('ELASTIC_MODES', () => {
  it('lists the five modes in picker order', () => {
    expect(ELASTIC_MODES).toEqual(['Wave', 'Spring', 'Taffy', 'Pinch', 'Jelly'])
  })
})

describe('elasticOffset — seamless loop', () => {
  it('offset at uTime=0 equals offset at uTime=TAU for every mode + sample', () => {
    for (let mode = 0 as ElasticMode; mode < 5; mode = (mode + 1) as ElasticMode) {
      for (const [px, py, lt] of SAMPLES) {
        const a = elasticOffset(mode, px, py, lt, 0, P)
        const b = elasticOffset(mode, px, py, lt, TAU, P)
        expect(b.dx).toBeCloseTo(a.dx, 6)
        expect(b.dy).toBeCloseTo(a.dy, 6)
      }
    }
  })
})

describe('elasticOffset — intensity', () => {
  it('scales linearly with intensity', () => {
    const half = elasticOffset(0, 0.5, 0.5, 0.3, 1.0, { ...P, intensity: 1 })
    const full = elasticOffset(0, 0.5, 0.5, 0.3, 1.0, { ...P, intensity: 2 })
    expect(full.dx).toBeCloseTo(half.dx * 2, 10)
    expect(full.dy).toBeCloseTo(half.dy * 2, 10)
  })
  it('intensity 0 → no displacement for every mode', () => {
    for (let mode = 0 as ElasticMode; mode < 5; mode = (mode + 1) as ElasticMode) {
      const o = elasticOffset(mode, 0.5, 0.5, 0.3, 1.0, { ...P, intensity: 0 })
      expect(o.dx).toBe(0)
      expect(o.dy).toBe(0)
    }
  })
})

describe('elasticOffset — actually moves', () => {
  it('each mode produces a non-zero offset somewhere mid-loop', () => {
    for (let mode = 0 as ElasticMode; mode < 5; mode = (mode + 1) as ElasticMode) {
      const moved = SAMPLES.some(([px, py, lt]) => {
        const o = elasticOffset(mode, px, py, lt, 1.3, P)
        return Math.abs(o.dx) > 1e-6 || Math.abs(o.dy) > 1e-6
      })
      expect(moved).toBe(true)
    }
  })
})
