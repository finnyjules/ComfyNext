import { describe, it, expect } from 'vitest'
import { toHeightPixels, heightGradient, RELIEF_FLAT_THRESHOLD } from '~/lib/scene3d/relief'

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

// Builds a WxH RGBA buffer (opaque, R=G=B) from a per-pixel value function — the shape
// heightGradient expects: an already height-converted buffer, as toHeightPixels produces.
function grid(width: number, height: number, valueAt: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = valueAt(x, y)
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = 255
    }
  }
  return out
}

// A checkerboard with 2px squares. NOT 1px squares: heightGradient compares x-1 to x+1
// (a stride-2 central difference), which is blind to a period-2 signal — a single-pixel
// checkerboard aliases to a dead 0, the classic Nyquist blind spot. 2px squares are the
// smallest pattern this operator can actually see, and still far finer than any real photo.
const checkerboard = grid(32, 32, (x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 255 : 0))
// A smooth linear ramp across a wide buffer — visually gradual, the shape a depth-model
// vignette takes. Constant along y so only the horizontal term contributes.
const ramp = grid(128, 128, (x) => Math.round((x / 127) * 255))

describe('heightGradient', () => {
  it('is ~0 for a uniform buffer — no local variation, nothing for bump mapping to catch', () => {
    const uniform = grid(16, 16, () => 128)
    expect(heightGradient(uniform, 16, 16)).toBeCloseTo(0, 5)
  })

  it('is much larger for a checkerboard than for a smooth ramp of the same value range', () => {
    const checkerGradient = heightGradient(checkerboard, 32, 32)
    const rampGradient = heightGradient(ramp, 128, 128)
    // Proves discrimination, not just "both are nonzero": the checkerboard must read as
    // dramatically sharper even though both buffers span the same 0-255 range.
    expect(checkerGradient).toBeGreaterThanOrEqual(rampGradient * 5)
  })

  it('places a smooth ramp below RELIEF_FLAT_THRESHOLD and a checkerboard above it', () => {
    // This is the assertion that actually protects the feature: it is what would have
    // caught the AI-relief bug (measured gradient 3.26/3.30, far below this line).
    expect(heightGradient(ramp, 128, 128)).toBeLessThan(RELIEF_FLAT_THRESHOLD)
    expect(heightGradient(checkerboard, 32, 32)).toBeGreaterThan(RELIEF_FLAT_THRESHOLD)
  })
})
