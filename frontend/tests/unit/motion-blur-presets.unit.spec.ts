// frontend/tests/unit/motion-blur-presets.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, evaluateAnimation } from '~/lib/motion/evaluate'
import type { UnitState } from '~/lib/motion/evaluate'
import { KINETIC_PRESETS_BY_ID } from '~/data/kinetic-presets'
import type { FrameMotion } from '~/lib/motion/types'

const MOTION: FrameMotion = { fps: 30, duration: 4 }

/** Sample the IN phase. Stagger + n=2 gives unit 0 an evaluation window that
 *  CLOSES BEFORE the phase does, so `e === 1` is reachable while the in-branch
 *  is still the one running — the only way to assert the endpoint value
 *  (at tIn >= inDur the engine returns the frozen IDENTITY_UNIT instead). */
function inUnits(presetId: string, tIn: number, duration = 0.5, stagger = 0.2, n = 2): UnitState[] {
  return evaluateAnimation({ offset: 0, in: { presetId, duration, stagger } }, tIn, MOTION, n).units!
}
/** Same trick for the OUT phase, which is anchored to the window end. */
function outUnits(presetId: string, tOut: number, duration = 0.5, stagger = 0.2, n = 2): UnitState[] {
  const anim = { offset: 0, duration, out: { presetId, duration, stagger } }
  return evaluateAnimation(anim, tOut, MOTION, n).units!
}

describe('blur presets — registration and catalog', () => {
  it('are registered in the engine tables', () => {
    expect(SUPPORTED_IN_IDS).toContain('blur-in')
    expect(SUPPORTED_IN_IDS).toContain('blur-slide-up')
    expect(SUPPORTED_OUT_IDS).toContain('blur-out')
  })
  it('reuse the existing catalog ids, and blur-slide-up has its own entry', () => {
    for (const id of ['blur-in', 'blur-slide-up', 'blur-out']) {
      const p = KINETIC_PRESETS_BY_ID[id]
      expect(p, id).toBeTruthy()
      expect(p.group, id).toBe('blur')
      expect(p.label.length, id).toBeGreaterThan(0)
    }
    expect(KINETIC_PRESETS_BY_ID['blur-slide-up'].category).toBe('in')
    // Canvas-native: no GSAP builder (the legacy blur builders stay untouched).
    expect(KINETIC_PRESETS_BY_ID['blur-slide-up'].build).toBeUndefined()
    expect(KINETIC_PRESETS_BY_ID['blur-in'].build).toBeTypeOf('function')
  })
})

describe('blur round-trips through evaluateAnimation', () => {
  it('the field a preset returns survives the evaluator untouched', () => {
    const mid = inUnits('blur-in', 0.1)[0]
    expect(mid.blur).toBeTypeOf('number')
    expect(mid.blur!).toBeGreaterThan(0)
    // Other fields keep their meaning alongside it.
    expect(mid.opacity).toBeGreaterThan(0)
    expect(mid.opacity).toBeLessThan(1)
  })
})

describe('blur-in', () => {
  it('starts blurred and decays monotonically', () => {
    const early = inUnits('blur-in', 0.02)[0].blur!
    const late = inUnits('blur-in', 0.2)[0].blur!
    expect(early).toBeGreaterThan(late)
    expect(late).toBeGreaterThan(0)
  })
  it('reaches EXACTLY zero blur at e === 1 (an entrance must end sharp)', () => {
    // unit 0's window is [0, 0.3]; sample past it but inside the 0.5s phase.
    const end = inUnits('blur-in', 0.4)[0]
    expect(end.blur).toBe(0)
    expect(end.opacity).toBe(1)
  })
  it('is sharp during the hold that follows the phase', () => {
    const hold = inUnits('blur-in', 1.2)[0]
    expect(hold.blur ?? 0).toBe(0)
  })
})

describe('blur-slide-up', () => {
  it('both moves and blurs mid-flight', () => {
    const mid = inUnits('blur-slide-up', 0.08)[0]
    expect(Math.abs(mid.dy)).toBeGreaterThan(0.01)   // rising from below
    expect(mid.dy).toBeGreaterThan(0)                // same sign as slide-up
    expect(mid.blur!).toBeGreaterThan(0)
  })
  it('lands at rest AND sharp', () => {
    const end = inUnits('blur-slide-up', 0.4)[0]
    expect(end.dy).toBe(0)
    expect(end.blur).toBe(0)
  })
})

describe('blur-out', () => {
  it('starts sharp and ends blurred', () => {
    const start = outUnits('blur-out', 0.001)[0].blur!
    const end = outUnits('blur-out', 0.4)[0].blur!
    expect(start).toBeLessThan(0.01)
    expect(end).toBeGreaterThan(start)
    expect(end).toBeGreaterThan(0.1)
    expect(outUnits('blur-out', 0.4)[0].opacity).toBe(0)
  })
})

describe('blur units', () => {
  it('is expressed in unit-box heights, not absolute px', () => {
    // A px-valued preset would peak around 8-12; unit-box values are fractions
    // of the glyph box, so every sample must stay well under 1.
    const samples = [
      ...[0.02, 0.1, 0.2, 0.4].map(t => inUnits('blur-in', t)[0].blur!),
      ...[0.02, 0.1, 0.2, 0.4].map(t => inUnits('blur-slide-up', t)[0].blur!),
      ...[0.02, 0.1, 0.2, 0.4].map(t => outUnits('blur-out', t)[0].blur!),
    ]
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0.5)
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.05)  // …but not vanishingly small
  })
})
