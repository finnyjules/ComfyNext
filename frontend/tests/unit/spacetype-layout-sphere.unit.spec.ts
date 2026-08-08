import { describe, it, expect } from 'vitest'
import { sphereLayout } from '~/lib/spacetype/layouts/sphere'
const P = { sphereRadius: 5, cardSize: 1, speed: 1, direction: 'cw' }
describe('sphere layout', () => {
  it('all tiles sit on the sphere radius', () => {
    for (let i = 0; i < 12; i++) {
      const t = sphereLayout.place(i, 12, P as any, 0)
      expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(5, 4)
    }
  })
  it('seam: t01=0 equals t01=1', () => {
    for (let i = 0; i < 7; i++) {
      const a = sphereLayout.place(i, 7, P as any, 0), b = sphereLayout.place(i, 7, P as any, 1)
      expect(b.x).toBeCloseTo(a.x, 5); expect(b.y).toBeCloseTo(a.y, 5); expect(b.z).toBeCloseTo(a.z, 5)
    }
  })
  it('scale follows cardSize', () => {
    expect(sphereLayout.place(0, 4, { ...P, cardSize: 2 } as any, 0).scale).toBeCloseTo(2, 6)
  })
  it('cards face outward: a tile whose azimuth is th has its +Z normal pointing radially out', () => {
    // For any tile at t01=0 (spin=0), azimuth th = i·GA. Outward radial = (cos th, 0, sin th);
    // the quad normal after rotation.y=rotY is (sin rotY, 0, cos rotY) — assert they match.
    for (let i = 0; i < 6; i++) {
      const t = sphereLayout.place(i, 9, P as any, 0)
      const th = Math.atan2(t.z, t.x)                 // the tile's horizontal azimuth
      expect(Math.sin(t.rotY)).toBeCloseTo(Math.cos(th), 5)   // normal.x == outward.x
      expect(Math.cos(t.rotY)).toBeCloseTo(Math.sin(th), 5)   // normal.z == outward.z
    }
  })
})
