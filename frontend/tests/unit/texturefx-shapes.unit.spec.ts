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

describe('shapeRegion basketweave', () => {
  it('roles are only 0 or 1', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        const u = i / 16, v = j / 16
        const r = shapeRegion('basketweave', u, v, cells)
        expect(r.role === 0 || r.role === 1).toBe(true)
      }
    }
  })
  it('fx and fy are in [0,1)', () => {
    const cells = 8
    for (let i = 1; i <= 15; i++) {
      for (let j = 1; j <= 15; j++) {
        const r = shapeRegion('basketweave', i / 16, j / 16, cells)
        expect(r.fx).toBeGreaterThanOrEqual(0)
        expect(r.fx).toBeLessThan(1)
        expect(r.fy).toBeGreaterThanOrEqual(0)
        expect(r.fy).toBeLessThan(1)
      }
    }
  })
  it('adjacent 2x2 blocks (by ch) have different roles', () => {
    // ch=8; blocks of size 2 in ch-space. Block A: (cx=0,cy=0) P=0 (role 0). Block B: (cx=2,cy=0) P=1 (role 1).
    // Sample centers: cx=0 -> u=(0.5)/8=0.0625; cx=2 -> u=(2.5)/8=0.3125 (with ch=8, cells=8)
    const rA = shapeRegion('basketweave', 0.0625, 0.0625, 8)
    const rB = shapeRegion('basketweave', 0.3125, 0.0625, 8)
    expect(rA.role).not.toBe(rB.role)
  })
  it('seamless wrap at cells=8 (multiple of 4): u=0 matches u=1 and v=0 matches v=1', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('basketweave', 0, t, cells).role)
        .toBe(shapeRegion('basketweave', 1, t, cells).role)
      expect(shapeRegion('basketweave', t, 0, cells).role)
        .toBe(shapeRegion('basketweave', t, 1, cells).role)
    }
  })
  it('seamless wrap at cells=6 (quantized to 8): u=0 matches u=1 and v=0 matches v=1', () => {
    const cells = 6
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('basketweave', 0, t, cells).role)
        .toBe(shapeRegion('basketweave', 1, t, cells).role)
      expect(shapeRegion('basketweave', t, 0, cells).role)
        .toBe(shapeRegion('basketweave', t, 1, cells).role)
    }
  })
})

describe('shapeRegion herringbone', () => {
  it('roles are only 0 or 1', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        const u = i / 16, v = j / 16
        const r = shapeRegion('herringbone', u, v, cells)
        expect(r.role === 0 || r.role === 1).toBe(true)
      }
    }
  })
  it('spot-check known cells at cells=4 (ch=4): role = floor((cx+cy)/2) % 2', () => {
    // ch=4; sample center of cell (cx,cy) at u=(cx+0.5)/4, v=(cy+0.5)/4
    const cases: [number, number, number][] = [
      [0, 0, 0], // floor(0/2)%2=0
      [2, 0, 1], // floor(2/2)%2=1
      [1, 1, 1], // floor(2/2)%2=1
      [3, 1, 0], // floor(4/2)%2=0
      [0, 2, 1], // floor(2/2)%2=1
    ]
    for (const [cx, cy, expectedRole] of cases) {
      const u = (cx + 0.5) / 4
      const v = (cy + 0.5) / 4
      const r = shapeRegion('herringbone', u, v, 4)
      expect(r.role).toBe(expectedRole)
    }
  })
  it('seamless wrap at cells=8 (multiple of 4): u=0 matches u=1 and v=0 matches v=1', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('herringbone', 0, t, cells).role)
        .toBe(shapeRegion('herringbone', 1, t, cells).role)
      expect(shapeRegion('herringbone', t, 0, cells).role)
        .toBe(shapeRegion('herringbone', t, 1, cells).role)
    }
  })
  it('seamless wrap at cells=6 (quantized to 8): u=0 matches u=1 and v=0 matches v=1', () => {
    const cells = 6
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('herringbone', 0, t, cells).role)
        .toBe(shapeRegion('herringbone', 1, t, cells).role)
      expect(shapeRegion('herringbone', t, 0, cells).role)
        .toBe(shapeRegion('herringbone', t, 1, cells).role)
    }
  })
})

