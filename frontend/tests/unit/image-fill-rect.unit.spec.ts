import { describe, it, expect } from 'vitest'
import { imageFillRect } from '~/lib/compositor/paint'

describe('imageFillRect', () => {
  it('cover fills the box and crops the overflow (centered)', () => {
    // 100x100 image into a 200x100 box → scale 2 → 200x200, vertically crop-centered
    expect(imageFillRect('cover', 100, 100, 200, 100)).toEqual({ dx: 0, dy: -50, dw: 200, dh: 200 })
  })

  it('contain fits inside and letterboxes (centered)', () => {
    expect(imageFillRect('contain', 100, 100, 200, 100)).toEqual({ dx: 50, dy: 0, dw: 100, dh: 100 })
  })

  it('stretch fills exactly, ignoring aspect', () => {
    expect(imageFillRect('stretch', 100, 100, 200, 100)).toEqual({ dx: 0, dy: 0, dw: 200, dh: 100 })
  })

  it('scale zooms about the center', () => {
    // contain base 100x100, scale 2 → 200x200, dx=(200-200)/2=0, dy=(100-200)/2=-50
    expect(imageFillRect('contain', 100, 100, 200, 100, 2)).toEqual({ dx: 0, dy: -50, dw: 200, dh: 200 })
  })

  it('offset shifts by a fraction of the box', () => {
    const r = imageFillRect('contain', 100, 100, 200, 100, 1, { x: 0.1, y: -0.2 })
    expect(r.dx).toBeCloseTo(50 + 20)   // +0.1*200
    expect(r.dy).toBeCloseTo(0 - 20)    // -0.2*100
  })
})
