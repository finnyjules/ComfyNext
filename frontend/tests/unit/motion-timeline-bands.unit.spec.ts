import { describe, it, expect } from 'vitest'
import type { LayerAnimation } from '~/lib/motion/types'
import {
  BAND_MIN, windowSeconds, bandSegments, setClipOffset,
  resizeTransition, setWindowDuration, snapSeconds,
} from '~/lib/motion/timelineBands'

const anim = (p: Partial<LayerAnimation> = {}): LayerAnimation => ({ offset: 0, ...p })

describe('windowSeconds', () => {
  it('undefined duration runs to frame end', () => {
    expect(windowSeconds(anim({ offset: 1 }), 4)).toEqual({ start: 1, end: 4 })
  })
  it('explicit duration clamps to frame end', () => {
    expect(windowSeconds(anim({ offset: 3, duration: 5 }), 4)).toEqual({ start: 3, end: 4 })
  })
})

describe('bandSegments', () => {
  it('no animation → full-width loop band', () => {
    expect(bandSegments(undefined, 4)).toEqual({ offset: 0, in: 0, loop: 1, out: 0, end: 1 })
  })
  it('offset + in + out + window end as fractions', () => {
    const a = anim({ offset: 1, duration: 2, in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    const s = bandSegments(a, 4)
    expect(s.offset).toBeCloseTo(0.25)
    expect(s.in).toBeCloseTo(0.125)
    expect(s.out).toBeCloseTo(0.125)
    expect(s.loop).toBeCloseTo(0.25)
    expect(s.end).toBeCloseTo(0.75)
  })
  it('in+out longer than window: out is squeezed into what remains', () => {
    const a = anim({ duration: 1, in: { presetId: 'fade-in', duration: 0.8 }, out: { presetId: 'fade-out', duration: 0.8 } })
    const s = bandSegments(a, 4)
    expect(s.in).toBeCloseTo(0.2)          // 0.8/4
    expect(s.out).toBeCloseTo(0.05)        // squeezed to the remaining 0.2s
    expect(s.loop).toBe(0)
  })
})

describe('setClipOffset', () => {
  it('clamps so an explicit window stays inside the frame', () => {
    const a = anim({ duration: 1 })
    setClipOffset(a, 3.7, 4)
    expect(a.offset).toBeCloseTo(3)
  })
  it('to-end windows keep at least BAND_MIN visible', () => {
    const a = anim()
    setClipOffset(a, 9, 4)
    expect(a.offset).toBeCloseTo(4 - BAND_MIN)
  })
  it('never negative', () => {
    const a = anim({ duration: 1 })
    setClipOffset(a, -2, 4)
    expect(a.offset).toBe(0)
  })
})

describe('resizeTransition', () => {
  it('resizes in, clamped to window minus out', () => {
    const a = anim({ duration: 2, in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    resizeTransition(a, 'in', 5, 4)
    expect(a.in!.duration).toBeCloseTo(1.5)
  })
  it('no-op when the slot is unset', () => {
    const a = anim()
    resizeTransition(a, 'in', 1, 4)   // must not throw
    expect(a.in).toBeUndefined()
  })
  it('enforces BAND_MIN', () => {
    const a = anim({ in: { presetId: 'fade-in', duration: 0.5 } })
    resizeTransition(a, 'in', 0, 4)
    expect(a.in!.duration).toBe(BAND_MIN)
  })
})

describe('setWindowDuration', () => {
  it('sets an explicit duration', () => {
    const a = anim({ offset: 1 })
    setWindowDuration(a, 2, 4)
    expect(a.duration).toBeCloseTo(2)
  })
  it('dragging to frame end resets to undefined (to-end)', () => {
    const a = anim({ offset: 1, duration: 2 })
    setWindowDuration(a, 3, 4)     // offset 1 + 3 = frame end
    expect(a.duration).toBeUndefined()
  })
  it('cannot shrink below in+out', () => {
    const a = anim({ in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    setWindowDuration(a, 0.2, 4)
    expect(a.duration).toBeCloseTo(1)
  })
  it('frame containment beats the in+out floor when they conflict', () => {
    const a = anim({ offset: 3.5, in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    setWindowDuration(a, 0.2, 4)        // maxDur = 0.5 < minDur = 1
    expect(a.duration).toBeCloseTo(0.5) // stored duration never exceeds the frame
  })
})

describe('snapSeconds', () => {
  it('snaps within epsilon', () => expect(snapSeconds(1.95, [0, 2, 4])).toBe(2))
  it('keeps value outside epsilon', () => expect(snapSeconds(1.7, [0, 2, 4])).toBe(1.7))
  it('prefers the nearest target', () => expect(snapSeconds(0.05, [0, 0.08])).toBe(0.08))
})
