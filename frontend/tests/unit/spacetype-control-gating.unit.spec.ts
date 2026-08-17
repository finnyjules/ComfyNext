import { describe, it, expect } from 'vitest'
import { showIfVisible } from '../../app/lib/studio/sections'
import { coilEffect } from '../../app/lib/spacetype/effects/coil'
import { cylinderEffect } from '../../app/lib/spacetype/effects/cylinder'
import { fieldEffect } from '../../app/lib/spacetype/effects/field'
import { ribbonEffect } from '../../app/lib/spacetype/effects/ribbon'

// Real exports are `coilEffect`/`cylinderEffect`/`fieldEffect`/`ribbonEffect` (SpaceTypeEffect
// objects with a `.controls` array), not bare `coil`/`cylinder`/`field`/`ribbon` — the brief's
// sketch import assumed the latter; adjusted here to match the actual module shape.
const EFFECTS = { coil: coilEffect, cylinder: cylinderEffect, field: fieldEffect, ribbon: ribbonEffect } as Record<string, any>
const SHADOW_DEPS = ['shadowStrength', 'shadowSoftness', 'lightAngleX', 'lightAngleY']

describe('shadow controls hide when shadows are off', () => {
  for (const [name, eff] of Object.entries(EFFECTS)) {
    it(`${name}: shadow deps gated on the shadows toggle`, () => {
      const controls = eff.controls as any[]
      const toggle = controls.find(c => c.key === 'shadows')
      expect(toggle, `${name} has a shadows toggle`).toBeTruthy()
      const offVal = toggle.kind === 'switch' ? false : 'off'
      const onVal = toggle.kind === 'switch' ? true : 'on'
      for (const dep of SHADOW_DEPS) {
        const c = controls.find(x => x.key === dep)
        expect(c, `${name}.${dep} exists`).toBeTruthy()
        expect(c.showIf, `${name}.${dep} has showIf`).toBeTruthy()
        expect(showIfVisible(c, (k) => (k === 'shadows' ? offVal : undefined))).toBe(false)
        expect(showIfVisible(c, (k) => (k === 'shadows' ? onVal : undefined))).toBe(true)
      }
    })
  }
})
