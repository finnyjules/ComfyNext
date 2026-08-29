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
    expect(out.version).toBe(4)
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
    expect(out.version).toBe(4)
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

  // --- v4: `blinds` (Fluted Glass) became a height-field engine (Textured Glass).
  // The painted-rib uniforms have no counterpart in a lit model and are dropped;
  // every surviving uniform keeps its NAME so motion tracks stay addressed.
  const glass = (params: any, version = 3, tracks?: any[]) => migrateShaderConfig({
    version,
    effects: [{ id: 'blinds', params, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' }],
    ...(tracks ? { motion: { duration: 4, fps: 30, tracks } } : {}),
  })

  it('drops the retired painted-rib uniforms from a pre-v4 blinds layer', () => {
    const out = glass({ u_count: 40, u_refraction: 2, u_depth: 0.8, u_shadeWidth: 0.2, u_chromatic: 0.03 })
    const p = out.effects[0]!.params as any
    expect(p.u_depth).toBeUndefined()
    expect(p.u_shadeWidth).toBeUndefined()
    // Everything that survived the rebuild keeps its name AND its value.
    expect(p.u_count).toBe(40)
    expect(p.u_refraction).toBe(2)
    expect(p.u_chromatic).toBe(0.03)
  })

  it('seeds the lit-shading pair so an old layer is not flat glass', () => {
    const p = glass({ u_count: 28, u_depth: 0.3 }).effects[0]!.params as any
    expect(p.u_relief).toBe(1.0)
    expect(p.u_sheen).toBe(0.3)
  })

  it('leaves a saved pattern choice where it was — u_mode 0 and 1 did not move', () => {
    expect((glass({ u_mode: 1, u_centerX: 0.25 }).effects[0]!.params as any).u_mode).toBe(1)
    expect((glass({ u_mode: 0 }).effects[0]!.params as any).u_mode).toBe(0)
  })

  it('drops motion tracks aimed at the retired uniforms, keeping the rest', () => {
    const tr = (path: string) => ({ path, from: 0, to: 1, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0 })
    const out = glass({ u_depth: 0.5 }, 3, [tr('effects.0.params.u_depth'), tr('effects.0.params.u_shadeWidth'), tr('effects.0.params.u_count'), tr('adjust.exposure')])
    expect(out.motion.tracks.map(t => t.path)).toEqual(['effects.0.params.u_count', 'adjust.exposure'])
  })

  it('keeps a u_depth track belonging to a DIFFERENT effect at the same index name', () => {
    const tr = (path: string) => ({ path, from: 0, to: 1, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0 })
    const out = migrateShaderConfig({
      version: 3,
      effects: [
        { id: 'topographic', params: { u_depth: 0.4 }, enabled: true, blend: 'normal', opacity: 1, layerId: 'a' },
        { id: 'blinds', params: { u_depth: 0.4 }, enabled: true, blend: 'normal', opacity: 1, layerId: 'b' },
      ],
      motion: { duration: 4, fps: 30, tracks: [tr('effects.0.params.u_depth'), tr('effects.1.params.u_depth')] },
    })
    // Only the blinds layer retired u_depth; layer 0 keeps both its param and its track.
    expect((out.effects[0]!.params as any).u_depth).toBe(0.4)
    expect(out.motion.tracks.map(t => t.path)).toEqual(['effects.0.params.u_depth'])
  })

  // The gate. A v4 layer sitting on defaults is indistinguishable from a pre-v4
  // one by params alone, so without the version check this would overwrite a
  // user's own Relief/Sheen with the seeded defaults on every single load.
  it('does not re-seed Relief/Sheen on an already-v4 blinds layer', () => {
    const p = glass({ u_relief: 0.2, u_sheen: 0.9 }, 4).effects[0]!.params as any
    expect(p.u_relief).toBe(0.2)
    expect(p.u_sheen).toBe(0.9)
  })

  it('is idempotent for blinds — migrating twice changes nothing further', () => {
    const once = glass({ u_count: 40, u_depth: 0.8, u_shadeWidth: 0.2 })
    const twice = migrateShaderConfig(JSON.parse(JSON.stringify(once)))
    expect(twice.effects[0]!.params).toEqual(once.effects[0]!.params)
  })
})
