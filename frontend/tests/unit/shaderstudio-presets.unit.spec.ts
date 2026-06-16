// frontend/tests/unit/shaderstudio-presets.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { ADJUST_PRESETS, DUOTONE_PRESETS, applyAdjustPreset } from '~/lib/shaderstudio/presets'
import { defaultConfig } from '~/lib/shaderstudio/types'

describe('shaderstudio presets', () => {
  it('duotone presets are hex pairs', () => {
    expect(DUOTONE_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const p of DUOTONE_PRESETS) {
      expect(p.ink).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(p.paper).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('applyAdjustPreset writes the preset values into adjust', () => {
    const c = defaultConfig()
    const punchy = ADJUST_PRESETS.find(p => p.name === 'Punchy')!
    applyAdjustPreset(c.adjust, punchy)
    expect(c.adjust.contrast).toBe(punchy.values.contrast)
    expect(c.adjust.saturation).toBe(punchy.values.saturation)
  })
})
