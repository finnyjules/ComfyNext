import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/geoshape/config'

describe('geoshape config', () => {
  it('mergeConfig on junk returns defaults', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(mergeConfig({ count: 'nope', layout: 'bogus' }).count).toBe(DEFAULT_CONFIG.count)
    expect(mergeConfig({ layout: 'bogus' }).layout).toBe(DEFAULT_CONFIG.layout)
  })
  it('round-trips a full config', () => {
    const cfg = { ...DEFAULT_CONFIG, count: 8, layout: 'grid' as const, overlapMode: 'shape' as const, seed: 42 }
    expect(mergeConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg)
  })
  it('defaults overlapMode to hole (geologo default)', () => {
    expect(DEFAULT_CONFIG.overlapMode).toBe('hole')
  })
})
