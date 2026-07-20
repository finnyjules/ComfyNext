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
    // NOTE: `effect` is intentionally KEPT in Task 5 (readers still use it); Task 6
    // switches readers to `effects` and only then deletes `effect`.
  })
  it('passes through an already-migrated config untouched', () => {
    const cur = { version: 2, effects: [{ id: 'x', params: {}, enabled: true, blend: 'screen', opacity: 0.5, layerId: 'a' }] }
    const out = migrateShaderConfig(cur)
    expect(out.effects[0]!.blend).toBe('screen')
  })
})
