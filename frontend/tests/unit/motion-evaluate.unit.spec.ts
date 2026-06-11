// frontend/tests/unit/motion-evaluate.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  layerWindow, evaluateAnimation, evaluateKeyframes, IDENTITY_UNIT,
  SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS,
} from '../../app/lib/motion/evaluate'
import type { LayerAnimation } from '../../app/lib/motion/types'

const MOTION = { fps: 30, duration: 4 }

describe('layerWindow', () => {
  it('defaults to offset→frame end', () => {
    expect(layerWindow({ offset: 1 }, MOTION)).toEqual({ start: 1, end: 4 })
  })
  it('honors explicit duration and clamps to frame end', () => {
    expect(layerWindow({ offset: 1, duration: 2 }, MOTION)).toEqual({ start: 1, end: 3 })
    expect(layerWindow({ offset: 3, duration: 9 }, MOTION)).toEqual({ start: 3, end: 4 })
  })
})

describe('evaluateAnimation — phases', () => {
  const anim: LayerAnimation = {
    offset: 1,
    in: { presetId: 'fade-in', duration: 0.5, stagger: 0 },
    out: { presetId: 'fade-out', duration: 0.5, stagger: 0 },
  }
  it('invisible before its window', () => {
    expect(evaluateAnimation(anim, 0.5, MOTION, 1).visible).toBe(false)
  })
  it('mid-in: partially faded', () => {
    const st = evaluateAnimation(anim, 1.25, MOTION, 1) // halfway through fade-in
    expect(st.visible).toBe(true)
    expect(st.units![0].opacity).toBeGreaterThan(0.4)
    expect(st.units![0].opacity).toBeLessThan(1)
  })
  it('hold: identity', () => {
    const st = evaluateAnimation(anim, 2.5, MOTION, 1)
    expect(st.units![0]).toEqual(IDENTITY_UNIT)
  })
  it('out is anchored to the window end (fully gone at end)', () => {
    const st = evaluateAnimation(anim, 3.999, MOTION, 1)
    expect(st.units![0].opacity).toBeLessThan(0.05)
  })
})

describe('evaluateAnimation — stagger', () => {
  const anim: LayerAnimation = {
    offset: 0,
    in: { presetId: 'slide-up', duration: 1.0, stagger: 0.3 },
  }
  it('later units lag earlier ones', () => {
    const st = evaluateAnimation(anim, 0.35, MOTION, 3)
    expect(st.units![0].opacity).toBeGreaterThan(st.units![2].opacity)
    expect(st.units![0].dy).toBeLessThan(st.units![2].dy) // unit 0 closer to rest (dy→0)
  })
})

describe('evaluateAnimation — determinism', () => {
  it('glitch-in produces identical output for identical input', () => {
    const anim: LayerAnimation = { offset: 0, in: { presetId: 'glitch-in', duration: 1 } }
    const a = evaluateAnimation(anim, 0.2, MOTION, 5)
    const b = evaluateAnimation(anim, 0.2, MOTION, 5)
    expect(a).toEqual(b)
  })
})

describe('evaluateAnimation — loop', () => {
  it('wave oscillates and is periodic', () => {
    const anim: LayerAnimation = { offset: 0, loop: { presetId: 'wave', duration: 1, stagger: 0 } }
    const a = evaluateAnimation(anim, 0.25, MOTION, 1)
    const b = evaluateAnimation(anim, 1.25, MOTION, 1)
    expect(a.units![0].dy).toBeCloseTo(b.units![0].dy, 6)
    expect(Math.abs(a.units![0].dy)).toBeGreaterThan(0.01)
  })
})