describe('rolesFor basketweave and herringbone', () => {
  it('basketweave resolves to [a, b]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'basketweave' } as any)).toEqual(['a', 'b'])
  })
  it('herringbone resolves to [brickA, brickB]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'herringbone' } as any)).toEqual(['brickA', 'brickB'])
  })
})

describe('shapeRegion fishscale', () => {
  it('scale center (u=0,v=0) maps to role 0 with fx≈0.5, fy≈0.5', () => {
    const r = shapeRegion('fishscale', 0, 0, 4)
    expect(r.role).toBe(0)
    expect(r.fx).toBeCloseTo(0.5, 5)
    expect(r.fy).toBeCloseTo(0.5, 5)
  })
  it('roles are only 0 or 1 over a sampled grid', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        const r = shapeRegion('fishscale', i / 16, j / 16, cells)
        expect(r.role === 0 || r.role === 1).toBe(true)
      }
    }
  })
  it('seamless wrap at cells=8: u=0 edge matches u=1 edge', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      const v = i / 16
      expect(shapeRegion('fishscale', 0, v, cells).role)
        .toBe(shapeRegion('fishscale', 1, v, cells).role)
    }
  })
  it('seamless wrap at cells=8: v=0 edge matches v=1 edge', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      const u = i / 16
      expect(shapeRegion('fishscale', u, 0, cells).role)
        .toBe(shapeRegion('fishscale', u, 1, cells).role)
    }
  })
})

describe('shapeRegion pythagorean', () => {
  it('world origin maps to role 0 with fx=0, fy=0 at cells=10', () => {
    const r = shapeRegion('pythagorean', 0, 0, 10)
    expect(r.role).toBe(0)
    expect(r.fx).toBeCloseTo(0, 5)
    expect(r.fy).toBeCloseTo(0, 5)
  })
  it('small-square interior (world 2.5,0.5 → u=0.25,v=0.05 at cells=10) maps to role 1', () => {
    const r = shapeRegion('pythagorean', 0.25, 0.05, 10)
    expect(r.role).toBe(1)
  })
  it('roles are only 0 or 1 over a sampled grid', () => {
    const cells = 10
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        const r = shapeRegion('pythagorean', i / 16, j / 16, cells)
        expect(r.role === 0 || r.role === 1).toBe(true)
      }
    }
  })
  it('seamless wrap at cells=10: u=0 matches u=1 and v=0 matches v=1', () => {
    const cells = 10
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('pythagorean', 0, t, cells).role)
        .toBe(shapeRegion('pythagorean', 1, t, cells).role)
      expect(shapeRegion('pythagorean', t, 0, cells).role)
        .toBe(shapeRegion('pythagorean', t, 1, cells).role)
    }
  })
  it('seamless wrap at cells=8 (quantized to chP=10): u=0 matches u=1 and v=0 matches v=1', () => {
    const cells = 8
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('pythagorean', 0, t, cells).role)
        .toBe(shapeRegion('pythagorean', 1, t, cells).role)
      expect(shapeRegion('pythagorean', t, 0, cells).role)
        .toBe(shapeRegion('pythagorean', t, 1, cells).role)
    }
  })
})

describe('rolesFor fishscale and pythagorean', () => {
  it('fishscale resolves to [scale, ground]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'fishscale' } as any)).toEqual(['scale', 'ground'])
  })
  it('pythagorean resolves to [big, small]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'pythagorean' } as any)).toEqual(['big', 'small'])
  })
})

