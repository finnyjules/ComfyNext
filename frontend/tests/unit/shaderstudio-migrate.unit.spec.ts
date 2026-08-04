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
    expect(out.version).toBe(3)
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

  // --- v3: gradient_map became a real (Photoshop) gradient map; the old cosine
  // rainbow moved to spectrum_map. Pre-v3 layers must follow the rainbow.
  it('moves a pre-v3 gradient_map layer to spectrum_map, keeping its params', () => {
    const out = migrateShaderConfig({
      version: 2,
      effects: [{ id: 'gradient_map', params: { u_hue: 0.42, u_spread: 1.5 }, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' }],
    })
    expect(out.effects[0]!.id).toBe('spectrum_map')
    expect(out.effects[0]!.params).toEqual({ u_hue: 0.42, u_spread: 1.5 })
    expect(out.version).toBe(3)
  })
  it('moves a pre-v3 gradient_map layer on bare defaults too', () => {
    const out = migrateShaderConfig({
      version: 2,
      effects: [{ id: 'gradient_map', params: {}, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' }],
    })
    expect(out.effects[0]!.id).toBe('spectrum_map')
  })
  // The gate that makes this migration idempotent. Without it, every NEW
  // gradient_map saved on defaults (`params: {}`) would be turned into a rainbow
  // on the next load — the two cases are indistinguishable by params alone.
  it('leaves a v3 gradient_map on defaults alone', () => {
    const out = migrateShaderConfig({
      version: 3,
      effects: [{ id: 'gradient_map', params: {}, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' }],
    })
    expect(out.effects[0]!.id).toBe('gradient_map')
  })
  it('is idempotent — migrating twice does not re-migrate', () => {
    const once = migrateShaderConfig({
      version: 2,
      effects: [{ id: 'gradient_map', params: {}, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' }],
    })
    const twice = migrateShaderConfig(JSON.parse(JSON.stringify(once)))
    expect(twice.effects[0]!.id).toBe('spectrum_map')
  })
  it('keeps a pre-v3 layer already carrying new-shape params as gradient_map', () => {
    const out = migrateShaderConfig({
      version: 2,
      effects: [{ id: 'gradient_map', params: { u_mix: 0.5 }, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' }],
    })
    expect(out.effects[0]!.id).toBe('gradient_map')
  })
})
