/**
 * observedToConfigs (app/lib/taste/observedConfigs.ts) — the taste-wall's
 * observed column. Synthetic observed.json shape in, and:
 *   - every mapped param with n >= OBSERVED_MIN_N lands at its median
 *     (asserted against a base that provably differs first — a build that
 *     ignores medians must FAIL these, not vacuously pass),
 *   - n < OBSERVED_MIN_N params stay at base,
 *   - pooled colours are injected (ground/ramp/ink/paper/accent),
 *   - a deliberately broken stats key (the untranslated mapping path) is
 *     ignored — observedStatsKey's translation is load-bearing.
 */
import { describe, expect, it } from 'vitest'
import {
  OBSERVED_MIN_N,
  observedFacetProxies,
  observedPool,
  observedStatsKey,
  observedToConfigs,
  type ObservedParamStats,
  type ObservedStats,
} from '../../app/lib/taste/observedConfigs'
import { gradientRange } from '../../app/lib/taste/mapping'
import { defaultConfig as gradientDefaultConfig } from '../../app/lib/gradientfx/randomize'
import { defaultConfig as shaderDefaultConfig } from '../../app/lib/shaderstudio/types'
import { DEFAULT_CONFIG } from '../../app/lib/vectortype/config'
import { getByPath } from '../../app/lib/studio/path'

const stats = (n: number, median: number): ObservedParamStats =>
  ({ n, projects: n, min: median, p25: median, median, p75: median, max: median })

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function bases() {
  return {
    gradient: gradientDefaultConfig('#test'),
    shader: shaderDefaultConfig(),
    vectortype: clone(DEFAULT_CONFIG),
  }
}

const OBSERVED: ObservedStats = {
  studios: {
    gradient: {
      params: {
        'flow.intensity': stats(5, 0.83),
        'layers[*].color.steps': stats(4, 6), // exercises the layers[*] translation
        'post.grainAmount': stats(2, 0.9), // n < 3 — must be ignored
        'post.bloomStrength': stats(3, 0.5),
      },
      colors: { '#101010': 9, '#ff2200': 5, '#f0f0f0': 3 },
    },
    shader: {
      params: {
        'adjust.saturation': stats(4, 0.4),
        'post.bloom.intensity': stats(3, 2.2),
        'effects[post_grain].params.u_amount': stats(6, 0.7), // exercises the effect-slot translation
      },
      colors: { '#0a0a0a': 4, '#fafafa': 2, '#00ff88': 1 },
    },
    vectorType: {
      params: {
        'axes.wght': stats(6, 720),
        'size': stats(3, 150.4), // must land ROUNDED
        'tracking': stats(2, 50), // n < 3 — must be ignored
      },
      colors: { '#0b0d12': 6, '#00c8ff': 3 },
    },
  },
}

describe('observedStatsKey', () => {
  it('translates each studio addressing scheme to the miner keys', () => {
    expect(observedStatsKey('gradient', 'layer.color.steps')).toBe('layers[*].color.steps')
    expect(observedStatsKey('gradient', 'post.grainAmount')).toBe('post.grainAmount')
    expect(observedStatsKey('shader', 'effects.0.params.u_amount')).toBe('effects[post_grain].params.u_amount')
    expect(observedStatsKey('shader', 'effects.1.params.u_temperature')).toBe('effects[color_temperature].params.u_temperature')
    expect(observedStatsKey('shader', 'adjust.saturation')).toBe('adjust.saturation')
    expect(observedStatsKey('vectortype', 'appearance.0.paint.a')).toBe('appearance[fill].paint.a')
    expect(observedStatsKey('vectortype', 'axes.wght')).toBe('axes.wght')
  })
})

