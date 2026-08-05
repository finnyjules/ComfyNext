import { describe, it, expect } from 'vitest'
import { scrubValue } from '~/lib/studio/scrub'
import { nudgeValue } from '~/lib/studio/row'

const base = { min: 0, max: 100, step: 1 }

describe('scrubValue', () => {
  it('maps half the default scrub distance to half the range', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130 })).toBe(50)
  })
  it('clamps at both ends', () => {
    expect(scrubValue({ ...base, startValue: 90, deltaPx: 1000 })).toBe(100)
    expect(scrubValue({ ...base, startValue: 10, deltaPx: -1000 })).toBe(0)
  })
  it('snaps to step', () => {
    expect(scrubValue({ min: 0, max: 100, step: 5, startValue: 0, deltaPx: 130 })).toBe(50)
    expect(scrubValue({ min: 0, max: 100, step: 5, startValue: 0, deltaPx: 26 })).toBe(10)
  })
  // Shift means `coarse` in the studios, in both the drag and the arrow keys. `fine`
  // is the pre-studio meaning and is still live on the `v-scrub` directive
  // (plugins/scrub.client.ts), whose one user is GridPropertyPanel.
  it('fine scales the delta down', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: true })).toBe(15)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: false })).toBe(100)
  })
  it('shift-coarse keeps the travel rate but lands on a ten-step grid', () => {
    // 130px of 260 is half of 0..100 → 50 either way; the grid shows at 34px, which
    // is 13.07 raw: on the normal grid that snaps to 13, on the coarse one to 10.
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130, coarse: true })).toBe(50)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 34 })).toBe(13)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 34, coarse: true })).toBe(10)
  })
  it('coarse-drags on the same grid a shift-arrow jumps by', () => {
    // KEY_COARSE_STEPS worth of a 0.01 step is 0.1 — the drag must not invent its own.
    const v = scrubValue({ min: 0, max: 1, step: 0.01, startValue: 0, deltaPx: 44, coarse: true })
    expect(v).toBe(0.2)
    expect(v).toBe(Number(v.toFixed(6)))
  })
  // The tests above all start at 0, which is ON the coarse grid — so they pass under an
  // absolute grid AND a relative one and cannot tell the two gestures apart. This one
  // starts off-grid and runs both paths, which is the only way the disagreement shows.
  it('a coarse drag increment equals a shift-arrow press, from the same start', () => {
    const r = { min: 0, max: 100, step: 1 } as const
    const start = 13
    const oneArrow = nudgeValue({ ...r, value: start, direction: 1, coarse: true })
    expect(oneArrow).toBe(23) // relative: 13 + 10. An absolute x10 grid would say 20.
    // 30px of 260 across 0..100 is +11.5 steps — one coarse increment.
    expect(scrubValue({ ...r, startValue: start, deltaPx: 30, coarse: true })).toBe(oneArrow)

    const twoArrows = nudgeValue({ ...r, value: oneArrow, direction: 1, coarse: true })
    expect(twoArrows).toBe(33)
    // 55px is +21.2 steps — two increments.
    expect(scrubValue({ ...r, startValue: start, deltaPx: 55, coarse: true })).toBe(twoArrows)

    // ...and backwards.
    const backArrow = nudgeValue({ ...r, value: start, direction: -1, coarse: true })
    expect(backArrow).toBe(3)
    expect(scrubValue({ ...r, startValue: start, deltaPx: -30, coarse: true })).toBe(backArrow)
  })

  it('does not coarsen a range too short to hold the jump', () => {
    // matToonSteps, min 2 max 5. The x10 grid collapsed to the endpoints: the first two
    // pixels past the 2px drag threshold snapped 3 -> 2, and 4 was unreachable.
    const toon = { min: 2, max: 5, step: 1 } as const
    expect(scrubValue({ ...toon, startValue: 3, deltaPx: 3, coarse: true })).toBe(3)
    expect(scrubValue({ ...toon, startValue: 3, deltaPx: 50, coarse: true })).toBe(4)
    expect(scrubValue({ ...toon, startValue: 3, deltaPx: 50, coarse: true }))
      .toBe(scrubValue({ ...toon, startValue: 3, deltaPx: 50 }))
    // Cells, 2..12 — reachable in twos now rather than only 2, 10 and 12.
    expect(scrubValue({ min: 2, max: 12, step: 1, startValue: 5, deltaPx: 60, coarse: true })).toBe(7)
  })

  it('honours a per-control scrubPx override', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130, scrubPx: 130 })).toBe(100)
  })
  it('handles a negative-min (bipolar) range and negative delta', () => {
    expect(scrubValue({ min: -100, max: 100, step: 1, startValue: 0, deltaPx: -130 })).toBe(-130 / 260 * 200)
  })
  it('never emits float dust', () => {
    // Use inputs that trigger IEEE 754 accumulation error: 0.1 * 3 = 0.30000000000000004
    // min:0 max:1 step:0.1, deltaPx:65 → raw:0.25 → Math.round(0.25/0.1)*0.1 → 0.30000000000000004
    const v = scrubValue({ min: 0, max: 1, step: 0.1, startValue: 0, deltaPx: 65, scrubPx: 260 })
    // Must return clean 0.3, not the dusty 0.30000000000000004
    expect(v).toBe(0.3)
    // Verify it's strictly equal to the toFixed clean round (test fails if strip is removed)
    expect(v).toBe(Number(v.toFixed(6)))
  })
})
