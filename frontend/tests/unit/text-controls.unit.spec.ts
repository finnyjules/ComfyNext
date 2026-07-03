import { describe, it, expect, beforeEach } from 'vitest'
import { drawLocalLayer, createTextLayer, type TextLayer } from '../../app/composables/useCompositorLayers'

/**
 * Text layer typography controls: letter-spacing (tracking), case transform,
 * and underline / strikethrough decorations. All are optional and absent ⇒
 * byte-identical to the pre-feature render, so the "off" cases assert no extra
 * work happens. Uses a recording-stub 2D context (same approach as
 * layer-mask-composite.unit.spec.ts) since rendering is pure canvas.
 */

interface FillTextOp { op: 'fillText' | 'strokeText'; text: string; x: number; y: number }
interface FillRectOp { op: 'fillRect'; x: number; y: number; w: number; h: number }
type Op = FillTextOp | FillRectOp

let ops: Op[] = []
let lastLetterSpacing = ''

function recordingCtx(): CanvasRenderingContext2D {
  const noop = () => {}
  const ctx: Record<string, unknown> = {
    canvas: { width: 100, height: 100 },
    font: '',
    letterSpacing: '',   // presence makes `'letterSpacing' in ctx` true
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, transform: noop, setTransform: noop,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath: noop, rect: noop, roundRect: noop, ellipse: noop,
    moveTo: noop, lineTo: noop, clip: noop, clearRect: noop,
    measureText: (s: string) => ({ width: s.length * 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fill: noop, stroke: noop,
    fillText: (text: string, x: number, y: number) => ops.push({ op: 'fillText', text, x, y }),
    strokeText: (text: string, x: number, y: number) => ops.push({ op: 'strokeText', text, x, y }),
    fillRect: (x: number, y: number, w: number, h: number) => ops.push({ op: 'fillRect', x, y, w, h }),
    drawImage: noop,
  }
  // Track the letterSpacing that was in effect at draw time.
  Object.defineProperty(ctx, 'letterSpacing', {
    get() { return lastLetterSpacing },
    set(v: string) { lastLetterSpacing = v },
    configurable: true,
  })
  return ctx as unknown as CanvasRenderingContext2D
}

const W = 1000, H = 1000

function draw(partial: Partial<TextLayer>) {
  const layer = createTextLayer({ text: 'hi', color: '#ffffff', ...partial })
  drawLocalLayer(recordingCtx(), layer, W, H)
  return layer
}

beforeEach(() => { ops = []; lastLetterSpacing = '' })

describe('letter spacing', () => {
  it('sets ctx.letterSpacing to em × fontSize × W', () => {
    draw({ fontSize: 0.1, letterSpacing: 0.2 }) // 0.2em of 0.1*1000 = 100px → 20px
    expect(lastLetterSpacing).toBe('20px')
  })
  it('resets to 0px when unset (never leaks from a prior layer)', () => {
    lastLetterSpacing = '99px'
    draw({ fontSize: 0.1 })
    expect(lastLetterSpacing).toBe('0px')
  })
})

describe('case transform', () => {
  it('uppercases the drawn glyphs but not the stored text', () => {
    const layer = draw({ text: 'hello', textTransform: 'uppercase' })
    expect(layer.text).toBe('hello') // stored text untouched — round-trips through editing
    expect(ops.find(o => o.op === 'fillText')).toMatchObject({ text: 'HELLO' })
  })
  it('lowercases', () => {
    draw({ text: 'HELLO', textTransform: 'lowercase' })
    expect(ops.find(o => o.op === 'fillText')).toMatchObject({ text: 'hello' })
  })
  it('capitalizes each word', () => {
    draw({ text: 'hello world', textTransform: 'capitalize' })
    expect(ops.find(o => o.op === 'fillText')).toMatchObject({ text: 'Hello World' })
  })
  it('renders verbatim when unset', () => {
    draw({ text: 'MixedCase' })
    expect(ops.find(o => o.op === 'fillText')).toMatchObject({ text: 'MixedCase' })
  })
})

describe('decorations', () => {
  it('draws no decoration rects by default', () => {
    draw({ text: 'hi' })
    expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(0)
  })
  it('draws one underline rect per non-empty line', () => {
    draw({ text: 'a\nb', underline: true })
    expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(2)
  })
  it('draws underline below the baseline and strikethrough near the middle', () => {
    // Single line centered at y=0 (textBaseline middle, one line). fontPx = 100.
    draw({ text: 'a', fontSize: 0.1, underline: true, strikethrough: true })
    const rects = ops.filter((o): o is FillRectOp => o.op === 'fillRect')
    expect(rects).toHaveLength(2)
    const underline = rects.find(r => r.y > 10)!
    const strike = rects.find(r => Math.abs(r.y) < 10)!
    expect(underline.y).toBeGreaterThan(strike.y) // underline sits lower than strike
  })
  it('skips decoration on empty lines', () => {
    draw({ text: 'a\n\nb', underline: true })
    expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(2) // only the two non-empty lines
  })
})
