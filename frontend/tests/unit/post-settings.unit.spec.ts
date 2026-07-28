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
})
