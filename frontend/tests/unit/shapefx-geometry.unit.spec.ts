import { describe, it, expect } from 'vitest'
import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const prim = (primitive: ShapeConfig['shape']['primitive']): ShapeConfig => ({
  ...DEFAULT_CONFIG, shape: { ...DEFAULT_CONFIG.shape, mode: 'primitive', primitive },
})
const gem = (seed: string, vertices = 14): ShapeConfig => ({
  ...DEFAULT_CONFIG, seed, shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', vertices },
})

describe('buildGeometry', () => {
  it('primitives produce a non-indexed geometry with a position attribute', () => {
    const g = buildGeometry(prim('cube'))
    expect(g.index).toBeNull()                       // non-indexed → crisp flat facets
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('every primitive kind builds without throwing', () => {
    for (const k of ['cube','sphere','cone','cylinder','prism','torus','icosahedron','octahedron'] as const) {
      expect(() => buildGeometry(prim(k))).not.toThrow()
    }
  })

  it('gem hull produces a valid non-empty geometry', () => {
    const g = buildGeometry(gem('#gem1', 16))
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(12) // ≥ 4 tris
  })

  it('a small 4-vertex gem still yields a valid solid', () => {
    const g = buildGeometry(gem('#x', 4))
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(12)
  })
})
