// frontend/tests/unit/shaderstudio-motion.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { ANIMATABLE, applyMotion, getByPath, setByPath, trackValue } from '~/lib/shaderstudio/motion'
import { defaultConfig, type MotionTrack } from '~/lib/shaderstudio/types'

const track = (over: Partial<MotionTrack> = {}): MotionTrack => ({
  path: 'adjust.exposure', from: 0, to: 1, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0, ...over,
})

describe('shaderstudio motion', () => {
  it('get/set by dotted path', () => {
    const c = defaultConfig()
    setByPath(c, 'post.blur.maxBlur', 12)
    expect(getByPath(c, 'post.blur.maxBlur')).toBe(12)
    setByPath(c, 'effect.params.u_size', 3)
    expect(c.effect.params.u_size).toBe(3)
  })

  it('trackValue interpolates linearly and holds at end for a single play', () => {
    const t = track({ from: 0, to: 10 })
    expect(trackValue(t, 0, 4)).toBeCloseTo(0)
    expect(trackValue(t, 2, 4)).toBeCloseTo(5)
    expect(trackValue(t, 4, 4)).toBeCloseTo(10)
  })

  it('pingpong is seamless: value at t=0 equals value at t=duration', () => {
    const t = track({ from: 0, to: 10, easing: 'pingpong' })
    expect(trackValue(t, 0, 4)).toBeCloseTo(trackValue(t, 4, 4))
  })

  it('applyMotion writes the evaluated value at the path without mutating the source', () => {
    const c = defaultConfig()
    c.motion.tracks = [track({ path: 'adjust.exposure', from: 0, to: 2 })]
    const out = applyMotion(c, 2) // half-way
    expect(out.adjust.exposure).toBeCloseTo(1)
    expect(c.adjust.exposure).toBe(0) // original untouched
  })

  it('ANIMATABLE lists fixed-section paths with labels and ranges', () => {
    const exp = ANIMATABLE.find(a => a.path === 'adjust.exposure')!
    expect(exp.label).toBeTruthy()
    expect(exp.min).toBeLessThan(exp.max)
  })
})
