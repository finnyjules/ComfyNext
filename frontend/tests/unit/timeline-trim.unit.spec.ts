import { describe, it, expect } from 'vitest'
import { computeLeftTrim, clampLengthToSource } from '../../shared/timeline/trim'

describe('computeLeftTrim', () => {
  // Clip: start 100, in 30, length 60.
  const base = { start_frame: 100, in_frame: 30, length: 60 }

  it('trimming right (later start) shortens and advances in_frame', () => {
    expect(computeLeftTrim(base, 110, true)).toEqual({ start_frame: 110, in_frame: 40, length: 50 })
  })

  it('trimming left (earlier start) lengthens and rewinds in_frame', () => {
    expect(computeLeftTrim(base, 80, true)).toEqual({ start_frame: 80, in_frame: 10, length: 80 })
  })

  it('clamps at in_frame 0 — cannot reveal content before the source start', () => {
    expect(computeLeftTrim(base, 50, true)).toEqual({ start_frame: 70, in_frame: 0, length: 90 })
  })

  it('never shrinks below 1 frame', () => {
    expect(computeLeftTrim(base, 500, true)).toEqual({ start_frame: 159, in_frame: 89, length: 1 })
  })

  it('images and other unbounded kinds keep in_frame untouched', () => {
    expect(computeLeftTrim(base, 80, false)).toEqual({ start_frame: 80, in_frame: 30, length: 80 })
  })
})

describe('clampLengthToSource', () => {
  it('caps length at remaining source frames', () => {
    expect(clampLengthToSource(100, 30, 90)).toBe(60)   // 90 total, 30 used
  })
  it('unknown source (null) leaves length alone', () => {
    expect(clampLengthToSource(100, 30, null)).toBe(100)
  })
  it('floors at 1', () => {
    expect(clampLengthToSource(5, 89, 90)).toBe(1)
  })
  it('speed scales the budget: 2× halves the timeline frames available', () => {
    expect(clampLengthToSource(100, 30, 90, 2)).toBe(30)   // 60 source frames / 2
  })
  it('speed 0.5 doubles the timeline frames available', () => {
    expect(clampLengthToSource(300, 30, 90, 0.5)).toBe(120) // 60 source frames / 0.5
  })
  it('length under the budget passes through untouched at any speed', () => {
    expect(clampLengthToSource(10, 0, 90, 2)).toBe(10)
  })
})
