import { describe, it, expect } from 'vitest'
import {
  isBipolar, fillOrigin, fillFraction, stepDecimals, formatValue, parseTyped, resetValue,
  nudgeValue, KEY_COARSE_STEPS,
} from '../../app/lib/studio/row'

describe('isBipolar', () => {
  it('is true only when the range crosses zero', () => {
    expect(isBipolar(-0.5, 0.5)).toBe(true)
    expect(isBipolar(0, 100)).toBe(false)
    expect(isBipolar(-10, 0)).toBe(false)
  })
})

describe('fillOrigin', () => {
  it('starts at the left for a one-sided range', () => {
    expect(fillOrigin(0, 100)).toBe(0)
  })

  it('starts where zero sits for a bipolar range', () => {
    expect(fillOrigin(-0.5, 0.5)).toBeCloseTo(0.5)
    expect(fillOrigin(-1, 3)).toBeCloseTo(0.25)
  })
})

describe('fillFraction', () => {
  it('maps the value onto 0..1', () => {
    expect(fillFraction(50, 0, 100)).toBeCloseTo(0.5)
  })

  it('clamps outside the range rather than overflowing the row', () => {
    expect(fillFraction(150, 0, 100)).toBe(1)
    expect(fillFraction(-20, 0, 100)).toBe(0)
  })

  it('reads zero for a zero-width range instead of dividing by zero', () => {
    expect(fillFraction(5, 5, 5)).toBe(0)
  })
})

describe('stepDecimals', () => {
  it('derives the decimal places from the step', () => {
    expect(stepDecimals(1)).toBe(0)
    expect(stepDecimals(0.01)).toBe(2)
    expect(stepDecimals(0.5)).toBe(1)
  })

  it('falls back to whole numbers for a missing or bad step', () => {
    expect(stepDecimals(0)).toBe(0)
    expect(stepDecimals(NaN)).toBe(0)
  })
})

describe('formatValue', () => {
  it('shows exactly as many decimals as the step implies', () => {
    expect(formatValue(0.3333, 0.01)).toBe('0.33')
    expect(formatValue(12, 1)).toBe('12')
  })
})

describe('parseTyped', () => {
  it('accepts a plain number', () => {
    expect(parseTyped('42', 0, 100, 1)).toBe(42)
  })

  it('ignores stray units someone pasted in', () => {
    expect(parseTyped('42px', 0, 100, 1)).toBe(42)
  })

  it('snaps to the step', () => {
    expect(parseTyped('0.337', 0, 1, 0.01)).toBeCloseTo(0.34)
  })

  it('clamps to the range', () => {
    expect(parseTyped('900', 0, 100, 1)).toBe(100)
    expect(parseTyped('-900', 0, 100, 1)).toBe(0)
  })

  it('rejects non-numbers rather than writing NaN into the document', () => {
    expect(parseTyped('abc', 0, 100, 1)).toBeNull()
    expect(parseTyped('', 0, 100, 1)).toBeNull()
    expect(parseTyped('   ', 0, 100, 1)).toBeNull()
  })
})

describe('nudgeValue', () => {
  const base = { min: 0, max: 100, step: 1 } as const

  it('moves one step in each direction', () => {
    expect(nudgeValue({ ...base, value: 50, direction: 1 })).toBe(51)
    expect(nudgeValue({ ...base, value: 50, direction: -1 })).toBe(49)
  })

  it('moves one STEP, not one unit, on a fractional step', () => {
    expect(nudgeValue({ value: 1, min: 0, max: 2, step: 0.05, direction: 1 })).toBeCloseTo(1.05)
    expect(nudgeValue({ value: 1, min: 0, max: 2, step: 0.05, direction: -1 })).toBeCloseTo(0.95)
  })

  it('multiplies the jump by KEY_COARSE_STEPS when coarse', () => {
    expect(nudgeValue({ ...base, value: 50, direction: 1, coarse: true })).toBe(50 + KEY_COARSE_STEPS)
    expect(nudgeValue({ ...base, value: 50, direction: -1, coarse: true })).toBe(50 - KEY_COARSE_STEPS)
    expect(nudgeValue({ value: 1, min: 0, max: 2, step: 0.05, direction: 1, coarse: true })).toBeCloseTo(1.5)
  })

  it('clamps at both ends instead of running past them', () => {
    expect(nudgeValue({ ...base, value: 100, direction: 1 })).toBe(100)
    expect(nudgeValue({ ...base, value: 0, direction: -1 })).toBe(0)
    // A coarse jump that overshoots pins to the end rather than being refused.
    expect(nudgeValue({ ...base, value: 96, direction: 1, coarse: true })).toBe(100)
    expect(nudgeValue({ ...base, value: 4, direction: -1, coarse: true })).toBe(0)
  })

  it('returns the value unchanged at an end, so the caller can skip the write', () => {
    const at = nudgeValue({ ...base, value: 100, direction: 1 })
    expect(at).toBe(100)
    expect(nudgeValue({ value: 3.14, min: -3.14, max: 3.14, step: 0.01, direction: 1 })).toBeCloseTo(3.14)
  })

  it('snaps onto the step grid from an off-step starting value', () => {
    // 0.337 + 0.01 = 0.347, which snaps to 0.35 — the same grid parseTyped enforces.
    expect(nudgeValue({ value: 0.337, min: 0, max: 1, step: 0.01, direction: 1 })).toBeCloseTo(0.35)
    expect(nudgeValue({ value: 0.337, min: 0, max: 1, step: 0.01, direction: -1 })).toBeCloseTo(0.33)
    // Off-grid on a coarse integer step: 7 - 5 = 2, which snaps to 0.
    expect(nudgeValue({ value: 7, min: 0, max: 100, step: 5, direction: -1 })).toBe(0)
    expect(nudgeValue({ value: 7, min: 0, max: 100, step: 5, direction: 1 })).toBe(10)
  })

  it('still moves when the step is missing or nonsensical', () => {
    expect(nudgeValue({ value: 5, min: 0, max: 100, step: 0, direction: 1 })).toBe(6)
    expect(nudgeValue({ value: 5, min: 0, max: 100, step: NaN, direction: -1 })).toBe(4)
  })
})

describe('resetValue', () => {
  it('prefers the declared default', () => {
    expect(resetValue({ default: 7, min: 0, max: 100 })).toBe(7)
  })

  it('falls back to zero for a bipolar range', () => {
    expect(resetValue({ min: -0.5, max: 0.5 })).toBe(0)
  })

  it('falls back to the minimum otherwise', () => {
    expect(resetValue({ min: 20, max: 100 })).toBe(20)
  })

  it('treats a declared zero default as a real default, not as absent', () => {
    expect(resetValue({ default: 0, min: 20, max: 100 })).toBe(0)
  })
})
