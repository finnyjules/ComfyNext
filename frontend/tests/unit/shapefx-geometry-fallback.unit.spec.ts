import { describe, it, expect, vi } from 'vitest'

vi.mock('../../app/lib/shapefx/points', () => ({
  gemPoints: () => [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
}))

import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const degenerateGem: ShapeConfig = {
  ...DEFAULT_CONFIG, shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', vertices: 4 },
}

describe('buildGeometry degenerate fallback', () => {
  it('falls back to the tetrahedron when the hull is degenerate', () => {
    const g = buildGeometry(degenerateGem)
    g.computeBoundingSphere()
    expect(g.getAttribute('position').count).toBe(12)
    expect(g.boundingSphere!.radius).toBeCloseTo(1.4, 1)
  })
})
