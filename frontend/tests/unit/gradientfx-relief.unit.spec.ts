import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CENTER, DEFAULT_LIGHT, LAYOUTS, canvasCenter, cloneConfig, ensureConfigDefaults,
  lightVector, reliefLight, type GradientConfig,
} from '~/lib/gradientfx/types'
import { buildConfig, defaultConfig, reroll, rippleConfig, stackConfig } from '~/lib/gradientfx/randomize'
import { resolveGradientFx } from '~/lib/gradientfx/renderer'

describe('lightVector', () => {
  it('azimuth 0 / elevation 0 points along +X', () => {
    const [x, y, z] = lightVector(0, 0)
    expect(x).toBeCloseTo(1, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(0, 6)
  })
  it('elevation 90 points straight out (+Z)', () => {
    const [x, y, z] = lightVector(123, 90)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(1, 6)
  })
  it('azimuth 90 / elevation 0 points along +Y', () => {
    const [x, y, z] = lightVector(90, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1, 6)
    expect(z).toBeCloseTo(0, 6)
  })
  it('always returns a unit vector', () => {
    for (const [az, el] of [[0, 0], [37, 45], [200, 70], [359, 12]]) {
      const v = lightVector(az!, el!)
      const len = Math.hypot(v[0], v[1], v[2])
      expect(len).toBeCloseTo(1, 6)
    }
  })
})

describe('defaulted accessors + ensureConfigDefaults', () => {
  it('reliefLight / canvasCenter fall back to defaults when absent', () => {
    expect(reliefLight({ grain: 0.2, relief: 0.5 })).toEqual(DEFAULT_LIGHT)
    expect(canvasCenter({ aspect: '1:1', layout: 'orbit', margin: 0, innerRadius: 0, background: '#000' }))
      .toEqual(DEFAULT_CENTER)
  })
  it('accessors return the configured value when present', () => {
    expect(reliefLight({ grain: 0, relief: 1, light: { azimuth: 10, elevation: 20 } }))
      .toEqual({ azimuth: 10, elevation: 20 })
    expect(canvasCenter({ aspect: '1:1', layout: 'orbit', margin: 0, innerRadius: 0, background: '#000', center: { x: 0.1, y: -0.2 } }))
      .toEqual({ x: 0.1, y: -0.2 })
  })
  it('backfills missing fields on a legacy config in place', () => {
    const legacy = defaultConfig('#legacy') as GradientConfig
    // Simulate a persisted blob from before this feature.
    delete (legacy.canvas as any).center
    delete (legacy.relief as any).light
    const out = ensureConfigDefaults(legacy)
    expect(out).toBe(legacy)
    expect(out.canvas.center).toEqual(DEFAULT_CENTER)
    expect(out.relief.light).toEqual(DEFAULT_LIGHT)
    // Distinct object, not a shared reference to the constant.
    expect(out.canvas.center).not.toBe(DEFAULT_CENTER)
  })
})

describe('config builders include the new fields', () => {
  it('defaultConfig has center + light', () => {
    const c = defaultConfig('#d')
    expect(c.canvas.center).toBeDefined()
    expect(c.relief.light).toBeDefined()
  })
  it('buildConfig has center + light for any seed', () => {
    for (const s of ['#a', '#b', '#orbit-seed', '#zzz']) {
      const c = buildConfig(s)
      expect(c.canvas.center).toBeDefined()
      expect(c.relief.light).toBeDefined()
    }
  })
  it('reroll never leaves center/light undefined', () => {
    let c = defaultConfig('#r')
    for (const scope of ['all', 'colors', 'structure', 'all'] as const) {
      c = reroll(c, scope, '#seed-' + scope)
      expect(c.canvas.center).toBeDefined()
      expect(c.relief.light).toBeDefined()
    }
  })
})

describe('resolveGradientFx (HMR-safe singleton)', () => {
  it('returns the same instance across re-evaluations of the same scope', () => {
    const scope: { __sailorGradientFx?: any } = {}
    const a = resolveGradientFx(scope)
    const b = resolveGradientFx(scope) // simulates the module re-running under HMR
    expect(a).toBe(b)
    expect(scope.__sailorGradientFx).toBe(a)
  })
  it('does not create a new instance when the scope already holds one', () => {
    const existing = resolveGradientFx({})
    const scope = { __sailorGradientFx: existing }
    expect(resolveGradientFx(scope)).toBe(existing)
  })
})

describe('stackConfig preset', () => {
  it('is a stack layout with ring count + rotStep + pivot', () => {
    const c = stackConfig('#s')
    expect(c.canvas.layout).toBe('stack')
    const sh = c.layers[0]!.shape
    expect(sh.count).toBeGreaterThanOrEqual(2)
    expect(sh.rotStep).toBeGreaterThan(0)
    expect(sh.pivot).toBeGreaterThan(0)
    expect(c.layers[0]!.color.stops.length).toBeGreaterThanOrEqual(2)
  })
  it("'stack' is a registered layout", () => {
    expect(LAYOUTS).toContain('stack')
  })
})

describe('rippleConfig preset', () => {
  it('reproduces the reference shape: orbit + relief + spectrum', () => {
    const c = rippleConfig('#ripple')
    expect(c.canvas.layout).toBe('orbit')
    expect(c.canvas.aspect).toBe('1:1')
    expect(c.relief.relief).toBeGreaterThan(0.5)
    expect(c.relief.light).toBeDefined()
    expect(c.canvas.center).toBeDefined()
    expect(c.layers[0]!.shape.type).toBe('bands')
    expect(c.layers[0]!.color.stops.length).toBeGreaterThanOrEqual(4)
    // Seamless angular ramp: first and last stop share a hue.
    const stops = c.layers[0]!.color.stops
    expect(stops[0]!.color).toBe(stops[stops.length - 1]!.color)
  })
  it('is deterministic-ish (same seed → same structural config)', () => {
    expect(cloneConfig(rippleConfig('#x'))).toEqual(rippleConfig('#x'))
  })
})
