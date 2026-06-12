import { describe, it, expect } from 'vitest'
import {
  MIN_SCALE, MAX_SCALE, clampScale, identityView, screenToNorm, normToScreen, zoomAt,
} from '~/lib/stageView'

const RW = 400, RH = 300

describe('stageView', () => {
  it('clamps scale to [MIN, MAX]', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(100)).toBe(MAX_SCALE)
    expect(clampScale(1)).toBe(1)
  })

  it('identity view maps norm→screen 1:1', () => {
    const v = identityView()
    expect(normToScreen(0.5, 0.5, RW, RH, v)).toEqual({ sx: 200, sy: 150 })
  })

  it('screenToNorm is the inverse of normToScreen (identity)', () => {
    const v = identityView()
    const s = normToScreen(0.25, 0.75, RW, RH, v)
    const n = screenToNorm(s.sx, s.sy, RW, RH, v)
    expect(n.nx).toBeCloseTo(0.25)
    expect(n.ny).toBeCloseTo(0.75)
  })

  it('screenToNorm inverts normToScreen under zoom + pan', () => {
    const v = { scale: 2.5, tx: -130, ty: 40 }
    const s = normToScreen(0.4, 0.6, RW, RH, v)
    const n = screenToNorm(s.sx, s.sy, RW, RH, v)
    expect(n.nx).toBeCloseTo(0.4)
    expect(n.ny).toBeCloseTo(0.6)
  })

  it('zoomAt keeps the anchor screen point fixed', () => {
    const v = identityView()
    const ax = 120, ay = 90
    const before = screenToNorm(ax, ay, RW, RH, v)
    const z = zoomAt(v, 2, ax, ay)
    const after = screenToNorm(ax, ay, RW, RH, z)
    expect(after.nx).toBeCloseTo(before.nx)
    expect(after.ny).toBeCloseTo(before.ny)
    expect(z.scale).toBe(2)
  })

  it('zoomAt respects the scale clamp', () => {
    const v = { scale: MAX_SCALE, tx: 0, ty: 0 }
    expect(zoomAt(v, 4, 0, 0).scale).toBe(MAX_SCALE)
  })
})
