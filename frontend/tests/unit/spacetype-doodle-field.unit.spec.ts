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
  it('confines doodles to the spawn area when one is given', () => {
    const area = { x: 200, y: 300, w: 100, h: 150 }
    for (const d of doodleField(mulberry32(4), 12, 900, 1150, [40, 120], area)) {
      expect(d.x).toBeGreaterThanOrEqual(200); expect(d.x).toBeLessThanOrEqual(300)
      expect(d.y).toBeGreaterThanOrEqual(300); expect(d.y).toBeLessThanOrEqual(450)
    }
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
