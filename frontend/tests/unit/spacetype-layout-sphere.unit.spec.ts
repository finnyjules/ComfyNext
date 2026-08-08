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
})
