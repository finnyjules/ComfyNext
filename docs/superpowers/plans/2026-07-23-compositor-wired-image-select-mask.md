# Compositor Wired-Image Select + Mask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Smart Select (the lasso) and the brush's freehand Mask mode work on **wired** images (connected through the Compositor's ports), not just local layers, via one new non-destructive primitive: a per-wired-slot raster visibility mask.

**Architecture:** A `maskUrl` raster (white = hidden) stored per slot in `sailor_wiredTreatments`, in the wired image's own pixel space. The shared `drawWiredImageLayer` pre-composites `image ⊗ mask` so the mask moves with the image across every frontend render surface. Brush strokes and smart-select silhouettes both write this one field.

**Tech Stack:** Vue 3 SFC (Nuxt 4), Canvas 2D, Replicate `meta/sam-2` (existing), vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-compositor-wired-image-select-mask-design.md`

## Global Constraints

- **Non-destructive:** the wired source is never modified. Delete/Cut-out and brush-mask only write the per-slot `maskUrl` (white = hidden, transparent = shown), in the wired image's capped pixel space.
- **Render parity (frontend):** the mask must apply everywhere `drawWiredImageLayer` renders — Compositor modal preview, `renderStaticComposite` (what "Generate as image" uploads), motion bake, and `ArtifactFrameNode`. Achieve this by changing the shared `drawWiredImageLayer`, not any one surface.
- **Backend is OUT OF SCOPE (documented follow-up):** wired slots stay live-wired to the Python compositor (`comfy_extras/nodes_compositor.py`), so a full backend pipeline run will NOT apply `maskUrl`. Only the frontend render path (incl. Generate-as-image) is covered here. Note this in the smart-select panel is not required, but the plan's final report must call it out.
- **CORS:** wired images are same-origin `/view` URLs (no `crossOrigin` needed, `getImageData` won't taint). Still, wrap pixel reads in try/catch and abort gracefully (toast) if a read ever throws — never crash.
- **Existing behavior unchanged:** when a slot has no `maskUrl`, `drawWiredImageLayer` must be byte-identical to today. When `wiredTreatments` has no `maskUrl` field, all existing surfaces render as before.
- **Local-layer paths untouched:** the just-landed local-image brush-mask fix (commit b72ac641d) and the local smart-select actions stay as they are; this plan only adds the wired branch.
- Typecheck: repo has ~400 pre-existing `vue-tsc` errors; only NEW errors in touched files matter (`npx vue-tsc --noEmit 2>&1 | grep -iE "<symbol>"`). Unit tests run in vitest `environment: 'node'` (no DOM) — pure helpers only.
- Git hygiene: stage ONLY this feature's files per task; parallel sessions dirty the tree. Never `git add -A`, never stash. Main-direct commits, each with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Dev URLs use `127.0.0.1`.

---

### Task 1: `wiredImageAffine` pure helper + unit tests

**Files:**
- Modify: `frontend/app/lib/compositor/smartSelect.ts`
- Test: `frontend/tests/unit/smart-select.unit.spec.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `Affine`, `Pt`, `applyAffine`, `invertAffine` from this file.
- Produces (used by Tasks 4–6):
  - `interface WiredXform { x: number; y: number; scale: number; rotation: number }`
  - `wiredImageAffine(layer: WiredXform, W: number, H: number, iw: number, ih: number, capW: number, capH: number): Affine` — maps artboard px → the wired image's CAPPED pixel space (capW×capH). `iw`/`ih` are the native image dims (for fit-contain); `capW`/`capH` are the capped dims the mask/SAM input use.

**Derivation (must match `drawWiredImageLayer`, useCompositorLayers.ts:1619-1634):** the image is fit-contained into `fitW×fitH` where `iAspect = iw/ih`, `cAspect = W/H`; if `iAspect > cAspect` then `fitW=W, fitH=W/iAspect` else `fitH=H, fitW=H*iAspect`. Then `translate(W/2 + x·W, H/2 + y·H) → rotate(rotation°) → scale(scale)`, and the native image maps into the `[-fitW/2, fitW/2]×[-fitH/2, fitH/2]` box. So an artboard point maps to capped-image px by inverting that chain and rescaling the box to capW×capH.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/smart-select.unit.spec.ts`:

```ts
import { wiredImageAffine } from '~/lib/compositor/smartSelect'

