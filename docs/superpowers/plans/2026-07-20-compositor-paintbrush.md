# Compositor Paintbrush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Brush tool to the Frame Compositor that paints freehand regions as a new first-class `brush` layer kind, fillable with the full app fill set and usable on both sides of the existing silhouette-mask, plus a Mask mode that paints reveal/erase visibility on any selected layer.

**Architecture:** The painted region is a full-artboard alpha shape stored as resolution-independent strokes on a `BrushLayer`. It renders through the existing single 2D renderer (`paintLayerStack → paintLayer → drawLayerContent`) via an offscreen stamp+`source-in` fill, mirroring the proven `drawTintedImage` recipe — so effects/blend/opacity/`maskedByKey`/motion all work with zero mask-specific code. A new `useBrushPaint` engine drives the tool; strokes commit through `useLocalLayerEditor` so undo is unified.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Canvas 2D, Vitest (`tests/unit/**/*.unit.spec.ts`, node env, recording-ctx stubs).

## Global Constraints

- Kind name is `'brush'` (NOT `'paint'` — collides with `Paint` type / `paintLayer()`/`resolvePaint()`).
- Strokes store points in **width-normalized** coords: both axes divided by artboard width `W` (matches `useBrushMask`'s radius convention). Radius is width-normalized too.
- The single 2D renderer `paintLayerStack()` in `useCompositorLayers.ts` is shared by node preview, modal, and export — a correct `drawLayerContent` branch renders identically everywhere.
- `drawLayerContent(ctx, layer, W)` receives only `W`; recover artboard height as `layer.h * W` (store `h = aspect = artboardH/artboardW`, exactly like image layers).
- The ctx handed to `drawLayerContent` already has opacity/blend/transform applied and is centered at the layer origin — draw geometry centered on `(0,0)`.
- Fill via `resolvePaint(ctx, paint, {w,h})`; its gradient/pattern geometry is centered on `(0,0)`, so translate the offscreen to its center before filling (see `drawTintedImage:602`).
- Repaint is automatic: the modal's `watch` (CompositorModal.vue:1562) re-renders on any `localLayers` change (it `JSON.stringify`s them).
- Parallel sessions edit `useCompositorLayers.ts` and `CompositorModal.vue`; stage ONLY this feature's hunks when committing (`git add -p` / explicit paths), never `git add -A`.
- Typecheck/compile is not a package script; verify with `npm run test:unit` and the dev-server compile (Vite). Painting is fully client-side — browser verification needs no paid API.

---

### Task 1: Brush stroke model + stamp library (pure, TDD)

New pure module for the stroke data type and the alpha-stamping algorithm. No DOM/canvas types beyond `CanvasRenderingContext2D`, so the geometry helpers unit-test directly.

**Files:**
- Create: `frontend/app/lib/compositor/brushStamp.ts`
- Test: `frontend/tests/unit/brush-stamp.unit.spec.ts`

**Interfaces:**
- Produces:
  - `interface PaintStroke { points: {x:number;y:number}[]; radius:number; hardness:number; opacity:number; erase:boolean }`
  - `smoothPoints(points: {x:number;y:number}[], samples?: number): {x:number;y:number}[]`
  - `strokeRadiusPx(stroke: PaintStroke, base: number): number`
  - `drawStrokeAlpha(ctx: CanvasRenderingContext2D, stroke: PaintStroke, base: number): void` — paints the stroke as white alpha at FULL opacity (caller controls globalAlpha/composite).
  - `stampStrokes(ctx: CanvasRenderingContext2D, strokes: PaintStroke[], base: number, makeCanvas: () => HTMLCanvasElement): void` — composites every stroke with correct per-stroke opacity + erase. `makeCanvas` is injected so the renderer passes `() => document.createElement('canvas')` and tests pass a stub.

- [ ] **Step 1: Write failing tests**

```ts
// frontend/tests/unit/brush-stamp.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { smoothPoints, strokeRadiusPx, type PaintStroke } from '~/lib/compositor/brushStamp'

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
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npm run test:unit -- brush-stamp`
Expected: FAIL — cannot resolve `~/lib/compositor/brushStamp`.

- [ ] **Step 3: Implement `brushStamp.ts`**

```ts
// frontend/app/lib/compositor/brushStamp.ts
// Freehand brush strokes → white alpha coverage on a canvas. Strokes are stored
// width-normalized (both axes / artboard width); `base` is the px-per-unit for the
// target canvas (its width when a stroke spans the full artboard). The renderer
// then source-in-fills this alpha with any Paint. See the paintbrush design spec.

export interface PaintStroke {
  points: { x: number; y: number }[] // width-normalized (both axes ÷ artboard width)
  radius: number                     // width-normalized brush radius
  hardness: number                   // 1 = hard edge … 0 = fully soft
  opacity: number                    // 0..1 per-stroke flow
  erase: boolean                     // erase strokes carve alpha back out
}

/** Catmull-Rom resample: smooth a polyline through its points. Endpoints are kept
 *  exactly; interior gets `samples` interpolated points per segment. */
export function smoothPoints(points: { x: number; y: number }[], samples = 8): { x: number; y: number }[] {
  const n = points.length
  if (n < 3) return points
  const out: { x: number; y: number }[] = [points[0]!]
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    for (let s = 1; s <= samples; s++) {
      const t = s / samples
      const t2 = t * t, t3 = t2 * t
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      out.push({ x, y })
    }
  }
  return out
}

/** Width-normalized radius → target px, floored so a dot always shows. */
export function strokeRadiusPx(stroke: PaintStroke, base: number): number {
  return Math.max(0.5, stroke.radius * base)
}

/** Paint ONE stroke as white alpha at full opacity. Hard = round polyline + dot
 *  caps; soft = overlapping radial-gradient stamps (solid core to `hardness`). */
export function drawStrokeAlpha(ctx: CanvasRenderingContext2D, stroke: PaintStroke, base: number): void {
  const pts = smoothPoints(stroke.points, stroke.hardness >= 0.999 ? 4 : 8)
  if (!pts.length) return
  const r = strokeRadiusPx(stroke, base)
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (stroke.hardness >= 0.999) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x * base, p.y * base, r, 0, Math.PI * 2); ctx.fill() }
    if (pts.length > 1) {
      ctx.lineWidth = r * 2
      ctx.beginPath(); ctx.moveTo(pts[0]!.x * base, pts[0]!.y * base)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x * base, pts[i]!.y * base)
      ctx.stroke()
    }
  } else {
    const inner = Math.max(0, Math.min(0.95, stroke.hardness))
    const step = Math.max(1, r * 0.35)
    const stamp = (x: number, y: number) => {
      const g = ctx.createRadialGradient(x, y, r * inner, x, y, r)
      g.addColorStop(0, '#fff'); g.addColorStop(inner, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    let prev = pts[0]!
    stamp(prev.x * base, prev.y * base)
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!
      const dx = (p.x - prev.x) * base, dy = (p.y - prev.y) * base
      const dist = Math.hypot(dx, dy)
      const steps = Math.max(1, Math.floor(dist / step))
      for (let s = 1; s <= steps; s++) stamp((prev.x * base) + (dx * s) / steps, (prev.y * base) + (dy * s) / steps)
      prev = p
    }
  }
  ctx.restore()
}

/** Composite all strokes onto `ctx`. Each paint stroke renders to its own temp
 *  canvas at full alpha, then composites at its `opacity` so a self-overlapping
 *  stroke stays uniform. Erase strokes carve directly with destination-out. */
export function stampStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: PaintStroke[],
  base: number,
  makeCanvas: () => HTMLCanvasElement,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height
  for (const s of strokes) {
    if (!s.points.length) continue
    if (s.erase) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity))
      drawStrokeAlpha(ctx, s, base); ctx.restore()
      continue
    }
    const tmp = makeCanvas(); tmp.width = w; tmp.height = h
    const tctx = tmp.getContext('2d'); if (!tctx) continue
    drawStrokeAlpha(tctx, s, base)
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity)); ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(tmp, 0, 0); ctx.restore()
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd frontend && npm run test:unit -- brush-stamp`
Expected: PASS (4 assertions).

- [ ] **Step 5: Add a stampStrokes composite test (recording ctx)**

Append to the test file — verify erase uses `destination-out` and paint strokes composite at their opacity. Model the recording stub on `tests/unit/layer-mask-composite.unit.spec.ts`:

```ts
import { stampStrokes, type PaintStroke } from '~/lib/compositor/brushStamp'

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
    drawImage() { ops.push({ op: 'drawImage', composite, alpha }) }, getContext() { return recCtx().ctx },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

describe('stampStrokes composite recipe', () => {
  const s = (p: Partial<PaintStroke> = {}): PaintStroke =>
    ({ points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], radius: 0.05, hardness: 1, opacity: 0.5, erase: false, ...p })
  it('erase strokes carve with destination-out', () => {
    const { ctx, ops } = recCtx()
    stampStrokes(ctx, [s({ erase: true, opacity: 0.8 })], 100, () => recCtx().ctx.canvas as unknown as HTMLCanvasElement)
    expect(ops.some(o => o.composite === 'destination-out')).toBe(true)
  })
  it('paint strokes composite their temp at stroke opacity', () => {
    const { ctx, ops } = recCtx()
    const make = () => { const c = recCtx(); return Object.assign(c.ctx.canvas as object, { getContext: () => c.ctx }) as unknown as HTMLCanvasElement }
    stampStrokes(ctx, [s({ opacity: 0.5 })], 100, make)
    const draw = ops.find(o => o.op === 'drawImage')
    expect(draw?.alpha).toBe(0.5)
  })
})
```

- [ ] **Step 6: Run and commit**

Run: `cd frontend && npm run test:unit -- brush-stamp` → PASS.
```bash
git add frontend/app/lib/compositor/brushStamp.ts frontend/tests/unit/brush-stamp.unit.spec.ts
git commit -m "feat(compositor): brush stroke model + alpha stamp lib

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `BrushLayer` type, factory, and render branch

Add the kind to the unions, a factory, and the `drawLayerContent` branch that stamps strokes to a full-artboard offscreen and `source-in`-fills via `resolvePaint`.

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (union L16, add interface near L280, union L288, factory near L409, `drawLayerContent` branch near L1010 before the `image` branch's close)
- Test: `frontend/tests/unit/brush-layer-render.unit.spec.ts`

**Interfaces:**
- Consumes: `PaintStroke`, `stampStrokes` from Task 1.
- Produces:
  - `interface BrushLayer extends LayerCommon { kind:'brush'; strokes: PaintStroke[]; fill: Paint; stroke?: Paint; strokeWidth?: number; w: number; h: number }`
  - `createBrushLayer(partial?: Partial<BrushLayer>): BrushLayer`

- [ ] **Step 1: Add the type + union members**

In `useCompositorLayers.ts`:
- L16 union → add `| 'brush'`:
  ```ts
  export type LocalLayerKind = 'text' | 'rect' | 'ellipse' | 'line' | 'path' | 'image' | 'polygon' | 'star' | 'brush'
  ```
- Add near the other layer interfaces (e.g. after `ImageLayer`, ~L270), and import the stroke type at top with the other imports:
  ```ts
  import { type PaintStroke, stampStrokes } from '~/lib/compositor/brushStamp'
  ```
  ```ts
  export interface BrushLayer extends LayerCommon {
    kind: 'brush'
    strokes: PaintStroke[]
    fill: Paint            // region fill — full FillControl set; '' / 'none' = no fill
    stroke?: Paint         // optional outline of the painted silhouette
    strokeWidth?: number   // normalized to width
    w: number              // full-artboard bounds; 1 = artboard width
    h: number              // aspect (artboardH / artboardW)
  }
  ```
- L288 union → add `| BrushLayer`.
- Re-export the stroke type so consumers import from one place:
  ```ts
  export type { PaintStroke } from '~/lib/compositor/brushStamp'
  ```

- [ ] **Step 2: Add the factory** (mirror `createPathLayer:401`), after `createImageLayer`:

```ts
export function createBrushLayer(partial: Partial<BrushLayer> = {}): BrushLayer {
  return {
    id: newId(), kind: 'brush',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 1, h: 1, strokes: [], fill: '#3b82f6', stroke: '', strokeWidth: 0,
    ...partial,
  }
}
```

- [ ] **Step 3: Write the failing render test**

```ts
// frontend/tests/unit/brush-layer-render.unit.spec.ts
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
```

- [ ] **Step 4: Run to verify fail**

Run: `cd frontend && npm run test:unit -- brush-layer-render`
Expected: FAIL — brush kind not handled, no `source-in` fill.

- [ ] **Step 5: Add the `drawLayerContent` branch** (in `useCompositorLayers.ts`, add an `else if` in the `drawLayerContent` switch ~L1010, following the `image` branch):

```ts
} else if (layer.kind === 'brush') {
  if (!layer.strokes.length) return
  const w = Math.max(1, Math.round(layer.w * W))
  const h = Math.max(1, Math.round(layer.h * W))
  const off = document.createElement('canvas'); off.width = w; off.height = h
  const octx = off.getContext('2d'); if (!octx) return
  // Strokes are width-normalized; `base = w` maps them into this offscreen (w == W when layer.w == 1).
  stampStrokes(octx, layer.strokes, w, () => document.createElement('canvas'))
  if (hasPaint(layer.fill)) {
    octx.save()
    octx.translate(w / 2, h / 2)               // center so resolvePaint's gradient/pattern lines up
    octx.globalCompositeOperation = 'source-in' // keep fill only where strokes painted
    octx.fillStyle = resolvePaint(octx, layer.fill, { w, h })
    octx.fillRect(-w / 2, -h / 2, w, h)
    octx.restore()
  }
  ctx.drawImage(off, -w / 2, -h / 2, w, h)
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd frontend && npm run test:unit -- brush-layer-render`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/brush-layer-render.unit.spec.ts
git commit -m "feat(compositor): BrushLayer kind, factory, and render branch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `useBrushPaint` engine + tool state in the modal

The brush input engine (settings + live stroke) and the mutually-exclusive tool mode. Committing goes through `useLocalLayerEditor` (`addLocal` for a new layer, `setLocal` to extend the active layer's `strokes`).

**Files:**
- Create: `frontend/app/composables/useBrushPaint.ts`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (tool state near L453; `isSelectTool` L447; pointer handlers L1085/1115/1125; click guards L1149/1156)
- Test: `frontend/tests/unit/use-brush-paint.unit.spec.ts`

**Interfaces:**
- Consumes: `PaintStroke` (Task 1), `createBrushLayer` (Task 2), `useLocalLayerEditor` API (`addLocal`, `setLocal`, `selected`, `selectLocal`).
- Produces: `useBrushPaint()` returning `{ active, mode, sizePx, color, opacity, hardness, smoothing, eraser, cursor, setActive, radiusNorm, beginStroke, extendStroke, endStroke, hasLiveStroke }` where:
  - `radiusNorm(baseW: number): number` — display px → width-normalized radius (`sizePx/2 / baseW`).
  - `beginStroke(nx, ny)`, `extendStroke(nx, ny)`, `endStroke(): PaintStroke | null` — build the live stroke from width-normalized points; `endStroke` returns the finished `PaintStroke` (or null if empty) and clears live state.

- [ ] **Step 1: Write failing tests**

```ts
// frontend/tests/unit/use-brush-paint.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { useBrushPaint } from '~/composables/useBrushPaint'

describe('useBrushPaint', () => {
  it('radiusNorm maps display px to width fraction', () => {
    const b = useBrushPaint(); b.sizePx.value = 48
    expect(b.radiusNorm(960)).toBeCloseTo(0.025, 4) // 24 / 960
  })
  it('builds a stroke from points and honors eraser/hardness/opacity', () => {
    const b = useBrushPaint()
    b.sizePx.value = 40; b.hardness.value = 0.5; b.opacity.value = 0.7; b.eraser.value = true
    b.beginStroke(0.1, 0.1, 1000); b.extendStroke(0.2, 0.2); b.extendStroke(0.3, 0.25)
    const s = b.endStroke()!
    expect(s.points.length).toBe(3)
    expect(s.erase).toBe(true)
    expect(s.hardness).toBe(0.5)
    expect(s.opacity).toBe(0.7)
    expect(s.radius).toBeCloseTo(0.02, 4) // 20 / 1000
    expect(b.endStroke()).toBe(null)      // cleared after finish
  })
  it('setActive(false) drops any live stroke', () => {
    const b = useBrushPaint()
    b.beginStroke(0.1, 0.1, 1000); b.setActive(false)
    expect(b.hasLiveStroke.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npm run test:unit -- use-brush-paint` → FAIL (module missing).

- [ ] **Step 3: Implement `useBrushPaint.ts`** (Vue reactivity globals are provided by the test setup; import from 'vue' in app code):

```ts
// frontend/app/composables/useBrushPaint.ts
import { ref } from 'vue'
import type { PaintStroke } from '~/lib/compositor/brushStamp'

export type BrushMode = 'paint' | 'mask'

export function useBrushPaint() {
  const active = ref(false)
  const mode = ref<BrushMode>('paint')
  const sizePx = ref(40)          // brush DIAMETER, display px
  const color = ref('#3b82f6')
  const opacity = ref(1)          // 0..1
  const hardness = ref(1)         // 1 hard … 0 soft
  const smoothing = ref(true)
  const eraser = ref(false)
  const cursor = ref<{ x: number; y: number } | null>(null) // width-normalized, for the ring

  let live: PaintStroke | null = null
  const hasLiveStroke = ref(false)

  function radiusNorm(baseW: number): number {
    return Math.max(0.0005, sizePx.value / 2 / Math.max(1, baseW))
  }
  function setActive(v: boolean) { active.value = v; if (!v) { live = null; hasLiveStroke.value = false } }

  function beginStroke(nx: number, ny: number, baseW: number) {
    live = { points: [{ x: nx, y: ny }], radius: radiusNorm(baseW), hardness: hardness.value, opacity: opacity.value, erase: eraser.value }
    hasLiveStroke.value = true
  }
  function extendStroke(nx: number, ny: number) {
    if (!live) return
    // Drop micro-moves so smoothing has clean input.
    const last = live.points[live.points.length - 1]!
    if (Math.hypot(nx - last.x, ny - last.y) < 0.0008) return
    live.points.push({ x: nx, y: ny })
  }
  function endStroke(): PaintStroke | null {
    const s = live
    live = null; hasLiveStroke.value = false
    return s && s.points.length ? s : null
  }
  const liveStroke = () => live

  return {
    active, mode, sizePx, color, opacity, hardness, smoothing, eraser, cursor, hasLiveStroke,
    setActive, radiusNorm, beginStroke, extendStroke, endStroke, liveStroke,
  }
}
```

Note: `smoothing.value === false` is honored at render time by passing `samples = 1` — recorded in Task 4 where the live stroke is stamped; committed strokes always store raw points so smoothing stays a render-time choice. (For v1 the stored stroke is always smoothed at render; the `smoothing` flag gates whether `smoothPoints` runs — wire in Task 4's overlay + the render branch reads a per-stroke default of on. If `smoothing` must persist per-stroke, add `smooth:boolean` to `PaintStroke` — deferred; v1 smooths always.)

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test:unit -- use-brush-paint` → PASS.

- [ ] **Step 5: Wire tool state into CompositorModal.vue**

Near L415 (with `pen`): `const brush = useBrushPaint()` and import `useBrushPaint`. Import `createBrushLayer` from `useCompositorLayers` (add to the existing import).

Near L453 (with `distortTool`):
```ts
function toggleBrush() {
  brush.setActive(!brush.active.value)
  if (brush.active.value) { pen.setActive(false); exitNodeEdit(); if (genActive.value) exitGenMode(); distortTool.value = false; selectLocal(null) }
}
```
Update `isSelectTool` (L447) to include `&& !brush.active.value`.

Add the active brush-layer target + commit helpers (near the gen painters, ~L1930). Uses `selected`/`addLocal`/`setLocal` from the editor and `canvasDisplay`:
```ts
// The brush layer strokes land on. Reuse the selected brush layer, else create one.
let brushLayerId: string | null = null
function activeBrushLayer(): BrushLayer | null {
  const sel = selected.value
  if (sel && sel.kind === 'brush') return sel as BrushLayer
  if (brushLayerId) { const l = localLayers.value.find(x => x.id === brushLayerId); if (l && l.kind === 'brush') return l as BrushLayer }
  return null
}
function onBrushPointerDown(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return
  e.preventDefault(); e.stopPropagation()
  canvasRef.value?.setPointerCapture?.(e.pointerId)
  brush.beginStroke(p.nx, p.ny, canvasDisplay.w)
  brush.cursor.value = { x: p.nx, y: p.ny }
  renderStack() // show the live stroke immediately (see Task 4 overlay hook)
}
function onBrushPointerMove(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return
  brush.cursor.value = { x: p.nx, y: p.ny }
  if (!brush.hasLiveStroke.value) return
  brush.extendStroke(p.nx, p.ny)
  renderStack()
}
function onBrushPointerUp() {
  const s = brush.endStroke(); if (!s) { return }
  const existing = activeBrushLayer()
  const aspect = canvasDisplay.h / Math.max(1, canvasDisplay.w)
  if (existing) {
    setLocal(existing.id, { strokes: [...existing.strokes, s] })
    brushLayerId = existing.id
  } else {
    const layer = createBrushLayer({ strokes: [s], fill: brush.color.value, h: aspect })
    addLocal(layer)            // records history + selects
    brushLayerId = layer.id
  }
}
```

Branch the three capture handlers BEFORE the pen checks:
- L1091 area (pointer-down): add `if (brush.active.value) { onBrushPointerDown(e); return }`
- L1121 area (pointer-move): add `if (brush.active.value) { onBrushPointerMove(e); return }` (before the pen branch)
- L1126 area (pointer-up): add `if (brush.active.value) { onBrushPointerUp(); return }`

Click guards — in `onCanvasClick` (L1149) and `onStageBackgroundClick` (L1156), early-return when `brush.active.value` (mirror the `genActive` guard already there).

Add `BrushLayer` to the type import from `useCompositorLayers` at the top of the script.

- [ ] **Step 6: Compile-check + commit**

Run: `cd frontend && npm run test:unit -- use-brush-paint` → PASS. Start the dev server once (Task 7 verifies interactively) or rely on the Vite compile in Task 7. Commit:
```bash
git add frontend/app/composables/useBrushPaint.ts frontend/tests/unit/use-brush-paint.unit.spec.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): brush tool state, input engine, and stroke commit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Toolbar button, options bar, live-stroke overlay, cursor ring

Surface the tool: a Brush button, a size/opacity/hardness/eraser options bar, a live-stroke preview during a drag, and a brush-size cursor ring. Fill is edited via the existing `FillControl` in the layer properties panel — verify it already shows for the selected brush layer; if the panel gates fill on specific kinds, add `'brush'`.

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (toolbar L2866-area; options bar near the gen inspector L3081-area; overlay canvas hook in `renderStack` L1546; cursor-ring div L2494; lucide import L51)

**Interfaces:**
- Consumes: `brush` engine + `brush.liveStroke()` (Task 3), `stampStrokes`/`drawStrokeAlpha` (Task 1).

- [ ] **Step 1: Add the Brush toolbar button** — copy the Pen button (L2866-2873), add `Brush` to the `lucide-vue-next` import (L51):

```html
<button
  class="flex items-center justify-center size-8 rounded cursor-pointer"
  :class="brush.active.value ? 'bg-white text-neutral-900' : 'hover:bg-white/10 text-white/80'"
  title="Brush — paint a freehand region (B)"
  @click="toggleBrush">
  <Brush class="size-4" />
</button>
```

- [ ] **Step 2: Add the options bar** — a `v-if="brush.active.value"` panel mirroring the gen inspector (L3081-3094). Include Paint/Mask toggle (mode), color (`StudioColor`), size, opacity, hardness, eraser toggle. Fill type (gradient/pattern/image) stays in the layer panel via `FillControl`.

```html
<div v-if="brush.active.value" class="..."> <!-- match gen inspector container classes -->
  <div class="panel-label mb-1.5">Brush</div>
  <div class="flex items-center gap-1 p-0.5 rounded-md bg-white/[0.05] mb-2">
    <button v-for="m in ['paint','mask']" :key="m" class="flex-1 h-7 rounded text-[11px] capitalize cursor-pointer"
      :class="brush.mode.value === m ? 'bg-white text-neutral-900 font-medium' : 'text-white/70 hover:bg-white/10'"
      @click="brush.mode.value = (m as any)">{{ m }}</button>
  </div>
  <div v-if="brush.mode.value === 'paint'" class="flex items-center gap-2 mb-2">
    <span class="text-[10px] text-white/40 w-9 shrink-0">Color</span>
    <StudioColor :model-value="brush.color.value" @update:model-value="(v: string) => brush.color.value = v" />
  </div>
  <div class="flex items-center gap-2 mb-2">
    <span class="text-[10px] text-white/40 w-9 shrink-0">Size</span>
    <input type="range" min="2" max="240" step="1" v-model.number="brush.sizePx.value" class="flex-1 accent-white cursor-pointer" />
    <span class="text-[10px] text-white/50 w-8 text-right tabular-nums">{{ brush.sizePx.value }}</span>
  </div>
  <div class="flex items-center gap-2 mb-2">
    <span class="text-[10px] text-white/40 w-9 shrink-0">Flow</span>
    <input type="range" min="0.05" max="1" step="0.05" v-model.number="brush.opacity.value" class="flex-1 accent-white cursor-pointer" />
    <span class="text-[10px] text-white/50 w-8 text-right tabular-nums">{{ Math.round(brush.opacity.value * 100) }}</span>
  </div>
  <div class="flex items-center gap-2 mb-2">
    <span class="text-[10px] text-white/40 w-9 shrink-0">Soft</span>
    <input type="range" min="0" max="1" step="0.05" :value="1 - brush.hardness.value"
      @input="brush.hardness.value = 1 - Number(($event.target as HTMLInputElement).value)" class="flex-1 accent-white cursor-pointer" />
    <span class="text-[10px] text-white/50 w-8 text-right tabular-nums">{{ Math.round((1 - brush.hardness.value) * 100) }}</span>
  </div>
  <button class="w-full h-7 rounded text-[11px] cursor-pointer"
    :class="brush.eraser.value ? 'bg-white text-neutral-900' : 'bg-white/[0.05] text-white/70 hover:bg-white/10'"
    @click="brush.eraser.value = !brush.eraser.value">{{ brush.eraser.value ? 'Eraser on' : 'Eraser' }}</button>
</div>
```

- [ ] **Step 3: Live-stroke overlay** — in `renderStack` (L1546), after `paintLayerStack(...)`, draw the in-progress stroke so it appears before commit:

```ts
// Live brush stroke preview (paint mode): stamp onto the same ctx with the brush color.
const ls = brush.active.value && brush.mode.value === 'paint' ? brush.liveStroke() : null
if (ls && ls.points.length) {
  const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height
  const octx = off.getContext('2d')
  if (octx) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    stampStrokes(octx, [ls], W, () => document.createElement('canvas'))
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.globalCompositeOperation = 'source-in'
    octx.fillStyle = ls.erase ? 'rgba(255,255,255,0.5)' : brush.color.value
    octx.fillRect(0, 0, off.width, off.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(off, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
```
Import `stampStrokes` from `~/lib/compositor/brushStamp` at the top of the script.

- [ ] **Step 4: Cursor ring** — copy the gen ring div (L2494-2499); gate on `brush.active.value && brush.cursor.value`. Position it in artboard px (`cursor.x * canvasDisplay.w`), sized `brush.sizePx.value`:

```html
<div
  v-if="brush.active.value && brush.cursor.value"
  class="absolute pointer-events-none rounded-full border border-white/90 bg-white/10"
  :style="{ left: (brush.cursor.value.x * canvasDisplay.w - brush.sizePx.value / 2) + 'px', top: (brush.cursor.value.y * canvasDisplay.h - brush.sizePx.value / 2) + 'px', width: brush.sizePx.value + 'px', height: brush.sizePx.value + 'px', zIndex: 30 }"
/>
```
Clear on leave: add `brush.cursor.value = null` to the stage `@pointerleave` (near L2424). Toggle the stage `cursor-none` class when `brush.active.value` (near L2417). Add a `B` key → `toggleBrush` near the `V` shortcut (L618).

- [ ] **Step 5: Verify FillControl reaches brush layers** — inspect the layer properties panel section that renders `<FillControl>`. If it is gated (`v-if` on kinds like rect/ellipse/path), add `'brush'` to that condition so a selected brush layer exposes gradient/ombre/pattern/stripes fills. If it renders for any layer with a `fill`, no change needed.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): brush toolbar, options bar, live preview, cursor ring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Selection, hit-test, and layer-list label for the `brush` kind

Make a brush layer selectable/movable and correctly labeled. Brush layers carry `w`/`h`, so bounding-box math likely works; verify and patch the kind-specific gaps.

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (bounding box `boxPx`/`hitTest` if they switch on kind), and wherever the layer-list label is derived (search `kind === 'image'` label sites in `CompositorModal.vue` / `useCompositorLayers.ts`).

- [ ] **Step 1: Audit box/hit-test** — check `boxPx`, `handlePositions`, `hitTest` in `useLocalLayerEditor.ts`. If they read `layer.w`/`layer.h` generically (with defaults), brush layers get a bounding box free. If there's a `switch(kind)` that omits `brush`, add a case returning the `w`/`h` rectangle (same as `rect`).

- [ ] **Step 2: Add a label** — find the derived layer-name/icon map (e.g. a function turning `kind` → display string). Add `brush: 'Brush'` (and a `Brush` icon if the list shows per-kind icons).

- [ ] **Step 3: Verify** — `cd frontend && npm run test:unit -- layer-edits compositor` → PASS (no regressions). Manual selection verified in Task 7.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useLocalLayerEditor.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): select/hit-test/label support for brush layers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Brush Mask mode — paint reveal/erase on the selected layer

Mask mode paints freehand visibility onto the currently selected layer, stored as `maskStrokes` + `maskBase` on `LayerCommon`, applied `destination-in` when that layer renders.

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`LayerCommon` fields; apply mask in `drawLocalLayerSelf`/`paintLayer` path)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (`onBrushPointerUp` mask branch)
- Test: `frontend/tests/unit/brush-mask-strokes.unit.spec.ts`

**Interfaces:**
- Consumes: `stampStrokes` (Task 1), `PaintStroke`.
- Produces: on `LayerCommon`: `maskStrokes?: PaintStroke[]`, `maskBase?: 'visible' | 'hidden'`.

- [ ] **Step 1: Add fields** to `LayerCommon` (~L155):
```ts
maskStrokes?: import('~/lib/compositor/brushStamp').PaintStroke[] // freehand visibility painted on THIS layer
maskBase?: 'visible' | 'hidden'                                   // default 'visible'; erase hides, invert flips
```

- [ ] **Step 2: Failing test** — assert a layer with `maskStrokes` composites `destination-in` in `drawLocalLayerSelf`. Model on `layer-mask-composite.unit.spec.ts` recording ctx; assert an op runs under `destination-in`.

```ts
// frontend/tests/unit/brush-mask-strokes.unit.spec.ts — mirror layer-mask-composite's recordingCtx
// create a rect layer with maskStrokes and assert a destination-in composite occurs.
```

- [ ] **Step 3: Apply the mask** — in `drawLocalLayerSelf` (L810), after `paintLayer` renders the layer, if `layer.maskStrokes?.length || layer.maskBase === 'hidden'`, build a mask offscreen (base = device width), `maskBase==='visible'` → fill white then erase where `erase` strokes paint / add where paint strokes are; apply to the layer via `destination-in`. Reuse the offscreen recipe from `drawLocalLayer`'s mask path. Keep it in a helper `applyStrokeMask(ctx, layer, W, H)` to stay isolated.

Semantics: base `visible` → start all-white (fully visible); non-erase strokes keep white (no-op), erase strokes cut holes (`destination-out`). base `hidden` → start transparent; non-erase strokes paint white (reveal). This gives "brush hides, eraser un-hides" with `visible` base, and "brush reveals" with `hidden` base (invert).

- [ ] **Step 4: Commit path in the tool** — in `onBrushPointerUp` (Task 3), when `brush.mode.value === 'mask'`: require a selected non-brush layer; `setLocal(sel.id, { maskStrokes: [...(sel.maskStrokes ?? []), s] })`. If none selected, no-op (optionally flash a hint).

- [ ] **Step 5: Run tests + commit**

Run: `cd frontend && npm run test:unit -- brush-mask` → PASS.
```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/app/components/vue-canvas/CompositorModal.vue frontend/tests/unit/brush-mask-strokes.unit.spec.ts
git commit -m "feat(compositor): brush mask mode — paint reveal/erase on a layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Image-as-fill / painted-area-as-mask affordances + full browser verification

Surface the two `maskedByKey` entry points and verify the whole feature in the running app (all client-side — no paid API).

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (mask-source picker already exists for `maskedByKey`; ensure a brush layer appears as a selectable mask source and target; add an "Image…" affordance on the brush layer's fill row that links a chosen image layer via `maskedByKey` + `maskShowSource=false`).

- [ ] **Step 1: Mask wiring audit** — find the existing UI that sets `maskedByKey` (the "mask with another layer" control). Confirm a `brush` layer shows up in its source list and can be a target. Since masking is kind-agnostic in the renderer (verified: `drawLocalLayerSelf` dispatch), only the picker's list needs to include brush layers — patch if it filters kinds.

- [ ] **Step 2: Image-as-fill affordance** — on the brush layer properties (near `FillControl`), add a small "Fill with image…" button that: opens the existing image picker/add-image flow, then sets the new image layer's `maskedByKey` to the brush layer's `StackKey` (`l:<brushId>`) with `maskShowSource=false`. This reuses `addImageFromName`/`addImageFromFile` + `setLocal`.

- [ ] **Step 3: Browser verification** (dev server; painting is free):
  - Start via the project launcher (`./dev.sh` or `preview_start` name from `.claude/launch.json`); use `127.0.0.1` not `localhost` (WS listener).
  - Open a Frame → Compositor modal. Select Brush. Paint strokes; confirm they render live and commit.
  - Change fill to gradient, then a pattern (stripes/checkerboard) via `FillControl`; confirm the painted region fills correctly and identically in the node preview after closing.
  - Eraser carves; Flow < 100% builds; Soft > 0 feathers the edge.
  - "Fill with image…" shows an image through the painted shape; set a brush layer as the mask for a separate image via the mask picker — both directions.
  - Mask mode: select an image layer, paint to hide part, confirm reveal/erase.
  - Move/scale/rotate the brush layer; opacity/blend; ⌘Z removes the last stroke; `B` toggles the tool.
  - Export the frame; confirm the exported PNG matches the modal (same `paintLayerStack`).
  - Capture a screenshot for the user.

- [ ] **Step 4: Final unit run + commit**

Run: `cd frontend && npm run test:unit` → all pass (no regressions vs baseline).
```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): image-as-fill + brush-as-mask affordances

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Paint color pixels → Tasks 1–4 (brush layer + tool). ✓
- Fill set (gradient/ombre/pattern/stripes/etc.) → Task 2 render + Task 4 FillControl. ✓
- Image as fill → Task 7 step 2 (`maskedByKey`). ✓
- Painted area as mask for another image → Task 7 step 1 (`maskedByKey`, both directions). ✓
- Reveal/erase a layer (Mask mode) → Task 6. ✓
- Brush controls: color+size+eraser (Task 3/4), opacity/flow (Task 3/4), softness (Task 1 soft stamp + Task 4 slider), smoothing (Task 1 `smoothPoints`). ✓
- Undo unified with layer history → Task 3 (`addLocal`/`setLocal` record history). ✓
- One tool, Paint/Mask toggle → Task 4 mode toggle. ✓
- Modal-only v1, inline opens modal → scope honored (no inline UI). ✓

**Type consistency:** `PaintStroke` defined once in `brushStamp.ts`, re-exported from `useCompositorLayers`; `BrushLayer.kind === 'brush'` used consistently in factory, render branch, tool commit, selection, mask commit. `createBrushLayer` name stable across Tasks 2–3. `stampStrokes(ctx, strokes, base, makeCanvas)` signature stable across Tasks 1, 2, 4.

**Placeholder scan:** No TBD/TODO. The one deferred detail (per-stroke `smooth` persistence) is explicitly scoped out with a stated v1 behavior (always smooth at render).

**Risks/notes:**
- Per-stroke temp-canvas allocation in `stampStrokes` is O(strokes); acceptable for v1, pool later if the live overlay janks.
- Task 5/7 have audit steps (box/hit-test, mask-picker kind filter) whose exact edits depend on code found at execution time — each names the file and the concrete change to make.
- If `smoothing.value === false` must visibly disable smoothing in v1, add `smooth?: boolean` to `PaintStroke` and thread it into `smoothPoints`; deferred otherwise.
