import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBrushLayer, drawLocalLayer } from '~/composables/useCompositorLayers'

// Recording canvas + document.createElement stub, modeled on layer-mask-composite.unit.spec.ts.
const ops: { ctx: string; op: string; composite: string }[] = []
function recordingCtx(name: string) {
  let composite = 'source-over'
  const g = { addColorStop() {} }
  return {
    canvas: { width: 200, height: 200 },
    get globalCompositeOperation() { return composite }, set globalCompositeOperation(v: string) { composite = v },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    getTransform: () => ({}), setTransform() {}, save() {}, restore() {}, translate() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, roundRect() {}, ellipse() {},
    fill() { ops.push({ ctx: name, op: 'fill', composite }) },
    stroke() { ops.push({ ctx: name, op: 'stroke', composite }) },
    fillRect() { ops.push({ ctx: name, op: 'fillRect', composite }) },
    createRadialGradient() { return g }, createLinearGradient() { return g }, createPattern() { return g },
    drawImage() { ops.push({ ctx: name, op: 'drawImage', composite }) },
  } as unknown as CanvasRenderingContext2D
}
let seq = 0
beforeEach(() => {
  ops.length = 0; seq = 0
  vi.stubGlobal('document', { createElement: () => { const n = `off-${++seq}`; const c: any = { width: 0, height: 0 }; c.getContext = () => recordingCtx(n); return c } })
})
afterEach(() => vi.unstubAllGlobals())

describe('brush layer render', () => {
  it('stamps strokes then source-in fills, drawn to the main ctx', () => {
    const layer = createBrushLayer({ strokes: [{ points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }], radius: 0.05, hardness: 1, opacity: 1, erase: false }], fill: '#ff0000' })
    const main = recordingCtx('main')
    drawLocalLayer(main, layer, 200, 200)
    // The offscreen fill uses source-in (fill clipped to painted alpha)…
    expect(ops.some(o => o.op === 'fillRect' && o.composite === 'source-in')).toBe(true)
    // …and the composed offscreen is drawn onto the main ctx.
    expect(ops.some(o => o.ctx === 'main' && o.op === 'drawImage')).toBe(true)
  })
  it('empty strokes draw nothing', () => {
    const layer = createBrushLayer({ strokes: [] })
    drawLocalLayer(recordingCtx('main'), layer, 200, 200)
    expect(ops.some(o => o.ctx === 'main' && o.op === 'drawImage')).toBe(false)
  })
})
