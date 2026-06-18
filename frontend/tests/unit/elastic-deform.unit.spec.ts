import { describe, it, expect } from 'vitest'
import { wave, charDeform, hash01, TAU, type DeformParams } from '../../app/lib/spacetype/elasticDeform'

const P: DeformParams = {
  base: 1, ampV: 1.4, ampH: 0.25, baseSkew: 0, ampSkew: 12, baseSlant: 0, ampSlant: 8, randomness: 1,
}

describe('wave', () => {
  it('poly=0 is a pure sine', () => {
    for (const p of [0.3, 1.1, 2.7, 5.0]) expect(wave(p, 0)).toBeCloseTo(Math.sin(p), 10)
  })
  it('poly=1 is a triangle that still tracks the sine sign and stays in [-1,1]', () => {
    for (const p of [0.3, 1.1, 2.7, 5.0]) {
      const v = wave(p, 1)
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0000001)
      expect(Math.sign(v)).toBe(Math.sign(Math.sin(p)))
    }
  })
  it('is periodic over 2π for any poly (loopable)', () => {
    for (const poly of [0, 0.5, 1]) {
      for (const p of [0.2, 1.3, 2.9]) expect(wave(p + TAU, poly)).toBeCloseTo(wave(p, poly), 9)
    }
  })
})

describe('hash01', () => {
  it('is in [0,1) and deterministic', () => {
    for (const k of [0, 1, 7, 91.7]) {
      const v = hash01(k)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      expect(hash01(k)).toBe(v)
    }
  })
})

describe('charDeform — loop seamless', () => {
  it('every field at time=0 equals time=TAU for several characters', () => {
    for (const gi of [0, 3, 9, 17]) {
      const a = charDeform(gi, 0, P)
      const b = charDeform(gi, TAU, P)
      expect(b.sy).toBeCloseTo(a.sy, 9)
      expect(b.sx).toBeCloseTo(a.sx, 9)
      expect(b.skewTan).toBeCloseTo(a.skewTan, 9)
      expect(b.slantRad).toBeCloseTo(a.slantRad, 9)
    }
  })
})

describe('charDeform — randomness', () => {
  it('randomness=0 → identical deformation across characters (uniform)', () => {
    const p0 = { ...P, randomness: 0 }
    const a = charDeform(0, 1.0, p0)
    const b = charDeform(7, 1.0, p0)
    expect(b.sy).toBeCloseTo(a.sy, 10)
    expect(b.sx).toBeCloseTo(a.sx, 10)
    expect(b.skewTan).toBeCloseTo(a.skewTan, 10)
    expect(b.slantRad).toBeCloseTo(a.slantRad, 10)
  })
  it('randomness=1 → characters differ', () => {
    const a = charDeform(0, 1.0, P)
    const b = charDeform(7, 1.0, P)
    expect(Math.abs(b.sy - a.sy) + Math.abs(b.skewTan - a.skewTan)).toBeGreaterThan(1e-3)
  })
  it('base stretch applies even with no motion', () => {
    const d = charDeform(2, 0.0, { ...P, base: 2.2, ampV: 0, randomness: 0 })
    expect(d.sy).toBeCloseTo(2.2, 10)
  })
})
