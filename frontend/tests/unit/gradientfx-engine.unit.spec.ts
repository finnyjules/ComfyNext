import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { cloneConfig, DEFAULT_FLOW, DEFAULT_FOCUS, ensureConfigDefaults, flowConfig, LAYOUTS } from '~/lib/gradientfx/types'
import { BLUR_FS, GRADIENT_FS } from '~/lib/gradientfx/shaders'
import { GRADIENT_GUIDANCE, gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { GRADIENT_PRESET_NAMES, buildGradientPreset } from '~/lib/gradientfx/presets'
import { AUTHORED_PRESETS } from '~/lib/gradientfx/presetConfigs'
import { buildVibePrompt } from '~/lib/vibePrompt'
import { describeControls } from '~/lib/spacetype/controlDescriptor'
import { makeConfigParams } from '~/lib/agent/configParams'
import { makeRng, mulberry32, xmur3 } from '~/lib/gradientfx/rng'
import { buildField } from '~/lib/gradientfx/field'
import { buildRampLut, hexToRgb, hslToRgb, rgbToHsl } from '~/lib/gradientfx/ramp'
import { LIQUID_PRESETS, buildConfig, defaultConfig, liquidConfig, liquidPresetConfig, reroll, rippleConfig, stackConfig } from '~/lib/gradientfx/randomize'
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
    // Targeting moved from {layer, param} to a dotted `path`; legacy saved docs
    // are migrated on load by ensureConfigDefaults (see gradientfx-motion-path).
    const cfg = { ...defaultConfig('#m'), motion: { tracks: [track({ path: 'layers.0.shape.phase', from: 0, to: 1 })], duration: 4, fps: 30, size: 1080 } }
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
  it('liquidConfig opens on the authored lit-refractive look, not a flat max warp', () => {
    // These are hand-picked values, not derived from anything, so pin the ones that
    // define the look — a silent drift here changes what every new liquid gradient
    // starts as, which is invisible until someone notices the default got worse.
    const c = liquidConfig('#lq')
    expect(c.flow!.refract).toBe(92)      // bends the ramp through the folds
    expect(c.flow!.depth).toBe(8)         // form comes from lighting, not displacement
    expect(c.flow!.highlights).toBe(63)
    expect(c.flow!.shadows).toBe(55)
    expect(c.relief.grain).toBe(0.95)
    expect(c.focus!.blur).toBe(64)
    expect(c.layers[0]!.color.stops.map(s => s.color))
      .toEqual(['#f9d9f0', '#c026d3', '#960d32', '#fb7f09'])
  })
  it('liquidConfig still varies by seed, so reroll is not a no-op', () => {
    expect(liquidConfig('#a').seed).not.toBe(liquidConfig('#b').seed)
  })
  it('the five liquid look presets are unaffected by the liquid default', () => {
    // liquidPresetConfig builds its own object from DEFAULT_FLOW + LIQUID_LOOKS, so
    // marble/oil/ink/lava/satin must not inherit the authored default's flow values.
    for (const name of LIQUID_PRESETS) {
      expect(liquidPresetConfig(name, '#p').flow!.refract, name).not.toBe(92)
    }
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
  it('reroll colors scope leaves flow untouched', () => {
    const base = buildConfig('#fc')
    const rolled = reroll(base, 'colors', '#fc2')
    expect(rolled.flow).toEqual(base.flow)
  })
  it('every preset carries a flow block (Flow UI binds config.flow! unconditionally)', () => {
    for (const c of [defaultConfig('#p1'), rippleConfig('#p2'), stackConfig('#p3'), liquidConfig('#p4'), buildConfig('#p5')]) {
      expect(c.flow).toBeDefined()
      expect(typeof c.flow!.angle).toBe('number')
    }
  })
})

describe('gradientfx shader has flow stage', () => {
  it('declares the flow uniforms and warp function', () => {
    expect(GRADIENT_FS).toContain('u_flowIntensity')
    expect(GRADIENT_FS).toContain('vec2 applyFlow')
    expect(GRADIENT_FS).toContain('u_layout > 3.5')
  })
  it('declares the liquid-surface uniforms (veins/ripple/refract/viscosity)', () => {
    for (const u of ['u_flowVeins', 'u_flowVeinScale', 'u_flowRipple', 'u_flowRefract', 'u_flowViscosity', 'u_flowSwirl']) {
      expect(GRADIENT_FS).toContain(u)
    }
  })
  it('living drift churns the field (two inner offsets), not the old rigid translate', () => {
    for (const u of ['u_flowAnim1', 'u_flowAnim2', 'u_flowAnimAmt']) expect(GRADIENT_FS).toContain(u)
    // the old single-offset rigid translate is gone
    expect(GRADIENT_FS).not.toContain('u_flowOffset')
    // fold churn is gated so a static (speed 0) gradient is unchanged
    expect(GRADIENT_FS).toContain('if (u_flowAnimAmt > 0.0)')
  })
  it('Depth emboss is frequency-compensated so it is defined at every fold scale', () => {
    // slope normalized to the top of the fold-scale range (max u_flowFoldScale = 7)
    expect(GRADIENT_FS).toContain('7.0 / u_flowFoldScale')
  })
  it('Depth also refracts/displaces the gradient through the fold relief', () => {
    // the ramp coordinate t is bent by the fold slope, scaled by Depth
    expect(GRADIENT_FS).toContain('dot(g * (7.0 / u_flowFoldScale), dir) * u_flowDepth')
  })
  it('fold height uses quintic-smoothed noise so the Depth emboss does not facet', () => {
    expect(GRADIENT_FS).toContain('vnoise5')
    // flowHeight (source of the Depth normal + veins) must build on the C2 fbm5
    expect(GRADIENT_FS).toMatch(/float flowHeight[\s\S]*?fbm5\(sp, u_flowDetail\)/)
    // the quintic (Perlin) fade polynomial, not the cubic one
    expect(GRADIENT_FS).toContain('f * (f * 6.0 - 15.0) + 10.0')
  })
})

describe('gradientfx focus / soft-focus post stage', () => {
  it('BLUR_FS declares the focus/blur uniforms + disc-kernel logic', () => {
    for (const u of ['u_blur', 'u_focusShape', 'u_focusCenter', 'u_focusRadius', 'u_focusSoft', 'u_focusAngle', 'u_src']) {
      expect(BLUR_FS).toContain(u)
    }
    expect(BLUR_FS).toContain('focusMask')
    expect(BLUR_FS).toContain('GOLDEN')
  })
  it('grain is deferred past the blur (grain supersedes blur — stays crisp)', () => {
    expect(GRADIENT_FS).toContain('u_grainDeferred')       // main pass can skip grain
    expect(BLUR_FS).toContain('hashGrain')                 // blur pass re-applies it
    expect(BLUR_FS).toContain('u_grain')
  })
  it('DEFAULT_FOCUS is off (blur 0 → byte-identical no-op)', () => {
    expect(DEFAULT_FOCUS.blur).toBe(0)
    expect(DEFAULT_FOCUS.shape).toBe('off')
  })
  it('ensureConfigDefaults backfills focus, merging a partial (agent-patched) object', () => {
    const c = defaultConfig('#f1') as any
    expect(c.focus).toBeUndefined()
    ensureConfigDefaults(c)
    expect(c.focus).toEqual(DEFAULT_FOCUS)
    // partial focus (e.g. tuner set only blur) is completed, not clobbered
    const c2 = defaultConfig('#f2') as any
    c2.focus = { blur: 60 }
    ensureConfigDefaults(c2)
    expect(c2.focus.blur).toBe(60)
    expect(c2.focus.shape).toBe('off')
    expect(c2.focus.radius).toBe(DEFAULT_FOCUS.radius)
  })
  it('gradientAgentControls exposes focus controls; band angle only when linear', () => {
    const base = defaultConfig('#f3')
    const keys = gradientAgentControls(base).map(c => c.key)
    expect(keys).toContain('focus.blur')
    expect(keys).toContain('focus.shape')
    expect(keys).toContain('focus.x')
    expect(keys).not.toContain('focus.angle') // off → no band angle
    const linear = { ...base, focus: { ...DEFAULT_FOCUS, shape: 'linear' as const } }
    expect(gradientAgentControls(linear).map(c => c.key)).toContain('focus.angle')
  })
})

describe('gradient agent tune-up (presets + guidance)', () => {
  it('every preset builds a valid, defaults-backfilled config; unknown → null', () => {
    for (const name of GRADIENT_PRESET_NAMES) {
      const c = buildGradientPreset(name, '#seed')
      expect(c, name).toBeTruthy()
      expect(c!.layers.length).toBeGreaterThan(0)
      expect(c!.focus).toBeDefined()   // ensureConfigDefaults ran
    }
    expect(buildGradientPreset('not-a-preset')).toBeNull()
  })
  it('liquid-surface presets use the liquid layout (bake in the good depth/veins)', () => {
    for (const n of ['marble', 'oil', 'ink', 'lava', 'satin']) expect(buildGradientPreset(n)!.canvas.layout).toBe('liquid')
  })
  it('a user-authored preset is used verbatim but re-seeded (vary noise, keep vibe)', () => {
    const authored = AUTHORED_PRESETS.marble!
    const built = buildGradientPreset('marble', '#fresh')!
    expect(built.seed).toBe('#fresh')                                  // re-seeded
    expect(built.canvas.layout).toBe(authored.canvas.layout)           // look-defining params kept
    expect(built.flow!.intensity).toBe(authored.flow!.intensity)
    expect(built.layers[0]!.color.stops).toEqual(authored.layers[0]!.color.stops)
    expect(authored.seed).toBe('#74xvg7mn')                            // source object untouched
  })
  it('re-seeded presets vary orientation (angle) per seed but stay deterministic', () => {
    const a = buildGradientPreset('marble', '#s1')!, b = buildGradientPreset('marble', '#s2')!
    for (const c of [a, b]) { expect(c.flow!.angle).toBeGreaterThanOrEqual(0); expect(c.flow!.angle).toBeLessThanOrEqual(360) }
    expect(a.flow!.angle).not.toBe(b.flow!.angle)                      // different seeds → different angles
    expect(buildGradientPreset('marble', '#s1')!.flow!.angle).toBe(a.flow!.angle) // same seed → same angle
  })
  it('gradientAgentControls exposes the preset macro only when includePreset', () => {
    const cfg = defaultConfig('#c')
    expect(gradientAgentControls(cfg).map(c => c.key)).not.toContain('preset')
    const withPreset = gradientAgentControls(cfg, { includePreset: true })
    const preset = withPreset.find(c => c.key === 'preset')
    expect(preset?.kind).toBe('select')
    expect(preset?.options).toEqual([...GRADIENT_PRESET_NAMES])
  })
  it('GRADIENT_GUIDANCE teaches recipes + few-shot examples, not typography', () => {
    expect(GRADIENT_GUIDANCE).toMatch(/marble|liquid/i)
    expect(GRADIENT_GUIDANCE).toMatch(/focus\.blur/)
    expect(GRADIENT_GUIDANCE).toMatch(/relief\.grain/)
    expect(GRADIENT_GUIDANCE.toLowerCase()).not.toContain('typography effect')
    // few-shot composition examples present, referencing real preset names + stop keys
    expect(GRADIENT_GUIDANCE).toContain('EXAMPLES')
    expect(GRADIENT_GUIDANCE).toContain('"preset":"marble"')
    expect(GRADIENT_GUIDANCE).toContain('layer.color.stops.0.color')
    // every preset name referenced in an example must be a real, buildable preset
    for (const m of GRADIENT_GUIDANCE.matchAll(/"preset":"(\w+)"/g)) {
      expect(buildGradientPreset(m[1]!), m[1]).toBeTruthy()
    }
  })
  it('buildVibePrompt injects guidance and drops the stale text/typography wording', () => {
    const described = describeControls(gradientAgentControls(defaultConfig('#p'), { includePreset: true }), makeConfigParams(() => defaultConfig('#p'), () => 0))
    const prompt = buildVibePrompt(described, 'blue marble', 'Gradient studio', GRADIENT_GUIDANCE)
    expect(prompt).toContain(GRADIENT_GUIDANCE)
    expect(prompt).not.toContain('typography effect')
    expect(prompt).not.toContain('do not change the text')
    // without guidance it still works (other studios)
    expect(buildVibePrompt(described, 'x', 'Shader studio')).toContain('CONTROLS YOU MAY CHANGE')
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