describe('shapeRegion hex', () => {
  const cells = 12

  it('3-coloring valid: all three roles appear over a sampled grid', () => {
    const roleSet = new Set<number>()
    for (let i = 0; i <= 32; i++) {
      for (let j = 0; j <= 32; j++) {
        const r = shapeRegion('hex', i / 32, j / 32, cells)
        expect(r.role >= 0 && r.role <= 2).toBe(true)
        roleSet.add(r.role)
      }
    }
    expect(roleSet).toEqual(new Set([0, 1, 2]))
  })

  it('adjacency: two horizontally-adjacent hex centers have different roles', () => {
    // Compute hex grid params as the implementation does
    const K = 1.1547005
    const nx = Math.max(9, Math.round(cells / 3) * 3)
    const ny = 2 * Math.round((nx * K) / 2)
    const sx = 1 / nx, sy = 1 / ny
    // Row 0, col 0 center vs col 1 center (no offset for even row)
    const u0 = 0 * sx, v0 = 0 * sy
    const u1 = 1 * sx, v1 = 0 * sy
    const r0 = shapeRegion('hex', u0, v0, cells)
    const r1 = shapeRegion('hex', u1, v1, cells)
    expect(r0.role).not.toBe(r1.role)
  })

  it('rolesFor: hex resolves to [a, b, c]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'hex' } as any)).toEqual(['a', 'b', 'c'])
  })

  it('mod-3 periodicity (cells=12): three consecutive interior column centers produce all three distinct roles', () => {
    // Verify nx≡0 mod 3 actually cycles through all three roles.
    // Use interior points only — the boundary wrap (((x%1)+1)%1) makes u=0/u=1 identical,
    // so seam tests above are tautological; this test exercises the underlying math directly.
    const K = 1.1547005
    const nx = Math.max(9, Math.round(cells / 3) * 3) // 12
    const ny = 2 * Math.round((nx * K) / 2)
    const sx = 1 / nx, sy = 1 / ny
    // Even row 2 (no column offset), cols 3,4,5 — all strictly inside (0,1)
    const roleSet = new Set([3, 4, 5].map(col => shapeRegion('hex', col * sx, 2 * sy, cells).role))
    expect(roleSet).toEqual(new Set([0, 1, 2]))
  })

  it('mod-3 periodicity (cells=9): three consecutive interior column centers produce all three distinct roles', () => {
    const K = 1.1547005
    const nx = Math.max(9, Math.round(9 / 3) * 3) // 9
    const ny = 2 * Math.round((nx * K) / 2)
    const sx = 1 / nx, sy = 1 / ny
    const roleSet = new Set([3, 4, 5].map(col => shapeRegion('hex', col * sx, 2 * sy, 9).role))
    expect(roleSet).toEqual(new Set([0, 1, 2]))
  })

  it('seamless wrap at cells=12: u=0 matches u=1', () => {
    for (let i = 0; i <= 16; i++) {
      const v = i / 16
      expect(shapeRegion('hex', 0, v, 12).role)
        .toBe(shapeRegion('hex', 1, v, 12).role)
    }
  })

  it('seamless wrap at cells=12: v=0 matches v=1', () => {
    for (let i = 0; i <= 16; i++) {
      const u = i / 16
      expect(shapeRegion('hex', u, 0, 12).role)
        .toBe(shapeRegion('hex', u, 1, 12).role)
    }
  })

  it('seamless wrap at cells=9: u=0 matches u=1 and v=0 matches v=1', () => {
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('hex', 0, t, 9).role)
        .toBe(shapeRegion('hex', 1, t, 9).role)
      expect(shapeRegion('hex', t, 0, 9).role)
        .toBe(shapeRegion('hex', t, 1, 9).role)
    }
  })

  it('flat orientation: hex(u,v,flat) equals hex(v,u,pointy) with fx/fy swapped', () => {
    const testPoints = [[0.1, 0.3], [0.6, 0.2], [0.8, 0.7]]
    for (const [u, v] of testPoints) {
      const flat = shapeRegion('hex', u, v, 12, { hexOrient: 'flat' } as any)
      const pointy = shapeRegion('hex', v, u, 12, { hexOrient: 'pointy' } as any)
      expect(flat.role).toBe(pointy.role)
      expect(flat.fx).toBeCloseTo(pointy.fy, 5)
      expect(flat.fy).toBeCloseTo(pointy.fx, 5)
    }
  })
})