describe('wiredImageAffine', () => {
  // 1000×800 artboard, image 1600×1200 (iAspect 1.333 > cAspect 1.25 → fitW=1000, fitH=750),
  // centered (x=0,y=0), scale 1, no rotation, capped to 1024×768.
  const base = { x: 0, y: 0, scale: 1, rotation: 0 }
  it('maps the image center to the capped-image center', () => {
    const m = wiredImageAffine(base, 1000, 800, 1600, 1200, 1024, 768)
    const p = applyAffine(m, { x: 500, y: 400 }) // artboard center
    expect(p.x).toBeCloseTo(512, 4)
    expect(p.y).toBeCloseTo(384, 4)
  })
  it('maps the fit-box top-left corner to capped-image (0,0)', () => {
    const m = wiredImageAffine(base, 1000, 800, 1600, 1200, 1024, 768)
    // fitW=1000,fitH=750 centered → top-left at artboard (500-500, 400-375) = (0, 25)
    const p = applyAffine(m, { x: 0, y: 25 })
    expect(p.x).toBeCloseTo(0, 3)
    expect(p.y).toBeCloseTo(0, 3)
  })
  it('round-trips through the inverse', () => {
    const m = wiredImageAffine({ x: 0.1, y: -0.2, scale: 1.3, rotation: 22 }, 1000, 800, 1600, 1200, 1024, 768)
    const q = applyAffine(invertAffine(m), applyAffine(m, { x: 321, y: 234 }))
    expect(q.x).toBeCloseTo(321, 3)
    expect(q.y).toBeCloseTo(234, 3)
  })
  it('handles the tall-image fit branch (iAspect < cAspect)', () => {
    // image 600×1200 (iAspect .5 < 1.25) → fitH=800, fitW=400; centered.
    const m = wiredImageAffine(base, 1000, 800, 600, 1200, 512, 1024)
    const p = applyAffine(m, { x: 500, y: 400 })
    expect(p.x).toBeCloseTo(256, 4)
    expect(p.y).toBeCloseTo(512, 4)
  })
})
```

- [ ] **Step 2: Run — verify RED**

Run: `cd frontend && npx vitest run tests/unit/smart-select.unit.spec.ts`
Expected: FAIL — `wiredImageAffine` is not exported.

- [ ] **Step 3: Implement**

Append to `frontend/app/lib/compositor/smartSelect.ts`:

```ts
export interface WiredXform { x: number; y: number; scale: number; rotation: number }

/** Artboard px → a wired image's CAPPED pixel space, matching drawWiredImageLayer's
 *  fit-contain → translate → rotate → scale chain (useCompositorLayers.ts). The
 *  native image (iw×ih) fills a fitW×fitH box; we map that box onto capW×capH. */
