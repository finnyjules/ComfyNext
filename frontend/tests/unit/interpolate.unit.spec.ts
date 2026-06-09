import { describe, it, expect } from 'vitest'
import { interpolateClipAt } from '../../shared/timeline/interpolate'

describe('interpolateClipAt', () => {
  it('returns static scalars when no keyframes', () => {
    const tf = interpolateClipAt({ x: 0.2, scale: 1.5 }, 10)
    expect(tf).toEqual({ x: 0.2, y: 0, rotation: 0, scale: 1.5, opacity: 1 })
  })

  it('lerps linearly between bracketing keyframes', () => {
    const clip = {
      keyframes: [
        { frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 },
        { frame: 10, x: 1, y: -1, rotation: 90, scale: 2, opacity: 0 },
      ],
    }
    const tf = interpolateClipAt(clip, 5)
    expect(tf.x).toBeCloseTo(0.5, 10)
    expect(tf.y).toBeCloseTo(-0.5, 10)
    expect(tf.rotation).toBeCloseTo(45, 10)
    expect(tf.scale).toBeCloseTo(1.5, 10)
    expect(tf.opacity).toBeCloseTo(0.5, 10)
  })

  it('applies smoothstep for easeInOut (t=0.25 → 0.15625)', () => {
    const clip = {
      keyframes: [
        { frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, ease: 'easeInOut' as const },
        { frame: 10, x: 1, y: 0, rotation: 0, scale: 1, opacity: 1 },
      ],
    }
    expect(interpolateClipAt(clip, 2.5).x).toBeCloseTo(0.15625, 10)
  })

  it('clamps before the first and after the last keyframe', () => {
    const clip = {
      keyframes: [
        { frame: 5, x: 0.3, y: 0, rotation: 0, scale: 1, opacity: 1 },
        { frame: 10, x: 0.9, y: 0, rotation: 0, scale: 1, opacity: 1 },
      ],
    }
    expect(interpolateClipAt(clip, 0).x).toBeCloseTo(0.3, 10)
    expect(interpolateClipAt(clip, 99).x).toBeCloseTo(0.9, 10)
  })
})
