import { describe, it, expect } from 'vitest'
import { sourceFrameAt } from '../../shared/timeline/sourceFrame'

// Mirrors the formulas pinned in types.ts: source_frame = in_frame +
// floor(localFrame * speed); reverse evaluates at the mirrored local frame.
describe('sourceFrameAt', () => {
  const clip = (over: object) => ({ in_frame: 0, length: 10, ...over })

  it('identity at speed 1', () => {
    expect(sourceFrameAt(clip({}), 0)).toBe(0)
    expect(sourceFrameAt(clip({}), 7)).toBe(7)
    expect(sourceFrameAt(clip({ in_frame: 5 }), 7)).toBe(12)
  })

  it('speed 0.5 holds each source frame twice', () => {
    const f = [0, 1, 2, 3, 4].map(l => sourceFrameAt(clip({ speed: 0.5 }), l))
    expect(f).toEqual([0, 0, 1, 1, 2])
  })

  it('speed 2 skips every other source frame', () => {
    expect(sourceFrameAt(clip({ speed: 2 }), 3)).toBe(6)
  })

  it('reverse plays the mapped range last→first', () => {
    // length 10, speed 1: forward range [0..9]; reverse at local 0 → 9, local 9 → 0
    expect(sourceFrameAt(clip({ reverse: true }), 0)).toBe(9)
    expect(sourceFrameAt(clip({ reverse: true }), 9)).toBe(0)
    expect(sourceFrameAt(clip({ reverse: true, in_frame: 3 }), 0)).toBe(12)
  })

  it('reverse after speed: mirrored local frame, then speed mapping', () => {
    // length 10, speed 0.5: forward maps local 0..9 → 0,0,1,1,2,2,3,3,4,4
    // reverse at local 0 = forward at local 9 = 4
    expect(sourceFrameAt(clip({ reverse: true, speed: 0.5 }), 0)).toBe(4)
    expect(sourceFrameAt(clip({ reverse: true, speed: 0.5 }), 9)).toBe(0)
  })

  it('defaults: missing speed=1, in_frame=0, never negative', () => {
    expect(sourceFrameAt({ length: 1 }, 0)).toBe(0)
    expect(sourceFrameAt({ length: 0, reverse: true }, 0)).toBe(0)
  })
})
