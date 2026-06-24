import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { cloneConfig, DEFAULT_FLOW, ensureConfigDefaults, flowConfig, LAYOUTS } from '~/lib/gradientfx/types'
import { makeRng, mulberry32, xmur3 } from '~/lib/gradientfx/rng'
import { buildField } from '~/lib/gradientfx/field'
import { buildRampLut, hexToRgb, hslToRgb, rgbToHsl } from '~/lib/gradientfx/ramp'
import { buildConfig, defaultConfig, liquidConfig, reroll } from '~/lib/gradientfx/randomize'
import { applyMotion, trackValue } from '~/lib/gradientfx/motion'
import type { MotionTrack, ShapeConfig } from '~/lib/gradientfx/types'

const baseShape = (over: Partial<ShapeConfig> = {}): ShapeConfig => ({
  type: 'wave', count: 12, minDepth: 0.05, curveExp: 1, jitter: 0, peaks: 4, phase: 0,
  detail: 3, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'down', mirror: 'none', valley: 0.5,
  ...over,
})

describe('gradientfx rng', () => {
  it('xmur3 + mulberry32 are deterministic', () => {
    expect(xmur3('hello')).toBe(xmur3('hello'))
    const a = mulberry32(123), b = mulberry32(123)
    expect(a()).toBe(b())
  })
  it('makeRng with the same seed produces the same stream; different seeds differ', () => {
    const a = makeRng('#abc'), b = makeRng('#abc'), c = makeRng('#xyz')
    expect(a.next()).toBe(b.next())
    expect(makeRng('#abc').next()).not.toBe(c.next())
  })
  it('range/int/pick stay in bounds', () => {
    const r = makeRng('#seed')
    for (let i = 0; i < 200; i++) {
      const v = r.range(2, 5); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThan(5)
      const n = r.int(1, 4); expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(4)
      expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']))
    }
  })
})

describe('gradientfx field', () => {
  it('returns count values in [0,1]', () => {
    for (const type of ['bands', 'pyramid', 'wave', 'noise'] as const) {
      const f = buildField(baseShape({ type, count: 20 }), '#s')
      expect(f.length).toBe(20)
      for (const v of f) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    }
  })
  it('is deterministic for the same seed', () => {
    const a = buildField(baseShape({ type: 'noise' }), '#s')
    const b = buildField(baseShape({ type: 'noise' }), '#s')
    expect(Array.from(a)).toEqual(Array.from(b))
  })
  it('respects minDepth floor', () => {
    const f = buildField(baseShape({ minDepth: 0.5 }), '#s')
    for (const v of f) expect(v).toBeGreaterThanOrEqual(0.5 - 1e-6)
  })
  it('clamps count to [1,256]', () => {
    expect(buildField(baseShape({ count: 0 }), '#s').length).toBe(1)
    expect(buildField(baseShape({ count: 9999 }), '#s').length).toBe(256)
  })
})

describe('gradientfx ramp', () => {
  it('hex round-trips and parses shorthand', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 })
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })
  it('hsl<->rgb round-trips approximately', () => {
    const [h, s, l] = rgbToHsl({ r: 120, g: 200, b: 60 })
    const back = hslToRgb(h, s, l)
    expect(Math.abs(back.r - 120)).toBeLessThan(2)
    expect(Math.abs(back.g - 200)).toBeLessThan(2)
    expect(Math.abs(back.b - 60)).toBeLessThan(2)
  })
  it('LUT is 256px RGBA with correct endpoints', () => {
    const lut = buildRampLut([{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 }])
    expect(lut.length).toBe(256 * 4)
    expect(lut[0]).toBe(0); expect(lut[3]).toBe(255)        // first pixel black, opaque
    expect(lut[255 * 4]).toBe(255)                          // last pixel white
  })
  it('LUT handles empty + single stop without throwing', () => {
    expect(buildRampLut([]).length).toBe(256 * 4)
    expect(buildRampLut([{ color: '#abcdef', pos: 0.5 }]).length).toBe(256 * 4)
  })
})

describe('gradientfx randomize', () => {
  it('buildConfig is deterministic from the seed', () => {
    expect(buildConfig('#aaa')).toEqual(buildConfig('#aaa'))
    expect(buildConfig('#aaa')).not.toEqual(buildConfig('#bbb'))
  })
  it('defaultConfig has one layer and valid structure', () => {
    const c = defaultConfig('#fixed')
    expect(c.layers.length).toBe(1)
    expect(c.layers[0]!.color.stops.length).toBeGreaterThanOrEqual(2)
  })
  it('reroll color keeps structure; reroll structure keeps color', () => {
    const c = buildConfig('#start')
    const recol = reroll(c, 'colors', '#newcol')
    expect(recol.layers[0]!.shape).toEqual(c.layers[0]!.shape)
    expect(recol.layers[0]!.color).not.toEqual(c.layers[0]!.color)

    const restruct = reroll(c, 'structure', '#newstruct')
    expect(restruct.layers[0]!.color).toEqual(c.layers[0]!.color)
    expect(restruct.layers[0]!.shape).not.toEqual(c.layers[0]!.shape)
  })
  it('locks pin fields across reroll', () => {
    const c = { ...buildConfig('#l'), locks: { layout: true, colors: true } }
    const r = reroll(c, 'all', '#z')
    expect(r.canvas.layout).toBe(c.canvas.layout)
    expect(r.layers[0]!.color).toEqual(c.layers[0]!.color)
  })
})

