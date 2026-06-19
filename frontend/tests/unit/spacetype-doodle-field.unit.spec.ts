import { describe, it, expect } from 'vitest'
import { doodleField, DOODLE_KINDS } from '../../app/lib/spacetype/doodleField'
import { mulberry32 } from '../../app/lib/spacetype/rng'

describe('doodleField', () => {
  it('returns `count` doodles', () => {
    expect(doodleField(mulberry32(1), 5, 900, 1150, [40, 120])).toHaveLength(5)
  })
  it('is deterministic for the same seed', () => {
    expect(doodleField(mulberry32(2), 4, 900, 1150, [40, 120]))
      .toEqual(doodleField(mulberry32(2), 4, 900, 1150, [40, 120]))
  })
  it('places doodles within the canvas and gives each a known kind + non-empty path', () => {
    for (const d of doodleField(mulberry32(3), 8, 900, 1150, [40, 120])) {
      expect(d.x).toBeGreaterThanOrEqual(0); expect(d.x).toBeLessThanOrEqual(900)
      expect(d.y).toBeGreaterThanOrEqual(0); expect(d.y).toBeLessThanOrEqual(1150)
      expect(DOODLE_KINDS).toContain(d.kind)
      expect(d.points.length).toBeGreaterThan(1)
      expect(d.appearAt).toBeGreaterThanOrEqual(0); expect(d.appearAt).toBeLessThanOrEqual(1)
    }
  })
})
