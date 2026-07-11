import { describe, it, expect } from 'vitest'
import { gemPoints } from '../../app/lib/shapefx/points'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const cfg = (over: Partial<ShapeConfig['shape']>, seed = '#seed1'): ShapeConfig => ({
  ...DEFAULT_CONFIG, seed, shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', ...over },
})

describe('gemPoints', () => {
  it('is deterministic for a given seed + params', () => {
    expect(gemPoints(cfg({ vertices: 14 }))).toEqual(gemPoints(cfg({ vertices: 14 })))
  })

  it('a different seed yields different points', () => {
    expect(gemPoints(cfg({ vertices: 14 }, '#a'))).not.toEqual(gemPoints(cfg({ vertices: 14 }, '#b')))
  })

  it('point count follows vertices (clamped to a minimum of 4)', () => {
    expect(gemPoints(cfg({ vertices: 20 })).length).toBe(20)
    expect(gemPoints(cfg({ vertices: 2 })).length).toBe(4)
  })

  it('clamps vertices to a safe ceiling so a junk import cannot hang the hull builder', () => {
    expect(gemPoints(cfg({ vertices: 1e8 })).length).toBe(64)
  })

  it('depth scales the Z extent', () => {
    const zExtent = (c: ShapeConfig) => {
      const zs = gemPoints(c).map(p => p[2])
      return Math.max(...zs) - Math.min(...zs)
    }
    expect(zExtent(cfg({ vertices: 30, depth: 2 }))).toBeGreaterThan(zExtent(cfg({ vertices: 30, depth: 0.5 })))
  })

  it('every point is finite 3-tuple', () => {
    for (const p of gemPoints(cfg({ vertices: 24 }))) {
      expect(p).toHaveLength(3)
      expect(p.every(Number.isFinite)).toBe(true)
    }
  })
})