describe('observedToConfigs', () => {
  it('lands mapped medians (against a provably different base)', () => {
    const base = bases()
    expect(getByPath(base.gradient, 'flow.intensity')).not.toBe(0.83)
    expect(getByPath(base.gradient, 'layers.0.color.steps')).not.toBe(6)
    expect(getByPath(base.shader, 'adjust.saturation')).not.toBe(0.4)
    expect(getByPath(base.vectortype, 'axes.wght')).not.toBe(720)

    const out = observedToConfigs(OBSERVED, base)
    expect(getByPath(out.gradient, 'flow.intensity')).toBe(0.83)
    expect(getByPath(out.gradient, 'layers.0.color.steps')).toBe(6)
    expect(getByPath(out.gradient, 'post.bloomStrength')).toBe(0.5)
    expect(getByPath(out.shader, 'adjust.saturation')).toBe(0.4)
    expect(getByPath(out.shader, 'post.bloom.intensity')).toBe(2.2)
    expect(getByPath(out.vectortype, 'axes.wght')).toBe(720)
    expect(getByPath(out.vectortype, 'size')).toBe(150) // rounded
  })

  it('seeds nothing from n < OBSERVED_MIN_N samples', () => {
    expect(OBSERVED.studios!.gradient!.params!['post.grainAmount']!.n).toBeLessThan(OBSERVED_MIN_N)
    const base = bases()
    const out = observedToConfigs(OBSERVED, base)
    expect(getByPath(out.gradient, 'post.grainAmount')).toBe(getByPath(base.gradient, 'post.grainAmount'))
    expect(getByPath(out.vectortype, 'tracking')).toBe(getByPath(base.vectortype, 'tracking'))
  })

  it('ignores a deliberately broken (untranslated) stats key', () => {
    const broken: ObservedStats = clone(OBSERVED)
    delete broken.studios!.gradient!.params!['layers[*].color.steps']
    // The RAW mapping path — the miner never writes this key. If the build
    // reads mapping paths without translating, this median would land.
    broken.studios!.gradient!.params!['layer.color.steps'] = stats(9, 6)
    const base = bases()
    const out = observedToConfigs(broken, base)
    expect(getByPath(out.gradient, 'layers.0.color.steps')).toBe(getByPath(base.gradient, 'layers.0.color.steps'))
    expect(getByPath(out.gradient, 'layers.0.color.steps')).not.toBe(6)
  })

  it('injects pooled colours: ground, ramp, ink/paper, accent', () => {
    const out = observedToConfigs(OBSERVED, bases())
    // gradient: darkest pooled colour as ground, ramp from the pool darkest-first
    expect(getByPath(out.gradient, 'canvas.background')).toBe('#101010')
    const stops = getByPath(out.gradient, 'layers.0.color.stops') as Array<{ color: string }>
    expect(stops[0]!.color).toBe('#101010')
    const pool = observedPool(OBSERVED, 'gradient')
    for (const s of stops) expect(pool).toContain(s.color)
    // shader: duotone ink darkest, paper lightest
    expect(out.shader.duotone.ink).toBe('#0a0a0a')
    expect(out.shader.duotone.paper).toBe('#fafafa')
    // vectortype: most saturated pooled colour as the type ink
    expect(getByPath(out.vectortype, 'appearance.0.paint.a')).toBe('#00c8ff')
  })

  it('makes observed groups visible and never mutates the bases', () => {
    const base = bases()
    const before = clone(base)
    const out = observedToConfigs(OBSERVED, base)
    expect(getByPath(out.gradient, 'post.bloom')).toBe(true) // bloomStrength median > 0
    expect(out.shader.adjust.enabled).toBe(true)
    expect(out.shader.post.bloom.enabled).toBe(true)
    expect(out.shader.duotone.enabled).toBe(before.shader.duotone.enabled) // observed OFF stays off
    expect(base).toEqual(before)
  })
})

describe('observedFacetProxies', () => {
  it('inverts grain → texture and background luma → valueBias, nothing else', () => {
    const range = gradientRange('post.grainAmount')!
    const withGrain: ObservedStats = clone(OBSERVED)
    const median = range.min + 0.6 * (range.max - range.min)
    withGrain.studios!.gradient!.params!['post.grainAmount'] = stats(5, median)
    const proxies = observedFacetProxies(withGrain)
    expect(proxies.texture).toBeCloseTo(0.6, 5)
    expect(proxies.valueBias).toBeCloseTo((0x10 * 0.299 + 0x10 * 0.587 + 0x10 * 0.114) / 255, 5)
    expect(Object.keys(proxies).sort()).toEqual(['texture', 'valueBias'])
  })

  it('offers no texture proxy from an under-sampled grain stat', () => {
    const proxies = observedFacetProxies(OBSERVED) // grain n=2 here
    expect(proxies.texture).toBeUndefined()
  })
})
