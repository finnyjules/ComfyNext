import { describe, it, expect } from 'vitest'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'
import { blendEffect, stepPose, gradientT } from '../../app/lib/spacetype/effects/blend'

describe('blendEffect contract', () => {
  it('declares an id, label, and controls', () => {
    expect(blendEffect.id).toBe('blend')
    expect(blendEffect.label).toBe('Blend')
    expect(blendEffect.controls.length).toBeGreaterThan(0)
  })
  it('every control has a default and a unique key', () => {
    const keys = blendEffect.controls.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of blendEffect.controls) expect(c.default).toBeDefined()
  })
  it('exposes the blend signature controls', () => {
    const keys = blendEffect.controls.map(c => c.key)
    for (const k of ['text', 'font', 'steps', 'rotStepX', 'rotStepY', 'rotStepZ', 'scaleStep', 'style', 'blendMode', 'fills', 'gradientMode', 'spin']) {
      expect(keys).toContain(k)
    }
  })
  it('builds a default param set from its controls', () => {
    const d = defaultsFromControls(blendEffect.controls)
    expect(d.steps).toBe(40)
    expect(d.style).toBe('outline')
    expect(d.blendMode).toBe('additive')
    expect(d.gradientMode).toBe('on')
  })
})

describe('stepPose (cumulative per-step deltas)', () => {
  const p = { rotStepX: 0, rotStepY: 0.1, rotStepZ: 0.06, scaleStep: 0.985, spreadX: 0.02, spreadY: 0 }
  it('is the identity-ish origin at step 0', () => {
    const s = stepPose(0, p)
    expect(s.px).toBe(0)
    expect(s.py).toBe(0)
    expect(s.pz).toBeCloseTo(0, 10)   // -0 at i=0 is harmless as a z-position
    expect(s.rx).toBe(0)
    expect(s.ry).toBe(0)
    expect(s.rz).toBe(0)
    expect(s.s).toBe(1)
  })
  it('accumulates rotation, scale, and spread linearly/multiplicatively with i', () => {
    const s = stepPose(10, p)
    expect(s.ry).toBeCloseTo(1.0, 10)
    expect(s.rz).toBeCloseTo(0.6, 10)
    expect(s.px).toBeCloseTo(0.2, 10)
    expect(s.s).toBeCloseTo(Math.pow(0.985, 10), 10)
    expect(s.pz).toBeCloseTo(-0.15, 10)
  })
})

describe('gradientT (normalised blend position)', () => {
  it('spans 0 at the original to 1 at the last echo', () => {
    expect(gradientT(0, 40)).toBe(0)
    expect(gradientT(39, 40)).toBe(1)
    expect(gradientT(5, 11)).toBeCloseTo(0.5, 10)
  })
  it('is 0 for a single step (no division by zero)', () => {
    expect(gradientT(0, 1)).toBe(0)
  })
})