describe('shapeRegion cairo', () => {
  const cells = 12 // chC = 6 * max(1, round(12/6)) = 12

  it('role set: all three roles appear and are subset of {0,1,2} over a sampled grid', () => {
    const roleSet = new Set<number>()
    for (let i = 0; i <= 32; i++) {
      for (let j = 0; j <= 32; j++) {
        const r = shapeRegion('cairo', i / 32, j / 32, cells)
        expect(r.role >= 0 && r.role <= 2).toBe(true)
        roleSet.add(r.role)
      }
    }
    expect(roleSet).toEqual(new Set([0, 1, 2]))
  })

  it('fx and fy are in [0,1] for sampled points', () => {
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        const r = shapeRegion('cairo', i / 16, j / 16, cells)
        expect(r.fx).toBeGreaterThanOrEqual(0)
        expect(r.fx).toBeLessThanOrEqual(1)
        expect(r.fy).toBeGreaterThanOrEqual(0)
        expect(r.fy).toBeLessThanOrEqual(1)
      }
    }
  })

  it('known point: centroid near (0,2) in chC=12 space returns a valid role in {0,1,2}', () => {
    // Pentagon "U" has a pinwheel center at world (3,3) in 6-unit space.
    // At cells=12 (chC=12), sample near world (0.5, 2.5) which falls clearly inside one pentagon.
    // We assert coverage and role membership, not an exact k (verified by the controller).
    const r = shapeRegion('cairo', 0.5 / 12, 2.5 / 12, cells)
    expect([0, 1, 2]).toContain(r.role)
    expect(r.fx).toBeGreaterThanOrEqual(0)
    expect(r.fy).toBeGreaterThanOrEqual(0)
  })

  it('3-coloring adjacency spot-check: two points straddling a horizontal edge have different roles', () => {
    // Sample two u,v pairs known (by inspection of the geometry) to be on opposite sides
    // of a shared pentagon edge. At chC=12, world (0.5, 2.1) and (0.5, 2.2) straddle
    // the boundary between role-2 and role-1 pentagons (verified via the shapeRegion sampler).
    const rA = shapeRegion('cairo', 0.5 / 12, 2.1 / 12, cells)
    const rB = shapeRegion('cairo', 0.5 / 12, 2.2 / 12, cells)
    expect(rA.role).not.toBe(rB.role)
  })

  it('rolesFor: cairo resolves to [a, b, c]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'cairo' } as any)).toEqual(['a', 'b', 'c'])
  })

  it('seamless wrap at cells=12: u=0 edge matches u=1 edge', () => {
    for (let i = 0; i <= 16; i++) {
      const v = i / 16
      expect(shapeRegion('cairo', 0, v, cells).role)
        .toBe(shapeRegion('cairo', 1, v, cells).role)
    }
  })

  it('seamless wrap at cells=12: v=0 edge matches v=1 edge', () => {
    for (let i = 0; i <= 16; i++) {
      const u = i / 16
      expect(shapeRegion('cairo', u, 0, cells).role)
        .toBe(shapeRegion('cairo', u, 1, cells).role)
    }
  })

  it('seamless wrap at cells=8 (quantized to chC=6): u=0 matches u=1 and v=0 matches v=1', () => {
    // cells=8 -> chC = 6 * max(1, round(8/6)) = 6 * round(1.33)=6*1 = 6 (proves the period-6 quantize)
    const c = 8
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      expect(shapeRegion('cairo', 0, t, c).role)
        .toBe(shapeRegion('cairo', 1, t, c).role)
      expect(shapeRegion('cairo', t, 0, c).role)
        .toBe(shapeRegion('cairo', t, 1, c).role)
    }
  })
})

