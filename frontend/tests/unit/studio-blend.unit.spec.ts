import { describe, it, expect } from 'vitest'
import { BLEND_MODES, BLEND_IDX, BLEND_LAYERS_GLSL } from '~/lib/studio/blend'

describe('studio blend module', () => {
  it('maps every mode to a stable index', () => {
    expect(BLEND_IDX).toEqual({
      normal: 0, lighten: 1, screen: 2, add: 3, multiply: 4, darken: 5, overlay: 6,
    })
  })
  it('lists all seven modes in index order', () => {
    expect(BLEND_MODES).toEqual(['normal', 'lighten', 'screen', 'add', 'multiply', 'darken', 'overlay'])
  })
  it('exposes a blendLayers GLSL function', () => {
    expect(BLEND_LAYERS_GLSL).toContain('vec3 blendLayers(vec3 base, vec3 src, float mode)')
  })
})
