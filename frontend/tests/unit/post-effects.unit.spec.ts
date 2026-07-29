import { describe, it, expect } from 'vitest'
import {
  adjustFilterString, noiseBytes, brightPassInPlace, duotoneInPlace,
  vignetteStops, hexToRgb, chainActive, isChainEffect, defaultPostEffect,
  POST_EFFECT_DEFAULTS, POST_FX_PARAM_CLAMP, GPU_TYPES, isGpuEffect,
  type AdjustEffect, type DofEffect,
} from '~/lib/compositor/postEffects'

const adjust = (p: Partial<AdjustEffect>): AdjustEffect =>
  ({ type: 'adjust', brightness: 1, contrast: 1, saturation: 1, hue: 0, visible: true, ...p })

describe('adjustFilterString', () => {
  it('is empty at neutral values (no wasted filter pass)', () => {
    expect(adjustFilterString(adjust({}))).toBe('')
  })
  it('emits only non-neutral functions, clamped', () => {
    expect(adjustFilterString(adjust({ brightness: 1.5 }))).toBe('brightness(1.5)')
    expect(adjustFilterString(adjust({ brightness: 9, hue: -400 })))
      .toBe('brightness(2) hue-rotate(-180deg)')
    expect(adjustFilterString(adjust({ contrast: 0.5, saturation: 0, hue: 90 })))
      .toBe('contrast(0.5) saturate(0) hue-rotate(90deg)')
  })
})

describe('noiseBytes', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = noiseBytes(1234, 64), b = noiseBytes(1234, 64), c = noiseBytes(99, 64)
    expect([...a]).toEqual([...b])
    expect([...a]).not.toEqual([...c])
    expect(a.length).toBe(64)
  })
})

describe('brightPassInPlace', () => {
  it('zeroes alpha below the luminance threshold, keeps it above', () => {
    // px0 = dark gray (lum ~64), px1 = near-white (lum ~230)
    const d = new Uint8ClampedArray([64, 64, 64, 255, 230, 230, 230, 255])
    brightPassInPlace(d, 0.5)
    expect(d[3]).toBe(0)
    expect(d[7]).toBe(255)
  })
})

describe('duotoneInPlace', () => {
  const S = { r: 26, g: 26, b: 64 }, H = { r: 255, g: 232, b: 214 }
  it('maps luminance 0 → shadows and 1 → highlights at mix 1', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    duotoneInPlace(d, S, H, 1)
    expect([d[0], d[1], d[2]]).toEqual([S.r, S.g, S.b])
    expect([d[4], d[5], d[6]]).toEqual([H.r, H.g, H.b])
  })
  it('leaves pixels untouched at mix 0 and never touches alpha', () => {
    const d = new Uint8ClampedArray([10, 200, 30, 128])
    duotoneInPlace(d, S, H, 0)
    expect([...d]).toEqual([10, 200, 30, 128])
  })
})

describe('vignetteStops', () => {
  it('returns inner < outer with both clamped sane', () => {
    const { inner, outer } = vignetteStops(0.5, 0.5)
    expect(inner).toBeGreaterThanOrEqual(0)
    expect(outer).toBeGreaterThan(inner)
    const z = vignetteStops(0, 0) // softness 0 must not collapse the ramp
    expect(z.outer).toBeGreaterThan(z.inner)
  })
})

describe('hexToRgb', () => {
  it('parses #RGB, #RRGGBB and strips alpha from #RRGGBBAA', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#1a1a40')).toEqual({ r: 26, g: 26, b: 64 })
    expect(hexToRgb('#1a1a40cc')).toEqual({ r: 26, g: 26, b: 64 })
  })
})

describe('chain membership', () => {
  it('recognises exactly the five post types', () => {
    for (const t of ['adjust', 'bloom', 'grain', 'vignette', 'duotone']) expect(isChainEffect({ type: t })).toBe(true)
    for (const t of ['drop_shadow', 'layer_blur', 'inner_shadow', 'background_blur']) expect(isChainEffect({ type: t })).toBe(false)
  })
  it('chainActive requires a visible chain effect', () => {
    expect(chainActive(undefined)).toBe(false)
    expect(chainActive([{ type: 'drop_shadow', visible: true }])).toBe(false)
    expect(chainActive([{ type: 'bloom', visible: false }])).toBe(false)
    expect(chainActive([{ type: 'bloom', visible: true }])).toBe(true)
  })
})

describe('defaults', () => {
  it('every type has a default whose type matches its key, visible: true', () => {
    for (const [k, v] of Object.entries(POST_EFFECT_DEFAULTS)) {
      expect(v.type).toBe(k)
      expect(v.visible).toBe(true)
    }
  })
  it('defaultPostEffect returns a fresh clone', () => {
    const a = defaultPostEffect('adjust')
    ;(a as any).brightness = 99
    expect((POST_EFFECT_DEFAULTS.adjust as any).brightness).toBe(1)
  })
})

describe('dof effect routing', () => {
  it('has defaults inside its own clamp ranges', () => {
    const d = defaultPostEffect('dof') as DofEffect
    expect(d.type).toBe('dof')
    for (const [k, [lo, hi]] of Object.entries(POST_FX_PARAM_CLAMP.dof!)) {
      const v = (d as unknown as Record<string, number>)[k]!
      expect(v).toBeGreaterThanOrEqual(lo)
      expect(v).toBeLessThanOrEqual(hi)
    }
  })

  it('is a GPU effect and NOT a 2D chain effect', () => {
    const d = defaultPostEffect('dof')
    expect(isGpuEffect(d)).toBe(true)
    expect(isChainEffect(d)).toBe(false)
    expect(GPU_TYPES.has('dof')).toBe(true)
  })

  it('does not activate the 2D chain on its own', () => {
    expect(chainActive([defaultPostEffect('dof')])).toBe(false)
  })

  it('defaultPostEffect returns a fresh object each call', () => {
    const a = defaultPostEffect('dof') as DofEffect
    a.aperture = 0.9
    expect((defaultPostEffect('dof') as DofEffect).aperture).not.toBe(0.9)
  })
})
