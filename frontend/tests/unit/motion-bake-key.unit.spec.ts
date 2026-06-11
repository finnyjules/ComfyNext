import { describe, it, expect } from 'vitest'
import { motionSourceKey } from '../../app/lib/motion/bake'
import { createTextLayer } from '../../app/composables/useCompositorLayers'

describe('motionSourceKey', () => {
  const layers = [createTextLayer({ text: 'HELLO' })]
  const motion = { fps: 30, duration: 4 }
  it('is deterministic', () => {
    expect(motionSourceKey(layers, motion, 1280, 720)).toBe(motionSourceKey(layers, motion, 1280, 720))
  })
  it('changes when anything that affects pixels changes', () => {
    const base = motionSourceKey(layers, motion, 1280, 720)
    expect(motionSourceKey([{ ...layers[0], text: 'WORLD' }], motion, 1280, 720)).not.toBe(base)
    expect(motionSourceKey(layers, { fps: 24, duration: 4 }, 1280, 720)).not.toBe(base)
    expect(motionSourceKey(layers, motion, 1920, 1080)).not.toBe(base)
  })
})
