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
  it('pinwheel resolves to [a, b]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'pinwheel' } as any)).toEqual(['a', 'b'])
  })
  it('chevron resolves to [a, b]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'chevron' } as any)).toEqual(['a', 'b'])
  })
})

describe('shapeRegion pinwheel (HST)', () => {
  it('fx > fy gives role 0 when pinwheel is off', () => {
    // cell-local fx=0.7, fy=0.2 (diagonal split: role 0 when fx>fy)
    // With cells=4, u=0.175 puts us in first cell with fx=0.7; v=0.05 gives fy=0.2
    const r = shapeRegion('pinwheel', 0.175, 0.05, 4, { pinwheel: 'off' } as any)
    expect(r.role).toBe(0)
  })
  it('fx < fy gives role 1 when pinwheel is off', () => {
    // fx=0.2, fy=0.7: role 1
    const r = shapeRegion('pinwheel', 0.05, 0.175, 4, { pinwheel: 'off' } as any)
    expect(r.role).toBe(1)
  })
  it('pinwheel ON rotates cell by quadrant so role flips for some cells', () => {
    // cell (1,0): k=1, rotation maps (fx,fy) -> (fy, 1-fx)
    // Use u in cell cx=1 (gx in [1,2]), cy=0 (gy in [0,1])
    // u=0.3 -> gx=1.2 -> fx=0.2; v=0.3 -> gy=1.2 -> fy=0.2... pick fx>fy before rotation
    // cx=1,cy=0 -> k=1: r=(fy,1-fx). fx=0.7,fy=0.3 -> r=(0.3,0.3) -> boundary; use fx=0.8,fy=0.3
    // -> r=(0.3,0.2) -> r.x>r.y -> role 0
    const r = shapeRegion('pinwheel', (1 + 0.8) / 4, 0.3 / 4, 4, { pinwheel: 'on' } as any)
    expect(r.role).toBe(0)
  })
  it('seamless wrap: u=0 matches u=1', () => {
    const cells = 4
    for (let i = 0; i <= 8; i++) {
      const v = i / 8
      expect(shapeRegion('pinwheel', 0, v, cells, { pinwheel: 'off' } as any).role)
        .toBe(shapeRegion('pinwheel', 1, v, cells, { pinwheel: 'off' } as any).role)
      expect(shapeRegion('pinwheel', v, 0, cells, { pinwheel: 'off' } as any).role)
        .toBe(shapeRegion('pinwheel', v, 1, cells, { pinwheel: 'off' } as any).role)
    }
  })
})

describe('shapeRegion chevron', () => {
  const cells = 4
  it('two points one band apart have different roles', () => {
    // Same x, y offset by 1/cells shifts the band by 1 (plus zig variation, but at x=0 zig=1)
    // At u=0 (x edge), zig=abs(fract(0)*2-1)=1. band=floor(v*cells+1).
    // v=0.1 -> band=floor(0.4+1)=floor(1.4)=1 -> role=1
    // v=0.35 -> band=floor(1.4+1)=floor(2.4)=2 -> role=0
    const r0 = shapeRegion('chevron', 0, 0.1, cells)
    const r1 = shapeRegion('chevron', 0, 0.35, cells)
    expect(r0.role).not.toBe(r1.role)
  })
  it('seamless wrap in x: u=0 matches u=1', () => {
    for (let i = 0; i <= 8; i++) {
      const v = i / 8
      expect(shapeRegion('chevron', 0, v, cells).role)
        .toBe(shapeRegion('chevron', 1, v, cells).role)
    }
  })
  it('seamless wrap in y: v=0 matches v=1 (even cells)', () => {
    for (let i = 0; i <= 8; i++) {
      const u = i / 8
      expect(shapeRegion('chevron', u, 0, cells).role)
        .toBe(shapeRegion('chevron', u, 1, cells).role)
    }
  })
})