export function wiredImageAffine(
  layer: WiredXform, W: number, H: number, iw: number, ih: number, capW: number, capH: number,
): Affine {
  const cAspect = W / H, iAspect = iw / (ih || 1)
  let fitW: number, fitH: number
  if (iAspect > cAspect) { fitW = W; fitH = W / iAspect } else { fitH = H; fitW = H * iAspect }
  // Compose forward (image-cap px → artboard px), then invert.
  // image-cap (0..capW,0..capH) → box (−fitW/2..fitW/2): bx = (cxp/capW − 0.5)·fitW
  // → scale · rotate · translate(center).
  const th = (layer.rotation * Math.PI) / 180
  const cos = Math.cos(th), sin = Math.sin(th)
  const s = layer.scale || 1e-6
  const cx = W / 2 + layer.x * W, cy = H / 2 + layer.y * H
  // Forward matrix F (cap px → artboard px):
  //   v = box(cap);  box_x = (capx/capW − .5)·fitW,  box_y = (capy/capH − .5)·fitH
  //   then p = center + s·R·box
  // a·capx + c·capy + e  with box linear in cap → fold constants.
  const kx = fitW / capW, ky = fitH / capH
  // box = [kx·capx − fitW/2, ky·capy − fitH/2]
  // R·box scaled by s, plus center:
  const Fa = s * cos * kx,  Fc = -s * sin * ky
  const Fb = s * sin * kx,  Fd = s * cos * ky
  const boxOffX = -fitW / 2, boxOffY = -fitH / 2
  const Fe = cx + s * (cos * boxOffX - sin * boxOffY)
  const Ff = cy + s * (sin * boxOffX + cos * boxOffY)
  return invertAffine({ a: Fa, b: Fb, c: Fc, d: Fd, e: Fe, f: Ff })
}
```

- [ ] **Step 4: Run — verify GREEN**

Run: `cd frontend && npx vitest run tests/unit/smart-select.unit.spec.ts`
Expected: PASS (all, including prior smart-select cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/smartSelect.ts frontend/tests/unit/smart-select.unit.spec.ts
git commit -m "feat(compositor): wiredImageAffine — artboard→wired-image px for smart select

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `WiredTreatment.maskUrl` + `setWiredMaskUrl` + unit tests

**Files:**
- Modify: `frontend/app/composables/useWiredTreatments.ts`
- Test: `frontend/tests/unit/wired-mask-plan.unit.spec.ts` (append; this file already tests wired treatments)

**Interfaces:**
- Produces (used by Tasks 3–6):
  - `WiredTreatment` gains `maskUrl?: string`.
  - `setWiredMaskUrl(node: any, slot: number, url: string): void` — sets/clears `maskUrl` on `w:<slot>`, dropping the field (and the entry if now empty) when `url` is falsy. Preserves `maskedByKey`/`showSource`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/wired-mask-plan.unit.spec.ts` (mirror the existing `setWiredMask` tests in that file — read them first for the node-shape helper):

```ts
import { setWiredMaskUrl, readWiredTreatments } from '~/composables/useWiredTreatments'

describe('setWiredMaskUrl', () => {
  const mkNode = () => ({ data: { properties: {} as any } })
  it('sets a maskUrl on the slot key', () => {
    const n = mkNode()
    setWiredMaskUrl(n, 2, 'data:img/png;base64,AAAA')
    expect(readWiredTreatments(n)['w:2']).toEqual({ maskUrl: 'data:img/png;base64,AAAA' })
  })
  it('preserves an existing maskedByKey on the same slot', () => {
    const n = mkNode()
    n.data.properties.sailor_wiredTreatments = { 'w:1': { maskedByKey: 'l:x', showSource: true } }
    setWiredMaskUrl(n, 1, 'data:MASK')
    expect(readWiredTreatments(n)['w:1']).toEqual({ maskedByKey: 'l:x', showSource: true, maskUrl: 'data:MASK' })
  })
  it('clears maskUrl and drops the entry when empty', () => {
    const n = mkNode()
    n.data.properties.sailor_wiredTreatments = { 'w:1': { maskUrl: 'data:MASK' } }
    setWiredMaskUrl(n, 1, '')
    expect(readWiredTreatments(n)['w:1']).toBeUndefined()
  })
  it('clears maskUrl but keeps the entry when other fields remain', () => {
    const n = mkNode()
    n.data.properties.sailor_wiredTreatments = { 'w:1': { maskUrl: 'data:MASK', maskedByKey: 'l:x' } }
    setWiredMaskUrl(n, 1, '')
    expect(readWiredTreatments(n)['w:1']).toEqual({ maskedByKey: 'l:x' })
  })
})
```

- [ ] **Step 2: Run — verify RED**

Run: `cd frontend && npx vitest run tests/unit/wired-mask-plan.unit.spec.ts`
Expected: FAIL — `setWiredMaskUrl` not exported.

- [ ] **Step 3: Implement**

