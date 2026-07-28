import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/spacetype/post'

describe('post settings', () => {
  it('defaults every effect to off', () => {
    expect(postEnabled(DEFAULT_POST)).toBe(false)
  })
  it('film defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.film).toBe(false)
    expect(typeof DEFAULT_POST.filmIntensity).toBe('number')
  })
  it('postEnabled reports true when ONLY film is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, film: true })).toBe(true)
  })
  it('halftone defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.halftone).toBe(false)
    expect(typeof DEFAULT_POST.halftoneRadius).toBe('number')
    expect(typeof DEFAULT_POST.halftoneScatter).toBe('number')
  })
  it('postEnabled reports true when ONLY halftone is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, halftone: true })).toBe(true)
  })
  it('dotScreen defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.dotScreen).toBe(false)
    expect(typeof DEFAULT_POST.dotScreenScale).toBe('number')
    expect(typeof DEFAULT_POST.dotScreenAngle).toBe('number')
  })
  it('postEnabled reports true when ONLY dotScreen is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, dotScreen: true })).toBe(true)
  })
  it('glitch defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.glitch).toBe(false)
  })
  it('postEnabled reports true when ONLY glitch is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, glitch: true })).toBe(true)
  })
  it('gtao defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.gtao).toBe(false)
    expect(typeof DEFAULT_POST.gtaoRadius).toBe('number')
    expect(typeof DEFAULT_POST.gtaoIntensity).toBe('number')
    expect(typeof DEFAULT_POST.gtaoThickness).toBe('number')
  })
  it('postEnabled reports true when ONLY gtao is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, gtao: true })).toBe(true)
  })
  // Regression guard for the "GTAO darkens everything uniformly" bug: radius/thickness must stay
  // in the same (plain world-space) units, and both scaled for Sailor's roughly unit-scale
  // primitives — NOT the >1 world-unit values a screen-space-scaled radius needs. This can't catch
  // the actual GPU-side symptom (that needs a real render + pixel diff, see the bug report), but it
  // does stop someone reintroducing the old radius=4 / thickness=1 defaults that made `radius`
  // negligible relative to a fixed, unscaled `thickness` gate.
  it('gtao radius/thickness defaults are small, unit-scale-appropriate world-space values', () => {
    expect(DEFAULT_POST.gtaoRadius).toBeGreaterThan(0)
    expect(DEFAULT_POST.gtaoRadius).toBeLessThanOrEqual(1)
    expect(DEFAULT_POST.gtaoThickness).toBeGreaterThan(0)
    expect(DEFAULT_POST.gtaoThickness).toBeLessThanOrEqual(1)
  })
})
