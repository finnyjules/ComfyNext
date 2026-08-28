import { describe, expect, it } from 'vitest'
import { anchorOf, cornerOf, groupScaleFactor, scaleLayerAbout, unionBox } from '../../app/lib/compositor/groupResize'

describe('unionBox', () => {
  it('AABB of member boxes', () => {
    const u = unionBox([{ cx: 100, cy: 100, w: 40, h: 20 }, { cx: 200, cy: 200, w: 60, h: 40 }])
    // box1 x[80,120] y[90,110]; box2 x[170,230] y[180,220] → union x[80,230] y[90,220]
    expect(u).toEqual({ cx: 155, cy: 155, w: 150, h: 130 })
  })
})

describe('cornerOf / anchorOf', () => {
  const box = { cx: 100, cy: 100, w: 40, h: 20 } // tl(80,90) br(120,110)
  it('cornerOf br = bottom-right', () => { expect(cornerOf(box, 'br')).toEqual({ x: 120, y: 110 }) })
  it('anchorOf br = top-left (opposite)', () => { expect(anchorOf(box, 'br', false)).toEqual({ x: 80, y: 90 }) })
  it('anchorOf with fromCenter = box center', () => { expect(anchorOf(box, 'br', true)).toEqual({ x: 100, y: 100 }) })
})

describe('groupScaleFactor', () => {
  it('diagonal ratio', () => {
    const f = groupScaleFactor({ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 500, y: 500 })
    expect(f).toBeCloseTo(2) // |(400,400)| / |(200,200)|
  })
  it('clamps to minF', () => {
    expect(groupScaleFactor({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 1, y: 1 }, 0.05)).toBeCloseTo(0.05)
  })
  it('clamps to the upper bound', () => {
    // pointer very far from anchor vs a tiny cornerStart distance → huge raw ratio, clamped to 20
    const f = groupScaleFactor({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1000, y: 0 })
    expect(f).toBe(20)
  })
})

describe('scaleLayerAbout', () => {
  const W = 1000, H = 800, anchor = { x: 100, y: 100 }, f = 2
  it('scales a rect center-about-anchor + w,h', () => {
    const p = scaleLayerAbout({ id: 'r', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.2, h: 0.1 } as any, anchor, f, W, H)
    // center px (500,400) → 100+(400)*2=900, 100+(300)*2=700 → x0.9 y0.875
    expect(p).toMatchObject({ x: 0.9, y: 0.875, w: 0.4, h: 0.2 })
  })
  it('scales a text fontSize', () => {
    const p = scaleLayerAbout({ id: 't', kind: 'text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, fontSize: 0.06 } as any, anchor, f, W, H)
    expect(p).toMatchObject({ x: 0.9, y: 0.875, fontSize: 0.12 })
  })
  it('scales a line w and a path scale', () => {
    expect(scaleLayerAbout({ id: 'l', kind: 'line', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.2 } as any, anchor, f, W, H)).toMatchObject({ w: 0.4 })
    expect(scaleLayerAbout({ id: 'p', kind: 'path', x: 0.5, y: 0.5, rotation: 0, opacity: 1, scale: 0.5 } as any, anchor, f, W, H)).toMatchObject({ scale: 1 })
  })
  // A wired layer has NO independent height — its height is `w * lastAspect`. It
  // used to fall into the rect branch, where `l.h * f` is `undefined * f` = NaN,
  // and the NaN was persisted onto the layer.
  it('scales a wired layer by width only, never writing an h', () => {
    const p = scaleLayerAbout(
      { id: 'w', kind: 'wired', slot: 0, x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.2, lastAspect: 0.75 } as any,
      anchor, f, W, H,
    )
    expect(p).toMatchObject({ x: 0.9, y: 0.875, w: 0.4 })
    expect('h' in p).toBe(false)
  })
})
