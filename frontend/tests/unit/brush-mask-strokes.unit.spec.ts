import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { drawLocalLayer, createRectLayer } from '../../app/composables/useCompositorLayers'
import type { PaintStroke } from '../../app/lib/compositor/brushStamp'

/**
 * Guard for Task 6 (brush "Mask mode"): a layer carrying `maskStrokes` (or a
 * `maskBase: 'hidden'`) must have its rendered pixels clipped by a stroke mask
 * that is built on its own device-sized offscreen and composited with a single
 * `destination-in` — the same isolated-offscreen recipe drawLocalLayer uses for
 * a layer-mask, so the mask aligns with the layer's pixels in device space and
 * never clips anything else on the shared context.
 *
 * Recording-stub style mirrors layer-mask-composite.unit.spec.ts, extended with
 * `arc` (drawStrokeAlpha needs it) so brush strokes can rasterize.
 */

interface RecordedOp {
  ctx: string        // which context the op ran on ('main', 'off-1', 'off-2', …)
  op: string         // method name
  composite: string  // globalCompositeOperation in effect when the op ran
}

const ops: RecordedOp[] = []

/** Canvas draw calls that rasterize pixels directly (not via another canvas). */
const PRIMITIVE_DRAWS = new Set(['fill', 'stroke', 'fillRect', 'fillText', 'strokeText'])

function recordingCtx(name: string): CanvasRenderingContext2D {
  let composite = 'source-over'
  const stack: string[] = []
  const record = (op: string) => { ops.push({ ctx: name, op, composite }) }
  const noop = () => {}
  const ctx: Record<string, unknown> = {
    canvas: { width: 100, height: 100 },
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    globalAlpha: 1,
    filter: 'none',
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    get globalCompositeOperation() { return composite },
    set globalCompositeOperation(v: string) { composite = v },
    save: () => { stack.push(composite) },
    restore: () => { composite = stack.pop() ?? 'source-over' },
    translate: noop, rotate: noop, scale: noop, setTransform: noop, transform: noop,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath: noop, rect: noop, roundRect: noop, ellipse: noop, arc: noop,
    moveTo: noop, lineTo: noop, clip: noop, clearRect: noop,
    measureText: (s: string) => ({ width: s.length * 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fill: () => record('fill'),
    stroke: () => record('stroke'),
    fillRect: () => record('fillRect'),
    fillText: () => record('fillText'),
    strokeText: () => record('strokeText'),
    drawImage: () => record('drawImage'),
  }
  return ctx as unknown as CanvasRenderingContext2D
}

let offscreenSeq = 0
function fakeCanvas() {
  offscreenSeq += 1
  const ctx = recordingCtx(`off-${offscreenSeq}`)
  return {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  }
}

beforeEach(() => {
  ops.length = 0
  offscreenSeq = 0
  vi.stubGlobal('document', { createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    return fakeCanvas()
  } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const stroke = (over: Partial<PaintStroke> = {}): PaintStroke => ({
  points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }],
  radius: 0.05, hardness: 1, opacity: 1, erase: false, ...over,
})

describe('brush mask-mode stroke masking', () => {
  const W = 100, H = 100

  it('a layer with maskStrokes composites its mask via a single destination-in drawImage', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    ;(layer as any).maskStrokes = [stroke()]
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    const underDestIn = ops.filter(o => o.composite === 'destination-in')
    expect(underDestIn.length).toBe(1)
    expect(underDestIn[0].op).toBe('drawImage')
  })

  it('the layer rasterizes on an offscreen, never on the shared main context', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    ;(layer as any).maskStrokes = [stroke()]
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    // The only op on main is the final composite of the isolated offscreen.
    const mainOps = ops.filter(o => o.ctx === 'main')
    expect(mainOps.map(o => o.op)).toEqual(['drawImage'])
    expect(mainOps[0].composite).toBe('source-over') // blend 'normal'
    // No primitive rasterization happened on main (mask never clips the shared ctx).
    expect(ops.some(o => o.ctx === 'main' && PRIMITIVE_DRAWS.has(o.op))).toBe(false)
  })

  it('no primitive draw runs under destination-in (mask stamp is a bare drawImage)', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    ;(layer as any).maskStrokes = [stroke(), stroke({ erase: true })]
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    const offenders = ops.filter(o => PRIMITIVE_DRAWS.has(o.op) && o.composite === 'destination-in')
    expect(offenders).toEqual([])
  })

  it('maskBase "hidden" with no strokes still clips via destination-in (fully hidden)', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    ;(layer as any).maskBase = 'hidden'
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    const underDestIn = ops.filter(o => o.composite === 'destination-in')
    expect(underDestIn.length).toBe(1)
    expect(underDestIn[0].op).toBe('drawImage')
  })

  it('a plain layer (no mask strokes, visible base) does not add any destination-in', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    expect(ops.some(o => o.composite === 'destination-in')).toBe(false)
  })

  // FIX #2: mask strokes are the INVERSE of paint strokes — a PLAIN (non-erase)
  // mask stroke HIDES the layer, so it must carve the mask via destination-out
  // (not be a white-on-white no-op). The outer destination-in isolation still holds.
  it('a plain mask stroke carves the mask via destination-out (brush HIDES)', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    ;(layer as any).maskStrokes = [stroke({ erase: false })]
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    // The plain stroke rasterizes as a destination-out carve on the mask offscreen.
    const carve = ops.filter(o => o.composite === 'destination-out' && PRIMITIVE_DRAWS.has(o.op))
    expect(carve.length).toBeGreaterThan(0)
    // …and the mask is still isolated onto the layer with a single destination-in drawImage.
    const underDestIn = ops.filter(o => o.composite === 'destination-in')
    expect(underDestIn.length).toBe(1)
    expect(underDestIn[0].op).toBe('drawImage')
  })

  // An ERASE mask stroke RESTORES visibility → it paints white (source-over),
  // never carves. So no destination-out primitive draw should appear for it.
  it('an erase mask stroke restores (paints white, no destination-out carve)', () => {
    const layer = createRectLayer({ fill: '#22d3ee' })
    ;(layer as any).maskStrokes = [stroke({ erase: true })]
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, W, H)
    const carve = ops.filter(o => o.composite === 'destination-out' && PRIMITIVE_DRAWS.has(o.op))
    expect(carve).toEqual([])
    // The isolation composite is still exactly one destination-in drawImage.
    const underDestIn = ops.filter(o => o.composite === 'destination-in')
    expect(underDestIn.length).toBe(1)
    expect(underDestIn[0].op).toBe('drawImage')
  })
})
