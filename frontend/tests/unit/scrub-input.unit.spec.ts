import { describe, it, expect } from 'vitest'
import { scrubInputValue, SCRUB_THRESHOLD_PX } from '~/lib/studio/scrub'

/**
 * The modal inspector's plain <input type="number"> fields scrub on a PIXEL-PER-STEP
 * model, not StudioRow's range-over-260px one: most of them (X/Y/W/H, rotation,
 * fontSize) declare no `max`, so a range mapping has nothing to map. This suite pins
 * the pixel model and proves it still reuses scrubValue's coarse-grid and float-dust
 * conventions.
 */
describe('scrubInputValue', () => {
  it('moves one step per pixel by default (Figma 1:1)', () => {
    expect(scrubInputValue({ startValue: 100, deltaPx: 30, step: 1 })).toBe(130)
    expect(scrubInputValue({ startValue: 100, deltaPx: -30, step: 1 })).toBe(70)
    expect(scrubInputValue({ startValue: 0, deltaPx: 0, step: 1 })).toBe(0)
  })

  it('works with NO max — the unbounded case StudioRow cannot handle', () => {
    // Rotation / W / H: min may be present, max absent. A range model divides by NaN;
    // this one just keeps counting.
    expect(scrubInputValue({ startValue: 500, deltaPx: 250, step: 1 })).toBe(750)
    expect(scrubInputValue({ startValue: 500, deltaPx: 250, step: 1, min: 1 })).toBe(750)
  })

  it('honours the step grid, including fractional steps', () => {
    // step 0.5 (duration, shadow offset): 30px → 15 steps of 0.5 → +7.5 wait no,
    // pixel-per-step means 30px is 30 steps, each 0.5 → +15.
    expect(scrubInputValue({ startValue: 0, deltaPx: 30, step: 0.5 })).toBe(15)
    // step 0.01 (letterSpacing, cloner radius): 25px → +0.25
    expect(scrubInputValue({ startValue: 0, deltaPx: 25, step: 0.01 })).toBe(0.25)
  })

  it('clamps to min and max when both are finite', () => {
    expect(scrubInputValue({ startValue: 90, deltaPx: 1000, step: 1, min: 0, max: 100 })).toBe(100)
    expect(scrubInputValue({ startValue: 10, deltaPx: -1000, step: 1, min: 0, max: 100 })).toBe(0)
  })

  it('clamps on one side only when only one bound is finite', () => {
    // min 1, no max: floors at 1 but rises without limit.
    expect(scrubInputValue({ startValue: 5, deltaPx: -1000, step: 1, min: 1 })).toBe(1)
    expect(scrubInputValue({ startValue: 5, deltaPx: 1000, step: 1, min: 1 })).toBe(1005)
  })

  it('Shift widens the grid to ×10 at the same travel rate (matches scrubValue coarse)', () => {
    // 34px of travel is +34 on the fine grid; coarse rounds that travel to the nearest
    // multiple of 10 → +30. Same technique scrubValue uses, so drag and keys agree.
    expect(scrubInputValue({ startValue: 0, deltaPx: 34, step: 1 })).toBe(34)
    expect(scrubInputValue({ startValue: 0, deltaPx: 34, step: 1, coarse: true })).toBe(30)
    // From an off-grid start the coarse jump is measured FROM the start, not from 0.
    expect(scrubInputValue({ startValue: 13, deltaPx: 34, step: 1, coarse: true })).toBe(43)
  })

  it('coarse multiplier can be overridden', () => {
    expect(scrubInputValue({ startValue: 0, deltaPx: 24, step: 1, coarse: true, coarseMultiplier: 5 })).toBe(25)
  })

  it('a custom pxPerStep slows or speeds the scrub', () => {
    // 4px per step → 40px is +10.
    expect(scrubInputValue({ startValue: 0, deltaPx: 40, step: 1, pxPerStep: 4 })).toBe(10)
  })

  it('never emits float dust', () => {
    const v = scrubInputValue({ startValue: 0, deltaPx: 3, step: 0.1 })
    expect(v).toBe(0.3)
    expect(v).toBe(Number(v.toFixed(6)))
  })

  it('a sub-threshold nudge below one step reads as no change', () => {
    // The directive ignores movement under SCRUB_THRESHOLD_PX so a click can still focus
    // to type; even past it, a tiny travel on a step-1 field rounds back to the start.
    expect(SCRUB_THRESHOLD_PX).toBeGreaterThan(0)
    expect(scrubInputValue({ startValue: 42, deltaPx: SCRUB_THRESHOLD_PX, step: 1 })).toBe(42 + SCRUB_THRESHOLD_PX)
    expect(scrubInputValue({ startValue: 42, deltaPx: 0, step: 1 })).toBe(42)
  })

  it('tolerates a missing/zero step by falling back to 1', () => {
    expect(scrubInputValue({ startValue: 0, deltaPx: 5, step: 0 })).toBe(5)
    expect(scrubInputValue({ startValue: 0, deltaPx: 5, step: NaN })).toBe(5)
  })
})
