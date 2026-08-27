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
import { LIQUID_PRESETS, buildConfig, defaultConfig, liquidConfig, liquidPresetConfig, reroll, rippleConfig, stackConfig, stripeConfig } from '~/lib/gradientfx/randomize'
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
    // hexToRgb now carries an alpha byte (opaque default for 3/6-digit hex — see the
    // alpha-in-stops fix); rgb parsing is unchanged.
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
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
    // relief.grain (was pinned at 0.95 here) is retired (Task 8) — its noise moved
    // into the shared post stack, which fresh/rerolled builders like liquidConfig()
    // no longer pre-enable (only migrated SAVED documents carry legacy grain
    // forward — see gradientfx/types.ts's ensureConfigDefaults). Not part of "the
    // look" this test pins anymore.
    expect(c.post.grain).toBe(false)
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
    expect(GRADIENT_FS).toContain('u_layout[0] > 3.5')
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

  it('the fold fbm is derivative-filtered (band-limited) so sub-pixel octaves fade, not alias', async () => {
    const { FBM_AA_LO, FBM_AA_HI } = await import('~/lib/gradientfx/shaders')
    // fbm5f (the filtered variant) must measure the per-pixel footprint with fwidth
    // and roll each octave off across the taste-tuned Nyquist band — embedded from
    // the constants, not hand-typed (same contract as REFRACT_REACH / TILT_GAIN).
    expect(GRADIENT_FS).toMatch(/float fbm5f[\s\S]*?fwidth\(/)
    expect(GRADIENT_FS).toMatch(/float fbm5f[\s\S]*?smoothstep\(/)
    expect(GRADIENT_FS).toContain(FBM_AA_LO.toFixed(4))
    expect(GRADIENT_FS).toContain(FBM_AA_HI.toFixed(4))
    // Re-pin the measured sweet spot: the fade begins above Nyquist 0.5 (LO=0.70)
    // so resolvable fold octaves are never touched, and only fully removes an
    // octave once its footprint > 1.40 (firmly sub-pixel). Retuned from 0.40/0.80,
    // which faded below Nyquist and read as blurry.
    expect(FBM_AA_LO).toBe(0.70)
    expect(FBM_AA_HI).toBe(1.40)
    expect(GRADIENT_FS).toContain('0.7000')
    expect(GRADIENT_FS).toContain('1.4000')
    // The band must be a real rolloff window (LO fully-resolved < HI aliased-out),
    // and the whole thing lives inside a WebGL2 shader where fwidth is core.
    expect(FBM_AA_LO).toBeLessThan(FBM_AA_HI)
    expect(GRADIENT_FS.startsWith('#version 300 es')).toBe(true)
  })

  it('the octave weight w(fw,k) = 1 - smoothstep(LO, HI, fw*2^k) has the properties the shader relies on', async () => {
    const { FBM_AA_LO, FBM_AA_HI } = await import('~/lib/gradientfx/shaders')
    // TS mirror of the GLSL octave rolloff, so the behaviour (not just the string
    // constant) is pinned. Matches fbm5f: footprint = fw * exp2(k), w = 1 for k==0,
    // else 1 - smoothstep(LO, HI, footprint).
    const smoothstep = (e0: number, e1: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
      return t * t * (3 - 2 * t)
    }
    const w = (fw: number, k: number) =>
      k === 0 ? 1 : 1 - smoothstep(FBM_AA_LO, FBM_AA_HI, fw * 2 ** k)

    // (a) an octave whose footprint fw*2^k < LO gets w==1 — resolvable octaves untouched.
    for (let k = 1; k < 6; k++) {
      const fw = (FBM_AA_LO * 0.99) / 2 ** k // footprint just under LO
      expect(w(fw, k)).toBe(1)
    }

    // (b) w is monotonic non-increasing as footprint grows (fix k, sweep fw upward).
    let prev = Infinity
    for (const fw of [0.01, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0, 1.4, 2.0, 4.0]) {
      const wk = w(fw, 3)
      expect(wk).toBeLessThanOrEqual(prev + 1e-12)
      prev = wk
    }

    // (c) w → 1 as footprint → 0 (filtered fbm collapses to the unfiltered identity
    // at fine resolution — every octave passes through whole).
    for (let k = 1; k < 6; k++) expect(w(1e-6, k)).toBeCloseTo(1, 10)

    // (d) mean-preservation: with sum += amp*w*noise; tot += amp*w and the sum/tot
    // normalization, a field of constant-mean octaves returns that mean regardless of
    // the weights — weighting can never shift the mean, only band-limit the variance.
    const mean = 0.375
    const amps = [0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625]
    const footprints = [0.02, 0.09, 0.35, 0.8, 1.6, 3.2] // spans below-LO through above-HI
    let sum = 0, tot = 0
    for (let k = 0; k < 6; k++) {
      const wk = w(footprints[k], k)
      sum += amps[k] * wk * mean
      tot += amps[k] * wk
    }
    expect(tot).toBeGreaterThan(0)
    expect(sum / tot).toBeCloseTo(mean, 12)
  })

  it('band-limits the emboss/refraction NORMAL, but the veins/ripple sample the raw field', () => {
    // The filtered field feeds the finite-difference normals (flowHeightAA); the
    // directly-sampled veins/ripple must keep the unfiltered flowHeight, or the
    // dither that was hiding ink's vein seams is stripped and they alias into lines.
    expect(GRADIENT_FS).toContain('float flowHeightAA')
    expect(GRADIENT_FS).toMatch(/float flowHeightAA[\s\S]*?fbm5f\(sp, u_flowDetail\)/)
    // veins read h0 = flowHeight(p) (unfiltered), the emboss reads flowHeightAA
    expect(GRADIENT_FS).toContain('float h  = flowHeightAA(p);')
    expect(GRADIENT_FS).toContain('float ph = flowHeight(p) * TAU;')  // ripple stays raw
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
  it('grain retired from both passes (Task 8) — the shared post stack applies it AFTER this blur pass, so no deferred re-apply is needed here', () => {
    // Uniform DECLARATIONS, not a bare substring: the retirement is explained in
    // prose in both files, and those comments legitimately name the old uniforms.
    expect(GRADIENT_FS).not.toContain('uniform float u_grain;')
    expect(GRADIENT_FS).not.toContain('uniform float u_grainDeferred;')
    expect(BLUR_FS).not.toContain('uniform float u_grain;')
    expect(BLUR_FS).not.toContain('hashGrain')
  })
  it('DEFAULT_FOCUS is off (blur 0 → byte-identical no-op)', () => {
    expect(DEFAULT_FOCUS.blur).toBe(0)
    expect(DEFAULT_FOCUS.shape).toBe('off')
  })
  it('ensureConfigDefaults backfills focus, merging a partial (agent-patched) object', () => {
    // stripeConfig, not defaultConfig: defaultConfig now runs ensureConfigDefaults
    // internally (Task 7), so its focus is already backfilled — this test needs an
    // un-normalized config to characterize the backfill itself.
    const c = stripeConfig('#f1') as any
    expect(c.focus).toBeUndefined()
    ensureConfigDefaults(c)
    expect(c.focus).toEqual(DEFAULT_FOCUS)
    // partial focus (e.g. tuner set only blur) is completed, not clobbered
    const c2 = stripeConfig('#f2') as any
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
  // Deliberate characterization change: this used to assert the roll on `marble`,
  // which is an AUTHORED preset. Orientation is now the author's to choose (see
  // the block below), so the roll is pinned on a BUILDER-ONLY preset instead —
  // where an algorithm chose the angle and any angle is as good as another.
  it('an ALGORITHMIC preset varies orientation per seed but stays deterministic', () => {
    const a = buildGradientPreset('liquid', '#s1')!, b = buildGradientPreset('liquid', '#s2')!
    for (const c of [a, b]) { expect(c.flow!.angle).toBeGreaterThanOrEqual(0); expect(c.flow!.angle).toBeLessThanOrEqual(360) }
    expect(a.flow!.angle).not.toBe(b.flow!.angle)                      // different seeds → different angles
    expect(buildGradientPreset('liquid', '#s1')!.flow!.angle).toBe(a.flow!.angle) // same seed → same angle
  })

  describe('an authored preset keeps the orientation its author aimed', () => {
    // Owner report: "sunset" takes carried the right colours but ran LEFT TO
    // RIGHT — a sideways sunset. The orientation roll ran over every preset,
    // including the authored ones, and the authored sunset sets flow.angle 269
    // with a vertical ramp ON PURPOSE: a horizon. For a preset whose whole
    // subject is a direction, the angle IS a look-defining param, exactly like
    // its colours — and the function's own doc already promised those are kept.
    it('sunset keeps its horizon angle and its light, whatever the seed', () => {
      for (const seed of ['#a', '#b', '#c', '#zzz', '#0']) {
        const built = buildGradientPreset('sunset', seed)!
        expect(built.flow!.angle).toBe(AUTHORED_PRESETS.sunset!.flow!.angle)
        expect(built.relief.light!.azimuth).toBe(AUTHORED_PRESETS.sunset!.relief.light!.azimuth)
        expect(built.seed).toBe(seed) // still re-seeded: the NOISE varies, the aim does not
      }
    })

    it('every authored preset does, not just sunset', () => {
      for (const [name, authored] of Object.entries(AUTHORED_PRESETS)) {
        if (!authored) continue
        const built = buildGradientPreset(name, '#roll-me')!
        expect(built.flow?.angle, name).toBe(authored.flow?.angle)
        expect(built.relief.light?.azimuth, name).toBe(authored.relief.light?.azimuth)
      }
    })

    it('and the colours are still the author\u2019s too (the promise this restores)', () => {
      const built = buildGradientPreset('sunset', '#x')!
      expect(built.layers[0]!.color.stops).toEqual(AUTHORED_PRESETS.sunset!.layers[0]!.color.stops)
      expect(built.layers[0]!.color.gradientDir).toBe('vertical')
    })
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
    expect(GRADIENT_GUIDANCE).toMatch(/post\.grain/)
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
