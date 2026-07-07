import { describe, expect, it } from 'vitest'
import { resizableKind, boxHandles } from '../../app/composables/useLocalLayerEditor'

describe('resizableKind', () => {
  it('is true only for box layers (rect/ellipse/image)', () => {
    for (const k of ['rect', 'ellipse', 'image']) expect(resizableKind(k)).toBe(true)
    for (const k of ['text', 'line', 'path']) expect(resizableKind(k)).toBe(false)
  })
})

describe('boxHandles', () => {
  it('returns corner handles tl/tr/br/bl, rotation handle rot, and edge midpoints t/r/b/l', () => {
    // Simple non-rotated case: center at (100, 100), half-width 50, half-height 40
    const handles = boxHandles(100, 100, 50, 40, 0)

    // Corners
    expect(handles.tl).toEqual({ x: 50, y: 60 })
    expect(handles.tr).toEqual({ x: 150, y: 60 })
    expect(handles.br).toEqual({ x: 150, y: 140 })
    expect(handles.bl).toEqual({ x: 50, y: 140 })

    // Edge midpoints
    expect(handles.t).toEqual({ x: 100, y: 60 })   // top edge center
    expect(handles.r).toEqual({ x: 150, y: 100 })  // right edge center
    expect(handles.b).toEqual({ x: 100, y: 140 })  // bottom edge center
    expect(handles.l).toEqual({ x: 50, y: 100 })   // left edge center

    // Other handles
    expect(handles.rot).toEqual({ x: 100, y: 34 })  // above top center
    expect(handles.topCenter).toEqual({ x: 100, y: 60 })
    expect(handles.center).toEqual({ x: 100, y: 100 })
  })

  it('rotates all handles correctly when rotationDeg is applied', () => {
    // 90-degree rotation: cx=100, cy=100, hw=50, hh=40, rotation=90°
    const handles = boxHandles(100, 100, 50, 40, 90)

    // After 90° rotation:
    // tl (-50, -40) → (40, -50) relative → (140, 50) absolute
    // tr (50, -40) → (40, 50) relative → (140, 150) absolute
    // Approximate due to floating point
    const eps = 0.0001
    expect(Math.abs(handles.tl.x - 140) < eps && Math.abs(handles.tl.y - 50) < eps).toBe(true)
    expect(Math.abs(handles.tr.x - 140) < eps && Math.abs(handles.tr.y - 150) < eps).toBe(true)

    // Edge midpoints should also be rotated
    // t (0, -40) → (40, 0) relative → (140, 100) absolute
    expect(Math.abs(handles.t.x - 140) < eps && Math.abs(handles.t.y - 100) < eps).toBe(true)
    // r (50, 0) → (0, 50) relative → (100, 150) absolute
    expect(Math.abs(handles.r.x - 100) < eps && Math.abs(handles.r.y - 150) < eps).toBe(true)
    // b (0, 40) → (-40, 0) relative → (60, 100) absolute
    expect(Math.abs(handles.b.x - 60) < eps && Math.abs(handles.b.y - 100) < eps).toBe(true)
    // l (-50, 0) → (0, -50) relative → (100, 50) absolute
    expect(Math.abs(handles.l.x - 100) < eps && Math.abs(handles.l.y - 50) < eps).toBe(true)
  })
})
