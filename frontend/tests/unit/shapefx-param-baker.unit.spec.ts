import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'
import { makeConfigParams } from '../../app/lib/agent/configParams'

describe('shape param override round-trip', () => {
  it('applying then restoring overrides leaves the config byte-identical', () => {
    const cfg: any = mergeConfig(structuredClone(DEFAULT_CONFIG))
    const before = JSON.stringify(cfg)
    const params = makeConfigParams(() => cfg, () => 0)
    const overrides = { 'shape.jitter': 55, 'palette.baseHue': 12 }

    const snapshot: Record<string, unknown> = {}
    for (const k of Object.keys(overrides)) snapshot[k] = params[k]
    try {
      for (const [k, v] of Object.entries(overrides)) params[k] = v
      expect(cfg.shape.jitter).toBe(55)
      expect(cfg.palette.baseHue).toBe(12)
    } finally {
      for (const [k, v] of Object.entries(snapshot)) params[k] = v
    }
    expect(JSON.stringify(cfg)).toBe(before)
  })
})
