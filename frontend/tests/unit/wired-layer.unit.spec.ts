import { describe, it, expect, afterEach } from 'vitest'
import { createWiredLayer, wiredBoxFromWidgets, widgetsFromWiredBox } from '~/lib/compositor/wiredLayer'
import {
  _registerWiredContent, localLayerBox, paintLayerStack,
  type LocalLayer, type WiredLayer,
} from '~/composables/useCompositorLayers'
import { DEFAULT_CLONER } from '~/composables/useCloner'

describe('wired layer mapping', () => {
  const natural = { w: 800, h: 600 }          // content pixels
  const canvas = { w: 1024, h: 1024 }

  it('creates a wired layer with defaults matching the old default placement', () => {
    const l = createWiredLayer(3)
    expect(l.kind).toBe('wired')
    expect(l.slot).toBe(3)
    expect(l.x).toBeCloseTo(0.5)
    expect(l.y).toBeCloseTo(0.5)
    expect(l.rotation).toBe(0)
    expect(l.opacity).toBe(1)
  })

  it('round-trips widget transform -> box -> widget transform', () => {
    const tf = { x: 0.1, y: -0.2, rotation: 15, scale: 1.5, opacity: 0.8 }
    const box = wiredBoxFromWidgets(tf, natural, canvas)
    const back = widgetsFromWiredBox({ ...createWiredLayer(0), ...box }, natural, canvas)
    expect(back.x).toBeCloseTo(tf.x, 5)
    expect(back.y).toBeCloseTo(tf.y, 5)
    expect(back.rotation).toBeCloseTo(tf.rotation, 5)
    expect(back.scale).toBeCloseTo(tf.scale, 5)
    expect(back.opacity).toBeCloseTo(tf.opacity, 5)
  })

  it('identity transform maps to the same box the old fit-draw produced', () => {
    // scale=1, x=y=0 must reproduce the legacy "fit to canvas" box so migrated
    // frames render pixel-identically.
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, natural, canvas)
    expect(box.x).toBeCloseTo(0.5)
    expect(box.y).toBeCloseTo(0.5)
    // 800x600 in 1024x1024: fit => width-limited => w = 1 (full canvas width)
    expect(box.w).toBeCloseTo(1)
  })

  it('height-limited fit matches the legacy contain math', () => {
    // 600x800 (portrait) in 1024x1024: iAspect < cAspect => height-limited, so
    // fitH = H and fitW = H * iAspect => normalized w = 0.75.
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, { w: 600, h: 800 }, canvas)
    expect(box.w).toBeCloseTo(0.75)
    expect(box.lastAspect).toBeCloseTo(800 / 600)
  })

  it('records the content aspect so the unlinked state keeps its last size', () => {
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, natural, canvas)
    expect(box.lastAspect).toBeCloseTo(600 / 800)
  })

  it('round-trips on a non-square canvas', () => {
    const wide = { w: 1920, h: 1080 }
    const tf = { x: -0.33, y: 0.07, rotation: -42, scale: 0.65, opacity: 0.4 }
    const box = wiredBoxFromWidgets(tf, natural, wide)
    const back = widgetsFromWiredBox({ ...createWiredLayer(1), ...box }, natural, wide)
    expect(back.x).toBeCloseTo(tf.x, 5)
    expect(back.y).toBeCloseTo(tf.y, 5)
    expect(back.scale).toBeCloseTo(tf.scale, 5)
  })

  it('gives each created layer a distinct id', () => {
    expect(createWiredLayer(0).id).not.toBe(createWiredLayer(0).id)
  })
})

// ── Paint dispatch (Task 2) ──────────────────────────────────────────────────
//
// These run in vitest's default `node` environment: there is no DOM and no real
// 2D context anywhere in this repo's unit suite (node-canvas is not a dependency
// and happy-dom's canvas does not rasterize), so a pixel-probe test is not
// available. The repo's existing pattern for canvas code is a stub context
// (see tests/unit/spacetype-canvas2d-branch.unit.spec.ts); this extends it into
// a RECORDING context that tracks the full affine transform stack, so what is
// asserted is the real device-space geometry of the draw — the same thing a
// pixel probe would establish — rather than the raw drawImage arguments.

interface DrawRecord { cx: number; cy: number; w: number; h: number; alpha: number; op: string; src: unknown }

/** A CanvasRenderingContext2D stand-in that tracks [a,b,c,d,e,f] through
 *  save/restore/translate/rotate/scale and records each drawImage in DEVICE space. */
