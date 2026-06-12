import { describe, it, expect } from 'vitest'
import { bakeRadius } from '~/composables/useBrushMask'

// `bakeRadius` decides the per-stroke radius (output px) baked into the mask,
// folding in the Expand control. Expand always grows the CHANGE region:
//  - normal mode: strokes ARE the change region → grow strokes.
//  - inverted mode: strokes are the KEEP region → shrink strokes (erode keep =
//    dilate change), clamped so a fully-eroded stroke never goes negative.

describe('bakeRadius', () => {
  it('grows the stroke in normal mode (expand grows the change region)', () => {
    // 0.1 width-fraction × 1000 artW = 100 px, +20 expand = 120
    expect(bakeRadius(0.1, 1000, 20, false)).toBe(120)
  })

  it('shrinks the stroke in inverted mode (expand still grows the change region)', () => {
    // keep stroke 100 px, eroded by 20 = 80 → change boundary moves outward
    expect(bakeRadius(0.1, 1000, 20, true)).toBe(80)
  })

  it('clamps to 0 when expand fully erodes a thin keep stroke (inverted)', () => {
    // 0.01 × 1000 = 10 px keep stroke, expand 50 → would be -40, clamped to 0
    expect(bakeRadius(0.01, 1000, 50, true)).toBe(0)
  })

  it('is identical in both modes when expand is 0', () => {
    expect(bakeRadius(0.1, 1000, 0, false)).toBe(100)
    expect(bakeRadius(0.1, 1000, 0, true)).toBe(100)
  })
})
