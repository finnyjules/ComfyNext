import { describe, it, expect } from 'vitest'
import { buildReel, type ReelParams } from '~/lib/spacetype/slotGeometry'
import { reelScroll, settleTime, type Timing } from '~/lib/spacetype/slotGeometry'

const base: ReelParams = {
  messages: 'MAKE IT REAL\nSHIP TODAY',
  reelUnit: 'word',
  fillerSource: 'messages',
  glyphSet: 'mixed',
  shapeSet: 'geometric',
  fillerTokens: 'A B C',
  fillerDensity: 3,
  align: 'left',
}

describe('buildReel', () => {
  it('slotCount is the longest message token count (word mode)', () => {
    const r = buildReel(base)
    expect(r.slotCount).toBe(3)       // "MAKE IT REAL" = 3 words
    expect(r.messageCount).toBe(2)
    expect(r.stride).toBe(4)          // 1 land + 3 filler
  })

  it('each slot strip has messageCount*stride cells, land cells at m*stride', () => {
    const r = buildReel(base)
    expect(r.cells).toHaveLength(3)
    for (const strip of r.cells) expect(strip).toHaveLength(2 * 4)
    // slot 0, message 0 land cell = "MAKE"
    expect(r.cells[0]![0]).toEqual({ kind: 'text', value: 'MAKE' })
    // slot 0, message 1 land cell (index stride=4) = "SHIP"
    expect(r.cells[0]![4]).toEqual({ kind: 'text', value: 'SHIP' })
  })

  it('pads short messages with blank land cells (left align)', () => {
    // "SHIP TODAY" has 2 words; slot 2 (index 2) is blank for message 1
    const r = buildReel(base)
    expect(r.cells[2]![4]).toEqual({ kind: 'blank', value: '' })
    // but slot 2 message 0 = "REAL"
    expect(r.cells[2]![0]).toEqual({ kind: 'text', value: 'REAL' })
  })

  it('char mode makes one slot per character', () => {
    const r = buildReel({ ...base, messages: 'GO\nHEY', reelUnit: 'char' })
    expect(r.slotCount).toBe(3)       // "HEY" = 3 chars
    expect(r.cells[0]![0]).toEqual({ kind: 'text', value: 'G' })
  })

  it('shape filler emits shape cells; deterministic for same params', () => {
    const r1 = buildReel({ ...base, fillerSource: 'shapes' })
    const r2 = buildReel({ ...base, fillerSource: 'shapes' })
    expect(r1.cells).toEqual(r2.cells)
    const filler = r1.cells[0]![1]     // first filler after land 0
    expect(filler!.kind).toBe('shape')
  })

  it('fillerDensity 0 makes stride 1 (no filler)', () => {
    const r = buildReel({ ...base, fillerDensity: 0 })
    expect(r.stride).toBe(1)
    expect(r.cells[0]).toHaveLength(2)
  })
})

const T: Timing = { messageCount: 2, stride: 4, slotCount: 3, hold: 0.4, stagger: 0.5, overshoot: 0.3 }
const L = T.messageCount * T.stride // strip length = 8

describe('reelScroll', () => {
  it('is seamless: offset at t01=0 equals offset as t01→1 (mod strip length)', () => {
    for (let j = 0; j < T.slotCount; j++) {
      const a = reelScroll(0, j, T).offset
      const b = reelScroll(0.999999, j, T).offset
      const d = Math.min(Math.abs(a - b), L - Math.abs(a - b))
      expect(d).toBeLessThan(0.02)
    }
  })

  it('holds message 0 at the start of the loop (offset 0, ~0 speed)', () => {
    const r = reelScroll(0.05, 0, T) // within hold sub-phase of segment 0
    expect(r.offset).toBeCloseTo(0, 5)
    expect(r.speed).toBeLessThan(0.02)
  })

  it('lands slot j on integer cell offsets after settling', () => {
    // End of segment 0 (t01≈0.499): every slot has settled onto message 1's land cell (offset 4).
    // (At t01≈0.999 the reel has already wrapped toward message 0's land cell, offset→0.)
    const r = reelScroll(0.499, 1, T)
    expect(r.offset).toBeCloseTo(4, 1)
  })

  it('offset is continuous across the internal segment boundary', () => {
    const before = reelScroll(0.4999, 0, T).offset
    const after = reelScroll(0.5001, 0, T).offset
    // near cell 4 on both sides (end of seg0 settles to 4; start of seg1 holds at 4)
    expect(Math.abs(before - after)).toBeLessThan(0.1)
  })

  it('staggers landings left-to-right: settleTime increases with slot index', () => {
    expect(settleTime(0, 3, 0.4, 0.5)).toBeLessThanOrEqual(settleTime(1, 3, 0.4, 0.5))
    expect(settleTime(1, 3, 0.4, 0.5)).toBeLessThanOrEqual(settleTime(2, 3, 0.4, 0.5))
    // last slot always settles at u=1
    expect(settleTime(2, 3, 0.4, 0.5)).toBeCloseTo(1, 5)
  })

  it('stagger 0 makes every slot settle at u=1', () => {
    expect(settleTime(0, 3, 0.4, 0)).toBeCloseTo(1, 5)
    expect(settleTime(1, 3, 0.4, 0)).toBeCloseTo(1, 5)
  })
})
