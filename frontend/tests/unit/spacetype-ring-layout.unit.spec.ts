import { describe, it, expect } from 'vitest'
import { ringTransform, type RingParams } from '~/lib/spacetype/ringLayout'

const P: RingParams = { radius: 5, ringTilt: 0, cardSize: 1, speed: 1, direction: 1 }

describe('ringTransform', () => {
  it('places n tiles evenly around the circle', () => {
    const n = 4
    const angles = Array.from({ length: n }, (_, i) => {
      const t = ringTransform(i, n, P, 0)
      return Math.atan2(t.z, t.x)
    })
    // consecutive angular gaps are equal (2π/n), within fp tolerance
    const gap = (2 * Math.PI) / n
    for (let i = 1; i < n; i++) {
      let d = angles[i]! - angles[i - 1]!
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      expect(Math.abs(d - gap)).toBeLessThan(1e-6)
    }
  })

  it('tiles sit on the radius', () => {
    const t = ringTransform(0, 6, P, 0)
    expect(Math.hypot(t.x, t.z)).toBeCloseTo(5, 6)
  })

  it('loop is seamless: t01=0 equals t01=1', () => {
    for (let i = 0; i < 5; i++) {
      const a = ringTransform(i, 5, P, 0)
      const b = ringTransform(i, 5, P, 1)
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.z).toBeCloseTo(a.z, 6)
      expect(b.rotY).toBeCloseTo(a.rotY, 6)
    }
  })

  it('scale follows cardSize', () => {
    expect(ringTransform(0, 3, { ...P, cardSize: 2.5 }, 0).scale).toBeCloseTo(2.5, 6)
  })

  it('direction reverses spin', () => {
    const fwd = ringTransform(1, 4, { ...P, direction: 1 }, 0.25)
    const rev = ringTransform(1, 4, { ...P, direction: -1 }, 0.25)
    expect(Math.atan2(fwd.z, fwd.x)).not.toBeCloseTo(Math.atan2(rev.z, rev.x), 4)
  })
})