describe('evaluateKeyframes', () => {
  // ease lives on the LO keyframe (ease INTO the next), per types.ts
  const kfs = [
    { t: 0, dx: 0, opacity: 1, ease: 'linear' as const },
    { t: 1, dx: 0.5, opacity: 0.5 },
  ]
  it('interpolates between keyframes honoring the lo ease', () => {
    expect(evaluateKeyframes(kfs, 0.2).dx).toBeCloseTo(0.1, 6)  // linear 0.2·0.5 = 0.1; easeInOutQuad(0.2)=0.08 would give 0.04
    const st = evaluateKeyframes(kfs, 0.5)
    expect(st.dx).toBeCloseTo(0.25, 6)
    expect(st.opacity).toBeCloseTo(0.75, 6)
  })
  it('defaults to easeInOut when the lo keyframe has no ease', () => {
    const noEase = [{ t: 0, dx: 0 }, { t: 1, dx: 1 }]
    expect(evaluateKeyframes(noEase, 0.2).dx).toBeCloseTo(0.08, 6) // easeInOutQuad(0.2)=2·0.2²=0.08, not linear 0.2
  })
  it('clamps outside the range', () => {
    expect(evaluateKeyframes(kfs, 5).dx).toBeCloseTo(0.5, 6)
    expect(evaluateKeyframes(kfs, -1).dx).toBeCloseTo(0, 6)
  })
})

describe('evaluateAnimation — stagger compression (C1)', () => {
  it('long text with default stagger: every unit completes within the in phase', () => {
    const anim: LayerAnimation = { offset: 0, in: { presetId: 'slide-up', duration: 1.0 } }
    const st = evaluateAnimation(anim, 0.999, MOTION, 50)
    expect(st.units![49].opacity).toBeGreaterThan(0.9)
    expect(Math.abs(st.units![49].dy)).toBeLessThan(0.05)
  })
})

describe('evaluateAnimation — in/out overlap (I1)', () => {
  it('out never starts before in finishes; handoff is continuous', () => {
    const anim: LayerAnimation = {
      offset: 0, duration: 1,
      in: { presetId: 'fade-in', duration: 0.8, stagger: 0 },
      out: { presetId: 'fade-out', duration: 0.8, stagger: 0 },
    }
    expect(evaluateAnimation(anim, 0.81, MOTION, 1).units![0].opacity).toBeGreaterThan(0.95)
    expect(evaluateAnimation(anim, 0.999, MOTION, 1).units![0].opacity).toBeLessThan(0.05)
  })
})

describe('evaluateAnimation — in→loop handoff (I2)', () => {
  it('loop starts at phase 0 when the in phase ends', () => {
    const anim: LayerAnimation = {
      offset: 0,
      in: { presetId: 'fade-in', duration: 0.7, stagger: 0 },
      loop: { presetId: 'wave', duration: 1, stagger: 0 },
    }
    expect(Math.abs(evaluateAnimation(anim, 0.7001, MOTION, 1).units![0].dy)).toBeLessThan(0.01)
  })
})

describe('evaluateAnimation — out clip sides + fallback', () => {
  it('mask-out-up clips from the bottom', () => {
    const anim: LayerAnimation = { offset: 0, duration: 1, out: { presetId: 'mask-out-up', duration: 0.5, stagger: 0 } }
    const st = evaluateAnimation(anim, 0.75, MOTION, 1)
    expect(st.units![0].clip?.side).toBe('bottom')
    expect(st.units![0].clip?.amount).toBeGreaterThan(0)
  })
  it('unknown preset ids fall back to fade behavior', () => {
    const anim: LayerAnimation = { offset: 0, in: { presetId: 'does-not-exist', duration: 0.5, stagger: 0 } }
    const st = evaluateAnimation(anim, 0.25, MOTION, 1)
    expect(st.units![0].opacity).toBeGreaterThan(0)
    expect(st.units![0].opacity).toBeLessThan(1)
  })
})

describe('supported preset id lists', () => {
  it('cover the core LIV vocabulary', () => {
    expect(SUPPORTED_IN_IDS).toContain('slide-up')
    expect(SUPPORTED_IN_IDS).toContain('mask-up')
    expect(SUPPORTED_OUT_IDS).toContain('fade-out')
    expect(SUPPORTED_LOOP_IDS).toContain('wave')
  })
})