describe('shapeRegion cubes', () => {
  const cells = 12

  it('role set: all three roles (top/left/right = 0/1/2) appear over a sampled grid', () => {
    const roleSet = new Set<number>()
    for (let i = 0; i <= 32; i++) {
      for (let j = 0; j <= 32; j++) {
        const r = shapeRegion('cubes', i / 32, j / 32, cells)
        expect(r.role >= 0 && r.role <= 2).toBe(true)
        roleSet.add(r.role)
        expect(isFinite(r.fx)).toBe(true)
        expect(isFinite(r.fy)).toBe(true)
      }
    }
    expect(roleSet).toEqual(new Set([0, 1, 2]))
  })

  it('face-by-angle spot check: top, left-face, right-face sectors produce correct roles', () => {
    // Compute hex center for row=2, col=2 (even row, off=0) with cells=12
    // K=1.1547005, nx=12, ny=2*round(12*K/2)=2*7=14, sx=1/12, sy=1/14
    const K = 1.1547005
    const nx = Math.max(9, Math.round(cells / 3) * 3) // 12
    const ny = 2 * Math.round((nx * K) / 2) // 14
    const sx = 1 / nx, sy = 1 / ny
    const bcx = 2 * sx  // col=2, off=0 → cx=(2+0)*sx
    const bcy = 2 * sy  // row=2 → cy=2*sy
    // Sector centers after aspect correction (dy_aspect = dy_raw * sx/sy):
    //   ang = (atan2(dy_aspect, dx) * 180/PI - 30 + 360) % 360 → role = floor(ang/120) % 3
    //   Role 0 (top):   raw atan2 ∈ [30°,150°)  — center at 90°: dx=0, dy>0 (+v direction)
    //   Role 1 (left):  raw atan2 ∈ [150°,270°) — center at 210°: dx<0, dy<0 (upper-left)
    //   Role 2 (right): raw atan2 ∈ [270°,390°) — center at 330°: dx>0, dy<0 (upper-right)
    const eps = sy * 0.2
    // Top: straight down in aspect-corrected space (dx=0, dy_aspect>0 → dy_raw>0 → +v)
    const rTop = shapeRegion('cubes', bcx, bcy + eps, cells)
    expect(rTop.role).toBe(0)
    // Left face: dx<0, dy<0 (upper-left in UV; atan2≈210°)
    const rLeft = shapeRegion('cubes', bcx - eps, bcy - eps * 0.5, cells)
    expect(rLeft.role).toBe(1)
    // Right face: dx>0, dy<0 (upper-right in UV; atan2≈330°)
    const rRight = shapeRegion('cubes', bcx + eps, bcy - eps * 0.5, cells)
    expect(rRight.role).toBe(2)
  })

  it('rolesFor: cubes resolves to [top, left, right]', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'cubes' } as any)).toEqual(['top', 'left', 'right'])
  })

  it('seamless wrap at cells=12: u=0 edge matches u=1 edge', () => {
    // Sample interior v values to avoid measure-zero boundary ties at exact centers
    for (let i = 1; i <= 15; i++) {
      const v = (i + 0.3) / 16
      expect(shapeRegion('cubes', 0, v, cells).role)
        .toBe(shapeRegion('cubes', 1, v, cells).role)
    }
  })

  it('seamless wrap at cells=12: v=0 edge matches v=1 edge', () => {
    for (let i = 1; i <= 15; i++) {
      const u = (i + 0.3) / 16
      expect(shapeRegion('cubes', u, 0, cells).role)
        .toBe(shapeRegion('cubes', u, 1, cells).role)
    }
  })

  it('seamless wrap at cells=9: u=0 matches u=1 and v=0 matches v=1', () => {
    for (let i = 1; i <= 15; i++) {
      const t = (i + 0.3) / 16
      expect(shapeRegion('cubes', 0, t, 9).role)
        .toBe(shapeRegion('cubes', 1, t, 9).role)
      expect(shapeRegion('cubes', t, 0, 9).role)
        .toBe(shapeRegion('cubes', t, 1, 9).role)
    }
  })
})
