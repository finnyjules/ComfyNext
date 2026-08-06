/**
 * Deterministic taste analyzers (server/utils/tasteAnalyze.ts) on synthetic
 * pixel buffers. The assertions are deliberately directional AND banded (side
 * of 0.5, not just ordering) so a broken analyzer that returns a constant 0.5
 * — or one reading the wrong channel — fails loudly.
 */
import { describe, expect, it } from 'vitest'
import {
  analyzeTaste,
  dominantPalette,
  imageMetrics,
  validatePixelImage,
  type PixelImage,
} from '../../server/utils/tasteAnalyze'

/** Build a w×h RGBA buffer from a per-pixel color function. */
function buf(w: number, h: number, px: (x: number, y: number) => [number, number, number]): PixelImage {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y)
      const o = (y * w + x) * 4
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255
    }
  }
  return { w, h, data }
}

// Warm, bright, low-contrast: flat orange field with a whisper of variation.
const warmBright = buf(32, 32, (x, y) => [230, 150 + ((x + y) % 3), 70])
// Cool, dark, high-contrast: navy ground with hard white speckles.
const coolDark = buf(32, 32, (x, y) => ((x + y * 3) % 8 === 0 ? [235, 240, 255] : [8, 16, 48]))

describe('imageMetrics', () => {
  it('orders warmth, value and contrast correctly across opposite buffers', () => {
    const warm = imageMetrics(warmBright).facets
    const cool = imageMetrics(coolDark).facets

    // Banded, not just ordered — a constant-0.5 analyzer fails every line.
    expect(warm.warmth!).toBeGreaterThan(0.6)
    expect(cool.warmth!).toBeLessThan(0.4)
    expect(warm.warmth!).toBeGreaterThan(cool.warmth!)

    expect(warm.valueBias!).toBeGreaterThan(0.55)
    expect(cool.valueBias!).toBeLessThan(0.35)

    expect(warm.contrast!).toBeLessThan(0.2)
    expect(cool.contrast!).toBeGreaterThan(0.6)
  })

  it('reads saturation discipline: vivid field vs grey field', () => {
    const vivid = imageMetrics(buf(16, 16, () => [255, 0, 128])).facets
    const grey = imageMetrics(buf(16, 16, () => [128, 128, 130])).facets
    expect(vivid.saturation!).toBeGreaterThan(0.8)
    expect(grey.saturation!).toBeLessThan(0.15)
  })

  it('reads palette breadth: rainbow vs monochrome', () => {
    const rainbow = imageMetrics(buf(36, 8, (x) => {
      const hue = (x / 36) * 360
      // crude saturated hue wheel
      const seg = Math.floor(hue / 60), f = (hue % 60) / 60
      const table: Array<[number, number, number]> = [
        [255, Math.round(255 * f), 0], [Math.round(255 * (1 - f)), 255, 0],
        [0, 255, Math.round(255 * f)], [0, Math.round(255 * (1 - f)), 255],
        [Math.round(255 * f), 0, 255], [255, 0, Math.round(255 * (1 - f))],
      ]
      return table[seg % 6]!
    })).facets
    const mono = imageMetrics(buf(36, 8, (x) => [0, 60 + x * 4, 200])).facets
    expect(rainbow.paletteBreadth!).toBeGreaterThan(0.5)
    expect(mono.paletteBreadth!).toBeLessThan(0.3)
  })

  it('reads density: checkerboard vs flat fill', () => {
    const busy = imageMetrics(buf(32, 32, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]))).facets
    const flat = imageMetrics(buf(32, 32, () => [90, 90, 90])).facets
    expect(busy.density!).toBeGreaterThan(0.7)
    expect(flat.density!).toBeLessThan(0.05)
  })
})

describe('dominantPalette', () => {
  it('finds both halves of a two-color image, deterministically', () => {
    const halves = buf(32, 32, (x) => (x < 16 ? [220, 30, 40] : [30, 60, 210]))
    const palette = dominantPalette(halves)
    expect(palette.length).toBeGreaterThanOrEqual(2)
    expect(palette.length).toBeLessThanOrEqual(5)
    const rgb = palette.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))
    expect(rgb.some(([r, , b]) => r! > 150 && b! < 100)).toBe(true)
    expect(rgb.some(([r, , b]) => b! > 150 && r! < 100)).toBe(true)
    // Deterministic: same buffer, same swatches.
    expect(dominantPalette(halves)).toEqual(palette)
  })
})

describe('analyzeTaste', () => {
  it('aggregates with attribution and honest agreement-based confidence', () => {
    const { reading, palette, perImage } = analyzeTaste([warmBright, coolDark])
    expect(perImage).toHaveLength(2)
    expect(palette.length).toBeGreaterThan(0)

    const vb = reading.facets.valueBias!
    expect(vb).toBeDefined()
    // Sources name real images on the aggregate's side of centre.
    for (const s of vb.sources ?? []) expect(s).toMatch(/^image-[01]$/)

    // Agreeing images → higher confidence than disagreeing ones.
    const agree = analyzeTaste([warmBright, warmBright]).reading.facets.valueBias!
    expect(agree.confidence).toBeGreaterThan(vb.confidence)

    // Deterministic route never claims the model-only facets.
    expect(reading.facets.motion).toBeUndefined()
    expect(reading.facets.ornament).toBeUndefined()
    expect(reading.avoids).toEqual([])
  })
})

describe('validatePixelImage', () => {
  it('accepts a well-formed buffer and rejects malformed ones', () => {
    const ok = validatePixelImage({ w: 2, h: 2, data: new Array(16).fill(0) }, 0)
    expect(ok.w).toBe(2)
    expect(() => validatePixelImage({ w: 2, h: 2, data: new Array(15).fill(0) }, 0)).toThrow(/length/)
    expect(() => validatePixelImage({ w: 0, h: 2, data: [] }, 0)).toThrow(/1\.\.256/)
    expect(() => validatePixelImage({ w: 999, h: 2, data: [] }, 1)).toThrow(/pixels\[1\]/)
    expect(() => validatePixelImage(null, 0)).toThrow(/object/)
  })
})
