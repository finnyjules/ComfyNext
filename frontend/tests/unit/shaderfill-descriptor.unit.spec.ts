import { describe, it, expect } from 'vitest'
import { DEFAULT_FILL, DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { quantizeTime, fieldKey, planFields, resolveEffectParams, LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'
import type { EffectDef } from '~/lib/shaderfx/types'

const spec = (o: Partial<ShaderSpec> = {}): ShaderSpec => ({ ...DEFAULT_SHADER_SPEC, ...o })

// Mirrors the real catalog's convention (shader_effects/manifest.json): `uniform`
// carries the `u_` prefix already; ShaderSpec.params does not.
const fakeEffect = (overrides: Partial<EffectDef> = {}): EffectDef => ({
  id: 'fbm_warp', name: 'FBM Warp', category: 'distortion', animated: true, passes: 1,
  centerParam: null, textures: [],
  params: [
    { uniform: 'u_amount', label: 'Amount', type: 'float', min: 0, max: 0.5, default: 0.12, step: 0.005 },
    { uniform: 'u_scale', label: 'Scale', type: 'float', min: 0.5, max: 8, default: 3, step: 0.25 },
    { uniform: 'u_mode', label: 'Mode', type: 'enum', default: 0, options: [{ label: 'A', value: 0 }, { label: 'B', value: 1 }] },
  ],
  source: '',
  ...overrides,
})

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

  it('does not collide on unescaped separators in param keys — "x=1,y":2 vs x:1,y:2', () => {
    const a = fieldKey(spec({ params: { 'x=1,y': 2 } }), 512, 512, 0)
    const b = fieldKey(spec({ params: { x: 1, y: 2 } }), 512, 512, 0)
    expect(a).not.toBe(b)
  })

  it('does not let a "|" in effectId masquerade as the effectId/params boundary', () => {
    // Under a naive `[effectId, paramsKey, ...].join('|')`, effectId 'a' with params
    // {'b|c': 5} previously produced the SAME string ("a|b|c=5|...") as effectId 'a|b'
    // with params {c: 5} — the '|' inside the param KEY shifted the boundary to land
    // exactly where the effectId/paramsKey split would otherwise be.
    const a = fieldKey(spec({ effectId: 'a', params: { 'b|c': 5 } }), 512, 512, 0.5)
    const b = fieldKey(spec({ effectId: 'a|b', params: { c: 5 } }), 512, 512, 0.5)
    expect(a).not.toBe(b)
  })

  it('does not let a "|" in Fill.a/b masquerade as the input-field boundary', () => {
    // Under a naive `${type}|${a}|${b}|...` join, a='foo|bar',b='baz' previously
    // produced the SAME string as a='foo', b='bar|baz'.
    const fillA = { ...DEFAULT_FILL, type: 'gradient' as const, a: 'foo|bar', b: 'baz' }
    const fillB = { ...DEFAULT_FILL, type: 'gradient' as const, a: 'foo', b: 'bar|baz' }
    const a = fieldKey(spec({ input: fillA }), 512, 512, 0)
    const b = fieldKey(spec({ input: fillB }), 512, 512, 0)
    expect(a).not.toBe(b)
  })

  it('keeps non-finite speeds distinct from each other and from a null param — plain JSON.stringify collapses NaN/Infinity/-Infinity to null', () => {
    const nanSpeed = fieldKey(spec({ speed: NaN }), 512, 512, 0)
    const posInfSpeed = fieldKey(spec({ speed: Infinity }), 512, 512, 0)
    const negInfSpeed = fieldKey(spec({ speed: -Infinity }), 512, 512, 0)
    const nullParam = fieldKey(spec({ params: { p: null as unknown as number } }), 512, 512, 0)
    expect(new Set([nanSpeed, posInfSpeed, negInfSpeed, nullParam]).size).toBe(4)
  })

  it('keeps a NaN param value distinct from an explicit null param value', () => {
    const withNaN = fieldKey(spec({ params: { p: NaN } }), 512, 512, 0)
    const withNull = fieldKey(spec({ params: { p: null as unknown as number } }), 512, 512, 0)
    expect(withNaN).not.toBe(withNull)
  })
})

describe('resolveEffectParams', () => {
  it('applies defaults for every declared param when overrides is empty', () => {
    expect(resolveEffectParams(fakeEffect(), {})).toEqual({ amount: 0.12, scale: 3, mode: 0 })
  })

  it('lets a valid override win over the default', () => {
    expect(resolveEffectParams(fakeEffect(), { amount: 0.4 })).toEqual({ amount: 0.4, scale: 3, mode: 0 })
  })

  it('drops keys the effect does not declare', () => {
    expect(resolveEffectParams(fakeEffect(), { amount: 0.4, notAParam: 999 })).toEqual({ amount: 0.4, scale: 3, mode: 0 })
  })

  it('clamps an out-of-range float override to min/max', () => {
    expect(resolveEffectParams(fakeEffect(), { amount: 99 }).amount).toBe(0.5)
    expect(resolveEffectParams(fakeEffect(), { amount: -99 }).amount).toBe(0)
  })

  it('falls back to default for an enum override that is not a declared option value', () => {
    expect(resolveEffectParams(fakeEffect(), { mode: 7 }).mode).toBe(0)
    expect(resolveEffectParams(fakeEffect(), { mode: 1 }).mode).toBe(1)
  })

  it('falls back to default for a non-finite override — Infinity is not clamped, it is rejected', () => {
    expect(resolveEffectParams(fakeEffect(), { amount: NaN }).amount).toBe(0.12)
    expect(resolveEffectParams(fakeEffect(), { amount: Infinity }).amount).toBe(0.12)
  })

  it('the whole point: an empty params object and one that repeats the defaults must key identically', () => {
    const effect = fakeEffect()
    const empty = resolveEffectParams(effect, {})
    const explicit = resolveEffectParams(effect, { amount: 0.12, scale: 3, mode: 0 })
    expect(explicit).toEqual(empty)
    const keyA = fieldKey(spec({ params: empty }), 512, 512, 0.5)
    const keyB = fieldKey(spec({ params: explicit }), 512, 512, 0.5)
    expect(keyA).toBe(keyB)
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
