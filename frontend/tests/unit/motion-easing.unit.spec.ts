// frontend/tests/unit/motion-easing.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  linear, powerOut, powerIn, easeInOutQuad, sineInOut,
  backOut, backIn, elasticOut, bounceOut, steps, resolveEase,
} from '../../app/lib/motion/easing'

const ALL = [linear, powerOut(2), powerOut(3), powerIn(2), easeInOutQuad,
  sineInOut, backOut(), backIn(), elasticOut, bounceOut, steps(6)]

describe('easing primitives', () => {
  it('all eases hit 0 at t=0 and 1 at t=1', () => {
    for (const fn of ALL) {
      expect(fn(0)).toBeCloseTo(0, 6)
      expect(fn(1)).toBeCloseTo(1, 6)
    }
  })
  it('powerOut(2) is the standard quad-out', () => {
    expect(powerOut(2)(0.5)).toBeCloseTo(0.75, 6)
  })
  it('backOut overshoots past 1 mid-curve', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => backOut()((i + 1) / 100)))
    expect(peak).toBeGreaterThan(1.05)
  })
  it('steps(6) quantizes', () => {
    expect(steps(6)(0.49)).toBeCloseTo(steps(6)(0.4), 6)
  })
})

describe('resolveEase (GSAP-style names)', () => {
  it('maps the names used by kinetic presets', () => {
    expect(resolveEase('power2.out')(0.5)).toBeCloseTo(powerOut(2)(0.5), 6)
    expect(resolveEase('power3.in')(0.5)).toBeCloseTo(powerIn(3)(0.5), 6)
    expect(resolveEase('back.out(1.7)')(1)).toBeCloseTo(1, 6)
    expect(resolveEase('elastic.out(1, 0.3)')(1)).toBeCloseTo(1, 6)
    expect(resolveEase('sine.inOut')(0.5)).toBeCloseTo(0.5, 6)
    expect(resolveEase('steps(6)')(0.99)).toBeCloseTo(1, 6)
    expect(resolveEase('none')(0.3)).toBeCloseTo(0.3, 6)
    expect(resolveEase(undefined)(0.5)).toBeCloseTo(powerOut(2)(0.5), 6) // default
  })
})
