import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { drawLocalLayer, createRectLayer } from '../../app/composables/useCompositorLayers'
import { maskStrokeToLocal, type PaintStroke } from '../../app/lib/compositor/brushStamp'

/**
 * A mask painted onto a layer must FOLLOW the layer when it moves/rotates: mask
 * strokes are captured in the layer's LOCAL frame (maskStrokeToLocal) and the
 * renderer (applyStrokeMask) replays the layer's translate+rotate — the same
 * transform paintLayer's applyXform uses for the content — so the mask lands on
 * the same pixels as the content at any layer position.
 */

// Replay the render-side matrix (translate(x*W, y*H) → rotate) on a local-space
// width-normalized point to get back its ABSOLUTE artboard width-normalized coord.
function renderLocalPoint(
  p: { x: number; y: number },
  xf: { x: number; y: number; rotation: number },
  W: number, H: number,
): { x: number; y: number } {
  const rot = (xf.rotation || 0) * Math.PI / 180
  const cos = Math.cos(rot), sin = Math.sin(rot)
  // local (width-norm) → px in the translated/rotated space, then to artboard px
  const px = xf.x * W + (p.x * W * cos - p.y * W * sin)
  const py = xf.y * H + (p.x * W * sin + p.y * W * cos)
  return { x: px / W, y: py / W } // back to width-normalized
}

const mkStroke = (over: Partial<PaintStroke> = {}): PaintStroke => ({
  points: [{ x: 0.7, y: 0.3 }, { x: 0.8, y: 0.55 }],
  radius: 0.05, hardness: 1, opacity: 1, erase: false, ...over,
})

describe('maskStrokeToLocal round-trip', () => {
  const W = 200, H = 100, aspect = H / W // 0.5

  it('a point painted at the layer\'s current transform round-trips to the same artboard coord', () => {
    const xf = { x: 0.6, y: 0.4, rotation: 0 }
    const s = mkStroke()
    const local = maskStrokeToLocal(s, xf, aspect)
    for (let i = 0; i < s.points.length; i++) {
      const back = renderLocalPoint(local.points[i]!, xf, W, H)
      expect(back.x).toBeCloseTo(s.points[i]!.x, 6)
      expect(back.y).toBeCloseTo(s.points[i]!.y, 6)
    }
  })

  it('under rotation, the round-trip still lands on the painted coord', () => {
    const xf = { x: 0.5, y: 0.5, rotation: 37 }
    const s = mkStroke()
    const local = maskStrokeToLocal(s, xf, aspect)
    for (let i = 0; i < s.points.length; i++) {
      const back = renderLocalPoint(local.points[i]!, xf, W, H)
      expect(back.x).toBeCloseTo(s.points[i]!.x, 6)
      expect(back.y).toBeCloseTo(s.points[i]!.y, 6)
    }
  })

  it('moving the layer after capture translates the mask by the same delta', () => {
    const at = { x: 0.5, y: 0.5, rotation: 0 }
    const s = mkStroke({ points: [{ x: 0.5, y: 0.25 }] }) // painted at layer center-ish
    const local = maskStrokeToLocal(s, at, aspect)
    // Move layer +0.2 in x, -0.1 in y.
    const moved = { x: 0.7, y: 0.4, rotation: 0 }
    const back = renderLocalPoint(local.points[0]!, moved, W, H)
    expect(back.x).toBeCloseTo(0.5 + 0.2, 6)          // x follows the move
    expect(back.y).toBeCloseTo(0.25 - 0.1 * aspect, 6) // y follows (y is a fraction of H)
  })
})

// ── Render side: the mask offscreen is translated to the layer's position ──────
interface Rec { ctx: string; op: string; args: number[] }
const recs: Rec[] = []
function recordingCtx(name: string): CanvasRenderingContext2D {
  let composite = 'source-over'
  const stack: string[] = []
  const noop = () => {}
  const ctx: Record<string, unknown> = {
    canvas: { width: 100, height: 100 },
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
    globalAlpha: 1, filter: 'none', shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    get globalCompositeOperation() { return composite },
    set globalCompositeOperation(v: string) { composite = v },
    save: () => { stack.push(composite) },
    restore: () => { composite = stack.pop() ?? 'source-over' },
    translate: (x: number, y: number) => { recs.push({ ctx: name, op: 'translate', args: [x, y] }) },
    rotate: (a: number) => { recs.push({ ctx: name, op: 'rotate', args: [a] }) },
    scale: noop, setTransform: noop, transform: noop,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath: noop, rect: noop, roundRect: noop, ellipse: noop, arc: noop,
    moveTo: noop, lineTo: noop, clip: noop, clearRect: noop,
    measureText: (s: string) => ({ width: s.length * 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fill: noop, stroke: noop, fillRect: noop, fillText: noop, strokeText: noop, drawImage: noop,
  }
  return ctx as unknown as CanvasRenderingContext2D
}
let seq = 0
beforeEach(() => {
  recs.length = 0; seq = 0
  vi.stubGlobal('document', { createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    seq += 1
    const ctx = recordingCtx(`off-${seq}`)
    return { width: 0, height: 0, getContext: (k: string) => (k === '2d' ? ctx : null) }
  } })
})
afterEach(() => vi.unstubAllGlobals())

describe('applyStrokeMask follows the layer transform', () => {
  it('translates the mask offscreen to the layer position (x*W, y*H)', () => {
    const W = 100, H = 100
    const layer = createRectLayer({ fill: '#22d3ee' }) as any
    layer.x = 0.7; layer.y = 0.4
    layer.maskStrokes = [mkStroke()]
    drawLocalLayer(recordingCtx('main'), layer, W, H)
    // Some offscreen (the mask) is translated to the layer's position in artboard px.
    const translated = recs.some(r => r.op === 'translate'
      && Math.abs(r.args[0]! - 0.7 * W) < 1e-6 && Math.abs(r.args[1]! - 0.4 * H) < 1e-6)
    expect(translated).toBe(true)
  })
})