function recordingCtx(devW = 100, devH = 100) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const stack: (typeof m)[] = []
  const draws: DrawRecord[] = []
  const apply = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f })
  const ctx: any = {
    canvas: { width: devW, height: devH },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() { stack.push({ ...m }) },
    restore() { const p = stack.pop(); if (p) m = p },
    translate(tx: number, ty: number) { m.e += m.a * tx + m.c * ty; m.f += m.b * tx + m.d * ty },
    scale(sx: number, sy: number) { m.a *= sx; m.b *= sx; m.c *= sy; m.d *= sy },
    rotate(r: number) {
      const cos = Math.cos(r), sin = Math.sin(r)
      const a = m.a * cos + m.c * sin, b = m.b * cos + m.d * sin
      const c = m.a * -sin + m.c * cos, d = m.b * -sin + m.d * cos
      m.a = a; m.b = b; m.c = c; m.d = d
    },
    transform() { /* skew — unused by these cases */ },
    setTransform(a: any, b?: number, c?: number, d?: number, e?: number, f?: number) {
      m = typeof a === 'object' ? { ...a } : { a, b: b!, c: c!, d: d!, e: e!, f: f! }
    },
    getTransform() { return { ...m } },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, roundRect() {},
    ellipse() {}, clip() {}, fill() {}, stroke() {}, fillRect() {}, clearRect() {},
    drawImage(src: unknown, dx: number, dy: number, dw: number, dh: number) {
      const ctr = apply(dx + dw / 2, dy + dh / 2)
      draws.push({
        cx: ctr.x, cy: ctr.y,
        w: dw * Math.hypot(m.a, m.b), h: dh * Math.hypot(m.c, m.d),
        alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation, src,
      })
    },
  }
  return { ctx: ctx as CanvasRenderingContext2D, draws }
}

/** A stand-in for the host's live content: anything with numeric width/height is a
 *  CanvasImageSource as far as the renderer is concerned. */
const content = (w: number, h: number) => ({ width: w, height: h } as unknown as CanvasImageSource)

function paint(ctx: CanvasRenderingContext2D, layer: LocalLayer, W = 100, H = 100) {
  paintLayerStack(ctx, W, H, [{ type: 'local', key: `l:${layer.id}`, layer }], [layer])
}

