import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TORN_EDGE, tornEdgeActive, sanitizeTornEdge, TORN_EDGE_STYLES, applyTornEdgeToData,
} from '~/lib/compositor/tornEdge'

describe('tornEdge spec helpers', () => {
  it('DEFAULT_TORN_EDGE is a complete, active spec', () => {
    expect(DEFAULT_TORN_EDGE.style).toBe('shredded')
    expect(tornEdgeActive(DEFAULT_TORN_EDGE)).toBe(true)
  })

  it('tornEdgeActive is false for undefined and for a fully-zero spec', () => {
    expect(tornEdgeActive(undefined)).toBe(false)
    expect(tornEdgeActive(null)).toBe(false)
    expect(tornEdgeActive({ ...DEFAULT_TORN_EDGE, amount: 0, grain: 0, lipWidth: 0 })).toBe(false)
  })

  it('sanitizeTornEdge clamps out-of-range numbers and rejects bad style/colour', () => {
    const s = sanitizeTornEdge({
      style: 'nope', amount: 9999, roughness: 5, grain: -3,
      grainTexture: 2, lipWidth: 1000, lipVariation: -1, lipColor: 'blurple', seed: 3,
    })
    expect(TORN_EDGE_STYLES).toContain(s.style)   // fell back to a valid style
    expect(s.amount).toBeLessThanOrEqual(200)
    expect(s.roughness).toBe(1)
    expect(s.grain).toBe(0)
    expect(s.grainTexture).toBe(1)
    expect(s.lipWidth).toBeLessThanOrEqual(80)
    expect(s.lipVariation).toBe(0)
    expect(s.lipColor).toBe(DEFAULT_TORN_EDGE.lipColor)  // invalid hex → default
    expect(s.seed).toBe(3)
  })

  it('sanitizeTornEdge merges partial patch over current', () => {
    const cur = { ...DEFAULT_TORN_EDGE, amount: 20 }
    const s = sanitizeTornEdge({ grain: 4 }, cur)
    expect(s.amount).toBe(20)   // preserved from cur
    expect(s.grain).toBe(4)     // overridden
  })
})

/** Build a WxH RGBA buffer with an opaque red square inset by `pad`. */
function squareBuffer(W: number, H: number, pad: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const solid = x >= pad && x < W - pad && y >= pad && y < H - pad
    if (solid) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 40; data[i + 3] = 255 }
  }
  return data
}
const alphaAt = (d: Uint8ClampedArray, W: number, x: number, y: number) => d[(y * W + x) * 4 + 3]

describe('applyTornEdgeToData', () => {
  const W = 80, H = 80, PAD = 10
  const spec = { ...DEFAULT_TORN_EDGE, amount: 8, grain: 4, lipWidth: 4, lipVariation: 0.6 }

  it('leaves the deep interior fully opaque but erases some edge pixels', () => {
    const d = squareBuffer(W, H, PAD)
    applyTornEdgeToData(d, W, H, spec, 1)
    expect(alphaAt(d, W, 40, 40)).toBe(255)              // centre untouched
    // count transparent pixels in the top edge row band that were solid before
    let erased = 0
    for (let x = PAD; x < W - PAD; x++) for (let y = PAD; y < PAD + 12; y++) {
      if (alphaAt(d, W, x, y) === 0) erased++
    }
    expect(erased).toBeGreaterThan(0)                    // the edge actually tore
  })

  it('is deterministic for a fixed seed and changes with the seed', () => {
    const a = squareBuffer(W, H, PAD); applyTornEdgeToData(a, W, H, spec, 1)
    const b = squareBuffer(W, H, PAD); applyTornEdgeToData(b, W, H, spec, 1)
    expect(Array.from(a)).toEqual(Array.from(b))         // same seed → identical
    const c = squareBuffer(W, H, PAD); applyTornEdgeToData(c, W, H, { ...spec, seed: 99 }, 1)
    expect(Array.from(c)).not.toEqual(Array.from(a))     // different seed → different
  })

  it('paints lip pixels in the lip colour near the torn edge', () => {
    const d = squareBuffer(W, H, PAD)
    applyTornEdgeToData(d, W, H, { ...spec, lipColor: '#00ff00', lipWidth: 6, grain: 0 }, 1)
    let greenish = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255 && d[i + 1] > 180 && d[i]! < 80 && d[i + 2]! < 80) greenish++
    }
    expect(greenish).toBeGreaterThan(0)                  // a green lip band appeared
  })

  it('does nothing to a fully transparent buffer', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    applyTornEdgeToData(d, W, H, spec, 1)
    expect(d.every(v => v === 0)).toBe(true)
  })

  it('shredded high-roughness tear erodes beyond `amount` px (band not clipped)', () => {
    const W2 = 160, H2 = 160, PAD2 = 40, amt = 16
    const d = squareBuffer(W2, H2, PAD2)
    // seed=118 found by sweeping seeds 1..3000: at this seed the noise pushes
    // depthMul() high enough in the interior of the top edge (away from the
    // left/right corners, whose own proximity would erode this row band
    // regardless of the bug) to erode past the old, too-tight band.
    applyTornEdgeToData(d, W2, H2,
      { ...DEFAULT_TORN_EDGE, style: 'shredded', roughness: 1, amount: amt, grain: 0, grainTexture: 0, lipWidth: 0, lipVariation: 0, seed: 118 }, 1)
    // rows just past `amount` from the top edge: distance-from-edge ≈ (y - PAD2).
    // Stay clear of the left/right corners (>=30px in) so the count isolates
    // the top-edge band bound rather than corner-proximity erosion.
    let deepErased = 0
    for (let y = PAD2 + amt + 3; y < PAD2 + Math.round(amt * 1.6); y++) {
      for (let x = PAD2 + 30; x < W2 - PAD2 - 30; x++) if (alphaAt(d, W2, x, y) === 0) deepErased++
    }
    expect(deepErased).toBeGreaterThan(0)
    // deep interior still solid
    expect(alphaAt(d, W2, 80, 80)).toBe(255)
  })
})
