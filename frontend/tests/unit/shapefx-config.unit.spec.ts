import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig, type ShapeConfig } from '../../app/lib/shapefx/config'

describe('shapefx config', () => {
  it('DEFAULT_CONFIG is internally consistent', () => {
    expect(DEFAULT_CONFIG.shape.mode).toBe('primitive')
    expect(DEFAULT_CONFIG.fillMode).toBe('facets')
    expect(DEFAULT_CONFIG.locks).toEqual({ shape: false, palette: false, style: false })
    expect(typeof DEFAULT_CONFIG.seed).toBe('string')
  })

  it('mergeConfig fills missing fields from DEFAULT_CONFIG (partial/old configs stay safe)', () => {
    const merged = mergeConfig({ seed: '#abc', palette: { baseHue: 200 } })
    expect(merged.seed).toBe('#abc')
    expect(merged.palette.baseHue).toBe(200)
    expect(merged.palette.harmony).toBe(DEFAULT_CONFIG.palette.harmony) // untouched → default
    expect(merged.shape.primitive).toBe(DEFAULT_CONFIG.shape.primitive)
    expect(merged.shape.jitter).toBe(DEFAULT_CONFIG.shape.jitter)       // new fields default in
    expect(merged.shape.scale).toBe(DEFAULT_CONFIG.shape.scale)
  })

  it('mergeConfig rejects junk types and falls back to defaults', () => {
    const merged = mergeConfig({ shape: { mode: 'nonsense' }, fillMode: 42, locks: 'no' })
    expect(merged.shape.mode).toBe(DEFAULT_CONFIG.shape.mode) // junk nested enum rejected
    expect(merged.fillMode).toBe(DEFAULT_CONFIG.fillMode)
    expect(merged.locks).toEqual(DEFAULT_CONFIG.locks)
  })

  it('mergeConfig round-trips a full DEFAULT_CONFIG', () => {
    expect(mergeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)))).toEqual(DEFAULT_CONFIG)
  })
})
