import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  strokeDashSegments, strokeAlignOf, strokeAligned, outsideStrokePadPx, paintLayerStack,
  createRectLayer, createLineLayer, createPathLayer,
  type LocalLayer, type RectLayer, type LineLayer, type CornerPin,
} from '~/composables/useCompositorLayers'

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('strokeDashSegments', () => {
  it('is null (solid) for an absent or malformed dash', () => {
    expect(strokeDashSegments(undefined)).toBeNull()
    expect(strokeDashSegments(null)).toBeNull()
    expect(strokeDashSegments({ dash: 0, gap: 0.02 })).toBeNull()
    expect(strokeDashSegments({ dash: -1, gap: 0.02 })).toBeNull()
    expect(strokeDashSegments({ dash: NaN, gap: 0.02 })).toBeNull()
    expect(strokeDashSegments({ dash: 'x', gap: 1 } as any)).toBeNull()
  })

  it('scales both segments by the caller unit (width-normalized storage)', () => {
    expect(strokeDashSegments({ dash: 0.02, gap: 0.01 }, 100)).toEqual([2, 1])
    expect(strokeDashSegments({ dash: 0.02, gap: 0.01 })).toEqual([0.02, 0.01])
  })

  it('clamps a bad gap to zero rather than dropping the dash', () => {
    expect(strokeDashSegments({ dash: 0.02, gap: -5 }, 100)).toEqual([2, 0])
    expect(strokeDashSegments({ dash: 0.02, gap: NaN }, 100)).toEqual([2, 0])
  })
})

describe('strokeAlignOf', () => {
  it('passes the two real alignments through', () => {
    expect(strokeAlignOf('inside')).toBe('inside')
    expect(strokeAlignOf('outside')).toBe('outside')
  })
  it('falls back to center for absent or unrecognized values', () => {
    expect(strokeAlignOf(undefined)).toBe('center')
    expect(strokeAlignOf('center')).toBe('center')
    expect(strokeAlignOf('middle')).toBe('center')
  })
})

// An outside-aligned stroke paints entirely beyond localLayerBox's plain w×h (see
// the box's own "no stroke padding" comment) — the corner-pin offscreen has to be
// padded by exactly this much, and only in this one case, or it clips the stroke
// away (center/inside) or shrinks a byte-identical no-stroke box (everything else).
describe('outsideStrokePadPx', () => {
  it('is 0 for a rect with no stroke at all', () => {
    const l = createRectLayer({ stroke: '', strokeWidth: 0.1, strokeAlign: 'outside' })
    expect(outsideStrokePadPx(l, 200)).toBe(0)
  })

  it('is 0 for a rect with a zero-width stroke', () => {
    const l = createRectLayer({ stroke: '#fff', strokeWidth: 0, strokeAlign: 'outside' })
    expect(outsideStrokePadPx(l, 200)).toBe(0)
  })

  it('is 0 for center and inside alignment — those stay exactly as before', () => {
    const center = createRectLayer({ stroke: '#fff', strokeWidth: 0.1, strokeAlign: 'center' })
    const inside = createRectLayer({ stroke: '#fff', strokeWidth: 0.1, strokeAlign: 'inside' })
    const absent = createRectLayer({ stroke: '#fff', strokeWidth: 0.1 })
    expect(outsideStrokePadPx(center, 200)).toBe(0)
    expect(outsideStrokePadPx(inside, 200)).toBe(0)
    expect(outsideStrokePadPx(absent, 200)).toBe(0)
  })

  it('is the full stroke width in px for an outside-aligned rect/ellipse/polygon/star', () => {
    // strokeWidth is normalized to canvas width for these kinds — 0.1 * 200 = 20px.
    const l = createRectLayer({ stroke: '#fff', strokeWidth: 0.1, strokeAlign: 'outside' })
    expect(outsideStrokePadPx(l, 200)).toBe(20)
  })

  it('scales a path\'s pad by its own `scale`, not just canvas width', () => {
    // strokeWidth is LOCAL units at scale=1 for a path — the rendered ctx is
    // pre-scaled by (scale*W), so the outward px extent must fold scale in too.
    const l = createPathLayer({ stroke: '#fff', strokeWidth: 0.1, strokeAlign: 'outside', scale: 2 })
    expect(outsideStrokePadPx(l, 200)).toBe(40) // 0.1 * 2 * 200
  })

  it('is 0 for a line — alignment does not apply (no interior)', () => {
    const l = createLineLayer({ stroke: '#fff', strokeWidth: 0.1 })
    expect(outsideStrokePadPx(l, 200)).toBe(0)
  })
})

