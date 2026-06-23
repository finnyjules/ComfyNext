import { describe, expect, it } from 'vitest'
import { fillForRole, gradColorAt, gradientRampCoord, hexToRgb } from '~/lib/texturefx/fills'
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

describe('fill opacity', () => {
  it('fillForRole preserves opacity when explicitly set', () => {
    const p = {
      mode: 'truchet', tileFamily: 'arcs',
      fills: { stroke: { type: 'solid', color: '#abcdef', opacity: 0.4 } }
    } as any
    const f = fillForRole(p, 'stroke', 0) as any
    expect(f.opacity).toBe(0.4)
  })
  it('fillForRole leaves opacity undefined when not set (renderer defaults to 1)', () => {
    const p = {
      mode: 'truchet', tileFamily: 'arcs',
      fills: { stroke: { type: 'solid', color: '#abcdef' } }
    } as any
    const f = fillForRole(p, 'stroke', 0) as any
    expect(f.opacity).toBeUndefined()
  })
})

describe('gradColorAt', () => {
  it('2-stop linear matches endpoints + midpoint', () => {
    const s = [{ c: '#000000', p: 0 }, { c: '#ffffff', p: 1 }]
    expect(gradColorAt(s, 0)).toEqual([0, 0, 0])
    expect(gradColorAt(s, 1)).toEqual([1, 1, 1])
    const m = gradColorAt(s, 0.5); expect(m[0]).toBeCloseTo(0.5, 5)
  })
  it('4-stop picks the right segment', () => {
    const s = [{ c: '#000000', p: 0 }, { c: '#ff0000', p: 0.33 }, { c: '#00ff00', p: 0.66 }, { c: '#ffffff', p: 1 }]
    const r = gradColorAt(s, 0.33); expect(r[0]).toBeCloseTo(1, 5); expect(r[1]).toBeCloseTo(0, 5)
  })
  it('clamps g outside the stop range', () => {
    const s = [{ c: '#112233', p: 0.2 }, { c: '#445566', p: 0.8 }]
    expect(gradColorAt(s, 0)).toEqual(gradColorAt(s, 0.2))
  })
})

describe('link resolution', () => {
  const base = { mode: 'truchet', tileFamily: 'weave' } as any // roles warp/weft/gap
  it('resolves a single hop to the target fill', () => {
    const p = { ...base, fills: { warp: { type: 'solid', color: '#abcdef' }, weft: { type: 'link', to: 'warp' } } } as any
    expect(fillForRole(p, 'weft', 1)).toEqual({ type: 'solid', color: '#abcdef' })
  })
  it('cycle falls back to legacy solid', () => {
    const p = { ...base, colorA: '#111111', colorB: '#222222',
      fills: { warp: { type: 'link', to: 'weft' }, weft: { type: 'link', to: 'warp' } } } as any
    expect(fillForRole(p, 'warp', 0).type).toBe('solid') // legacy, not a link
  })
  it('self-link and missing target fall back to legacy', () => {
    const p = { ...base, fills: { warp: { type: 'link', to: 'warp' }, weft: { type: 'link', to: 'nope' } } } as any
    expect(fillForRole(p, 'warp', 0).type).toBe('solid')
    expect(fillForRole(p, 'weft', 1).type).toBe('solid')
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
