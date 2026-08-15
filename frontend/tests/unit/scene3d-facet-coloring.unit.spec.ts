import { describe, it, expect } from 'vitest'
import { buildGeometry } from '~/lib/scene3d/engine'
import { parseMaterialForTest } from './helpers/scene3d-material'

describe('scene3d facet coloring modes', () => {
  it('scatter and ombre survive material parsing', () => {
    for (const mode of ['scatter', 'ombre'] as const) {
      const m = parseMaterialForTest({ type: 'gradient', color: '#222', roughness: 0.5, metalness: 0, gradientShading: mode })
      expect(m.gradientShading).toBe(mode)
    }
  })

  it('facet-variant geometry carries a per-face random attribute', () => {
    // buildGeometry(kind, params, modifiers, variant, content, font)
    const geo = buildGeometry('gem', { points: 20, spread: 0.6, depth: 1, gemSeed: 1 }, undefined, 'facet')
    const rand = geo.getAttribute('aFaceRand')
    expect(rand).toBeTruthy()
    expect(rand!.count).toBe(geo.getAttribute('position').count)
    // same value across a face's 3 verts, different across faces
    expect(rand!.getX(0)).toBe(rand!.getX(1))
    expect(rand!.getX(0)).toBe(rand!.getX(2))
    expect(rand!.getX(0)).not.toBe(rand!.getX(3))
    geo.dispose()
  })
})
