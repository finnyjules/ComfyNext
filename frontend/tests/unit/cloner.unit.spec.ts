import { describe, it, expect } from 'vitest'
import { expandClones, wiredClonerWidgetEntries, DEFAULT_CLONER, type Cloner } from '~/composables/useCloner'

const make = (patch: Partial<Cloner>): Cloner => ({ ...DEFAULT_CLONER, enabled: true, ...patch })

describe('expandClones', () => {
  it('returns a single identity when cloner is absent', () => {
    const out = expandClones(undefined, 1)
    expect(out).toEqual([{ dx: 0, dy: 0, drot: 0, dscale: 1, dopacity: 1 }])
  })

  it('returns a single identity when disabled', () => {
    const out = expandClones(make({ enabled: false, countX: 3, countY: 3 }), 1)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ dx: 0, dy: 0, drot: 0, dscale: 1, dopacity: 1 })
  })

  it('linear single row: countX clones along X', () => {
    const out = expandClones(make({ mode: 'linear', countX: 3, countY: 1, spacingX: 0.2 }), 1)
    expect(out).toHaveLength(3)
    // back-to-front: original (k=0) is LAST
    const last = out[out.length - 1]
    expect(last).toEqual({ dx: 0, dy: 0, drot: 0, dscale: 1, dopacity: 1 })
    // the set of dx offsets present
    const dxs = out.map(o => o.dx).sort((a, b) => a - b)
    expect(dxs).toEqual([0, 0.2, 0.4])
  })

  it('grid: countX*countY clones', () => {
    const out = expandClones(make({ mode: 'linear', countX: 2, countY: 3, spacingX: 0.1, spacingY: 0.25 }), 1)
    expect(out).toHaveLength(6)
    const pts = out.map(o => `${o.dx.toFixed(2)},${o.dy.toFixed(2)}`).sort()
    expect(pts).toEqual([
      '0.00,0.00', '0.00,0.25', '0.00,0.50',
      '0.10,0.00', '0.10,0.25', '0.10,0.50',
    ].sort())
  })

  it('falloff accumulates by clone index k', () => {
    const out = expandClones(make({
      mode: 'linear', countX: 3, countY: 1, spacingX: 0.1,
      stepRotation: 10, stepScale: 0.5, stepOpacity: 0.8,
    }), 1)
    // find by dx (k = ix here)
    const byDx = (dx: number) => out.find(o => Math.abs(o.dx - dx) < 1e-9)!
    expect(byDx(0)).toMatchObject({ drot: 0, dscale: 1, dopacity: 1 })
    expect(byDx(0.1).drot).toBeCloseTo(10)
    expect(byDx(0.1).dscale).toBeCloseTo(0.5)
    expect(byDx(0.1).dopacity).toBeCloseTo(0.8)
    expect(byDx(0.2).drot).toBeCloseTo(20)
    expect(byDx(0.2).dscale).toBeCloseTo(0.25)
    expect(byDx(0.2).dopacity).toBeCloseTo(0.64)
  })

  it('original is drawn last (on top)', () => {
    const out = expandClones(make({ mode: 'linear', countX: 4, countY: 1, spacingX: 0.1 }), 1)
    expect(out[out.length - 1]).toMatchObject({ dx: 0, dy: 0 })
  })

  it('radial full ring: count clones, no overlap at 0 and 360', () => {
    const out = expandClones(make({ mode: 'radial', count: 4, radius: 0.5, startAngle: 0, sweepAngle: 360 }), 1)
    expect(out).toHaveLength(4)
    // angles 0,90,180,270 → dx/dy on a unit-ish circle scaled by radius
    const norm = out.map(o => ({ x: +o.dx.toFixed(4), y: +o.dy.toFixed(4) }))
    // contains the 4 cardinal points * 0.5
    const has = (x: number, y: number) => norm.some(p => Math.abs(p.x - x) < 1e-3 && Math.abs(p.y - y) < 1e-3)
    expect(has(0.5, 0)).toBe(true)    // 0°
    expect(has(0, 0.5)).toBe(true)    // 90°
    expect(has(-0.5, 0)).toBe(true)   // 180°
    expect(has(0, -0.5)).toBe(true)   // 270°
  })

  it('radial applies aspect to dy so the ring is circular on screen', () => {
    // aspect = W/H = 2 (wide canvas) → vertical offsets doubled in y-fraction
    const out = expandClones(make({ mode: 'radial', count: 2, radius: 0.5, startAngle: 90, sweepAngle: 180 }), 2)
    // clone at 90° → dx≈0, dy = 0.5 * aspect(2) * sin(90) = 1.0
    // (the 270° clone also has dx≈0 but dy = -1.0; pick the positive one)
    const top = out.filter(o => Math.abs(o.dx) < 1e-3).sort((a, b) => b.dy - a.dy)[0]!
    expect(top.dy).toBeCloseTo(1.0)
  })

  it('radial faceCenter rotates each clone by its angle', () => {
    const out = expandClones(make({ mode: 'radial', count: 4, radius: 0.5, startAngle: 0, sweepAngle: 360, faceCenter: true, stepRotation: 0 }), 1)
    // a clone at 90° should carry drot≈90
    const rots = out.map(o => +o.drot.toFixed(2)).sort((a, b) => a - b)
    expect(rots).toEqual([0, 90, 180, 270])
  })
})

describe('wiredClonerWidgetEntries', () => {
  it('returns nothing for empty/undefined maps', () => {
    expect(wiredClonerWidgetEntries(undefined)).toEqual([])
    expect(wiredClonerWidgetEntries({})).toEqual([])
  })

  it('skips disabled cloners (leave widget at default)', () => {
    const map = { 1: make({ enabled: false, countX: 4 }) }
    expect(wiredClonerWidgetEntries(map as any)).toEqual([])
  })

  it('emits enabled cloners keyed by 1-based slot', () => {
    const map = {
      1: make({ enabled: true, mode: 'linear', countX: 3 }),
      3: make({ enabled: false }),
      5: make({ enabled: true, mode: 'radial', count: 6 }),
    }
    const out = wiredClonerWidgetEntries(map as any)
    expect(out.map(e => e.name).sort()).toEqual(['layer1_cloner', 'layer5_cloner'])
    // value round-trips as JSON of the enabled cloner
    const e1 = out.find(e => e.name === 'layer1_cloner')!
    expect(JSON.parse(e1.json)).toMatchObject({ enabled: true, mode: 'linear', countX: 3 })
  })
})