In `frontend/app/composables/useWiredTreatments.ts`: add `maskUrl?: string` to the `WiredTreatment` interface, and add (mirroring `setWiredMask`'s drop-when-empty logic exactly):

```ts
/** Set/clear the per-slot raster visibility mask (data URL, white = hidden).
 *  Empty url clears the field, dropping the entry if nothing else remains. */
export function setWiredMaskUrl(node: any, slot: number, url: string) {
  const key = `w:${slot}`
  const cur = { ...readWiredTreatments(node) }
  if (url) {
    cur[key] = { ...cur[key], maskUrl: url }
  } else {
    const t = { ...cur[key] }
    delete t.maskUrl
    if (Object.keys(t).length) cur[key] = t
    else delete cur[key]
  }
  writeWiredTreatments(node, cur)
}
```

(`writeWiredTreatments` is the existing private helper in the file.)

- [ ] **Step 4: Run — verify GREEN**

Run: `cd frontend && npx vitest run tests/unit/wired-mask-plan.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useWiredTreatments.ts frontend/tests/unit/wired-mask-plan.unit.spec.ts
git commit -m "feat(compositor): WiredTreatment.maskUrl + setWiredMaskUrl (per-slot visibility mask)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Apply the wired mask in the shared renderer + thread decoded masks

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`drawWiredImageLayer`)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (mask-image cache + closure)
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` (mask-image cache + closure)

**Interfaces:**
- Consumes: `WiredTreatment.maskUrl` (Task 2).
- Produces: `drawWiredImageLayer(ctx, img, layer, W, H, maskImg?)` — optional 6th param; when present and decodable, hidden regions are cut. Byte-identical when absent.

- [ ] **Step 1: Extend `drawWiredImageLayer` (pre-composite image ⊗ mask)**

The mask is in the image's pixel space, so composite once into a scratch canvas, then the cloner loop draws the masked image unchanged. In `useCompositorLayers.ts`, change the signature and add the pre-composite before the cloner loop:

```ts
export function drawWiredImageLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement | undefined | null,
  layer: WiredTransform,
  W: number,
  H: number,
  maskImg?: HTMLImageElement | HTMLCanvasElement | null,   // white = hidden, image pixel space
) {
  if (!img) return
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width
  const ih = 'naturalHeight' in img ? img.naturalHeight : img.height
  if (!iw || !ih) return
  if ('complete' in img && !img.complete) return
  // Apply the per-slot visibility mask ONCE (destination-out by the mask's alpha),
  // then the cloner loop draws the masked pixels exactly as it drew the plain image.
  let src: HTMLImageElement | HTMLCanvasElement = img
  const mReady = maskImg && (!('complete' in maskImg) || maskImg.complete)
    && (('naturalWidth' in maskImg ? maskImg.naturalWidth : maskImg.width) > 0)
  if (mReady) {
    const off = document.createElement('canvas'); off.width = iw; off.height = ih
    const octx = off.getContext('2d')
    if (octx) {
      octx.drawImage(img, 0, 0, iw, ih)
      octx.globalCompositeOperation = 'destination-out'
      octx.drawImage(maskImg as CanvasImageSource, 0, 0, iw, ih)
      src = off
    }
  }
  const cAspect = W / H, iAspect = iw / ih
  let fitW: number, fitH: number
  if (iAspect > cAspect) { fitW = W; fitH = W / iAspect } else { fitH = H; fitW = H * iAspect }
  const op = WIRED_BLEND_OP[layer.blend] ?? 'source-over'
  for (const c of expandClones(layer.cloner, W / H)) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * c.dopacity))
    ctx.globalCompositeOperation = op
    ctx.translate(W / 2 + (layer.x + c.dx) * W, H / 2 + (layer.y + c.dy) * H)
    const rot = layer.rotation + c.drot
    if (rot) ctx.rotate((rot * Math.PI) / 180)
    ctx.scale(layer.scale * c.dscale, layer.scale * c.dscale)
    ctx.drawImage(src, -fitW / 2, -fitH / 2, fitW, fitH)
    ctx.restore()
  }
}
```

The mask is stored white-on-transparent = hidden, so `destination-out` erases exactly the hidden regions. `document` is available in every surface that calls this (all render in the browser).

- [ ] **Step 2: Modal — decode + cache the per-slot mask, pass it to the closure**

In `CompositorModal.vue`, near `wiredImageEls` (line ~1275), add a decoded-mask cache keyed by slot, kept in sync with `wiredTreatments`:

```ts
const wiredMaskEls = ref<Record<number, HTMLImageElement | null>>({})
watch(wiredTreatments, (tr) => {
  for (const [key, t] of Object.entries(tr)) {
    const m = /^w:(\d+)$/.exec(key); if (!m) continue
    const slot = Number(m[1]); const url = (t as any).maskUrl as string | undefined
    if (!url) { if (wiredMaskEls.value[slot]) { const n = { ...wiredMaskEls.value }; delete n[slot]; wiredMaskEls.value = n } continue }
    const cur = wiredMaskEls.value[slot]
    if (cur && cur.dataset.url === url) continue
    const im = new Image(); im.onload = () => { im.dataset.url = url; wiredMaskEls.value = { ...wiredMaskEls.value, [slot]: im }; renderStack() }
    im.src = url
  }
}, { deep: true, immediate: true })
```

Update `drawWiredLayer` (line ~1333):

```ts
function drawWiredLayer(ctx: CanvasRenderingContext2D, layer: Layer, W: number, H: number) {
  drawWiredImageLayer(ctx, wiredImageEls.value[layer.slot], layer, W, H, wiredMaskEls.value[layer.slot] ?? null)
}
```

- [ ] **Step 3: ArtifactFrameNode — same cache keyed by url**

In `ArtifactFrameNode.vue`, mirror the modal: add a `wiredMasks` cache keyed by the slot's `url` (its cache key), synced from `wiredTreatments` (which is `readWiredTreatments({ data: props.data })`), and pass `wiredMasks.value[l.url] ?? null` as the 6th arg in its `drawWiredLayer` (line ~446). Trigger its `renderStack` on mask decode. (Mask key: resolve `w:<slot>` → the layer's `url` via the same `stackKeys`/`resolveKey` the file already uses.)

