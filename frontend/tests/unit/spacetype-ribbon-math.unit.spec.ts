import { describe, it, expect } from 'vitest'
import { wrap01, buildRibbonLabel, tileCount, ribbonRowState, type RibbonParams } from '../../app/lib/spacetype/ribbonMath'

const P: RibbonParams = {
  rows: 5, rowSpacing: 1, zRotation: 0.3, waveAmplitude: 0.4, waveFrequency: 2,
  rowPhase: 0.5, scrollSpeed: 1, scrollCycles: 1, waveCycles: 1,
}

describe('wrap01', () => {
  it('wraps into [0,1)', () => {
    expect(wrap01(0)).toBeCloseTo(0, 10)
    expect(wrap01(1)).toBeCloseTo(0, 10)
    expect(wrap01(1.25)).toBeCloseTo(0.25, 10)
    expect(wrap01(-0.25)).toBeCloseTo(0.75, 10)
  })
})

describe('buildRibbonLabel', () => {
  it('uppercases and pads with a trailing gap when case=upper', () => {
    expect(buildRibbonLabel('Vessel', 'upper')).toBe('VESSEL   ')
  })
  it('leaves case alone when as-typed', () => {
    expect(buildRibbonLabel('Vessel', 'as-typed')).toBe('Vessel   ')
  })
})

describe('tileCount', () => {
  it('covers the width with at least 2 extra tiles', () => {
    expect(tileCount(1000, 250)).toBe(6)
  })
  it('never returns less than 2', () => {
    expect(tileCount(10, 1000)).toBe(2)
  })
})

describe('ribbonRowState', () => {
  it('is deterministic for the same inputs', () => {
    expect(ribbonRowState(0.3, 2, P)).toEqual(ribbonRowState(0.3, 2, P))
  })
  it('centers rows around y=0', () => {
    const mid = ribbonRowState(0, 2, P) // middle of 5 rows (index 2)
    expect(mid.y).toBeCloseTo(0, 10)
    const top = ribbonRowState(0, 0, P)
    const bot = ribbonRowState(0, 4, P)
    expect(top.y).toBeCloseTo(-bot.y, 10)
  })
  it('applies progressive per-row z-rotation', () => {
    const r0 = ribbonRowState(0, 0, P)
    const r4 = ribbonRowState(0, 4, P)
    expect(r4.zRotation).toBeCloseTo(-r0.zRotation, 10)
    expect(r0.zRotation).not.toBe(0)
  })
  it('loops seamlessly: scroll and wave phase match at t01=0 and t01->1', () => {
    const a = ribbonRowState(0, 3, P)
    const b = ribbonRowState(0.999999, 3, P)
    expect(wrap01(b.scrollOffset)).toBeCloseTo(wrap01(a.scrollOffset), 4)
    expect(wrap01(b.wavePhase / (Math.PI * 2))).toBeCloseTo(wrap01(a.wavePhase / (Math.PI * 2)), 4)
  })
})
