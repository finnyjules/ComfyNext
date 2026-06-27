import { describe, it, expect } from 'vitest'
import { sceneBlend, holdFraction, parseEase, bezierEase } from '../../app/lib/spacetype/motion'

const LINEAR: [number, number, number, number] = [0, 0, 1, 1]

describe('motion timing (scene-sequenced model)', () => {
  it('holdFraction splits a beat by relative weights', () => {
    expect(holdFraction(3, 1)).toBeCloseTo(0.75)
    expect(holdFraction(0, 1)).toBeCloseTo(0)
    expect(holdFraction(1, 0)).toBeGreaterThan(0.98) // transition clamped to a tiny minimum (never /0)
  })

  it('parseEase falls back to ease-in-out on junk', () => {
    expect(parseEase('[0.1,0.2,0.3,0.4]')).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(parseEase('nope')).toEqual([0.42, 0, 0.58, 1])
    expect(parseEase('[1,2,3]')).toEqual([0.42, 0, 0.58, 1])
  })

  it('bezierEase pins endpoints and is monotonic-ish', () => {
    expect(bezierEase(0, LINEAR)).toBe(0)
    expect(bezierEase(1, LINEAR)).toBe(1)
    expect(bezierEase(0.5, LINEAR)).toBeCloseTo(0.5, 2)
  })

  it('static freezes on scene 0', () => {
    expect(sceneBlend(0.37, 4, 0.5, LINEAR, true)).toEqual({ cur: 0, nxt: 0, e: 0 })
  })

  it('fewer than 2 scenes freezes on scene 0', () => {
    expect(sceneBlend(0.9, 1, 0.5, LINEAR, false)).toEqual({ cur: 0, nxt: 0, e: 0 })
  })

  it('cycles scenes over the loop and wraps the last->first', () => {
    // 4 scenes, hold 0 (transition fills the whole beat), linear ease.
    expect(sceneBlend(0.0, 4, 0, LINEAR, false)).toMatchObject({ cur: 0, nxt: 1 })
    const mid = sceneBlend(0.125, 4, 0, LINEAR, false) // halfway through beat 0
    expect(mid.cur).toBe(0); expect(mid.nxt).toBe(1); expect(mid.e).toBeCloseTo(0.5, 1)
    const last = sceneBlend(0.95, 4, 0, LINEAR, false)  // in the final beat
    expect(last.cur).toBe(3); expect(last.nxt).toBe(0)  // wraps back to scene 0
  })

  it('holds (e=0) during the hold phase, then eases', () => {
    // hold 0.5 of each beat. Beat 0 spans t01 [0,0.5) for 2 scenes.
    expect(sceneBlend(0.1, 2, 0.5, LINEAR, false).e).toBe(0)   // within hold
    expect(sceneBlend(0.4, 2, 0.5, LINEAR, false).e).toBeGreaterThan(0) // in transition
  })
})
