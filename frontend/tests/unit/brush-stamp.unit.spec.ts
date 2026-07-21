import { describe, it, expect } from 'vitest'
import { smoothPoints, strokeRadiusPx, stampStrokes, type PaintStroke } from '~/lib/compositor/brushStamp'

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

describe('stampStrokes composite recipe', () => {
  const s = (p: Partial<PaintStroke> = {}): PaintStroke =>
    ({ points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], radius: 0.05, hardness: 1, opacity: 0.5, erase: false, ...p })

  it('erase strokes carve with destination-out', () => {
    const { ctx, ops } = recCtx()
    // Erase never touches makeCanvas — it draws destination-out straight onto
    // the main ctx — so a canvas-shaped stub with no getContext is enough to
    // prove that path is never taken.
    stampStrokes(ctx, [s({ erase: true, opacity: 0.8 })], 100, () => recCtx().ctx.canvas as unknown as HTMLCanvasElement)
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every(o => o.composite === 'destination-out')).toBe(true)
    expect(ops.every(o => o.alpha === 0.8)).toBe(true)
  })

  it('paint strokes render to a temp canvas at full alpha, then composite it at stroke opacity', () => {
    const { ctx, ops } = recCtx()
    const temps: ReturnType<typeof recCtx>[] = []
    const make = () => {
      const rec = recCtx()
      temps.push(rec)
      return Object.assign(rec.ctx.canvas as object, { getContext: () => rec.ctx }) as unknown as HTMLCanvasElement
    }
    stampStrokes(ctx, [s({ opacity: 0.5 })], 100, make)

    // The temp canvas received the actual paint (fill/stroke) at full alpha —
    // stroke opacity is applied only when compositing the temp back, not baked
    // into the stamp itself (so a self-overlapping stroke stays uniform).
    expect(temps).toHaveLength(1)
    const tempOps = temps[0]!.ops
    expect(tempOps.length).toBeGreaterThan(0)
    expect(tempOps.every(o => o.alpha === 1)).toBe(true)

    // The main ctx only sees one drawImage of that temp, at the stroke's
    // opacity and normal (source-over) blending.
    const draw = ops.find(o => o.op === 'drawImage')
    expect(draw).toBeTruthy()
    expect(draw?.alpha).toBe(0.5)
    expect(draw?.composite).toBe('source-over')
    expect(ops.some(o => o.op === 'fill' || o.op === 'stroke')).toBe(false)
  })
})
