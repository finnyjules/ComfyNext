import { describe, it, expect } from 'vitest'
import { sunDirection } from '~/lib/scene3d/engine'

describe('scene3d sun direction', () => {
  it('points straight up at 90° elevation', () => {
    const [x, y, z] = sunDirection(0, 90)
    expect(y).toBeCloseTo(1)
    expect(Math.hypot(x, z)).toBeCloseTo(0)
  })
  it('is a unit vector at arbitrary angles', () => {
    const [x, y, z] = sunDirection(123, 34)
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(y).toBeCloseTo(Math.sin((34 * Math.PI) / 180))
  })
})
