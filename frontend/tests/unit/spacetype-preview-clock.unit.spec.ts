import { describe, it, expect } from 'vitest'
import { previewFrameAt } from '~/lib/spacetype/loop'

// The preview loop renders once per DISTINCT frame, not once per display repaint.
// previewFrameAt maps elapsed wall-clock time to the quantized frame index; the
// surface skips rendering when that index is unchanged since the last tick.
describe('previewFrameAt', () => {
  const fps = 30, base = 180, k = 1   // 30fps × 6s loop = 180 frames, single loop

  it('collapses sub-frame repaints to the same frame index', () => {
    // Two repaints 4ms apart (a 120Hz-ish cadence) inside the same 1/30s window
    // land on the same frame — so the second render would be redundant.
    expect(previewFrameAt(0, fps, base, k)).toBe(0)
    expect(previewFrameAt(4, fps, base, k)).toBe(0)
    expect(previewFrameAt(8, fps, base, k)).toBe(0)
    // ~33.3ms later a new frame begins.
    expect(previewFrameAt(34, fps, base, k)).toBe(1)
  })

  it('advances exactly `fps` distinct frames per second (not the repaint rate)', () => {
    // Simulate a 120Hz display: 120 repaints across one second.
    const seen = new Set<number>()
    for (let i = 0; i < 120; i++) seen.add(previewFrameAt((i / 120) * 1000, fps, base, k))
    expect(seen.size).toBe(fps)   // 30 distinct frames despite 120 repaints
  })

  it('wraps within the multi-loop window base*k', () => {
    // At k=2 the index runs 0..(base*2 - 1) then wraps.
    expect(previewFrameAt((base * 2 / fps) * 1000, fps, base, 2)).toBe(0)
    expect(previewFrameAt(((base * 2 - 1) / fps) * 1000, fps, base, 2)).toBe(base * 2 - 1)
  })
})
