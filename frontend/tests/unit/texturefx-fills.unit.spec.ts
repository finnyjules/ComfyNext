import { describe, expect, it } from 'vitest'
import { fillForRole, gradientRampCoord, hexToRgb } from '~/lib/texturefx/fills'
import { rolesFor, ROLES_BY_FAMILY, legacyColor } from '~/lib/texturefx/roles'

describe('roles', () => {
  it('declares roles for every family', () => {
    for (const fam of ['checker','stripes','dots','grid','arcs','diagonal','weave','multiscale']) {
      expect(ROLES_BY_FAMILY[fam].length).toBeGreaterThanOrEqual(2)
    }
  })
  it('rolesFor follows mode (procedural→motif, truchet→tileFamily)', () => {
    expect(rolesFor({ mode: 'procedural', motif: 'weave' } as any).length).toBe(2) // motif weave doesn't exist → fallback ['a','b']
    expect(rolesFor({ mode: 'truchet', tileFamily: 'weave' } as any)).toEqual(['warp','weft','gap'])
  })
  it('legacy mapping: dots ground = background, checker role1 = colorB', () => {
    const p = { colorA:'#111111', colorB:'#222222', background:'#333333' } as any
    expect(legacyColor(p,'dots',1)).toBe('#333333')
    expect(legacyColor(p,'checker',1)).toBe('#222222')
  })
})

describe('fillForRole back-compat', () => {
  it('falls back to a legacy solid when no fills set', () => {
    const p = { mode:'truchet', tileFamily:'arcs', colorA:'#abcdef', background:'#000000' } as any
    expect(fillForRole(p,'stroke',0)).toEqual({ type:'solid', color:'#abcdef' })
    expect(fillForRole(p,'ground',1)).toEqual({ type:'solid', color:'#000000' })
  })
  it('uses an explicit fill when present', () => {
    const p = { mode:'truchet', tileFamily:'arcs', fills:{ stroke:{type:'gradient',frame:'cell',kind:'linear',angle:0,stops:[{c:'#fff',p:0},{c:'#000',p:1}]} } } as any
    expect(fillForRole(p,'stroke',0).type).toBe('gradient')
  })
})

describe('gradientRampCoord seamlessness', () => {
  it('tile-global ramp matches opposite edges (mirrored)', () => {
    for (let i=0;i<=10;i++){ const t=i/10
      expect(Math.abs(gradientRampCoord('tile',0,0,0,t,0) - gradientRampCoord('tile',0,0,1,t,0))).toBeLessThan(1e-9)
      expect(Math.abs(gradientRampCoord('tile',0,0,t,0,90) - gradientRampCoord('tile',0,0,t,1,90))).toBeLessThan(1e-9)
    }
  })
  it('returns 0..1', () => { expect(gradientRampCoord('tile',0,0,0.3,0.7,45)).toBeGreaterThanOrEqual(0) })
  it('tile ramp is seamless at a non-axis angle (45 deg snaps to integer wave numbers)', () => {
    for (let i = 0; i <= 10; i++) { const t = i / 10
      // left edge (ux=0) vs right edge (ux=1)
      expect(Math.abs(gradientRampCoord('tile',0,0,0,t,45) - gradientRampCoord('tile',0,0,1,t,45))).toBeLessThan(1e-9)
      // top edge (uy=0) vs bottom edge (uy=1)
      expect(Math.abs(gradientRampCoord('tile',0,0,t,0,45) - gradientRampCoord('tile',0,0,t,1,45))).toBeLessThan(1e-9)
    }
  })
  it('triangle ramp — not sawtooth (angle=0°, t=ux)', () => {
    // Peak at tile center: t=0.5 → 1 - |2·0.5 - 1| = 1
    expect(gradientRampCoord('tile',0,0, 0.5, 0, 0)).toBeCloseTo(1, 9)
    // Quarter point: t=0.25 → 1 - |2·0.25 - 1| = 0.5
    expect(gradientRampCoord('tile',0,0, 0.25, 0, 0)).toBeCloseTo(0.5, 9)
    // Three-quarter point: t=0.75 → 1 - |2·0.75 - 1| = 0.5
    expect(gradientRampCoord('tile',0,0, 0.75, 0, 0)).toBeCloseTo(0.5, 9)
    // Adjacent-tile join: value just before 1.0 ≈ value just after 0.0 (sawtooth fails this)
    const eps = 1e-4
    const nearOne  = gradientRampCoord('tile',0,0, 1 - eps, 0, 0)
    const nearZero = gradientRampCoord('tile',0,0, eps, 0, 0)
    expect(Math.abs(nearOne - nearZero)).toBeLessThan(1e-9)
  })
})
