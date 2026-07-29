import { describe, it, expect } from 'vitest'
import { clampExportDims } from '~/lib/gradientfx/exportDims'

// Review finding: per-axis clamping (Math.min(w, 4096), Math.min(h, 4096))
// does not preserve aspect ratio. A 9:16 export requested at "4K" comes out
// 4096x7282 before clamping — clamp each axis independently and you get a
// SQUARE 4096x4096, which then squashes the render (and the poster, baked
// from the same wrong canvas). clampExportDims must scale both axes by one
// factor instead.
describe('clampExportDims', () => {
  it('keeps a 9:16 aspect ratio when clamping a 4K-tall export', () => {
    // 9:16 at width 4096 => height 4096 * 16/9 ≈ 7282.
    const { w, h } = clampExportDims(4096, 7282, 4096)
    expect(w).toBeLessThanOrEqual(4096)
    expect(h).toBeLessThanOrEqual(4096)
    // The per-axis bug produces exactly 4096x4096 (ratio 1) here — assert the
    // ratio is still ~9:16, which the buggy version fails.
    expect(Math.abs(w / h - 9 / 16)).toBeLessThan(0.002)
  })

  it('keeps a 16:9 aspect ratio when clamping an 8K-wide export', () => {
    // 16:9 at width 8192 => height 4608. Both exceed 4096.
    const { w, h } = clampExportDims(8192, 4608, 4096)
    expect(w).toBeLessThanOrEqual(4096)
    expect(h).toBeLessThanOrEqual(4096)
    expect(Math.abs(w / h - 16 / 9)).toBeLessThan(0.002)
  })

  it('does not upscale or alter dimensions already within bounds', () => {
    expect(clampExportDims(800, 600, 4096)).toEqual({ w: 800, h: 600 })
  })

  it('clamps a square export to max on both axes', () => {
    expect(clampExportDims(8192, 8192, 4096)).toEqual({ w: 4096, h: 4096 })
  })

  it('never returns a zero or negative dimension', () => {
    const { w, h } = clampExportDims(1, 100000, 4096)
    expect(w).toBeGreaterThanOrEqual(1)
    expect(h).toBeGreaterThanOrEqual(1)
  })
})