- [ ] **Step 4: Verify render parity (compile + no-mask byte-identity)**

- `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "drawWiredImageLayer|wiredMask"` → no NEW errors.
- Serve-compile: `curl -s "http://127.0.0.1:<devport>/_nuxt/components/vue-canvas/CompositorModal.vue" | grep -c wiredMaskEls` → ≥ 2.
- Existing golden/parity tests still pass: `cd frontend && npx vitest run tests/unit/wired-mask-plan.unit.spec.ts` and any `*parity*`/`*golden*` unit spec that touches the compositor.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useCompositorLayers.ts frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/components/vue-canvas/ArtifactFrameNode.vue
git commit -m "feat(compositor): drawWiredImageLayer applies a per-slot visibility mask (all frontend surfaces)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Brush Mask mode → wired images

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: `setWiredMaskUrl` (Task 2), `wiredImageAffine` + `applyAffine`/`invertAffine` (Task 1), `wiredImageEls`, `selectedSlot`, `compositor`, `capDims`.
- Produces: brush Mask strokes hide/restore regions of a selected wired image via its `maskUrl`.

**Context:** local mask writes `setLocal(sel.id, { maskStrokes })` in `onBrushPointerUp` (the mask branch). Wired images have no `selectedLocal`; they're `selectedSlot`. The brush paints in artboard-normalized coords; map each stamp into the wired image's capped pixel space and accumulate into a live per-slot mask canvas, persisting to `maskUrl` on stroke end.

- [ ] **Step 1: Add a wired mask-target resolver + live canvas**

Add near the smart-select section:

```ts
// The wired image slot currently eligible as a brush/smart mask target (a
// selected wired image with a ready element), else null.
function selectedWiredImage(): { slot: number; el: HTMLImageElement | HTMLCanvasElement } | null {
  const slot = selectedSlot.value
  if (slot == null) return null
  const el = wiredImageEls.value[slot]
  return el ? { slot, el } : null
}
// Live per-slot mask canvas (capped image px) seeded from the slot's maskUrl.
let wiredBrushMask: { slot: number; canvas: HTMLCanvasElement } | null = null
async function ensureWiredBrushMask(slot: number, el: HTMLImageElement | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  if (wiredBrushMask?.slot === slot) return wiredBrushMask.canvas
  const iw = ('naturalWidth' in el ? el.naturalWidth : el.width) || 1
  const ih = ('naturalHeight' in el ? el.naturalHeight : el.height) || 1
  const { w: capW, h: capH } = capDims(iw, ih)
  const c = document.createElement('canvas'); c.width = capW; c.height = capH
  const existing = wiredTreatments.value[`w:${slot}`]?.maskUrl
  if (existing) { try { const im = await loadImage(existing); c.getContext('2d')!.drawImage(im, 0, 0, capW, capH) } catch { /* start empty */ } }
  wiredBrushMask = { slot, canvas: c }
  return c
}
```

