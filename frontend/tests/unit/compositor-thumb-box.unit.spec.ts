import { describe, it, expect } from 'vitest'
import { thumbBox } from '~/composables/useCompositorLayers'

describe('thumbBox — fit a layer box into a square, preserving aspect', () => {
  it('a square box fills the whole square', () => {
    expect(thumbBox(100, 100, 24)).toEqual({ w: 24, h: 24 })
  })

  it('a wide box is width-bound (height shrinks)', () => {
    // 2:1 box → 24 wide, 12 tall
    expect(thumbBox(200, 100, 24)).toEqual({ w: 24, h: 12 })
  })

  it('a tall box is height-bound (width shrinks)', () => {
    expect(thumbBox(100, 200, 24)).toEqual({ w: 12, h: 24 })
  })

  it('never upscales past the requested size', () => {
    const b = thumbBox(4, 8, 24)
    expect(b.w).toBeLessThanOrEqual(24)
    expect(b.h).toBeLessThanOrEqual(24)
    // aspect preserved: 1:2
    expect(b.h).toBe(b.w * 2)
  })

  it('clamps degenerate boxes to at least 1px so a canvas is always valid', () => {
    // A zero box never reaches here (renderLayerThumbnail guards box.w/h > 0), but
    // the fit must still return valid ≥1 integer dims for any input.
    const z = thumbBox(0, 0, 24)
    expect(z.w).toBeGreaterThanOrEqual(1)
    expect(z.h).toBeGreaterThanOrEqual(1)
    // An extreme aspect stays width-bound with a floored-to-1 minor axis.
    const b = thumbBox(1000, 1, 24)
    expect(b.w).toBe(24)
    expect(b.h).toBe(1)
  })

  it('returns integer canvas dimensions', () => {
    const b = thumbBox(37, 91, 24)
    expect(Number.isInteger(b.w)).toBe(true)
    expect(Number.isInteger(b.h)).toBe(true)
  })
})