// ── Ink model ────────────────────────────────────────────────────────────────
//
// This suite runs in the node environment (no DOM, no rasterizing canvas — see
// tests/unit/compositor-corner-radius.unit.spec.ts and wired-layer.unit.spec.ts).
// So the recording context below logs the draw ops, and `inkAt` replays that log
// under Canvas2D's own compositing rules to answer ONE question per probe point:
// is this point painted?  That is a pixel probe in everything but the raster —
// geometry (rect distance, dash phase), clipping, destination-out and the
// offscreen stamp are all modelled, so a knockout aimed at the wrong surface, a
// missing clip, or a leaked dash all change the answer.
//
// Geometry supported: axis-aligned rects (radius ignored — probes stay away from
// the corners) and straight segments. Enough for the alignment/dash claims.

type Pt = { x: number; y: number }
type Pred = (p: Pt) => boolean

type Op =
  | { kind: 'save' } | { kind: 'restore' }
  | { kind: 'clip'; pred: Pred }
  | { kind: 'fill'; pred: Pred; erase: boolean }
  | { kind: 'stroke'; pred: Pred }
  | { kind: 'stamp'; from: Recorder }

interface Recorder { name: string; ops: Op[] }

/** Signed distance to an axis-aligned rect centred on (0,0): negative inside. */
function sdRect(p: Pt, w: number, h: number): number {
  const dx = Math.abs(p.x) - w / 2
  const dy = Math.abs(p.y) - h / 2
  const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return out > 0 ? out : Math.max(dx, dy)
}

/** Distance from p to the segment a→b, plus the arc length of its projection. */
function segProject(p: Pt, a: Pt, b: Pt) {
  const vx = b.x - a.x, vy = b.y - a.y
  const len = Math.hypot(vx, vy) || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (len * len)))
  const cx = a.x + vx * t, cy = a.y + vy * t
  return { dist: Math.hypot(p.x - cx, p.y - cy), along: t * len }
}

/** A dashed pattern is "on" where the arc length falls in a dash, not a gap. */
function dashOn(along: number, dash: [number, number] | null): boolean {
  if (!dash) return true
  const period = dash[0] + dash[1]
  if (!(period > 0)) return true
  return ((along % period) + period) % period < dash[0]
}

function inkAt(rec: Recorder, p: Pt): boolean {
  let ink = false
  let clip: Pred | null = null
  const stack: (Pred | null)[] = []
  for (const op of rec.ops) {
    if (op.kind === 'save') { stack.push(clip); continue }
    if (op.kind === 'restore') { clip = stack.pop() ?? null; continue }
    if (op.kind === 'clip') { const prev = clip; clip = prev ? (q: Pt) => prev(q) && op.pred(q) : op.pred; continue }
    if (op.kind === 'stamp') { if (inkAt(op.from, p)) ink = true; continue }
    const inClip = !clip || clip(p)
    if (!inClip) continue
    if (op.kind === 'fill') { if (op.pred(p)) ink = op.erase ? false : true; continue }
    if (op.kind === 'stroke') { if (op.pred(p)) ink = true }
  }
  return ink
}

// ── Recording context ────────────────────────────────────────────────────────

const _byCanvas = new Map<object, Recorder>()

