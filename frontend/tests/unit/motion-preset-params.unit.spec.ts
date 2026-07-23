import { describe, it, expect } from 'vitest'
import { PRESET_PARAM_DEFAULTS, resolveParams, evaluateAnimation } from '~/lib/motion/evaluate'
import type { FrameMotion } from '~/lib/motion/types'

const MOTION: FrameMotion = { fps: 30, duration: 4 }

describe('resolveParams', () => {
  it('merges spec params over defaults', () => {
    PRESET_PARAM_DEFAULTS['__test'] = { a: 1, b: 2 }
    expect(resolveParams({ presetId: '__test', duration: 1, params: { b: 9 } })).toEqual({ a: 1, b: 9 })
    delete PRESET_PARAM_DEFAULTS['__test']
  })
  it('unknown preset → spec params only', () => {
    expect(resolveParams({ presetId: 'nope', duration: 1, params: { x: 3 } })).toEqual({ x: 3 })
  })
})

describe('existing presets are unchanged by the params plumbing', () => {
  it('fade-in midway matches its analytic value', () => {
    const st = evaluateAnimation(
      { offset: 0, in: { presetId: 'fade-in', duration: 1, stagger: 0, ease: 'none' } },
      0.5, MOTION, 1,
    )
    expect(st.visible).toBe(true)
    expect(st.units![0].opacity).toBeCloseTo(0.5)
  })
})
