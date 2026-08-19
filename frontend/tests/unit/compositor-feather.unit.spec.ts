import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEATHER, featherActive, sanitizeFeather, applyFeatherToData, type FeatherSpec,
} from '~/lib/compositor/feather'

describe('feather spec helpers', () => {
  it('DEFAULT_FEATHER is an active spec', () => {
    expect(DEFAULT_FEATHER.amount).toBeGreaterThan(0)
    expect(featherActive(DEFAULT_FEATHER)).toBe(true)
  })

  it('featherActive is false for undefined, null, and amount 0', () => {
    expect(featherActive(undefined)).toBe(false)
    expect(featherActive(null)).toBe(false)
    expect(featherActive({ ...DEFAULT_FEATHER, amount: 0 })).toBe(false)
  })

  it('sanitizeFeather clamps amount and rejects a bad curve', () => {
    const s = sanitizeFeather({ amount: 99, curve: 'nope' })
    expect(s.amount).toBe(1)                   // clamped to max
    expect(s.curve).toBe(DEFAULT_FEATHER.curve) // invalid → default
    const neg = sanitizeFeather({ amount: -5 })
    expect(neg.amount).toBe(0)                  // clamped to min
  })

  it('sanitizeFeather merges a partial patch over current', () => {
    const cur: FeatherSpec = { amount: 0.2, curve: 'linear' }
    const s = sanitizeFeather({ curve: 'smooth' }, cur)
    expect(s.amount).toBe(0.2)      // preserved
    expect(s.curve).toBe('smooth')  // overridden
  })
})

/** Build a WxH RGBA buffer with an opaque square inset by `pad`. */
function squareBuffer(W: number, H: number, pad: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const solid = x >= pad && x < W - pad && y >= pad && y < H - pad
    if (solid) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 40; data[i + 3] = 255 }
  }
  return data
}
const alphaAt = (d: Uint8ClampedArray, W: number, x: number, y: number) => d[(y * W + x) * 4 + 3]!

describe('applyFeatherToData (element-relative)', () => {
  const W = 80, H = 80

  it('leaves the deep interior fully opaque but fades edge pixels', () => {
    const d = squareBuffer(W, H, 10)                     // opaque [10,69], refExtent 30
    applyFeatherToData(d, W, H, { amount: 0.3, curve: 'linear' })  // featherDev 9
    expect(alphaAt(d, W, 40, 40)).toBe(255)              // center untouched
    const edge = alphaAt(d, W, 10, 40)                   // left edge column (d≈1)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)                       // faded
  })

  it('is a no-op on a fully transparent buffer', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    const before = d.slice()
    applyFeatherToData(d, W, H, { amount: 0.5, curve: 'linear' })
    expect(d).toEqual(before)
  })

  it('amount 0 leaves alpha bytes unchanged (identity gate)', () => {
    const d = squareBuffer(W, H, 10)
    const before = d.slice()
    applyFeatherToData(d, W, H, { amount: 0, curve: 'smooth' })
    expect(d).toEqual(before)
  })

  it('smooth and linear curves differ inside the band', () => {
    const dl = squareBuffer(W, H, 10)
    const ds = squareBuffer(W, H, 10)
    applyFeatherToData(dl, W, H, { amount: 0.6, curve: 'linear' })  // featherDev 18
    applyFeatherToData(ds, W, H, { amount: 0.6, curve: 'smooth' })
    // x=19 is 10px inside the left edge → t≈0.56, where the two curves diverge
    expect(alphaAt(dl, W, 19, 40)).not.toBe(alphaAt(ds, W, 19, 40))
  })

  it('larger amount fades deeper — a fixed interior point goes opaque → faded', () => {
    // This is the regression: canvas-relative scaling made small and large amounts
    // both saturate a placed element, so 0.1 and 1.0 looked identical.
    const dLow = squareBuffer(W, H, 10)
    const dHigh = squareBuffer(W, H, 10)
    applyFeatherToData(dLow,  W, H, { amount: 0.1, curve: 'linear' })  // featherDev 3
    applyFeatherToData(dHigh, W, H, { amount: 1.0, curve: 'linear' })  // featherDev 30
    // (40,20) is 11px from the top edge — outside the small band, inside the large one
    expect(alphaAt(dLow,  W, 40, 20)).toBe(255)          // amount 0.1 leaves it opaque
    expect(alphaAt(dHigh, W, 40, 20)).toBeLessThan(255)  // amount 1.0 fades it
  })

  it('feather depth is element-relative — same amount, proportional depth on different sizes', () => {
    const big   = squareBuffer(W, H, 8)   // opaque [8,71],  extent 64, refExtent 32
    const small = squareBuffer(W, H, 24)  // opaque [24,55], extent 32, refExtent 16
    applyFeatherToData(big,   W, H, { amount: 0.5, curve: 'linear' })  // featherDev 16
    applyFeatherToData(small, W, H, { amount: 0.5, curve: 'linear' })  // featherDev 8
    // A point 8px into `big` (d=8, t=8/16=0.5) and 4px into `small` (d=4, t=4/8=0.5)
    // are the SAME fraction of the way in — element-relative feather fades them equally.
    const aBig   = alphaAt(big,   W, 15, 40)
    const aSmall = alphaAt(small, W, 27, 40)
    expect(Math.abs(aBig - aSmall)).toBeLessThanOrEqual(2)
  })
})