function makeCtx(name: string, W = 200, H = 200) {
  const rec: Recorder = { name, ops: [] }
  const canvas = { width: W, height: H, getContext: () => ctx }
  _byCanvas.set(canvas, rec)
  // Current path as a predicate pair (fill area / distance to the outline).
  let fillPred: Pred = () => false
  let distTo: (p: Pt) => { dist: number; along: number } = () => ({ dist: Infinity, along: 0 })
  let dash: [number, number] | null = null
  const state: { dash: [number, number] | null }[] = []
  const ctx: any = {
    canvas,
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() { state.push({ dash }); rec.ops.push({ kind: 'save' }) },
    restore() { dash = state.pop()?.dash ?? null; rec.ops.push({ kind: 'restore' }) },
    translate() {}, scale() {}, rotate() {}, transform() {}, setTransform() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    setLineDash(d: number[]) { dash = d.length ? [d[0]!, d[1] ?? 0] : null },
    getLineDash() { return dash ? [dash[0], dash[1]] : [] },
    measureText() { return { width: 10 } },
    beginPath() { fillPred = () => false; distTo = () => ({ dist: Infinity, along: 0 }) },
    closePath() {},
    rect(x: number, y: number, w: number, h: number) { ctx.roundRect(x, y, w, h, 0) },
    roundRect(_x: number, _y: number, w: number, h: number, _r: unknown) {
      // Centred rects only (every shape layer draws at the origin).
      fillPred = (p: Pt) => sdRect(p, w, h) <= 0
      distTo = (p: Pt) => ({ dist: Math.abs(sdRect(p, w, h)), along: 0 })
    },
    ellipse() {},
    moveTo(x: number, y: number) { ctx._a = { x, y } },
    lineTo(x: number, y: number) {
      const a = ctx._a as Pt, b = { x, y }
      fillPred = () => false
      distTo = (p: Pt) => segProject(p, a, b)
    },
    clip() { const pred = fillPred; rec.ops.push({ kind: 'clip', pred }) },
    fill() {
      const pred = fillPred
      rec.ops.push({ kind: 'fill', pred, erase: ctx.globalCompositeOperation === 'destination-out' })
    },
    stroke() {
      const lw = ctx.lineWidth, d = dash, dt = distTo
      rec.ops.push({ kind: 'stroke', pred: (p: Pt) => { const r = dt(p); return r.dist <= lw / 2 && dashOn(r.along, d) } })
    },
    fillText() {}, strokeText() {}, fillRect() {}, clearRect() {},
    drawImage(src: any) {
      const from = _byCanvas.get(src)
      if (from) rec.ops.push({ kind: 'stamp', from })
    },
    createLinearGradient() { return { addColorStop() {} } },
    createPattern() { return null },
  }
  return { ctx: ctx as CanvasRenderingContext2D, rec }
}

/** Every op the shared painter made, flattened (main surface + any offscreen). */
function allOps(rec: Recorder): Op[] {
  return rec.ops.flatMap(o => (o.kind === 'stamp' ? allOps(o.from) : [o]))
}

let scratchCount = 0
beforeEach(() => {
  scratchCount = 0
  ;(globalThis as any).document = {
    createElement(tag: string) {
      if (tag !== 'canvas') return {}
      scratchCount += 1
      return makeCtx(`scratch${scratchCount}`).ctx.canvas
    },
  }
})
afterEach(() => { delete (globalThis as any).document })

function paint(layers: LocalLayer[], W = 200, H = 200) {
  const { ctx, rec } = makeCtx('main', W, H)
  paintLayerStack(ctx, W, H, layers.map(l => ({ type: 'local' as const, key: `l:${l.id}`, layer: l })), layers)
  return { rec, ink: (x: number, y: number) => inkAt(rec, { x, y }) }
}

// A 100x100 px square (0.5 of a 200px artboard) with a fat 20px outline.
const SQ = (partial: Partial<RectLayer> = {}) =>
  createRectLayer({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, radius: 0, fill: '', stroke: '#ffffff', strokeWidth: 0.1, ...partial })

describe('stroke alignment — where the ink lands', () => {
  // Silhouette edge is at x = ±50. A centered 20px outline spans 40..60.
  it('centers by default: ink straddles the edge (the pre-change behavior)', () => {
    const { ink, rec } = paint([SQ()])
    expect(ink(45, 0)).toBe(true)    // inside half
    expect(ink(55, 0)).toBe(true)    // outside half
    expect(ink(65, 0)).toBe(false)   // beyond the outline
    expect(ink(35, 0)).toBe(false)
    // …and it takes the legacy code path: no clip, no offscreen, no dash.
    expect(rec.ops.some(o => o.kind === 'clip' || o.kind === 'stamp')).toBe(false)
    expect(scratchCount).toBe(0)
  })

  it('inside: the whole outline sits within the silhouette, nothing outside it', () => {
    const { ink } = paint([SQ({ strokeAlign: 'inside' })])
    expect(ink(45, 0)).toBe(true)    // just inside the edge
    expect(ink(32, 0)).toBe(true)    // 20px band reaches x=30
    expect(ink(25, 0)).toBe(false)   // interior stays clean
    expect(ink(50.5, 0)).toBe(false) // NO ink outside the silhouette
    expect(ink(55, 0)).toBe(false)
    expect(ink(0, 55)).toBe(false)   // same on the other axis
    expect(ink(0, -55)).toBe(false)
  })

  it('outside: the whole outline sits beyond the silhouette, nothing inside it', () => {
    const { ink } = paint([SQ({ strokeAlign: 'outside' })])
    expect(ink(55, 0)).toBe(true)    // just outside the edge
    expect(ink(68, 0)).toBe(true)    // 20px band reaches x=70
    expect(ink(75, 0)).toBe(false)   // and no further
    expect(ink(49.5, 0)).toBe(false) // NO ink strictly inside
    expect(ink(45, 0)).toBe(false)
    expect(ink(0, -45)).toBe(false)
  })

  it('outside keeps the shape\'s OWN fill — the knockout only eats the outline', () => {
    const { ink } = paint([SQ({ fill: '#ff0000', strokeAlign: 'outside' })])
    expect(ink(0, 0)).toBe(true)     // fill survives
    expect(ink(55, 0)).toBe(true)    // outline outside it
  })

  // The Critical this feature can cause: a destination-out on the SHARED canvas
  // would punch a hole through everything already painted under the shape.
  it('outside never eats the backdrop under it', () => {
    const back = createRectLayer({ id: 'back', x: 0.5, y: 0.5, w: 1, h: 1, radius: 0, fill: '#123456', stroke: '', strokeWidth: 0 } as any)
    const { ink, rec } = paint([back, SQ({ strokeAlign: 'outside' })])
    expect(ink(0, 0)).toBe(true)     // backdrop intact under the shape's middle
    expect(ink(45, 0)).toBe(true)    // …and under the knocked-out ring
    expect(ink(-45, 20)).toBe(true)
    // The knockout happened on an offscreen, never on the shared context.
    expect(scratchCount).toBe(1)
    expect(rec.ops.some(o => o.kind === 'fill' && o.erase)).toBe(false)
    expect(allOps(rec).some(o => o.kind === 'fill' && o.erase)).toBe(true)
  })

  it('an unknown alignment degrades to center', () => {
    const { ink, rec } = paint([SQ({ strokeAlign: 'sideways' as any })])
    expect(ink(45, 0)).toBe(true)
    expect(ink(55, 0)).toBe(true)
    expect(rec.ops.some(o => o.kind === 'clip' || o.kind === 'stamp')).toBe(false)
  })
})

