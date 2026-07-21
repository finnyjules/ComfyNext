import { describe, it, expect } from 'vitest'
import { toWidthNorm } from '~/lib/compositor/brushStamp'

// FIX #1: pointer coords come in SCREEN-normalized (ny = fraction of HEIGHT) but
// strokes are stored WIDTH-normalized (both axes ÷ artboard width). toWidthNorm
// rescales Y by the aspect so a stroke lands at the correct vertical position on
// non-square artboards. X is always left untouched.
describe('toWidthNorm', () => {
  it('leaves Y unchanged on a square artboard (w === h)', () => {
    expect(toWidthNorm(0.3, 0.5, 800, 800)).toEqual({ x: 0.3, y: 0.5 })
    expect(toWidthNorm(0.9, 1.0, 500, 500)).toEqual({ x: 0.9, y: 1.0 })
  })
  it('compresses Y by the aspect on a 2:1 landscape (h < w)', () => {
    // ny is a fraction of HEIGHT (500); width-normalized y = ny * (500/1000).
    expect(toWidthNorm(0.4, 0.5, 1000, 500)).toEqual({ x: 0.4, y: 0.25 })
    expect(toWidthNorm(0.4, 1.0, 1000, 500)).toEqual({ x: 0.4, y: 0.5 })
  })
  it('expands Y by the aspect on a portrait artboard (h > w)', () => {
    // width-normalized y = ny * (1000/500) = ny * 2.
    expect(toWidthNorm(0.2, 0.5, 500, 1000)).toEqual({ x: 0.2, y: 1.0 })
  })
  it('never touches X', () => {
    expect(toWidthNorm(0.73, 0.1, 1234, 456).x).toBe(0.73)
  })
})
