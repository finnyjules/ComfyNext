// frontend/tests/unit/shaderstudio-mask.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { defaultConfig, defaultMask } from '~/lib/shaderstudio/types'
import { maskUniforms, sampleMask, MASK_SHAPE_IDX } from '~/lib/shaderstudio/mask'
import { applyMotion } from '~/lib/shaderstudio/motion'
import { shaderAgentControls } from '~/lib/shaderstudio/agentControls'
import type { EffectDef } from '~/lib/shaderfx/types'

describe('sampleMask (JS mirror of the GLSL maskValue)', () => {
  it('radius: ~1 at center, ~0 far outside, monotonic across the feathered edge', () => {
    const m = { ...defaultMask(), shape: 'radius' as const, cx: 0.5, cy: 0.5, size: 0.3, feather: 0.3 }
    expect(sampleMask(m, 0.5, 0.5, 1)).toBeCloseTo(1, 5)          // dead center
    expect(sampleMask(m, 0.95, 0.5, 1)).toBeCloseTo(0, 5)         // far outside
    // Walking outward from center, the value never increases.
    let prev = Infinity
    for (let u = 0.5; u <= 0.95; u += 0.02) {
      const v = sampleMask(m, u, 0.5, 1)
      expect(v).toBeLessThanOrEqual(prev + 1e-9)
      prev = v
    }
  })

  it('radius stays circular under a non-1 aspect ratio (wide image)', () => {
    // A wide image (ar=2) must not stretch the circle: a point at the same *pixel*
    // distance up vs. sideways should give ~equal mask values.
    const m = { ...defaultMask(), shape: 'radius' as const, cx: 0.5, cy: 0.5, size: 0.3, feather: 0.2, aspect: 1 }
    const ar = 2
    const side = sampleMask(m, 0.5 + 0.1 / ar, 0.5, ar) // 0.1 image-height to the right
    const up = sampleMask(m, 0.5, 0.5 + 0.1, ar)        // 0.1 image-height up
    expect(side).toBeCloseTo(up, 5)
  })

  it('band: full inside the strip, zero well outside it, independent of x', () => {
    const m = { ...defaultMask(), shape: 'band' as const, cx: 0.5, cy: 0.5, size: 0.1, feather: 0.2, angle: 0 }
    // On the band centerline the value is 1 regardless of horizontal position.
    expect(sampleMask(m, 0.1, 0.5, 1)).toBeCloseTo(1, 5)
    expect(sampleMask(m, 0.9, 0.5, 1)).toBeCloseTo(1, 5)
    // Far above/below the strip → 0.
    expect(sampleMask(m, 0.5, 0.9, 1)).toBeCloseTo(0, 5)
  })

  it('invert returns 1 - value everywhere', () => {
    const base = { ...defaultMask(), shape: 'radius' as const, size: 0.3, feather: 0.3 }
    for (const [u, v] of [[0.5, 0.5], [0.7, 0.5], [0.9, 0.2]] as const) {
      const on = sampleMask({ ...base, invert: false }, u, v, 1)
      const off = sampleMask({ ...base, invert: true }, u, v, 1)
      expect(off).toBeCloseTo(1 - on, 5)
    }
  })

  it('never returns NaN when size or feather collapse to 0', () => {
    const m = { ...defaultMask(), shape: 'radius' as const, size: 0, feather: 0 }
    const v = sampleMask(m, 0.5, 0.5, 1)
    expect(Number.isNaN(v)).toBe(false)
  })
})

describe('maskUniforms', () => {
  it('flattens a mask to flat scalar uniforms with the shape index', () => {
    const m = { ...defaultMask(), shape: 'band' as const, cx: 0.25, cy: 0.75, size: 0.2, aspect: 1.5, angle: 0.5, feather: 0.4, invert: true }
    const u = maskUniforms(m)
    expect(u.u_maskShape).toBe(MASK_SHAPE_IDX.band)
    expect(u.u_maskCx).toBe(0.25)
    expect(u.u_maskCy).toBe(0.75)
    expect(u.u_maskSize).toBe(0.2)
    expect(u.u_maskAspect).toBe(1.5)
    expect(u.u_maskAngle).toBe(0.5)
    expect(u.u_maskFeather).toBe(0.4)
    expect(u.u_maskInvert).toBe(1)
  })
})

describe('mask capability wiring', () => {
  const fakeDef: EffectDef = {
    id: 'noise_distortion', name: 'Warp', category: 'distort', animated: true, passes: 1,
    centerParam: null, textures: [], params: [], source: 'SRC',
  }

  it('motion animates a mask region param via its dotted path', () => {
    const c = defaultConfig()
    c.effects[0] = { ...c.effects[0]!, id: 'noise_distortion', mask: { ...defaultMask(), enabled: true, cx: 0.2 } }
    c.motion = { duration: 4, fps: 30, tracks: [
      { path: 'effects.0.mask.cx', from: 0.2, to: 0.8, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0 },
    ] }
    expect(applyMotion(c, 0).effects[0]!.mask!.cx).toBeCloseTo(0.2, 5)
    expect(applyMotion(c, 4).effects[0]!.mask!.cx).toBeCloseTo(0.8, 5)
    // original config untouched (applyMotion clones)
    expect(c.effects[0]!.mask!.cx).toBe(0.2)
  })

  // CHANGED 2026-08-25 (deliberate grant, was "only when the mask is enabled"):
  // the mask is a stage like any other, so its params are offered while it is OFF
  // — otherwise "mask the warp to a band across the middle" needs two turns. The
  // gate that remains is on the mask OBJECT existing, because the agent's dotted-
  // path writer creates missing intermediates and would otherwise fabricate a
  // half-built mask (see ensureEffectMasks, which the agent read paths call).
  it('agent controls surface mask keys once the layer HAS a mask, enabled or not', () => {
    const c = defaultConfig()
    c.effects[0] = { ...c.effects[0]!, id: 'noise_distortion', enabled: true, mask: undefined }
    expect(shaderAgentControls(c, fakeDef, 0).some(k => k.key.includes('.mask.'))).toBe(false)
    c.effects[0]!.mask = { ...defaultMask(), enabled: false }
    const off = shaderAgentControls(c, fakeDef, 0).map(k => k.key)
    expect(off).toContain('effects.0.mask.enabled')
    expect(off).toContain('effects.0.mask.cx')
    c.effects[0]!.mask!.enabled = true
    const keys = shaderAgentControls(c, fakeDef, 0).map(k => k.key)
    expect(keys).toContain('effects.0.mask.cx')
    expect(keys).toContain('effects.0.mask.size')
  })
})