- [ ] **Step 2: Extend the mask-target check + the "Select a layer to mask" hint**

The hint (`CompositorModal.vue` template, `v-if="brush.mode.value === 'mask' && !(selectedLocal && selectedLocal.kind !== 'brush')"`) must also treat a selected wired image as a valid target. Change the condition to:

```
v-if="brush.mode.value === 'mask' && !((selectedLocal && selectedLocal.kind !== 'brush') || selectedWiredImage())"
```

- [ ] **Step 3: Write wired mask strokes in `onBrushPointerUp`**

In the mask branch of `onBrushPointerUp`, before the local `setLocal` path, handle a selected wired image. The stroke `s` is width-normalized (artboard). Rasterize it into the live wired mask canvas through the artboard→image affine, then persist:

```ts
  if (brush.mode.value === 'mask') {
    const wired = selectedWiredImage()
    if (wired) {
      const el = wired.el
      const iw = ('naturalWidth' in el ? el.naturalWidth : el.width) || 1
      const ih = ('naturalHeight' in el ? el.naturalHeight : el.height) || 1
      const { w: capW, h: capH } = capDims(iw, ih)
      const canvas = await ensureWiredBrushMask(wired.slot, el)
      const mctx = canvas.getContext('2d')!
      const aff = wiredImageAffine(
        { x: (compositorLayer(wired.slot)?.x ?? 0), y: (compositorLayer(wired.slot)?.y ?? 0),
          scale: (compositorLayer(wired.slot)?.scale ?? 1), rotation: (compositorLayer(wired.slot)?.rotation ?? 0) },
        canvasDisplay.w, canvasDisplay.h, iw, ih, capW, capH,
      )
      stampWidthNormStrokeToMask(mctx, s, aff, capW, canvasDisplay.w)   // helper below
      setWiredMaskUrl(compositor.value, wired.slot, canvas.toDataURL('image/png'))
      renderStack()
      return
    }
    const sel = selectedLocal.value
    if (sel && sel.kind !== 'brush') setLocal(sel.id, { maskStrokes: [...(sel.maskStrokes ?? []), s] })
    return
  }
```

Where `compositorLayer(slot)` returns the wired `Layer` for a slot (`layers.value.find(l => l.slot === slot)`), and `stampWidthNormStrokeToMask` maps the stroke's width-normalized points through `aff` and paints them into the mask canvas (white to hide, or `destination-out` to restore for an eraser stroke). Implement it next to the smart-select helpers:

```ts
// Paint a width-normalized brush stroke into a wired image's mask canvas
// (image px). Plain stroke → WHITE (hide); erase stroke → destination-out (restore).
function stampWidthNormStrokeToMask(mctx: CanvasRenderingContext2D, s: any, aff: import('~/lib/compositor/smartSelect').Affine, capW: number, artW: number) {
  const pts = (s.points ?? []).map((p: any) => applyAffine(aff, { x: p.x * artW, y: p.y * artW /* width-normalized */ }))
  if (!pts.length) return
  // width-normalized stroke radius → artboard px → image px scale (uniform via |aff|).
  const scale = Math.hypot(aff.a, aff.b)
  const r = Math.max(1, (s.size ?? 0.02) * artW * scale / 2)
  mctx.save()
  mctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#fff'; mctx.lineCap = 'round'; mctx.lineJoin = 'round'; mctx.lineWidth = r * 2
  mctx.beginPath(); mctx.moveTo(pts[0].x, pts[0].y)
  for (const p of pts.slice(1)) mctx.lineTo(p.x, p.y)
  mctx.stroke()
  for (const p of pts) { mctx.beginPath(); mctx.arc(p.x, p.y, r, 0, Math.PI * 2); mctx.fill() }
  mctx.restore()
}
```

NOTE for the implementer: confirm the `PaintStroke` shape (`s.points`, `s.size`, `s.erase`) against `frontend/app/lib/compositor/brushStamp.ts` and the local `stampStrokes`; adapt field names to match exactly. The stroke's coordinate normalization (width-normalized x AND y) must match how `toWidthNorm`/`beginStroke` store it (see `onBrushPointerDown`).

- [ ] **Step 4: Reset the live mask when the target/slot changes or mode exits**

