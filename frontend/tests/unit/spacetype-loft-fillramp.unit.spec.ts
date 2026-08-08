import { describe, it, expect } from 'vitest'
import { rampFromFill } from '../../app/lib/spacetype/loftGeometry'
import * as THREE from 'three'

describe('rampFromFill', () => {
  it('solid fill → flat ramp (endpoints equal)', () => {
    const fills = JSON.stringify([{ type: 'solid', color: '#ff0000', a: '#ff0000', b: '#000000', textColor: '#ffffff', angle: 0, density: 0.5 }])
    const r = rampFromFill(THREE as any, fills, 64)
    expect(r.length).toBe(64 * 4)
    expect([r[0], r[1], r[2]]).toEqual([r[63 * 4], r[63 * 4 + 1], r[63 * 4 + 2]])
    expect(r[0]).toBeGreaterThan(200)  // red channel high
  })
  it('gradient fill → endpoints differ (A vs B)', () => {
    const fills = JSON.stringify([{ type: 'gradient', a: '#000000', b: '#ffffff', color: '#808080', textColor: '#ffffff', angle: 0, density: 0.5 }])
    const r = rampFromFill(THREE as any, fills, 64)
    const first = r[0]! + r[1]! + r[2]!, last = r[63*4]! + r[63*4+1]! + r[63*4+2]!
    expect(last).toBeGreaterThan(first + 200)   // dark → light along the ramp
  })
  it('malformed/empty → does not throw, returns size*4', () => {
    expect(rampFromFill(THREE as any, 'garbage', 32).length).toBe(32 * 4)
  })
})
