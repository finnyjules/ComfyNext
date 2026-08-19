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

describe('applyFeatherToData', () => {
  const W = 80, H = 80, PAD = 10
  // amount 0.1 * canvasW 80 * scale 1 = featherDev 8px
  const spec: FeatherSpec = { amount: 0.1, curve: 'linear' }

  it('leaves the deep interior fully opaque but fades edge pixels', () => {
    const d = squareBuffer(W, H, PAD)
    applyFeatherToData(d, W, H, spec, 1, W)
    expect(alphaAt(d, W, 40, 40)).toBe(255)              // center untouched
    const edge = alphaAt(d, W, PAD, 40)                  // left edge column (d≈1)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)                       // faded
  })

  it('is a no-op on a fully transparent buffer', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    const before = d.slice()
    applyFeatherToData(d, W, H, spec, 1, W)
    expect(d).toEqual(before)
  })

  it('amount 0 leaves alpha bytes unchanged (identity gate)', () => {
    const d = squareBuffer(W, H, PAD)
    const before = d.slice()
    applyFeatherToData(d, W, H, { amount: 0, curve: 'smooth' }, 1, W)
    expect(d).toEqual(before)
  })

  it('smooth and linear curves differ inside the band', () => {
    const dl = squareBuffer(W, H, PAD)
    const ds = squareBuffer(W, H, PAD)
    applyFeatherToData(dl, W, H, { amount: 0.1, curve: 'linear' }, 1, W)
    applyFeatherToData(ds, W, H, { amount: 0.1, curve: 'smooth' }, 1, W)
    // x=14 is ~5px inside the left edge → t≈0.625, where the two curves diverge
    expect(alphaAt(dl, W, 14, 40)).not.toBe(alphaAt(ds, W, 14, 40))
  })
})