describe('gradientfx reactive-safety (close-modal bug regression)', () => {
  // structuredClone throws DataCloneError on a Vue reactive proxy; cloneConfig
  // (JSON round-trip) must not. This is what broke the editor's close button.
  it('cloneConfig works on a Vue reactive proxy', () => {
    const r = reactive(buildConfig('#reactive'))
    expect(() => cloneConfig(r)).not.toThrow()
    expect(cloneConfig(r)).toEqual(buildConfig('#reactive'))
  })
  it('reroll + applyMotion accept reactive input without throwing', () => {
    const cfg = ref(buildConfig('#rx'))
    cfg.value.motion = { tracks: [{ layer: 0, param: 'phase', from: 0, to: 1, easing: 'pingpong', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }], duration: 4, fps: 30, size: 1080 }
    expect(() => reroll(cfg.value, 'all', '#z')).not.toThrow()
    expect(() => applyMotion(cfg.value, 1)).not.toThrow()
  })
})

describe('gradientfx motion', () => {
  const track = (over: Partial<MotionTrack> = {}): MotionTrack => ({
    layer: 0, param: 'phase', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0, ...over,
  })
  it('linear track spans from→to across the duration', () => {
    expect(trackValue(track(), 0, 4)).toBeCloseTo(0, 5)
    expect(trackValue(track(), 4, 4)).toBeCloseTo(1, 1)
  })
  it('pingpong returns to start at the end of a cycle', () => {
    const t = track({ easing: 'pingpong' })
    expect(trackValue(t, 0, 4)).toBeCloseTo(0, 2)
    expect(trackValue(t, 2, 4)).toBeCloseTo(1, 2) // mid = far extreme
    expect(trackValue(t, 4, 4)).toBeCloseTo(0, 2)
  })
  it('delay holds at `from` before starting', () => {
    expect(trackValue(track({ delay: 2 }), 1, 4)).toBe(0)
  })
  it('applyMotion overrides the targeted shape param without mutating the source', () => {
    const cfg = { ...defaultConfig('#m'), motion: { tracks: [track({ param: 'phase', from: 0, to: 1 })], duration: 4, fps: 30, size: 1080 } }
    const framed = applyMotion(cfg, 4)
    expect(framed.layers[0]!.shape.phase).toBeCloseTo(1, 1)
    expect(cfg.layers[0]!.shape.phase).toBe(0) // original untouched
  })
})

describe('gradientfx liquid randomize', () => {
  it('liquidConfig produces a liquid layout with visible warp', () => {
    const c = liquidConfig('#lq')
    expect(c.canvas.layout).toBe('liquid')
    expect(c.flow!.intensity).toBeGreaterThan(0)
  })
  it('defaultConfig carries a no-op flow block', () => {
    expect(defaultConfig('#d').flow!.intensity).toBe(0)
  })
  it('reroll structure rolls flow; the flow lock pins it', () => {
    const base = buildConfig('#fl')
    const rolled = reroll(base, 'structure', '#fl2')
    expect(rolled.flow).not.toEqual(base.flow)

    const locked = { ...buildConfig('#fl3'), locks: { flow: true } }
    const r = reroll(locked, 'all', '#fl4')
    expect(r.flow).toEqual(locked.flow)
  })
})

describe('gradientfx flow config', () => {
  it('LAYOUTS includes liquid', () => {
    expect(LAYOUTS).toContain('liquid')
  })
  it('DEFAULT_FLOW has zero intensity (no-op for existing gradients)', () => {
    expect(DEFAULT_FLOW.intensity).toBe(0)
  })
  it('ensureConfigDefaults backfills flow on a config that lacks it', () => {
    const c = defaultConfig('#bc') as any
    delete c.flow
    ensureConfigDefaults(c)
    expect(c.flow).toBeDefined()
    expect(c.flow.intensity).toBe(0)
  })
  it('flowConfig returns DEFAULT_FLOW when the config omits flow', () => {
    const c = defaultConfig('#bc2') as any
    delete c.flow
    expect(flowConfig(c)).toEqual(DEFAULT_FLOW)
  })
})
