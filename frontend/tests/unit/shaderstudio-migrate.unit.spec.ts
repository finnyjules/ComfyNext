import { describe, it, expect } from 'vitest'
import { migrateShaderConfig } from '~/lib/shaderstudio/migrate'

describe('shader config migration', () => {
  it('wraps a legacy single effect into effects[]', () => {
    const legacy = { version: 1, effect: { id: 'halftone', params: { u_size: 4 }, enabled: true }, duotone: { enabled: false } }
    const out = migrateShaderConfig(legacy)
    expect(out.effects).toHaveLength(1)
    expect(out.effects[0]!.id).toBe('halftone')
    expect(out.effects[0]!.blend).toBe('normal')
    expect(out.effects[0]!.opacity).toBe(1)
    expect(out.effects[0]!.layerId).toMatch(/.+/)
    expect(out.version).toBe(2)
    // Task 6 cutover: readers now use `effects[]`, so the legacy field is dropped.
    expect((out as any).effect).toBeUndefined()
  })
  it('passes through an already-migrated config untouched', () => {
    const cur = { version: 2, effects: [{ id: 'x', params: {}, enabled: true, blend: 'screen', opacity: 0.5, layerId: 'a' }] }
    const out = migrateShaderConfig(cur)
    expect(out.effects[0]!.blend).toBe('screen')
  })
  it('rewrites legacy effect.params.* motion track paths to effects.0.params.*', () => {
    const legacy = {
      version: 1,
      effect: { id: 'halftone', params: { u_size: 4 }, enabled: true },
      motion: { duration: 4, fps: 30, tracks: [
        { path: 'effect.params.u_size', from: 0, to: 1, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0 },
        { path: 'adjust.exposure', from: 0, to: 1, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0 },
      ] },
    }
    const out = migrateShaderConfig(legacy)
    expect(out.motion.tracks[0]!.path).toBe('effects.0.params.u_size')
    // Non-effect paths are left alone.
    expect(out.motion.tracks[1]!.path).toBe('adjust.exposure')
  })
})