describe('wired layer paint dispatch', () => {
  afterEach(() => { _registerWiredContent(null) })

  const wired = (partial: Partial<WiredLayer> = {}): WiredLayer =>
    createWiredLayer(0, { x: 0.5, y: 0.5, w: 0.5, lastAspect: 0.5, ...partial })

  it('draws the registered provider content into the layer box', () => {
    _registerWiredContent(() => content(200, 100))     // 2:1 ⇒ aspect 0.5
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired())
    expect(draws).toHaveLength(1)
    // w = 0.5 * 100 = 50px; h = 50 * 0.5 = 25px; centred at (0.5*100, 0.5*100).
    expect(draws[0]!.cx).toBeCloseTo(50, 5)
    expect(draws[0]!.cy).toBeCloseTo(50, 5)
    expect(draws[0]!.w).toBeCloseTo(50, 5)
    expect(draws[0]!.h).toBeCloseTo(25, 5)
  })

  it('honours the layer centre like every other layer kind', () => {
    _registerWiredContent(() => content(200, 100))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ x: 0.25, y: 0.75 }))
    expect(draws[0]!.cx).toBeCloseTo(25, 5)
    expect(draws[0]!.cy).toBeCloseTo(75, 5)
  })

  it('draws nothing when no provider is registered', () => {
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired())
    expect(draws).toHaveLength(0)
  })

  it('draws nothing (not a placeholder) when the provider returns null', () => {
    _registerWiredContent(() => null)
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ unlinked: true }))
    expect(draws).toHaveLength(0)
  })

  it('uses the LIVE content aspect when it differs from lastAspect', () => {
    _registerWiredContent(() => content(100, 200))     // live aspect 2 …
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ lastAspect: 0.5 }))             // … stale cached aspect 0.5
    expect(draws[0]!.h).toBeCloseTo(100, 5)            // 50 * 2, not 50 * 0.5
  })

  it('does not mutate the layer while painting (paint stays pure)', () => {
    _registerWiredContent(() => content(100, 200))
    const { ctx } = recordingCtx()
    const layer = wired({ lastAspect: 0.5 })
    paint(ctx, layer)
    expect(layer.lastAspect).toBe(0.5)
  })

  it('keeps lastAspect for an unlinked layer even when live content differs', () => {
    _registerWiredContent(() => content(100, 200))     // live aspect 2
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ lastAspect: 0.5, unlinked: true }))
    expect(draws[0]!.h).toBeCloseTo(25, 5)             // 50 * 0.5 — the size the user set
  })

  it('resolves the provider on EVERY paint, so re-running upstream re-fits', () => {
    let dims = content(200, 100)
    let calls = 0
    _registerWiredContent(() => { calls++; return dims })
    const layer = wired()
    const first = recordingCtx()
    paint(first.ctx, layer)
    expect(first.draws[0]!.h).toBeCloseTo(25, 5)
    dims = content(100, 100)                            // upstream re-ran square
    const second = recordingCtx()
    paint(second.ctx, layer)
    expect(second.draws[0]!.h).toBeCloseTo(50, 5)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('folds opacity and blend through the shared LayerCommon machinery', () => {
    _registerWiredContent(() => content(200, 100))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ opacity: 0.4, blend: 'multiply' }))
    expect(draws[0]!.alpha).toBeCloseTo(0.4, 5)
    expect(draws[0]!.op).toBe('multiply')
  })

  it('rotates around the layer centre', () => {
    _registerWiredContent(() => content(200, 100))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ rotation: 90 }))
    expect(draws[0]!.cx).toBeCloseTo(50, 5)
    expect(draws[0]!.cy).toBeCloseTo(50, 5)
  })

  it('skips a hidden wired layer', () => {
    _registerWiredContent(() => content(200, 100))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ visible: false }))
    expect(draws).toHaveLength(0)
  })

  it('stamps once per clone through the shared cloner', () => {
    _registerWiredContent(() => content(200, 100))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ cloner: { ...DEFAULT_CLONER, enabled: true, countX: 3, countY: 1 } }))
    expect(draws).toHaveLength(3)
  })

  // Regression for the "resolved twice per draw" bug: paintLayer used to call the
  // wired provider once (via localLayerBox) to size a warp/DOF offscreen and again
  // (via drawLayerContent) to actually draw — separately for EVERY clone. A provider
  // that hands back a fresh surface each call (a live studio surface, not a static
  // cached image) could then size one call's dimensions and draw a differently-sized
  // one, producing a misfit warp. The corner-pin path itself needs a real 2D canvas
  // context to rasterize (this suite runs with `environment: 'node'` — no DOM, see
  // the file-level comment above), so it isn't reachable with the recordingCtx
  // stand-in; a multi-clone plain wired layer exercises the same "one resolve must
  // serve every consumer within a single paint call" contract without needing one:
  // pre-fix, each clone's draw independently re-ran the provider (N calls for N
  // clones, each potentially sized differently); post-fix, paintLayer resolves once
  // up front and threads that single result to every clone's draw.
  it('resolves the wired provider exactly once per paint, even across clones, so a provider returning different dimensions on every call cannot desync one clone from another within the same frame', () => {
    let calls = 0
    // A DIFFERENT size every call — if anything downstream re-resolved instead of
    // reusing the one paintLayer-level result, later clones would render at a
    // different size than earlier ones within this same paint.
    const sizes: [number, number][] = [[200, 100], [50, 400], [300, 30]]
    _registerWiredContent(() => content(...sizes[calls++]!))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ cloner: { ...DEFAULT_CLONER, enabled: true, countX: 3, countY: 1 } }))
    expect(draws).toHaveLength(3)
    expect(calls).toBe(1)
    const h0 = draws[0]!.h
    expect(draws[1]!.h).toBeCloseTo(h0, 5)
    expect(draws[2]!.h).toBeCloseTo(h0, 5)
  })

  it('bboxes a wired layer as w × w*lastAspect, centred', () => {
    const box = localLayerBox(null, wired({ w: 0.5, lastAspect: 0.5 }), 100, 100)
    expect(box.w).toBeCloseTo(50, 5)
    expect(box.h).toBeCloseTo(25, 5)
  })

  it('bboxes from the live aspect when the provider has fresher content', () => {
    _registerWiredContent(() => content(100, 200))
    const box = localLayerBox(null, wired({ w: 0.5, lastAspect: 0.5 }), 100, 100)
    expect(box.h).toBeCloseTo(100, 5)   // box tracks what actually paints
  })

  it('never produces NaN geometry from a degenerate aspect', () => {
    _registerWiredContent(() => content(0, 0))
    const { ctx, draws } = recordingCtx()
    paint(ctx, wired({ lastAspect: 0 }))
    const box = localLayerBox(null, wired({ lastAspect: 0 }), 100, 100)
    expect(Number.isFinite(box.h)).toBe(true)
    expect(draws).toHaveLength(0)       // zero-sized content is not drawable
  })
})
