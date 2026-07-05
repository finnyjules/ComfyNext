import { describe, expect, it } from 'vitest'
import { nudgeLayers } from '../../app/lib/compositor/layerEdits'

const L = (id: string, x: number, y: number): any => ({ id, kind: 'rect', x, y, rotation: 0, opacity: 1, w: 0.1, h: 0.1 })

describe('nudgeLayers', () => {
  it('moves only selected layers by the delta', () => {
    const out = nudgeLayers([L('a', 0.2, 0.2), L('b', 0.5, 0.5)], new Set(['a']), 0.01, -0.02)
    expect(out[0].id).toBe('a')
    expect(out[0].x).toBeCloseTo(0.21)
    expect(out[0].y).toBeCloseTo(0.18)
    expect(out[1]).toMatchObject({ id: 'b', x: 0.5, y: 0.5 })
  })
  it('clamps to [-0.5, 1.5]', () => {
    const out = nudgeLayers([L('a', 1.49, -0.49)], new Set(['a']), 0.5, -0.5)
    expect(out[0].x).toBeCloseTo(1.5); expect(out[0].y).toBeCloseTo(-0.5)
  })
  it('returns the array unchanged for empty selection or zero delta', () => {
    const arr = [L('a', 0.2, 0.2)]
    expect(nudgeLayers(arr, new Set(), 0.01, 0.01)).toBe(arr)
    expect(nudgeLayers(arr, new Set(['a']), 0, 0)).toBe(arr)
  })
})
