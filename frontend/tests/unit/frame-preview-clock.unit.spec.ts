import { describe, it, expect } from 'vitest'
import { masterFrameIndex } from '~/lib/compositor/masterClock'

// The Frame card's live loop pulls a full-res studio frame + composites the whole
// stack at device resolution on every tick — expensive. It must render once per
// DISTINCT content frame, not once per display repaint (up to 120Hz on ProMotion),
// or a 30fps scene does 4× redundant readbacks+composites and playback goes janky.
// masterFrameIndex maps elapsed seconds to the quantized frame index; animateFrame
// skips the pull/composite when that index is unchanged since the last render.
describe('masterFrameIndex', () => {
  const fps = 30

  it('collapses sub-frame repaints to the same frame index', () => {
    // Repaints 4ms apart (≈120Hz) inside the same 1/30s window share a frame.
    expect(masterFrameIndex(0, fps)).toBe(0)
    expect(masterFrameIndex(0.004, fps)).toBe(0)
    expect(masterFrameIndex(0.008, fps)).toBe(0)
    // ~33.3ms in, a new frame begins.
    expect(masterFrameIndex(0.034, fps)).toBe(1)
  })

  it('advances exactly `fps` distinct frames per second (not the repaint rate)', () => {
    // Simulate a 120Hz display: 120 repaints across one second.
    const seen = new Set<number>()
    for (let i = 0; i < 120; i++) seen.add(masterFrameIndex(i / 120, fps))
    expect(seen.size).toBe(fps)   // 30 distinct frames despite 120 repaints
  })

  it('is monotonic across loop boundaries (no wrap — used only for change detection)', () => {
    // Unlike the bounded export clock, the preview index never wraps: it only feeds
    // a "did the frame change?" comparison, so a later time always yields a >= index.
    expect(masterFrameIndex(10, fps)).toBe(300)
    expect(masterFrameIndex(10.05, fps)).toBe(301)
    expect(masterFrameIndex(10, fps)).toBeLessThan(masterFrameIndex(10.05, fps))
  })

  it('guards a zero/negative fps to a sane 1fps floor (never divides by refresh rate)', () => {
    expect(masterFrameIndex(2, 0)).toBe(2)
    expect(masterFrameIndex(2.9, 0)).toBe(2)
  })
})