// Corner-pin renders a layer to a box-sized offscreen (localLayerBox — plain w×h,
// NO stroke padding) and warps that onto the pin quad. An outside-aligned stroke
// lies entirely beyond that box (see the previous describe block) and used to be
// 100% clipped away by the offscreen's own edges. `paintWithSizes` intercepts every
// canvas the paint makes and records what its width/height end up being SET to
// (production code always creates-then-sizes: `document.createElement('canvas');
// cc.width = …; cc.height = …`), so these tests observe the real offscreen size the
// warp path builds — not just the pure `outsideStrokePadPx` calculation.
function paintWithSizes(layers: LocalLayer[], W = 200, H = 200) {
  const sizes: { w: number; h: number }[] = []
  const { ctx, rec } = makeCtx('main', W, H)
  ;(globalThis as any).document = {
    createElement(tag: string) {
      if (tag !== 'canvas') return {}
      scratchCount += 1
      const inner = makeCtx(`scratch${scratchCount}`).ctx.canvas as any
      return new Proxy(inner, {
        set(target, prop, value) {
          target[prop] = value
          // Production always sets `.width` then `.height` right after — capture
          // only once BOTH have landed (on the `height` write), not the
          // momentarily-mismatched state mid-assignment (width already new,
          // height still the object's default).
          if (prop === 'height') sizes.push({ w: target.width, h: target.height })
          return true
        },
      })
    },
  }
  paintLayerStack(ctx, W, H, layers.map(l => ({ type: 'local' as const, key: `l:${l.id}`, layer: l })), layers)
  return { rec, sizes }
}

describe('corner-pin offscreen padding for outside-aligned strokes', () => {
  // A non-identity pin so cornerPinActive() sees real distortion and the warp
  // path (not the plain fast path) actually runs.
  const PIN: CornerPin = { tl: { x: -0.1, y: 0 }, tr: { x: 0.1, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } }

  it('grows the offscreen by the full stroke width on each side when outside-aligned', () => {
    // SQ() is a 100×100 box (0.5 of 200px) with a 20px outline (strokeWidth 0.1).
    const { sizes } = paintWithSizes([SQ({ strokeAlign: 'outside', cornerPin: PIN })])
    // 100 + 2*20 = 140 on both axes, and centered (translate to the new center is
    // exercised implicitly — a mis-centered draw would still report this size).
    expect(sizes).toContainEqual({ w: 140, h: 140 })
  })

  it('does NOT pad a centered stroke — the box stays exactly what it was', () => {
    const { sizes } = paintWithSizes([SQ({ strokeAlign: 'center', cornerPin: PIN })])
    expect(sizes).toContainEqual({ w: 100, h: 100 })
    expect(sizes.some(s => s.w > 100 || s.h > 100)).toBe(false)
  })

  it('does NOT pad an inside-aligned stroke — it never left the box to begin with', () => {
    const { sizes } = paintWithSizes([SQ({ strokeAlign: 'inside', cornerPin: PIN })])
    expect(sizes).toContainEqual({ w: 100, h: 100 })
    expect(sizes.some(s => s.w > 100 || s.h > 100)).toBe(false)
  })

  it('does NOT pad a layer with no stroke at all', () => {
    const l = createRectLayer({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, radius: 0, fill: '#fff', stroke: '', strokeWidth: 0, cornerPin: PIN })
    const { sizes } = paintWithSizes([l])
    expect(sizes).toContainEqual({ w: 100, h: 100 })
    expect(sizes.some(s => s.w > 100 || s.h > 100)).toBe(false)
  })
})

