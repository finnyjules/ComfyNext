import { describe, it, expect } from 'vitest'
import { DOF_FRAG, dofShouldRun, DOF_TAPS } from '~/lib/compositor/dofPass'
import { defaultPostEffect } from '~/lib/compositor/postEffects'
import type { DofEffect } from '~/lib/compositor/postEffects'

const dof = (p: Partial<DofEffect> = {}): DofEffect =>
  ({ ...(defaultPostEffect('dof') as DofEffect), ...p })

describe('DOF_FRAG', () => {
  it('is GLSL ES 3.00, matching the WebGL2 context', () => {
    expect(DOF_FRAG.startsWith('#version 300 es')).toBe(true)
  })

  it('declares every uniform the pass sets', () => {
    for (const u of ['uColor', 'uDepth', 'uFocus', 'uRange', 'uRadius',
                     'uBloomThreshold', 'uBloomStrength', 'uOffsets', 'uTapCount']) {
      expect(DOF_FRAG).toContain(u)
    }
  })

  it('accumulates in linear light — the difference between bokeh discs and grey mush', () => {
    expect(DOF_FRAG).toContain('toLinear')
    expect(DOF_FRAG).toContain('toSrgb')
  })

  it('boosts highlights BEFORE accumulating, not after', () => {
    const boost = DOF_FRAG.indexOf('uBloomStrength')
    const accumulate = DOF_FRAG.indexOf('acc +=')
    expect(boost).toBeGreaterThan(-1)
    expect(accumulate).toBeGreaterThan(boost)
  })

  it('sizes its offsets array to the tap count the pass uploads', () => {
    expect(DOF_FRAG).toContain(`uOffsets[${DOF_TAPS}]`)
  })
})

describe('dofShouldRun', () => {
  it('skips when the effect is hidden', () => {
    expect(dofShouldRun(dof({ visible: false }), true)).toBe(false)
  })
  it('skips at zero aperture — nothing to blur', () => {
    expect(dofShouldRun(dof({ aperture: 0 }), true)).toBe(false)
  })
  it('skips without a depth map rather than guessing at one', () => {
    expect(dofShouldRun(dof({ aperture: 0.05 }), false)).toBe(false)
  })
  it('runs when visible, open, and supplied with depth', () => {
    expect(dofShouldRun(dof({ aperture: 0.05 }), true)).toBe(true)
  })
})
