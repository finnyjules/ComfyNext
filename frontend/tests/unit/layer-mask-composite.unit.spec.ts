import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  drawLocalLayer, createRectLayer, createTextLayer,
} from '../../app/composables/useCompositorLayers'

/**
 * Regression guard for the maskedById compositing invariant (fixed in
 * 8606432c): paintLayer() sets its own globalCompositeOperation before every
 * draw, so a mask layer must NEVER be rendered directly under a
 * 'destination-in' set by the caller — it would silently paint itself (union)
 * instead of clipping the content (intersection). The correct recipe renders
 * the mask on its own offscreen and composites it with a single bare
 * drawImage, which is the only call that may execute under 'destination-in'.
 *
 * Recording-stub style modeled on motion-text-layout.unit.spec.ts, extended
 * with a save/restore state stack so composite-op bookkeeping matches real
 * canvas semantics.
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
    translate: noop, rotate: noop, scale: noop, setTransform: noop,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath: noop, rect: noop, roundRect: noop, ellipse: noop,
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
const ctxOwners = new Map<string, CanvasRenderingContext2D>()

function fakeCanvas() {
  offscreenSeq += 1
  const name = `off-${offscreenSeq}`
  const ctx = recordingCtx(name)
  ctxOwners.set(name, ctx)
  return {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  }
}

beforeEach(() => {
  ops.length = 0
  offscreenSeq = 0
  ctxOwners.clear()
  // drawLocalLayer's mask path creates offscreens via document.createElement.
  vi.stubGlobal('document', { createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    return fakeCanvas()
  } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('drawLocalLayer maskedById compositing invariant', () => {
  const W = 100, H = 100

  function drawMaskedPair() {
    const mask = createTextLayer({ text: 'AB', color: '#ffffff' })
    const content = createRectLayer({ fill: '#22d3ee' })
    content.maskedById = mask.id
    const main = recordingCtx('main')
    drawLocalLayer(main, content, W, H, mask)
    return { mask, content }
  }

  it('the ONLY operation under destination-in is a single drawImage', () => {
    drawMaskedPair()
    const underDestIn = ops.filter(o => o.composite === 'destination-in')
    expect(underDestIn.length).toBe(1)
    expect(underDestIn[0].op).toBe('drawImage')
  })

  it('no primitive draw runs under any non-source-over composite op', () => {
    drawMaskedPair()
    // The bug class: mask (or content) glyph/shape rasterization happening
    // while a Porter-Duff op like destination-in is current. Primitive draws
    // are only legitimate under source-over here (layer blend is 'normal').
    const offenders = ops.filter(o => PRIMITIVE_DRAWS.has(o.op) && o.composite !== 'source-over')
    expect(offenders).toEqual([])
  })

  it('mask and content rasterize on separate offscreens', () => {
    drawMaskedPair()
    const rectFillCtxs = new Set(ops.filter(o => o.op === 'fill').map(o => o.ctx))
    const textFillCtxs = new Set(ops.filter(o => o.op === 'fillText').map(o => o.ctx))
    expect(rectFillCtxs.size).toBeGreaterThan(0)  // content rect drew somewhere
    expect(textFillCtxs.size).toBeGreaterThan(0)  // mask text drew somewhere
    for (const c of rectFillCtxs) expect(textFillCtxs.has(c)).toBe(false)
    // And neither rasterized on the main context — both are offscreen-isolated.
    expect(rectFillCtxs.has('main')).toBe(false)
    expect(textFillCtxs.has('main')).toBe(false)
  })

  it('the main context receives exactly one drawImage (the final composite) under the layer blend op', () => {
    drawMaskedPair()
    const mainOps = ops.filter(o => o.ctx === 'main')
    expect(mainOps.map(o => o.op)).toEqual(['drawImage'])
    expect(mainOps[0].composite).toBe('source-over') // blend 'normal'
  })

  it('a non-normal layer blend reaches the final composite, not the mask step', () => {
    const mask = createTextLayer({ text: 'AB' })
    const content = createRectLayer({ fill: '#22d3ee', blend: 'multiply' })
    content.maskedById = mask.id
    const main = recordingCtx('main')
    drawLocalLayer(main, content, W, H, mask)
    const mainOps = ops.filter(o => o.ctx === 'main')
    expect(mainOps.map(o => o.op)).toEqual(['drawImage'])
    expect(mainOps[0].composite).toBe('multiply')
    // (paintLayer rasterizes the CONTENT under its own blend op inside the
    // offscreen — documented as a no-op against transparency — so we don't
    // assert on that.) The MASK, however, must rasterize purely: its alpha is
    // the clip, so any blend/Porter-Duff op during its draws is a bug.
    const maskCtx = ops.find(o => o.op === 'fillText')!.ctx
    const maskDraws = ops.filter(o => o.ctx === maskCtx && PRIMITIVE_DRAWS.has(o.op))
    expect(maskDraws.length).toBeGreaterThan(0)
    for (const d of maskDraws) expect(d.composite).toBe('source-over')
  })
})
