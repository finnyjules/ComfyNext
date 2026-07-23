import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS,
  PRESET_PARAM_DEFAULTS, evaluateAnimation,
} from '~/lib/motion/evaluate'
import type { FrameMotion, LayerAnimSpec } from '~/lib/motion/types'

const MOTION: FrameMotion = { fps: 30, duration: 4 }
const loopAt = (spec: LayerAnimSpec, t: number, n = 1) =>
  evaluateAnimation({ offset: 0, loop: { stagger: 0, ...spec } }, t, MOTION, n).units!
const inAt = (spec: LayerAnimSpec, t: number, n = 1) =>
  evaluateAnimation({ offset: 0, in: { stagger: 0, ...spec } }, t, MOTION, n).units!

describe('wiggle', () => {
  it('is registered with param defaults', () => {
    expect(SUPPORTED_LOOP_IDS).toContain('wiggle')
    expect(PRESET_PARAM_DEFAULTS['wiggle']).toMatchObject({ amplitude: expect.any(Number), cycles: expect.any(Number) })
  })
  it('loops seamlessly (state at phase 0 == phase 1)', () => {
    const spec = { presetId: 'wiggle', duration: 2 }
    const a = loopAt(spec, 0)[0]
    const b = loopAt(spec, 2 - 1e-9)[0]
    expect(b.dx).toBeCloseTo(a.dx, 3)
    expect(b.dy).toBeCloseTo(a.dy, 3)
    expect(b.rotation).toBeCloseTo(a.rotation, 3)
  })
  it('amplitude scales displacement', () => {
    const small = loopAt({ presetId: 'wiggle', duration: 2, params: { amplitude: 0.1 } }, 0.3)[0]
    const big = loopAt({ presetId: 'wiggle', duration: 2, params: { amplitude: 0.4 } }, 0.3)[0]
    expect(Math.abs(big.dx)).toBeCloseTo(Math.abs(small.dx) * 4, 5)
  })
  it('is deterministic per unit index', () => {
    const u0 = loopAt({ presetId: 'wiggle', duration: 2 }, 0.3, 3)
    const u1 = loopAt({ presetId: 'wiggle', duration: 2 }, 0.3, 3)
    expect(u0).toEqual(u1)
    expect(u0[0].dx).not.toBeCloseTo(u0[1].dx, 6) // per-unit variation
  })
})

describe('card flips', () => {
  it('ids registered on both tables', () => {
    expect(SUPPORTED_IN_IDS).toEqual(expect.arrayContaining(['card-flip-h', 'card-flip-v']))
    expect(SUPPORTED_OUT_IDS).toEqual(expect.arrayContaining(['card-flip-h-out', 'card-flip-v-out']))
  })
  it('card-flip-h squashes scaleX from ~0 to 1 (scaleY untouched)', () => {
    const spec = { presetId: 'card-flip-h', duration: 1, ease: 'none' }
    const start = inAt(spec, 0)[0]
    const end = inAt(spec, 1 - 1e-9)[0]
    expect(start.scaleX!).toBeLessThan(0.01)
    expect(end.scaleX!).toBeCloseTo(1, 1)
    expect(start.scaleY).toBeUndefined()
  })
  it('card-flip-v uses scaleY', () => {
    const st = inAt({ presetId: 'card-flip-v', duration: 1, ease: 'none' }, 0)[0]
    expect(st.scaleY!).toBeLessThan(0.01)
    expect(st.scaleX).toBeUndefined()
  })
})