describe('dashed strokes', () => {
  // 100px line (0.5 of 200), 10px dash + 10px gap: on 0..10, off 10..20, …
  const dashed = (partial: Partial<LineLayer> = {}) =>
    createLineLayer({ x: 0.5, y: 0.5, w: 0.5, strokeWidth: 0.05, stroke: '#ffffff', strokeDash: { dash: 0.05, gap: 0.05 }, ...partial })

  it('leaves a gap between the marks', () => {
    const { ink } = paint([dashed()])
    expect(ink(-45, 0)).toBe(true)   // 5px along → inside the first dash
    expect(ink(-35, 0)).toBe(false)  // 15px along → inside the first gap
    expect(ink(-25, 0)).toBe(true)   // 25px along → second dash
  })

  it('a solid line has no gaps (absent dash = today)', () => {
    const { ink } = paint([dashed({ strokeDash: undefined })])
    expect(ink(-45, 0)).toBe(true)
    expect(ink(-35, 0)).toBe(true)
    expect(ink(-25, 0)).toBe(true)
  })

  it('a zero-length dash stays solid rather than vanishing', () => {
    const { ink } = paint([dashed({ strokeDash: { dash: 0, gap: 0.05 } })])
    expect(ink(-35, 0)).toBe(true)
  })

  it('a dashed layer followed by a solid one paints the solid one without gaps', () => {
    // Real coverage of the PLUMBING (paintLayer wraps every layer's draw in its
    // own save()/restore(), so layers never see each other's canvas state) —
    // this can catch a regression there, but NOT a missing reset inside
    // strokeAligned itself: see the next test for that claim specifically.
    const solid = createLineLayer({ id: 'solid', x: 0.5, y: 0.75, w: 0.5, strokeWidth: 0.05, stroke: '#ffffff' } as any)
    const { rec } = paint([dashed(), solid])
    const strokes = rec.ops.filter(o => o.kind === 'stroke')
    expect(strokes).toHaveLength(2)
    const second: Recorder = { name: 'second', ops: [strokes[1]!] }
    expect(inkAt(second, { x: -35, y: 0 })).toBe(true)
  })

  // The claim above ("resets afterwards") can't actually fail through paintLayer:
  // its per-layer save()/restore() would isolate the canvas dash state even if
  // strokeAligned's own `if (dash) c.setLineDash([])` reset were deleted. Calling
  // the exported helper directly, on the SAME ctx, with NO save()/restore() in
  // between, is the only way to observe the reset strokeAligned makes itself —
  // deleting that line flips this test to fail (the second stroke would inherit
  // the first call's [10,10] pattern and go dark at the gap probe point).
  it('strokeAligned resets its own dash pattern (observable with no enclosing save/restore)', () => {
    const { ctx, rec } = makeCtx('direct')
    const line = (c: CanvasRenderingContext2D) => { c.beginPath(); c.moveTo(-50, 0); c.lineTo(50, 0) }
    line(ctx)
    strokeAligned(ctx, { width: 10, style: () => '#fff', dash: [10, 10] })
    line(ctx)
    strokeAligned(ctx, { width: 10, style: () => '#fff', dash: null })
    const strokes = rec.ops.filter(o => o.kind === 'stroke')
    expect(strokes).toHaveLength(2)
    const second: Recorder = { name: 'second', ops: [strokes[1]!] }
    expect(inkAt(second, { x: -35, y: 0 })).toBe(true) // 15px along → dark under a leaked [10,10] pattern
  })

  it('dashes an inside-aligned outline without leaving the pattern set', () => {
    const { rec, ink } = paint([SQ({ strokeAlign: 'inside', strokeDash: { dash: 0.05, gap: 0.05 } })])
    expect(ink(50.5, 0)).toBe(false)  // still inside the silhouette
    expect(rec.ops.filter(o => o.kind === 'clip')).toHaveLength(1)
  })
})
