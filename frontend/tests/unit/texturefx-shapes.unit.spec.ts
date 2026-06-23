import { describe, expect, it } from 'vitest'
import { shapeRegion } from '~/lib/texturefx/shapes'
import { rolesFor } from '~/lib/texturefx/roles'

describe('shapeRegion octagon', () => {
  it('center of a cell is the octagon tile (role 0)', () => {
    expect(shapeRegion('octagon', 0.5 / 4, 0.5 / 4, 4).role).toBe(0) // first cell center, cells=4
  })
  it('cell corner is the joint (role 1)', () => {
    expect(shapeRegion('octagon', 0.001, 0.001, 4).role).toBe(1)
  })
  it('seamless: u=0 edge matches u=1 edge', () => {
    for (let i = 0; i <= 8; i++) { const v = i / 8
      expect(shapeRegion('octagon', 0, v, 4).role).toBe(shapeRegion('octagon', 1, v, 4).role)
      expect(shapeRegion('octagon', v, 0, 4).role).toBe(shapeRegion('octagon', v, 1, 4).role)
    }
  })
})
describe('rolesFor shapes mode', () => {
  it('octagon resolves its roles', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'octagon' } as any)).toEqual(['tile', 'joint'])
  })
  it('unknown shape family falls back', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'nope' } as any)).toEqual(['a', 'b'])
  })
})
