// frontend/tests/unit/shaderstudio-types.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { cloneConfig, defaultConfig, outputDims } from '~/lib/shaderstudio/types'

describe('shaderstudio types', () => {
  it('defaultConfig is a passthrough (no effect, all passes disabled)', () => {
    const c = defaultConfig()
    expect(c.effects[0]!.id).toBe('')
    expect(c.duotone.enabled).toBe(false)
    expect(c.adjust.enabled).toBe(false)
    expect(c.post.blur.enabled).toBe(false)
    expect(c.post.chromatic.enabled).toBe(false)
    expect(c.motion.tracks).toEqual([])
    expect(c.resolution).toBeGreaterThan(0)
  })

  it('cloneConfig is a deep copy', () => {
    const a = defaultConfig()
    const b = cloneConfig(a)
    b.adjust.exposure = 1.5
    b.effects[0]!.params.foo = 2
    expect(a.adjust.exposure).toBe(0)
    expect(a.effects[0]!.params.foo).toBeUndefined()
  })

  it('outputDims caps the long edge and preserves aspect', () => {
    // landscape 1000x500, cap 512 → 512x256
    expect(outputDims(1000, 500, 512)).toEqual({ w: 512, h: 256 })
    // portrait 500x1000, cap 512 → 256x512
    expect(outputDims(500, 1000, 512)).toEqual({ w: 256, h: 512 })
    // smaller than cap → unchanged (even dims)
    expect(outputDims(300, 200, 4096)).toEqual({ w: 300, h: 200 })
  })

  it('outputDims treats the target as a true long edge when upscale is enabled', () => {
    // source smaller than target → upscales to the target long edge
    expect(outputDims(800, 600, 2048, { upscale: true })).toEqual({ w: 2048, h: 1536 })
    // source larger than target → still scales down to the target
    expect(outputDims(4000, 3000, 1024, { upscale: true })).toEqual({ w: 1024, h: 768 })
  })
})