Clear `wiredBrushMask = null` when `selectedSlot` changes, when the brush deactivates, and when brush mode flips to paint — so a stale slot's canvas isn't reused. Add to the existing `watch(selectedSlot, …)` / brush watchers.

- [ ] **Step 5: Verify in the running app (wired image)**

There is no unit test for SFC brush wiring. Verify live (see Task 7 harness for wiring an image): select a wired image → Brush → Mask → paint → the painted region disappears from the wired image; switch to Eraser → paint back → it restores; move/scale the wired image → the hidden region tracks it. Confirm `compositor.value.data.properties.sailor_wiredTreatments['w:<slot>'].maskUrl` is set.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): brush Mask mode hides/restores regions of a wired image

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Smart Select → wired images (enable + capture + New layer / Use as mask)

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: `wiredImageAffine` (Task 1), `selectedWiredImage`/`compositorLayer` (Task 4), existing smart-select state (`smart`, `smartCapture`, `smartActive`, `smartRefinedCanvas`, actions).
- Produces: the lasso works on a selected wired image; New layer + Use as mask produce local layers as today.

**Context:** the current smart-select code assumes a LOCAL target (`smartTarget = localLayers.find(...)`, `smartAffine()` from `layerAffine`, `smartCapture` from `imageLayerUrl(layer.filename)`). Generalize the target to `{ type:'local', layer } | { type:'wired', slot, el }` and branch capture + affine.

- [ ] **Step 1: Generalize the smart target + enable condition**

Replace the local-only `smartTarget`/`smartTargetId` with a unified target captured at `enterSmartMode`:

```ts
type SmartTarget = { type: 'local'; layer: any } | { type: 'wired'; slot: number; el: HTMLImageElement | HTMLCanvasElement }
const smartTargetRef = ref<SmartTarget | null>(null)
```

In `enterSmartMode`, set it from a selected local image OR a selected wired image (`selectedWiredImage()`). The lasso `:disabled` (line ~3626) becomes:

```
:disabled="!smartActive && selectedLocal?.kind !== 'image' && !selectedWiredImage()"
```

and its `:title` mirrors (enabled when either is selected).

- [ ] **Step 2: Branch capture + affine on target type**

`ensureSmartCapture()` and `smartAffine()` gain a wired branch:
- Wired capture: `el = target.el`; `iw/ih` from the element; `{capW,capH}=capDims(iw,ih)`; draw `el` into the capped offscreen for `dataUrl`; wrap the `getImageData`/`toDataURL` in try/catch → on throw, toast "Can't read this image's pixels — try adding it directly" and abort smart mode.
- Wired affine: `wiredImageAffine(compositorLayer(slot)!, canvasDisplay.w, canvasDisplay.h, iw, ih, capW, capH)`.
- Local branch: unchanged (`layerAffine`, `imageLayerUrl`).

Keep `smartCapture` shape `{ img?, el?, capW, capH, dataUrl }` so downstream extraction works for both (extraction reads from the capped source).

- [ ] **Step 3: New layer / Use as mask — confirm they already work for wired**

These actions extract masked pixels (image space) → upload → `addImageFromName` (a new LOCAL layer) / stencil + `maskedByKey`. They depend only on `smartCapture` + `smartAffine` + `cutoutPlacement`. Verify `cutoutPlacement` receives the wired transform correctly: it currently takes a local-layer box. Add a wired variant or generalize it to place the extracted crop at the wired image's position using the inverse wired affine (map the crop bbox center from image px → artboard, and size from capped px → artboard). Implement `wiredCutoutPlacement(bbox, slot, capW, capH, W, H)` in `smartSelect.ts` (pure, unit-tested — one case) mirroring `cutoutPlacement` but via `wiredImageAffine`'s inverse.

