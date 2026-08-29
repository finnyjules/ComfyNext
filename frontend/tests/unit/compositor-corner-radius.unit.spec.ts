import { describe, it, expect } from 'vitest'
import {
  cornerRadii, createRectLayer, shapeToPathLayer, paintLayerStack,
  type LocalLayer, type RectLayer,
} from '~/composables/useCompositorLayers'

describe('cornerRadii', () => {
  it('expands a plain number to four equal corners (the pre-existing uniform case)', () => {
    expect(cornerRadii(0.1, 1, 1)).toEqual([0.1, 0.1, 0.1, 0.1])
  })

  it('passes a four-tuple through in [tl, tr, br, bl] order', () => {
    expect(cornerRadii([0.01, 0.02, 0.03, 0.04], 1, 1)).toEqual([0.01, 0.02, 0.03, 0.04])
  })

  it('scales into the caller units (stored radius is width-normalized)', () => {
    expect(cornerRadii(0.1, 100, 100, 100)).toEqual([10, 10, 10, 10])
    expect(cornerRadii([0.1, 0.2, 0, 0], 100, 100, 100)).toEqual([10, 20, 0, 0])
  })

  it('clamps every corner to half the SHORTER side', () => {
    // 200x40 box: no corner may exceed 20.
    expect(cornerRadii(1, 200, 40, 100)).toEqual([20, 20, 20, 20])
    expect(cornerRadii([0.05, 1, 0.5, 0], 200, 40, 100)).toEqual([5, 20, 20, 0])
  })

  it('treats 0, negatives and non-finite values as square corners', () => {
    expect(cornerRadii(0, 100, 100, 100)).toEqual([0, 0, 0, 0])
    expect(cornerRadii(-0.5, 100, 100, 100)).toEqual([0, 0, 0, 0])
    expect(cornerRadii([-1, NaN, Infinity, 0.1], 100, 100, 100)).toEqual([0, 0, 0, 10])
  })

  it('degrades a missing radius and a degenerate box to zero', () => {
    expect(cornerRadii(undefined, 100, 100, 100)).toEqual([0, 0, 0, 0])
    expect(cornerRadii(0.5, 0, 0, 100)).toEqual([0, 0, 0, 0])
  })

  it('is pure — it never mutates the tuple it was handed', () => {
    const r: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5]
    cornerRadii(r, 100, 40, 100)
    expect(r).toEqual([0.5, 0.5, 0.5, 0.5])
  })
})

// ── Paint ────────────────────────────────────────────────────────────────────
//
// Same recording-context approach as tests/unit/wired-layer.unit.spec.ts (no DOM
// and no rasterizing canvas in this suite): the stub records the roundRect call
// the shared draw makes, which IS the geometry a pixel probe would establish.

function radiusRecorder() {
  const calls: { x: number; y: number; w: number; h: number; r: unknown }[] = []
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, transform() {},
    setTransform() {}, getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, ellipse() {},
    clip() {}, fill() {}, stroke() {}, fillRect() {}, clearRect() {}, drawImage() {},
    roundRect(x: number, y: number, w: number, h: number, r: unknown) { calls.push({ x, y, w, h, r }) },
  }
  return { ctx: ctx as CanvasRenderingContext2D, calls }
}

function paint(layer: LocalLayer, W = 100, H = 100) {
  const { ctx, calls } = radiusRecorder()
  paintLayerStack(ctx, W, H, [{ type: 'local', key: `l:${layer.id}`, layer }], [layer])
  return calls
}

describe('rect paint — per-corner radius', () => {
  const rect = (partial: Partial<RectLayer> = {}) =>
    createRectLayer({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, fill: '#fff', ...partial })

  it('draws a uniform rect with four equal radii', () => {
    const calls = paint(rect({ radius: 0.1 }))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.r).toEqual([10, 10, 10, 10])   // 0.1 * W(100)
  })

  it('draws four DIFFERENT corners from a tuple', () => {
    const calls = paint(rect({ radius: [0.01, 0.05, 0.1, 0] }))
    expect(calls[0]!.r).toEqual([1, 5, 10, 0])
  })

  it('clamps the drawn corners to half the shorter side', () => {
    // 0.5 * 100 = 50 wide, 0.2 * 100 = 20 tall ⇒ cap 10.
    const calls = paint(rect({ h: 0.2, radius: [0.4, 0.02, 0.4, 0] }))
    expect(calls[0]!.r).toEqual([10, 2, 10, 0])
  })
})

describe('shapeToPathLayer — rect corners', () => {
  it('keeps the square-corner path curve-free', () => {
    const p = shapeToPathLayer(createRectLayer({ w: 0.4, h: 0.2, radius: 0 }))!
    expect(p.d).not.toContain('Q')
  })

  it('emits one arc per rounded corner and none for the square ones', () => {
    const p = shapeToPathLayer(createRectLayer({ w: 0.4, h: 0.2, radius: [0.05, 0, 0.05, 0] }))!
    expect(p.d.match(/Q/g) ?? []).toHaveLength(2)
  })

  it('produces the same path data for a uniform tuple as for the equivalent number', () => {
    const asNumber = shapeToPathLayer(createRectLayer({ w: 0.4, h: 0.2, radius: 0.03 }))!
    const asTuple = shapeToPathLayer(createRectLayer({ w: 0.4, h: 0.2, radius: [0.03, 0.03, 0.03, 0.03] }))!
    expect(asTuple.d).toBe(asNumber.d)
  })
})
