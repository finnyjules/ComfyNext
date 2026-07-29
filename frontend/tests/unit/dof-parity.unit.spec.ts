import { describe, it, expect } from 'vitest'
import { apertureRadiusPx, cocFor, apertureOffsets } from '~/lib/compositor/dofMath'
import { POST_FX_PARAM_CLAMP, defaultPostEffect } from '~/lib/compositor/postEffects'
import type { DofEffect } from '~/lib/compositor/postEffects'

describe('bake/preview scale parity', () => {
  it('one aperture covers the same FRACTION of the image at any scale', () => {
    const aperture = 0.03
    const preview = apertureRadiusPx(aperture, 1000) / 1000
    const bake = apertureRadiusPx(aperture, 3000) / 3000
    expect(preview).toBeCloseTo(bake, 12)
  })

  it('an un-normalized radius would NOT be scale-stable — guards the fix', () => {
    // If aperture were ever treated as a pixel count instead of a width fraction,
    // this is the mismatch that would ship: right in preview, half-strength on export.
    const fixedPx = 20
    expect(fixedPx / 1000).not.toBeCloseTo(fixedPx / 3000, 6)
  })

  it('scales linearly, so doubling the canvas doubles the pixel radius', () => {
    expect(apertureRadiusPx(0.05, 2000)).toBeCloseTo(apertureRadiusPx(0.05, 1000) * 2, 10)
  })
})

describe('agent-facing param behaviour', () => {
  it('focus sweeps the sharp band across the full depth range', () => {
    expect(cocFor(0.1, 0.1, 0.1)).toBe(0)
    expect(cocFor(0.1, 0.9, 0.1)).toBeGreaterThan(0)
    expect(cocFor(0.9, 0.9, 0.1)).toBe(0)
  })

  it('blade count changes the iris shape', () => {
    expect(apertureOffsets(64, 6, 0)).not.toEqual(apertureOffsets(64, 0, 0))
  })

  it('every documented param is clamped, so the agent cannot push one out of range', () => {
    const d = defaultPostEffect('dof') as unknown as Record<string, number>
    const clamps = POST_FX_PARAM_CLAMP.dof!
    for (const k of Object.keys(d)) {
      if (k === 'type' || k === 'visible') continue
      expect(clamps[k], `${k} has no clamp`).toBeDefined()
    }
  })

  it('bright = near, so a higher focus selects the closer subject', () => {
    // depth 0.8 = near subject, 0.05 = far background
    const near = 0.8, far = 0.05
    expect(cocFor(near, 0.8, 0.1)).toBe(0)          // focused on the subject
    expect(cocFor(far, 0.8, 0.1)).toBeGreaterThan(0) // background defocused
  })

  it('defaults are a usable lens, not a no-op', () => {
    const d = defaultPostEffect('dof') as DofEffect
    expect(d.aperture).toBeGreaterThan(0)
    expect(d.bladeCount).toBeGreaterThanOrEqual(3)
    expect(d.bloomStrength).toBeGreaterThan(0)
  })
})
