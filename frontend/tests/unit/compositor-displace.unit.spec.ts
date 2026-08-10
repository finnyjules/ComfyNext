import { describe, it, expect } from 'vitest'
import {
  buildDisplacementField,
  resampleBilinear,
  DEFAULT_DISPLACE_MAP,
} from '~/lib/compositor/displace'

// Build a w×h RGBA buffer from a per-pixel fill fn returning [r,g,b,a].
function makeMap(w: number, h: number, fill: (x: number, y: number) => number[]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, al] = fill(x, y)
      const p = (y * w + x) * 4
      a[p] = r!; a[p + 1] = g!; a[p + 2] = b!; a[p + 3] = al!
    }
  }
  return a
}
const dx = (f: Float32Array, w: number, x: number, y: number) => f[(y * w + x) * 2]!
const dy = (f: Float32Array, w: number, x: number, y: number) => f[(y * w + x) * 2 + 1]!

describe('buildDisplacementField', () => {
  it('height mode: a flat map produces a ~zero field', () => {
    const w = 5, h = 5
    const map = makeMap(w, h, () => [128, 128, 128, 255])
    const f = buildDisplacementField(map, w, h, { read: 'height', amount: 40, softness: 0 })
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      expect(Math.abs(dx(f, w, x, y))).toBeLessThan(1e-6)
      expect(Math.abs(dy(f, w, x, y))).toBeLessThan(1e-6)
    }
  })

  it('height mode: pushes at a brightness edge, ~zero in flat regions', () => {
    const w = 5, h = 3
    // Left half black (x<=1), right half white (x>=3), step across the middle column.
    const map = makeMap(w, h, (x) => { const v = x <= 1 ? 0 : x >= 3 ? 255 : 128; return [v, v, v, 255] })
    const f = buildDisplacementField(map, w, h, { read: 'height', amount: 40, softness: 0 })
    // Flat interior far from the edge: ~0.
    expect(Math.abs(dx(f, w, 0, 1))).toBeLessThan(1e-6)
    // At the edge column the horizontal push is large and points toward white (+x).
    expect(dx(f, w, 2, 1)).toBeGreaterThan(0.4)
    // Vertical push stays ~0 (edge is vertical).
    expect(Math.abs(dy(f, w, 2, 1))).toBeLessThan(1e-6)
  })

  it('height mode: invert flips the push direction', () => {
    const w = 5, h = 3
    const map = makeMap(w, h, (x) => { const v = x <= 1 ? 0 : x >= 3 ? 255 : 128; return [v, v, v, 255] })
    const normal = buildDisplacementField(map, w, h, { read: 'height', amount: 40, invert: false, softness: 0 })
    const inv = buildDisplacementField(map, w, h, { read: 'height', amount: 40, invert: true, softness: 0 })
    expect(Math.sign(dx(normal, w, 2, 1))).toBe(-Math.sign(dx(inv, w, 2, 1)))
  })

  it('channels mode: R drives x, G drives y', () => {
    const w = 2, h = 2
    const map = makeMap(w, h, () => [255, 128, 0, 255]) // R=1 → dx=+1, G=0.5 → dy=0
    const f = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 })
    expect(dx(f, w, 0, 0)).toBeCloseTo(1, 2)
    expect(dy(f, w, 0, 0)).toBeCloseTo(0, 2)
  })

  it('alpha gates the offset: transparent map pixels push nothing', () => {
    const w = 2, h = 2
    const map = makeMap(w, h, () => [255, 255, 0, 0]) // fully transparent
    const f = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 })
    for (let i = 0; i < f.length; i++) expect(f[i]).toBeCloseTo(0, 6)
  })

  it('channels and height produce different fields on the same colour input', () => {
    const w = 4, h = 4
    const map = makeMap(w, h, (x) => [x * 60, 200 - x * 40, 90, 255])
    const fh = buildDisplacementField(map, w, h, { read: 'height', amount: 40, softness: 0 })
    const fc = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 })
    let diff = 0
    for (let i = 0; i < fh.length; i++) diff += Math.abs(fh[i]! - fc[i]!)
    expect(diff).toBeGreaterThan(0.1)
  })
})

describe('buildDisplacementField dpr compensation', () => {
  it('height mode: pixelScale scales the field so a denser (retina) render warps the same in screen px', () => {
    // Smooth horizontal ramp brightness = k*x; on a fixed grid, a larger step+pixelScale
    // must yield a proportionally larger field (the dpr compensation knob).
    const w = 9, h = 3
    const ramp = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255); const p = (y * w + x) * 4
      ramp[p] = v; ramp[p + 1] = v; ramp[p + 2] = v; ramp[p + 3] = 255
    }
    const at1 = buildDisplacementField(ramp, w, h, { read: 'height', amount: 40, softness: 0 }, 1)
    const at2 = buildDisplacementField(ramp, w, h, { read: 'height', amount: 40, softness: 0 }, 2)
    // Interior pixel, away from clamped borders.
    const i = (1 * w + 4) * 2
    expect(at1[i]!).toBeGreaterThan(0)
    expect(at2[i]!).toBeGreaterThan(0)
    // pixelScale 2 compensates for a 2x-denser render: field ~2x the pixelScale-1 field.
    expect(at2[i]! / at1[i]!).toBeGreaterThan(1.6)
    expect(at2[i]! / at1[i]!).toBeLessThan(2.4)
  })

  it('channels mode ignores pixelScale (already dpr-invariant)', () => {
    const w = 4, h = 4
    const map = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) { const p = i * 4; map[p] = 200; map[p + 1] = 60; map[p + 2] = 0; map[p + 3] = 255 }
    const a = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 }, 1)
    const b = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 }, 3)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('resampleBilinear', () => {
  const W = 4, H = 4
  // A distinct value per pixel so shifts are detectable: r = x*10, g = y*10.
  const src = (() => {
    const a = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4; a[p] = x * 10; a[p + 1] = y * 10; a[p + 2] = 0; a[p + 3] = 255
    }
    return a
  })()

  it('amount 0 returns the source byte-identical', () => {
    const field = new Float32Array(W * H * 2).fill(0.7) // non-zero field, but amount 0
    const out = resampleBilinear(src, field, 0, W, H)
    expect(Array.from(out)).toEqual(Array.from(src))
  })

  it('a constant field shifts interior pixels by the expected amount', () => {
    // field dx=+1 everywhere, amount 1 → each output samples src one px to the right.
    const field = new Float32Array(W * H * 2)
    for (let i = 0; i < W * H; i++) field[i * 2] = 1
    const out = resampleBilinear(src, field, 1, W, H)
    // interior pixel (1,1) should now hold src(2,1): r = 20
    expect(out[(1 * W + 1) * 4]).toBe(20)
  })

  it('edge clamp: sampling past the right edge reads the last column, never out of bounds', () => {
    const field = new Float32Array(W * H * 2)
    for (let i = 0; i < W * H; i++) field[i * 2] = 10 // huge push right
    const out = resampleBilinear(src, field, 5, W, H)
    // (3,0) pushed way right → clamped to x=3 → r = 30
    expect(out[(0 * W + 3) * 4]).toBe(30)
  })

  it('DEFAULT_DISPLACE_MAP has height read and a sane amount', () => {
    expect(DEFAULT_DISPLACE_MAP.read).toBe('height')
    expect(DEFAULT_DISPLACE_MAP.amount).toBeGreaterThan(0)
  })
})
