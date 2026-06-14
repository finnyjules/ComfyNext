import { describe, it, expect } from 'vitest'
import { normalizeAxisKeyframes } from '../../app/lib/timeline/convertPresetToKeyframes'

describe('normalizeAxisKeyframes', () => {
  it('sorts by t, clamps to [0,1], fills default ease', () => {
    const out = normalizeAxisKeyframes([
      { t: 1.2, axes: { wght: 900 } },
      { t: -0.1, axes: { wght: 100 }, ease: 'power2.in' },
    ])
    expect(out.map(k => k.t)).toEqual([0, 1])
    expect(out[0]!.ease).toBe('power2.in')
    expect(out[1]!.ease).toBe('linear')
  })
  it('returns [] for empty/undefined', () => {
    expect(normalizeAxisKeyframes(undefined)).toEqual([])
    expect(normalizeAxisKeyframes([])).toEqual([])
  })
})