- [ ] **Step 4: Verify live (wired)** — New layer lifts a copy correctly positioned over the wired image; Use as mask adds a stencil that clips another layer. (Full E2E in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/lib/compositor/smartSelect.ts frontend/tests/unit/smart-select.unit.spec.ts
git commit -m "feat(compositor): smart select works on wired images (enable, capture, new-layer/mask)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Smart Select wired Delete / Cut out (non-destructive) + hide Generate fill

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: `setWiredMaskUrl`, `smartRefinedCanvas`/selection silhouette (image space, capped), `wiredTreatments`, `capDims`, `loadImage`.
- Produces: Delete/Cut-out hide the region on a wired slot's `maskUrl`; Generate fill is not offered for wired targets.

- [ ] **Step 1: `smartBakeHole` → wired branch (OR the silhouette into maskUrl)**

For a wired target, instead of baking pixels, composite the refined selection silhouette (already in capped image space) into the slot's existing mask:

```ts
async function smartHideWired(slot: number, capW: number, capH: number, silhouette: HTMLCanvasElement) {
  const c = document.createElement('canvas'); c.width = capW; c.height = capH
  const ctx = c.getContext('2d')!
  const existing = wiredTreatments.value[`w:${slot}`]?.maskUrl
  if (existing) { try { ctx.drawImage(await loadImage(existing), 0, 0, capW, capH) } catch { /* start fresh */ } }
  // silhouette is white where selected → OR it in as white (hidden).
  ctx.drawImage(silhouette, 0, 0, capW, capH)
  setWiredMaskUrl(compositor.value, slot, c.toDataURL('image/png'))
  renderStack()
}
```

Wire `smartDelete` (wired branch) → `smartHideWired(...)`; `smartCutOut` (wired branch) → New-layer extract **then** `smartHideWired(...)`. The silhouette source is the refined mask in image space (the same canvas used to build `smartRefinedCanvas`); ensure it's white-on-transparent where selected (it is, per the smart-select mask normalization).

- [ ] **Step 2: Hide Generate fill for wired targets**

In the action bar template, the Generate-fill button gets `v-if` (or `:disabled`) so it is NOT offered when `smartTargetRef?.type === 'wired'`. The other four actions stay. Keep a one-line comment that wired generate-fill is a deferred follow-up.

- [ ] **Step 3: Verify live (wired)** — Delete hides the scribbled region non-destructively (undo restores; the wired source is untouched); Cut out lifts a copy AND hides the region; Generate fill is absent for wired. (Full E2E in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): smart-select Delete/Cut-out hide wired regions non-destructively; defer wired generate-fill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E verification with a real wired image

**Files:** none (verification; fix-forward into the task files above).

This exercises the paid SAM path once for the wired smart-select flow.

- [ ] **Step 1: Build a wired-image scene**

In the running app (dev server on 127.0.0.1; ComfyUI on :8188): create a blank project → add a **LoadImage** (or Image artifact) node with a real image in ComfyUI's input dir → add a **Compositor** node → wire the image node's output into the Compositor's image input port. Open the Compositor. Confirm the wired image renders and its row appears in the Layers panel as a wired slot.

Harness tips (from prior sessions): patch `Element.prototype.setPointerCapture = ()=>{}` before synthetic pointer events; the `javascript_tool` 30s cap kills only the caller (page-side async keeps running); the action bar's `[data-smart-bar]` guard can eat drag-starts near the selection.

- [ ] **Step 2: Verify smart select on the wired image**

1. Select the wired slot → the lasso button is **enabled** (was the bug).
2. Scribble over an object → refined selection + action bar.
3. **New layer** → a new local layer lifts a copy positioned over the wired image.
4. **Cut out** → copy lifted AND the region hidden on the wired image (source file untouched); undo restores.
5. **Delete** → region hidden non-destructively; undo restores.
6. **Use as mask** → stencil layer added; clips another layer.
7. **Generate fill** is not shown for the wired target.
8. Move/scale the wired image → the hidden region tracks the image.

- [ ] **Step 3: Verify brush mask on the wired image**

Select the wired slot → Brush → Mask → paint → region hides; Eraser → restores; the mask persists on reopen (`sailor_wiredTreatments['w:<slot>'].maskUrl`).

- [ ] **Step 4: Verify Generate-as-image carries the mask (frontend render)**

With a wired region hidden, use the compositor's **Generate as image** → the produced artifact shows the hidden region (confirms `renderStaticComposite` applies the wired mask). Note in the report that a full BACKEND pipeline run does NOT yet apply it (documented follow-up).

- [ ] **Step 5: Update memory + report**

Record landed state, the backend-follow-up gap, and any residual minors in the auto-memory.
