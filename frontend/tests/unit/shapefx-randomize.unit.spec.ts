import { describe, it, expect } from 'vitest'
import { reroll } from '../../app/lib/shapefx/randomize'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const withLocks = (locks: Partial<ShapeConfig['locks']>): ShapeConfig => ({
  ...DEFAULT_CONFIG, locks: { ...DEFAULT_CONFIG.locks, ...locks },
})

describe('reroll', () => {
  it('produces a new seed', () => {
    const out = reroll(DEFAULT_CONFIG)
    expect(out.seed).not.toBe(DEFAULT_CONFIG.seed)
  })

  it('a locked palette is preserved byte-for-byte; unlocked shape changes', () => {
    const start = withLocks({ palette: true, shape: false })
    // force a shape that will actually differ by using gem mode with many verts
    const seeded: ShapeConfig = { ...start, shape: { ...start.shape, mode: 'gem', vertices: 20 } }
    const out = reroll(seeded)
    expect(out.palette).toEqual(seeded.palette)          // locked → identical
    expect(out.shape).not.toEqual(seeded.shape)          // unlocked → changed
  })

  it('a locked shape is preserved; unlocked palette changes', () => {
    const start = withLocks({ shape: true, palette: false })
    const out = reroll(start)
    expect(out.shape).toEqual(start.shape)
    expect(out.palette).not.toEqual(start.palette)
  })

  it('preserves fillMode and the locks record', () => {
    const start: ShapeConfig = { ...DEFAULT_CONFIG, fillMode: 'surface', locks: { shape: true, palette: false, style: true } }
    const out = reroll(start)
    expect(out.fillMode).toBe('surface')
    expect(out.locks).toEqual(start.locks)
  })
})
