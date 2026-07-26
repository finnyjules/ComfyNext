import { describe, it, expect } from 'vitest'
import { DEFAULT_FILL, DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { quantizeTime, fieldKey, planFields, LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'

const spec = (o: Partial<ShaderSpec> = {}): ShaderSpec => ({ ...DEFAULT_SHADER_SPEC, ...o })

describe('quantizeTime', () => {
  it('snaps to the host frame interval', () => {
    expect(quantizeTime(0.51, 30)).toBeCloseTo(0.5)     // 15.3 -> 15 frames
    expect(quantizeTime(0.51, 60)).toBeCloseTo(0.5)     // 30.6 -> 30 frames
    expect(quantizeTime(0.52, 60)).toBeCloseTo(0.5167)  // 31.2 -> 31 frames
  })
  it('uses the host fps rather than a fixed 30 — a 60fps bake gets 60 distinct fields', () => {
    const at30 = new Set([0.50, 0.51, 0.52, 0.53].map(t => quantizeTime(t, 30)))
    const at60 = new Set([0.50, 0.51, 0.52, 0.53].map(t => quantizeTime(t, 60)))
    expect(at60.size).toBeGreaterThan(at30.size)
  })
})

describe('fieldKey', () => {
  it('is stable for identical descriptors — this is what makes batching work', () => {
    expect(fieldKey(spec(), 512, 512, 0.5)).toBe(fieldKey(spec(), 512, 512, 0.5))
  })
  it('separates on effect, params, anchor, size and time', () => {
    const base = fieldKey(spec(), 512, 512, 0.5)
    expect(fieldKey(spec({ effectId: 'droste' }), 512, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec({ params: { segments: 6 } }), 512, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec({ anchor: 'frame' }), 512, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec(), 256, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec(), 512, 512, 0.6)).not.toBe(base)
  })
  it('includes the input fill — gradient-in differs from grid-in', () => {
    const a = fieldKey(spec({ input: { ...DEFAULT_FILL, type: 'gradient' } }), 512, 512, 0)
    const b = fieldKey(spec({ input: { ...DEFAULT_FILL, type: 'grid' } }), 512, 512, 0)
    expect(a).not.toBe(b)
  })
  it('ignores param key ORDER so two equal descriptors share one field', () => {
    const a = fieldKey(spec({ params: { a: 1, b: 2 } }), 512, 512, 0)
    const b = fieldKey(spec({ params: { b: 2, a: 1 } }), 512, 512, 0)
    expect(a).toBe(b)
  })
  it('drops time entirely when speed is 0, so a frozen field caches once', () => {
    const frozen = spec({ speed: 0 })
    expect(fieldKey(frozen, 512, 512, 0)).toBe(fieldKey(frozen, 512, 512, 99))
  })
})

describe('planFields', () => {
  it('keeps the first N distinct keys live and freezes the rest', () => {
    const keys = Array.from({ length: LIVE_FIELD_CEILING + 3 }, (_, i) => `k${i}`)
    const { live, frozen } = planFields(keys)
    expect(live.length).toBe(LIVE_FIELD_CEILING)
    expect(frozen.length).toBe(3)
  })
  it('deduplicates — ten shapes sharing one descriptor cost one live field', () => {
    const { live, frozen } = planFields(['same','same','same','same','same','same'])
    expect(live).toEqual(['same'])
    expect(frozen).toEqual([])
  })
  it('never silently truncates — every key lands in exactly one bucket', () => {
    const keys = ['a','b','c','d','e','f','g']
    const { live, frozen } = planFields(keys)
    expect([...live, ...frozen].sort()).toEqual([...new Set(keys)].sort())
  })
})
