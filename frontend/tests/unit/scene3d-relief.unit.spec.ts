import { describe, it, expect } from 'vitest'
import { toHeightPixels } from '~/lib/scene3d/relief'

// One pixel = 4 entries (r,g,b,a).
const px = (...rgb: number[]) => new Uint8ClampedArray([...rgb, 255])

describe('toHeightPixels', () => {
  it('collapses colour to a single luminance value across all three channels', () => {
    const out = toHeightPixels(px(255, 0, 0))
    // Rec. 709 luma of pure red ≈ 0.2126 * 255 ≈ 54
    expect(out[0]).toBe(54)
    expect(out[1]).toBe(54)
    expect(out[2]).toBe(54)
  })

  it('weights green most and blue least', () => {
    const red = toHeightPixels(px(255, 0, 0))[0]!
    const green = toHeightPixels(px(0, 255, 0))[0]!
    const blue = toHeightPixels(px(0, 0, 255))[0]!
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('is a no-op on an already-grayscale pixel', () => {
    expect(toHeightPixels(px(128, 128, 128))[0]).toBe(128)
  })

  it('inverts when asked', () => {
    expect(toHeightPixels(px(255, 255, 255), true)[0]).toBe(0)
    expect(toHeightPixels(px(0, 0, 0), true)[0]).toBe(255)
  })

  it('forces alpha opaque so a transparent source cannot punch holes in the height field', () => {
    const out = toHeightPixels(new Uint8ClampedArray([10, 20, 30, 0]))
    expect(out[3]).toBe(255)
  })

  it('does not mutate its input', () => {
    const src = px(255, 0, 0)
    toHeightPixels(src)
    expect(src[0]).toBe(255)
  })

  it('handles a multi-pixel buffer', () => {
    const out = toHeightPixels(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))
    expect(out[0]).toBe(255)
    expect(out[4]).toBe(0)
    expect(out.length).toBe(8)
  })
})
