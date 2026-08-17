import { describe, it, expect } from 'vitest'
import { showIfVisible } from '../../app/lib/studio/sections'
import { coilEffect } from '../../app/lib/spacetype/effects/coil'
import { cylinderEffect } from '../../app/lib/spacetype/effects/cylinder'
import { fieldEffect } from '../../app/lib/spacetype/effects/field'
import { ribbonEffect } from '../../app/lib/spacetype/effects/ribbon'
import { boostEffect } from '../../app/lib/spacetype/effects/boost'

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

/**
 * boost's side/extrude/stroke controls are gated per-mode. Source-verified against
 * lib/spacetype/effects/boost.ts's resolveSide/pickStyle/update: `ombre` unconditionally
 * reads palette[0] (and palette[1] when paletteCount>1) to build its dither texture — a
 * detail the task brief's literal `in` list for boostColor1..6 missed — so boostColor1
 * and boostColor2 (but not 3..6, which ombre never indexes) also show for `sideMode:
 * 'ombre'`. See task-3-report.md for the full reconciliation.
 */
describe('boost: mode-specific controls gated', () => {
  const controls = boostEffect.controls as any[]
  const byKey = (key: string) => {
    const c = controls.find(x => x.key === key)
    expect(c, `boost.${key} exists`).toBeTruthy()
    expect(c.showIf, `boost.${key} has showIf`).toBeTruthy()
    return c
  }
  const readWith = (key: string, value: unknown) => (k: string) => (k === key ? (value as any) : undefined)

  it('extrudeMode: punchDistance only in punch mode', () => {
    const c = byKey('punchDistance')
    expect(showIfVisible(c, readWith('extrudeMode', 'static'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'tumble'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'zoom'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'punch'))).toBe(true)
  })

  it('extrudeMode: holdFraction hidden only in static mode', () => {
    const c = byKey('holdFraction')
    expect(showIfVisible(c, readWith('extrudeMode', 'static'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'tumble'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'zoom'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'punch'))).toBe(true)
  })

  it('extrudeMode: tumble hidden only in zoom mode (unused there per update())', () => {
    const c = byKey('tumble')
    expect(showIfVisible(c, readWith('extrudeMode', 'zoom'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'static'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'tumble'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'punch'))).toBe(true)
  })

  it('sideMode: sideColor only in solid mode', () => {
    const c = byKey('sideColor')
    expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(true)
    expect(showIfVisible(c, readWith('sideMode', 'gradient'))).toBe(false)
  })

  it('sideMode: gridCell/gridLine only in grid mode', () => {
    for (const key of ['gridCell', 'gridLine']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'grid'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
    }
  })

  it('sideMode: noiseColor1/noiseColor2 only in noise mode', () => {
    for (const key of ['noiseColor1', 'noiseColor2']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'noise'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
    }
  })

  it('sideMode: letterStyles only in custom mode', () => {
    const c = byKey('letterStyles')
    expect(showIfVisible(c, readWith('sideMode', 'custom'))).toBe(true)
    expect(showIfVisible(c, readWith('sideMode', 'mixed'))).toBe(false)
  })

  it('sideMode: boostColor1/boostColor2 visible for palette/gradient/ombre/mixed/custom, hidden for solid/rainbow/grid/noise', () => {
    for (const key of ['boostColor1', 'boostColor2']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
      expect(showIfVisible(c, readWith('sideMode', 'gradient'))).toBe(true)
      // ombre's resolveSide() unconditionally builds its dither texture from palette[0]/[1].
      expect(showIfVisible(c, readWith('sideMode', 'ombre'))).toBe(true)
    }
  })

  it('sideMode: boostColor3..6 and paletteCount hidden for ombre (never indexed there)', () => {
    for (const key of ['boostColor3', 'boostColor4', 'boostColor5', 'boostColor6', 'paletteCount']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'palette'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'gradient'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'mixed'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'custom'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'ombre'))).toBe(false)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
    }
  })

  it('stroke: strokeColor/strokeWidth only when stroke is on', () => {
    for (const key of ['strokeColor', 'strokeWidth']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('stroke', 'off'))).toBe(false)
      expect(showIfVisible(c, readWith('stroke', 'on'))).toBe(true)
    }
  })
})
