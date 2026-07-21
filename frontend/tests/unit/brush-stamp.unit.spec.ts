import { describe, it, expect } from 'vitest'
import { smoothPoints, strokeRadiusPx, stampStrokes, strokeBounds, brushBoxFromStrokes, type PaintStroke } from '~/lib/compositor/brushStamp'

const stroke = (p: Partial<PaintStroke> = {}): PaintStroke =>
  ({ points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], radius: 0.05, hardness: 1, opacity: 1, erase: false, ...p })

describe('smoothPoints', () => {
  it('returns the input unchanged for < 3 points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(smoothPoints(pts)).toEqual(pts)
  })
  it('produces a denser, monotonic-ish path for >= 3 points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.2 }, { x: 1, y: 0 }]
    const out = smoothPoints(pts, 6)
    expect(out.length).toBeGreaterThan(pts.length)
    expect(out[0]).toEqual(pts[0])                       // endpoints preserved
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
    for (const p of out) { expect(p.x).toBeGreaterThanOrEqual(-0.01); expect(p.x).toBeLessThanOrEqual(1.01) }
  })
})

describe('strokeRadiusPx', () => {
  it('scales width-normalized radius by base and floors at 0.5', () => {
    expect(strokeRadiusPx(stroke({ radius: 0.1 }), 1000)).toBe(100)
    expect(strokeRadiusPx(stroke({ radius: 0 }), 1000)).toBe(0.5)
  })
})

// Recording-ctx stub modeled on layer-mask-composite.unit.spec.ts: a fake 2D
// context that records every draw op with the composite mode + alpha in effect
// at call time, so we can assert stampStrokes' compositing recipe (not just
// that it calls some drawing methods).
function recCtx() {
  const ops: { op: string; composite: string; alpha: number }[] = []
  let composite = 'source-over', alpha = 1
  const g = { addColorStop() {} }
  const ctx = {
    canvas: { width: 100, height: 100 },
    get globalCompositeOperation() { return composite }, set globalCompositeOperation(v: string) { composite = v },
    get globalAlpha() { return alpha }, set globalAlpha(v: number) { alpha = v },
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() { ops.push({ op: 'fill', composite, alpha }) },
    stroke() { ops.push({ op: 'stroke', composite, alpha }) }, createRadialGradient() { return g },
    drawImage() { ops.push({ op: 'drawImage', composite, alpha }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

describe('strokeBounds', () => {
  const s = (p: Partial<PaintStroke> = {}): PaintStroke =>
    ({ points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], radius: 0.05, hardness: 1, opacity: 1, erase: false, ...p })
  const near = (b: { minX: number; minY: number; maxX: number; maxY: number }, e: number[]) => {
    expect(b.minX).toBeCloseTo(e[0]!, 6); expect(b.minY).toBeCloseTo(e[1]!, 6)
    expect(b.maxX).toBeCloseTo(e[2]!, 6); expect(b.maxY).toBeCloseTo(e[3]!, 6)
  }
  it('expands each stroke by its radius', () => near(strokeBounds([s()]), [0.15, 0.15, 0.45, 0.45]))
  it('unions multiple strokes', () => near(strokeBounds([s(), s({ points: [{ x: 0.8, y: 0.1 }], radius: 0.1 })]), [0.15, 0.0, 0.9, 0.45]))
  it('empty → zero box', () => expect(strokeBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 }))
})

describe('brushBoxFromStrokes', () => {
  const s = (p: Partial<PaintStroke> = {}): PaintStroke =>
    ({ points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], radius: 0.05, hardness: 1, opacity: 1, erase: false, ...p })
  const near = (box: { x: number; y: number; w: number; h: number }, e: number[]) => {
    expect(box.x).toBeCloseTo(e[0]!, 6); expect(box.y).toBeCloseTo(e[1]!, 6)
    expect(box.w).toBeCloseTo(e[2]!, 6); expect(box.h).toBeCloseTo(e[3]!, 6)
  }
  // bounds = 0.15..0.45 on both axes → w=h=0.3, center=0.3 (width-normalized)
  it('square artboard: y unchanged', () => near(brushBoxFromStrokes([s()], 1), [0.3, 0.3, 0.3, 0.3]))
  // center-y is 0.3 of WIDTH; on a 2:1 landscape (H = 0.5·W) that is 0.6 of HEIGHT
  it('landscape (aspect 0.5): y scaled up to fraction-of-height', () => near(brushBoxFromStrokes([s()], 0.5), [0.3, 0.6, 0.3, 0.3]))
  it('portrait (aspect 2): y scaled down', () => near(brushBoxFromStrokes([s()], 2), [0.3, 0.15, 0.3, 0.3]))
})

describe('stampStrokes composite recipe', () => {
  const s = (p: Partial<PaintStroke> = {}): PaintStroke =>
    ({ points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], radius: 0.05, hardness: 1, opacity: 0.5, erase: false, ...p })

  it('erase strokes carve with destination-out at the flow rate', () => {
    const { ctx, ops } = recCtx()
    stampStrokes(ctx, [s({ erase: true, opacity: 0.8 })], 100)
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every(o => o.composite === 'destination-out')).toBe(true)
    expect(ops.every(o => o.alpha === 0.8)).toBe(true)
  })

  it('paint strokes deposit dabs source-over at flow (build-up), never via a temp composite', () => {
    const { ctx, ops } = recCtx()
    stampStrokes(ctx, [s({ opacity: 0.5 })], 100)

    // Build-up mechanism: the stroke is laid down as MANY overlapping dab fills,
    // each composited source-over at the stroke's flow (0.5). Because the dabs
    // overlap, source-over accumulates their alpha — a self-overlapping stroke and
    // repeated passes darken toward opaque (Photoshop "Flow"), rather than clamping
    // to a flat per-stroke opacity via a single temp drawImage.
    const fills = ops.filter(o => o.op === 'fill')
    expect(fills.length).toBeGreaterThan(1)
    expect(fills.every(o => o.composite === 'source-over')).toBe(true)
    expect(fills.every(o => o.alpha === 0.5)).toBe(true)
    // No temp-canvas composite path any more.
    expect(ops.some(o => o.op === 'drawImage')).toBe(false)
  })
})
