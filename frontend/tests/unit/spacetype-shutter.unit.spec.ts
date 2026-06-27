import { describe, it, expect } from 'vitest'
import { effectiveProgress, shutterEffect } from '../../app/lib/spacetype/effects/shutter'
import { getEffect, SPACE_TYPE_EFFECTS } from '../../app/lib/spacetype/effects'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'

describe('shutter effect', () => {
  it('is registered and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS).toContain(shutterEffect)
    expect(getEffect('shutter')).toBe(shutterEffect)
    expect(getEffect('SHUTTER')).toBe(shutterEffect) // case-insensitive
  })

  it('has a backend-valid id and the speed-line copy controls', () => {
    expect(/^[a-z0-9]+$/.test(shutterEffect.id)).toBe(true)
    const keys = shutterEffect.controls.map(c => c.key)
    expect(keys).toContain('progress')
    expect(keys).toContain('copies')
    expect(keys).toContain('spacing')
    expect(keys).toContain('stripesBottom')
    expect(keys).toContain('stripesTop')
    expect(keys).toContain('weight')
  })

  it('defaults build without throwing and progress defaults to a full 1', () => {
    const d = defaultsFromControls(shutterEffect.controls)
    expect(d.progress).toBe(1)
  })

  it('loopRates is a single seamless cycle', () => {
    expect(shutterEffect.loopRates?.(defaultsFromControls(shutterEffect.controls))).toEqual([1])
  })

  describe('effectiveProgress', () => {
    it('static ignores time', () => {
      expect(effectiveProgress('static', 0.7, 0)).toBeCloseTo(0.7)
      expect(effectiveProgress('static', 0.7, 0.5)).toBeCloseTo(0.7)
      expect(effectiveProgress('static', 0.7, 0.99)).toBeCloseTo(0.7)
    })
    it('sweepin ramps 0 -> progress across the loop', () => {
      expect(effectiveProgress('sweepin', 1, 0)).toBeCloseTo(0)
      expect(effectiveProgress('sweepin', 1, 0.5)).toBeCloseTo(0.5)
      expect(effectiveProgress('sweepin', 0.8, 1)).toBeCloseTo(0.8)
    })
    it('loop ping-pongs 0 -> progress -> 0 (seamless endpoints)', () => {
      expect(effectiveProgress('loop', 1, 0)).toBeCloseTo(0)
      expect(effectiveProgress('loop', 1, 0.5)).toBeCloseTo(1)
      expect(effectiveProgress('loop', 1, 1)).toBeCloseTo(0)
    })
    it('clamps progress and result into [0,1]', () => {
      expect(effectiveProgress('static', 2, 0)).toBeCloseTo(1)
      expect(effectiveProgress('static', -1, 0)).toBeCloseTo(0)
    })
  })
})
