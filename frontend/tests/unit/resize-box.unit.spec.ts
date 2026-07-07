import { describe, expect, it } from 'vitest'
import { resizeBox } from '../../app/lib/compositor/resizeBox'

const START = { cx: 100, cy: 100, w: 40, h: 20 } // left=80 right=120 top=90 bottom=110

describe('resizeBox — unrotated', () => {
  it('right edge: widens right, left edge fixed, center shifts +x by Δw/2', () => {
    const r = resizeBox(START, 0, 'r', { x: 120, y: 100 }, { x: 130, y: 100 })
    expect(r).toMatchObject({ cx: 105, cy: 100, w: 50, h: 20 })
  })
  it('bottom edge: taller down, center shifts +y', () => {
    const r = resizeBox(START, 0, 'b', { x: 100, y: 110 }, { x: 100, y: 118 })
    expect(r).toMatchObject({ cx: 100, cy: 104, w: 40, h: 28 })
  })
  it('bottom-right corner: both dims grow, opposite (top-left) corner fixed', () => {
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 120 })
    expect(r).toMatchObject({ cx: 105, cy: 105, w: 50, h: 30 })
  })
  it('corner + alt (from center): both edges move, center fixed', () => {
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 120 }, { fromCenter: true })
    expect(r).toMatchObject({ cx: 100, cy: 100, w: 60, h: 40 })
  })
  it('corner + aspect (shift): keeps 2:1 ratio, driven by dominant axis', () => {
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 112 }, { aspect: true })
    // rawW=50, rawH=22 → scale=max(50/40,22/20)=1.25 → w=50,h=25, shift=(5,2.5)
    expect(r).toMatchObject({ cx: 105, cy: 102.5, w: 50, h: 25 })
  })
  it('clamps to min size instead of flipping', () => {
    const r = resizeBox(START, 0, 'r', { x: 120, y: 100 }, { x: 20, y: 100 }, {}, 2)
    expect(r.w).toBe(2)
  })
  it('alt + shift corner (from center, aspect): scale from unclamped dims, center fixed', () => {
    // rw=40+2*10=60, rh=20+2*2=24, scale=max(60/40,24/20)=1.5 → w=60,h=30
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 112 }, { aspect: true, fromCenter: true })
    expect(r).toMatchObject({ cx: 100, cy: 100, w: 60, h: 30 })
  })
  it('edge + shift is a no-op vs edge alone (aspect only affects corners)', () => {
    const plain = resizeBox(START, 0, 'r', { x: 120, y: 100 }, { x: 130, y: 100 })
    const shifted = resizeBox(START, 0, 'r', { x: 120, y: 100 }, { x: 130, y: 100 }, { aspect: true })
    expect(shifted).toMatchObject(plain)
  })
})

describe('resizeBox — rotated 90°', () => {
  it('right edge with world-down drag maps to local +x (width), center moves world-down', () => {
    const r = resizeBox(START, 90, 'r', { x: 100, y: 100 }, { x: 100, y: 110 })
    // localDelta = rot((0,10),-90) = (10,0) → w=50; localShift=(5,0) → worldShift=rot((5,0),90)=(0,5)
    expect(r.w).toBeCloseTo(50); expect(r.h).toBeCloseTo(20)
    expect(r.cx).toBeCloseTo(100); expect(r.cy).toBeCloseTo(105)
  })
})
