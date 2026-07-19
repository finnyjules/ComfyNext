import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fillPrimary, fillAlpha } from '~/lib/spacetype/fills'
import { hexBytes, DEFAULT_FILL, type Fill } from '~/lib/spacetype/fillTile'

const solid = (a: string): Fill => ({ ...DEFAULT_FILL, type: 'solid', a })

describe('fillAlpha', () => {
  it('is 1 for a legacy 6-digit fill', () => {
    expect(fillAlpha(solid('#ff0000'))).toBe(1)
  })
  it('reads alpha from an 8-digit fill', () => {
    expect(fillAlpha(solid('#ff000000'))).toBe(0)
    expect(fillAlpha(solid('#ff000080'))).toBeCloseTo(0.502, 3)
  })
})

describe('fillPrimary', () => {
  it('ignores alpha and returns the rgb — THREE.Color renders 8-digit hex as black', () => {
    const withA = fillPrimary(THREE, solid('#ff000080'))
    const without = fillPrimary(THREE, solid('#ff0000'))
    expect(withA.getHex()).toBe(without.getHex())
    expect(withA.getHex()).toBe(0xff0000)
  })
})

describe('hexBytes', () => {
  it('returns rgb bytes for 8-digit input rather than falling back to black', () => {
    expect(Array.from(hexBytes('#ff000080')).slice(0, 3)).toEqual([255, 0, 0])
  })
})
