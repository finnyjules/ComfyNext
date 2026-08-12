# Shape Image Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user fill any shape in a Frame with an image picked from a node on the canvas, with Cover/Contain/Tile/Stretch fit plus scale and X/Y offset.

**Architecture:** Add an `ImageFill` variant to the compositor `Paint` union. It resolves to a `CanvasPattern` via `resolvePaint`, reading decoded bitmaps from a shared cache that every render host preloads through the existing `ensureLayerImages` choke point — so the Frame node, Compositor modal, and export bake stay pixel-identical. A picker in `FillControl.vue` snapshots the chosen node's image URL.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (node env), HTML Canvas 2D.

## Global Constraints

- Render parity is a known hazard: all fill rendering MUST go through the shared `~/lib/paint/resolve.ts` / `~/lib/compositor/paint.ts` modules — never a per-surface copy.
- Module DAG (no cycles): `imageFillCache.ts` (leaf) ← `paint.ts` ← `resolve.ts`. `paint.ts` stays CPU-only at module scope (DOM only inside function bodies), matching its existing header contract.
- `ImageFill` is plain JSON (serializes with the layer). Reference is a **snapshot** URL — never a live node id.
- Fit modes: `'cover' | 'contain' | 'tile' | 'stretch'`. Extra controls: `scale` (default 1), `offset` (fraction of box, 0-centered, default `{x:0,y:0}`).
- Image picker is offered on **fill only** in v1 (stroke stays solid/gradient/pattern).
- Frontend commands run from `frontend/`: `cd frontend && npx vitest run <file>`.

---

### Task 1: `ImageFill` type, guard, and `hasPaint` awareness

**Files:**
- Modify: `frontend/app/lib/compositor/paint.ts` (add type + guard, near `isFill`)
- Modify: `frontend/app/lib/paint/resolve.ts:92-96` (`hasPaint`)
- Modify: `frontend/app/composables/useCompositorLayers.ts:70-73` (re-export)
- Test: `frontend/tests/unit/image-fill-model.unit.spec.ts`

**Interfaces:**
- Produces: `interface ImageFill { type: 'image'; src: string; fit: 'cover'|'contain'|'tile'|'stretch'; scale?: number; offset?: { x: number; y: number } }`; `type Paint = string | Gradient | Fill | ImageFill`; `isImageFill(p: Paint | undefined): p is ImageFill`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/image-fill-model.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isImageFill, isFill, isGradient, type ImageFill } from '~/lib/compositor/paint'
import { hasPaint } from '~/lib/paint/resolve'

const img: ImageFill = { type: 'image', src: '/view?filename=a.png&type=input', fit: 'cover' }

describe('ImageFill model', () => {
  it('isImageFill matches only an image paint', () => {
    expect(isImageFill(img)).toBe(true)
    expect(isImageFill('#fff')).toBe(false)
    expect(isImageFill({ type: 'linear', angle: 0, stops: [] } as any)).toBe(false)
    expect(isImageFill({ a: '#fff', density: 4, type: 'grid' } as any)).toBe(false)
  })

  it('does not confuse an ImageFill with a Fill or Gradient', () => {
    expect(isFill(img)).toBe(false)
    expect(isGradient(img)).toBe(false)
  })

  it('hasPaint is true only when src is non-empty', () => {
    expect(hasPaint(img)).toBe(true)
    expect(hasPaint({ ...img, src: '' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/image-fill-model.unit.spec.ts`
Expected: FAIL — `isImageFill` is not exported.

- [ ] **Step 3: Add the type and guard to `paint.ts`**

In `frontend/app/lib/compositor/paint.ts`, after the `Gradient` type and before `Paint`:

```ts
export interface ImageFill {
  type: 'image'
  src: string                              // snapshot URL of the picked node's image
  fit: 'cover' | 'contain' | 'tile' | 'stretch'
  scale?: number                           // default 1
  offset?: { x: number; y: number }        // fraction of box, 0-centered; default {0,0}
}
export type Paint = string | Gradient | Fill | ImageFill
```

And after `isFill`:

```ts
// An ImageFill is the only Paint whose discriminant `type` is 'image'.
export function isImageFill(p: Paint | undefined): p is ImageFill {
  return !!p && typeof p === 'object' && (p as ImageFill).type === 'image' && 'src' in p
}
```

- [ ] **Step 4: Teach `hasPaint` about it**

In `frontend/app/lib/paint/resolve.ts`, update the import from `~/lib/compositor/paint` to include `isImageFill` and `type ImageFill`, then add to `hasPaint` (before the final `return`):

```ts
export function hasPaint(paint: Paint | undefined): boolean {
  if (isImageFill(paint)) return !!paint.src
  if (isFill(paint)) return true
  if (isGradient(paint)) return paint.stops.length > 0
  return !!paint && paint !== 'none' && paint !== 'transparent'
}
```

- [ ] **Step 5: Re-export from the composable**

In `frontend/app/composables/useCompositorLayers.ts`, add `type ImageFill` and `isImageFill` to the `export { … } from '~/lib/compositor/paint'` block (lines 70-73):

```ts
export {
  type GradientStop, type LinearGradient, type RadialGradient, type Gradient, type Paint, type ImageFill,
  isGradient, isFill, isImageFill,
} from '~/lib/compositor/paint'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/image-fill-model.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/compositor/paint.ts frontend/app/lib/paint/resolve.ts frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/image-fill-model.unit.spec.ts
git commit -m "feat(compositor): ImageFill paint variant + guard"
```

---

### Task 2: `imageFillRect` — pure object-fit math

**Files:**
- Modify: `frontend/app/lib/compositor/paint.ts` (add exported pure helper)
- Test: `frontend/tests/unit/image-fill-rect.unit.spec.ts`

**Interfaces:**
- Produces: `imageFillRect(fit: 'cover'|'contain'|'stretch', iw: number, ih: number, tw: number, th: number, scale?: number, offset?: { x: number; y: number }): { dx: number; dy: number; dw: number; dh: number }` — the destination rect (in tile px) to draw the source image into. `'tile'` is handled by the caller, not here.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/image-fill-rect.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { imageFillRect } from '~/lib/compositor/paint'

describe('imageFillRect', () => {
  it('cover fills the box and crops the overflow (centered)', () => {
    // 100x100 image into a 200x100 box → scale 2 → 200x200, vertically crop-centered
    expect(imageFillRect('cover', 100, 100, 200, 100)).toEqual({ dx: 0, dy: -50, dw: 200, dh: 200 })
  })

  it('contain fits inside and letterboxes (centered)', () => {
    expect(imageFillRect('contain', 100, 100, 200, 100)).toEqual({ dx: 50, dy: 0, dw: 100, dh: 100 })
  })

  it('stretch fills exactly, ignoring aspect', () => {
    expect(imageFillRect('stretch', 100, 100, 200, 100)).toEqual({ dx: 0, dy: 0, dw: 200, dh: 100 })
  })

  it('scale zooms about the center', () => {
    // contain base 100x100, scale 2 → 200x200, dx=(200-200)/2=0, dy=(100-200)/2=-50
    expect(imageFillRect('contain', 100, 100, 200, 100, 2)).toEqual({ dx: 0, dy: -50, dw: 200, dh: 200 })
  })

  it('offset shifts by a fraction of the box', () => {
    const r = imageFillRect('contain', 100, 100, 200, 100, 1, { x: 0.1, y: -0.2 })
    expect(r.dx).toBeCloseTo(50 + 20)   // +0.1*200
    expect(r.dy).toBeCloseTo(0 - 20)    // -0.2*100
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/image-fill-rect.unit.spec.ts`
Expected: FAIL — `imageFillRect` is not exported.

- [ ] **Step 3: Implement the helper in `paint.ts`**

Add to `frontend/app/lib/compositor/paint.ts` (pure — no DOM, safe at module scope):

```ts
/** Destination rect (tile px) to draw a source image into a tw×th tile per `fit`,
 *  then zoomed by `scale` and shifted by `offset` (fraction of the tile). Pure.
 *  `'tile'` is NOT handled here — the caller builds a repeating cell instead. */
export function imageFillRect(
  fit: 'cover' | 'contain' | 'stretch',
  iw: number, ih: number, tw: number, th: number,
  scale = 1, offset: { x: number; y: number } = { x: 0, y: 0 },
): { dx: number; dy: number; dw: number; dh: number } {
  const s = scale > 0 ? scale : 1
  let dw: number, dh: number
  if (fit === 'stretch') { dw = tw * s; dh = th * s }
  else {
    const base = fit === 'cover' ? Math.max(tw / iw, th / ih) : Math.min(tw / iw, th / ih)
    dw = iw * base * s; dh = ih * base * s
  }
  const dx = (tw - dw) / 2 + (offset.x || 0) * tw
  const dy = (th - dh) / 2 + (offset.y || 0) * th
  return { dx, dy, dw, dh }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/image-fill-rect.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/paint.ts frontend/tests/unit/image-fill-rect.unit.spec.ts
git commit -m "feat(compositor): imageFillRect object-fit math"
```

---

### Task 3: Shared image-fill bitmap cache

**Files:**
- Create: `frontend/app/lib/paint/imageFillCache.ts`
- Test: `frontend/tests/unit/image-fill-cache.unit.spec.ts`

**Interfaces:**
- Produces: `getFillBitmap(src: string): HTMLImageElement | null` (synchronous, returns only a decoded bitmap); `ensureFillBitmaps(srcs: string[], onReady?: () => void): Promise<void>` (preload; no-op server-side).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/image-fill-cache.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getFillBitmap, ensureFillBitmaps } from '~/lib/paint/imageFillCache'

// Node env: no `window`, so ensureFillBitmaps is a no-op and nothing decodes.
describe('imageFillCache', () => {
  it('getFillBitmap returns null for an unknown src', () => {
    expect(getFillBitmap('/view?filename=nope.png&type=input')).toBeNull()
  })

  it('ensureFillBitmaps resolves and is a no-op without a DOM', async () => {
    await expect(ensureFillBitmaps(['/view?filename=a.png&type=input', ''])).resolves.toBeUndefined()
    expect(getFillBitmap('/view?filename=a.png&type=input')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/image-fill-cache.unit.spec.ts`
Expected: FAIL — module `~/lib/paint/imageFillCache` not found.

- [ ] **Step 3: Implement the cache**

Create `frontend/app/lib/paint/imageFillCache.ts`:

```ts
/**
 * Decoded-bitmap cache for `ImageFill` paints, keyed by the fill's snapshot
 * `src`. The synchronous `resolvePaint`/`paintTileBox` arms read it via
 * `getFillBitmap`; render hosts fill it ahead of the paint pass via
 * `ensureFillBitmaps` (wired into `ensureLayerImages`) — the same
 * preload-then-paint shape image LAYERS already use. DOM is touched only inside
 * function bodies, so this stays importable by the CPU-only `lib/` modules.
 */
const cache = new Map<string, HTMLImageElement>()
const inFlight = new Set<string>()

/** A decoded bitmap for `src`, or null if it isn't loaded yet / failed. */
export function getFillBitmap(src: string): HTMLImageElement | null {
  const im = cache.get(src)
  return im && im.complete && im.naturalWidth > 0 ? im : null
}

/** Decode every `src` not already loaded/in-flight. Resolves when this call's
 *  jobs settle. `onReady` fires per successful decode so a host can re-render. */
export function ensureFillBitmaps(srcs: string[], onReady?: () => void): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const jobs: Promise<unknown>[] = []
  for (const src of srcs) {
    if (!src) continue
    if (getFillBitmap(src) || inFlight.has(src)) continue
    inFlight.add(src)
    jobs.push(new Promise((res) => {
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => { cache.set(src, im); inFlight.delete(src); onReady?.(); res(null) }
      im.onerror = () => { inFlight.delete(src); res(null) }
      im.src = src
    }))
  }
  return jobs.length ? Promise.all(jobs).then(() => {}) : Promise.resolve()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/image-fill-cache.unit.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/paint/imageFillCache.ts frontend/tests/unit/image-fill-cache.unit.spec.ts
git commit -m "feat(compositor): shared image-fill bitmap cache"
```

---

### Task 4: Resolve an `ImageFill` to a pattern (render arms + export guard)

**Files:**
- Modify: `frontend/app/lib/paint/resolve.ts` (`resolvePaint` arm + `resolveImageFill`)
- Modify: `frontend/app/lib/compositor/paint.ts` (`paintTileBox` arm)
- Modify: `frontend/app/lib/paint/toVector.ts` (`paintToVectorPaint` guard)
- Test: `frontend/tests/unit/image-fill-resolve.unit.spec.ts`

**Interfaces:**
- Consumes: `getFillBitmap` (Task 3), `imageFillRect` + `isImageFill` (Tasks 1-2), `FILL_TILE_CAP` (existing module const in `resolve.ts`).
- Produces: `resolvePaint` returns `'transparent'` for an `ImageFill` whose bitmap is not loaded; `paintToVectorPaint` returns `null` for an `ImageFill` (SVG embed is a flagged fast-follow).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/image-fill-resolve.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ImageFill } from '~/lib/compositor/paint'
import { paintToVectorPaint } from '~/lib/paint/toVector'

const img: ImageFill = { type: 'image', src: '/view?filename=a.png&type=input', fit: 'cover' }

describe('ImageFill export', () => {
  it('paintToVectorPaint returns null for an image fill (raster embed is a fast-follow)', () => {
    // Must NOT fall through to the string arm and emit a bogus solid paint.
    expect(paintToVectorPaint(img, { box: { w: 100, h: 100 } } as any)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/image-fill-resolve.unit.spec.ts`
Expected: FAIL — `paintToVectorPaint` currently treats the object as a string paint and returns a non-null value.

- [ ] **Step 3: Add the `resolvePaint` arm + `resolveImageFill`**

In `frontend/app/lib/paint/resolve.ts`, import `imageFillRect` and `isImageFill` from `~/lib/compositor/paint`, and `getFillBitmap` from `~/lib/paint/imageFillCache`. Add to the TOP of `resolvePaint` (before `isFill`):

```ts
  if (isImageFill(paint)) return resolveImageFill(ctx, paint, box)
```

Then add this function below `resolvePaint`:

```ts
/** An `ImageFill` → a `CanvasPattern` (centered-origin, this module's convention).
 *  cover/contain/stretch paint one box-sized tile; tile repeats a cell whose width
 *  spans `scale` of the box. Returns 'transparent' until the bitmap is cached. */
function resolveImageFill(
  ctx: CanvasRenderingContext2D,
  paint: ImageFill,
  box: { w: number; h: number },
): string | CanvasPattern {
  const img = getFillBitmap(paint.src)
  const iw = img ? (img.naturalWidth || img.width) : 0
  const ih = img ? (img.naturalHeight || img.height) : 0
  if (!img || !iw || !ih) return 'transparent'
  const bw = Math.max(box.w, 1e-3), bh = Math.max(box.h, 1e-3)
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const sx = m ? (Math.hypot(m.a, m.b) || 1) : 1, sy = m ? (Math.hypot(m.c, m.d) || 1) : 1
  const k = Math.min(1, FILL_TILE_CAP / Math.max(bw * sx, bh * sy, 1))
  const scale = paint.scale && paint.scale > 0 ? paint.scale : 1
  const offset = paint.offset ?? { x: 0, y: 0 }

  if (paint.fit === 'tile') {
    const cellW = Math.max(1, Math.round(bw * scale * sx * k))
    const cellH = Math.max(1, Math.round(cellW * (ih / iw)))
    const cell = document.createElement('canvas'); cell.width = cellW; cell.height = cellH
    cell.getContext('2d')!.drawImage(img, 0, 0, cellW, cellH)
    const pat = ctx.createPattern(cell, 'repeat')
    if (!pat) return 'transparent'
    if (typeof DOMMatrix !== 'undefined' && pat.setTransform) {
      pat.setTransform(new DOMMatrix()
        .translateSelf(-bw / 2 + offset.x * bw, -bh / 2 + offset.y * bh)
        .scaleSelf(1 / (sx * k), 1 / (sy * k)))
    }
    return pat
  }

  const tw = Math.max(1, Math.round(bw * sx * k)), th = Math.max(1, Math.round(bh * sy * k))
  const tile = document.createElement('canvas'); tile.width = tw; tile.height = th
  const { dx, dy, dw, dh } = imageFillRect(paint.fit, iw, ih, tw, th, scale, offset)
  tile.getContext('2d')!.drawImage(img, dx, dy, dw, dh)
  const pat = ctx.createPattern(tile, 'no-repeat')
  if (!pat) return 'transparent'
  if (typeof DOMMatrix !== 'undefined' && pat.setTransform) {
    pat.setTransform(new DOMMatrix().translateSelf(-bw / 2, -bh / 2).scaleSelf(bw / tw, bh / th))
  }
  return pat
}
```

- [ ] **Step 4: Add the `paintTileBox` corner-origin arm**

In `frontend/app/lib/compositor/paint.ts`, import `getFillBitmap` from `~/lib/paint/imageFillCache`. At the top of `paintTileBox` (after `const W … H …` and the `ctx` is available, before the `isFill` branch), add:

```ts
  if (isImageFill(paint)) {
    const img = getFillBitmap(paint.src)
    const iw = img ? (img.naturalWidth || img.width) : 0
    const ih = img ? (img.naturalHeight || img.height) : 0
    if (img && iw && ih) {
      // corner-origin single tile: 'tile' collapses to cover for this incidental
      // path (only shader-input/material previews reach paintTileBox).
      const fit = paint.fit === 'tile' ? 'cover' : paint.fit
      const { dx, dy, dw, dh } = imageFillRect(fit, iw, ih, W, H, paint.scale ?? 1, paint.offset ?? { x: 0, y: 0 })
      ctx.drawImage(img, dx, dy, dw, dh)
    }
    return c   // transparent when unloaded
  }
```

(Ensure `paintTileBox` builds `c`/`ctx` before this guard; move the guard just after `const ctx = c.getContext('2d')!`. Import `imageFillRect` is local to this module.)

- [ ] **Step 5: Add the `toVector` guard**

In `frontend/app/lib/paint/toVector.ts`, import `isImageFill`, and in `paintToVectorPaint` add BEFORE the `isGradient`/`isFill` checks:

```ts
  // ImageFill has no vector form yet — a real <image>-in-<pattern> embed is a
  // flagged fast-follow. Return null so the shape exports unfilled rather than
  // letting the object fall through to the solid-string arm.
  if (isImageFill(paint)) return null
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/image-fill-resolve.unit.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Run the full paint suite to check for regressions**

Run: `cd frontend && npx vitest run tests/unit/image-fill-model.unit.spec.ts tests/unit/image-fill-rect.unit.spec.ts tests/unit/image-fill-cache.unit.spec.ts tests/unit/image-fill-resolve.unit.spec.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/paint/resolve.ts frontend/app/lib/compositor/paint.ts frontend/app/lib/paint/toVector.ts frontend/tests/unit/image-fill-resolve.unit.spec.ts
git commit -m "feat(compositor): resolve ImageFill to a pattern + export guard"
```

---

### Task 5: Preload fill bitmaps through `ensureLayerImages`

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts:579-596` (`ensureLayerImages` + new `collectFillImageSrcs`)
- Test: `frontend/tests/unit/image-fill-collect.unit.spec.ts`

**Interfaces:**
- Consumes: `ensureFillBitmaps` (Task 3), `isImageFill` (Task 1), `LocalLayer` (existing).
- Produces: `collectFillImageSrcs(layers: LocalLayer[]): string[]` — de-duplicated `src`s from every layer's `fill` and `stroke`. `ensureLayerImages` now also preloads them.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/image-fill-collect.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { collectFillImageSrcs } from '~/composables/useCompositorLayers'
import type { LocalLayer } from '~/composables/useCompositorLayers'

const rect = (over: any): LocalLayer => ({
  id: 'r', kind: 'rect', x: 0, y: 0, w: 0.3, h: 0.2, rotation: 0, opacity: 1,
  fill: '#fff', stroke: '', strokeWidth: 0, radius: 0, ...over,
}) as any

describe('collectFillImageSrcs', () => {
  it('collects image-fill srcs from fill and stroke, de-duplicated', () => {
    const a = { type: 'image', src: 'A', fit: 'cover' }
    const b = { type: 'image', src: 'B', fit: 'tile' }
    const layers = [
      rect({ fill: a }),
      rect({ id: 'r2', fill: '#000', stroke: b }),
      rect({ id: 'r3', fill: a }),           // dup of A
    ]
    expect(collectFillImageSrcs(layers).sort()).toEqual(['A', 'B'])
  })

  it('ignores solid / gradient / pattern fills', () => {
    expect(collectFillImageSrcs([rect({ fill: '#123' })])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/image-fill-collect.unit.spec.ts`
Expected: FAIL — `collectFillImageSrcs` is not exported.

- [ ] **Step 3: Implement the collector and extend `ensureLayerImages`**

In `frontend/app/composables/useCompositorLayers.ts`, add near `ensureLayerImages`. First ensure the imports include `isImageFill` (from the re-export block added in Task 1, or import from `~/lib/compositor/paint`) and add `import { ensureFillBitmaps } from '~/lib/paint/imageFillCache'`.

```ts
/** Every ImageFill `src` referenced by a layer's fill or stroke, de-duplicated.
 *  Drives the preload so the synchronous resolve arm has the bitmap in hand. */
export function collectFillImageSrcs(layers: LocalLayer[]): string[] {
  const out = new Set<string>()
  for (const l of layers) {
    for (const p of [(l as any).fill, (l as any).stroke]) {
      if (isImageFill(p) && p.src) out.add(p.src)
    }
  }
  return [...out]
}
```

Then, inside `ensureLayerImages`, after the existing image-layer loop builds `jobs` and before `await Promise.all(jobs)` (or after it — either is fine), preload fill bitmaps too:

```ts
export async function ensureLayerImages(layers: LocalLayer[]): Promise<void> {
  if (typeof window === 'undefined') return
  const jobs: Promise<unknown>[] = []
  for (const layer of layers) {
    if (layer.kind !== 'image') continue
    const url = imageLayerUrl(layer.filename)
    if (_imageCache.get(url)?.complete) continue
    jobs.push(new Promise((res) => {
      const im = new Image()
      im.onload = () => { _imageCache.set(url, im); res(null) }
      im.onerror = () => res(null)
      im.src = url
    }))
  }
  jobs.push(ensureFillBitmaps(collectFillImageSrcs(layers)))
  if (jobs.length) await Promise.all(jobs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/image-fill-collect.unit.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/image-fill-collect.unit.spec.ts
git commit -m "feat(compositor): preload image-fill bitmaps in ensureLayerImages"
```

---

### Task 6: Picker + fit/scale/offset UI in `FillControl.vue`

**Files:**
- Create: `frontend/app/components/vue-canvas/compositor/FillImagePicker.vue`
- Modify: `frontend/app/components/vue-canvas/compositor/FillControl.vue`

**Interfaces:**
- Consumes: `type ImageFill`, `isImageFill`, `type Paint` (from `~/composables/useCompositorLayers`); `vueFlowNodes` via `inject` (provided by `VueNodeCanvas.vue:1003`).
- Produces: `FillControl` emits an `ImageFill` `Paint` through its existing `update:modelValue` contract when the image type is active. `FillImagePicker` emits `@pick` with a `src: string`.

- [ ] **Step 1: Build the canvas image picker component**

Create `frontend/app/components/vue-canvas/compositor/FillImagePicker.vue`:

```vue
<script setup lang="ts">
/** Grid of the canvas's image-bearing nodes; picking one emits its current
 *  image URL (snapshot). Reads the live node list injected by VueNodeCanvas. */
import { computed, inject, type Ref } from 'vue'

const emit = defineEmits<{ pick: [src: string] }>()
const nodes = inject<Ref<any[]>>('vueFlowNodes')

interface Choice { id: string; src: string; label: string }
const choices = computed<Choice[]>(() => {
  const list = nodes?.value ?? []
  const out: Choice[] = []
  for (const n of list) {
    const src = n?.data?.images?.[0]
    if (typeof src === 'string' && src) out.push({ id: n.id, src, label: n?.data?.label || n?.type || n.id })
  }
  return out
})
</script>

<template>
  <div>
    <div v-if="!choices.length" class="rounded border border-white/10 bg-[#141414] p-3 text-[11px] text-white/40">
      No images on the canvas yet.
    </div>
    <div v-else class="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
      <button
        v-for="c in choices" :key="c.id" type="button"
        class="aspect-square rounded border border-white/10 overflow-hidden bg-[#1a1a1a] hover:border-white/40 cursor-pointer"
        :title="c.label" @click="emit('pick', c.src)"
      >
        <img :src="c.src" class="h-full w-full object-cover" alt="" />
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Wire `'image'` into `FillControl.vue` — script**

In `frontend/app/components/vue-canvas/compositor/FillControl.vue`:

Add to imports:

```ts
import { type Paint, type Gradient, type ImageFill, isFill, isGradient, isImageFill } from '~/composables/useCompositorLayers'
import FillImagePicker from '~/components/vue-canvas/compositor/FillImagePicker.vue'
```

Add reactive state and helpers (near the other `ref`s):

```ts
// The type dropdown offers a synthetic 'image' entry on top of the Fill types.
type UiType = FillType | 'image'
const imageFill = ref<ImageFill | null>(isImageFill(props.modelValue) ? { ...props.modelValue } : null)
const pickerOpen = ref(false)
const currentType = computed<UiType>(() => isImageFill(props.modelValue) ? 'image' : fill.type)

watch(() => props.modelValue, (v) => {
  if (isImageFill(v)) { imageFill.value = { ...v }; pickerOpen.value = false }
})

function setUiType(t: UiType) {
  if (t === 'image') {
    if (!imageFill.value) { imageFill.value = { type: 'image', src: '', fit: 'cover', scale: 1, offset: { x: 0, y: 0 } }; pickerOpen.value = true }
    emit('update:modelValue', { ...imageFill.value })
    return
  }
  // leaving image → fall back to the normal Fill path
  imageFill.value = null
  setType(t as FillType)
}

function pushImage(patch: Partial<ImageFill>) {
  const next: ImageFill = { type: 'image', src: '', fit: 'cover', scale: 1, offset: { x: 0, y: 0 }, ...imageFill.value, ...patch }
  imageFill.value = next
  emit('update:modelValue', { ...next })
}
function onPick(src: string) { pickerOpen.value = false; pushImage({ src }) }
```

Also extend the type list the dropdown renders. **Exclude `'image'` when `nested`** — the nested instance edits a shader's `spec.input`, and an `ImageFill` as a shader input reaches `descriptor.ts inputKey` / `paintTileBox`, which do not render it. This mirrors how the nested editor already excludes `'shader'` (`availableTypes` at FillControl.vue:30):

```ts
const uiTypes = computed<UiType[]>(() => props.nested ? availableTypes.value : [...availableTypes.value, 'image'])
```

- [ ] **Step 3: Wire `'image'` into `FillControl.vue` — template**

Change the header label span to reflect the image type:

```html
<span>{{ isNone ? 'No fill' : currentType }}</span>
```

Change the `<select>` to bind `currentType`/`setUiType` and render `uiTypes`:

```html
<select :value="currentType" class="w-full rounded bg-white/10 px-2 py-1.5 text-xs text-white/90 outline-none capitalize cursor-pointer"
  @change="setUiType(($event.target as HTMLSelectElement).value as any)">
  <option v-for="t in uiTypes" :key="t" :value="t">{{ t }}</option>
</select>
```

Add the image panel — place it as the FIRST branch of the editor `v-if` chain (before `fill.type === 'gradient'`), so it wins whenever the image type is active:

```html
<template v-if="currentType === 'image'">
  <div v-if="imageFill?.src && !pickerOpen" class="flex items-center gap-2">
    <div class="h-10 w-10 shrink-0 rounded border border-white/10 overflow-hidden bg-[#1a1a1a]">
      <img :src="imageFill.src" class="h-full w-full object-cover" alt="" />
    </div>
    <button type="button" class="text-[11px] text-white/70 hover:text-white underline cursor-pointer" @click="pickerOpen = true">Replace image</button>
  </div>
  <FillImagePicker v-else @pick="onPick" />

  <template v-if="imageFill?.src">
    <div class="grid grid-cols-4 gap-1">
      <button v-for="f in (['cover','contain','tile','stretch'] as const)" :key="f" type="button"
        class="h-7 rounded border text-[10px] capitalize cursor-pointer"
        :class="imageFill.fit === f ? 'border-white/60 bg-white/10 text-white' : 'border-white/10 bg-[#1a1a1a] text-white/60 hover:text-white'"
        @click="pushImage({ fit: f })">{{ f }}</button>
    </div>
    <div>
      <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
        <span>Scale</span><span class="tabular-nums normal-case">{{ (imageFill.scale ?? 1).toFixed(2) }}×</span>
      </div>
      <input type="range" min="0.1" max="4" step="0.05" :value="imageFill.scale ?? 1" class="w-full accent-white cursor-pointer"
        @input="pushImage({ scale: Number(($event.target as HTMLInputElement).value) })" />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <label class="text-[9px] uppercase tracking-[0.1em] text-white/35">Offset X
        <input type="range" min="-0.5" max="0.5" step="0.01" :value="imageFill.offset?.x ?? 0" class="w-full accent-white cursor-pointer"
          @input="pushImage({ offset: { x: Number(($event.target as HTMLInputElement).value), y: imageFill.offset?.y ?? 0 } })" />
      </label>
      <label class="text-[9px] uppercase tracking-[0.1em] text-white/35">Offset Y
        <input type="range" min="-0.5" max="0.5" step="0.01" :value="imageFill.offset?.y ?? 0" class="w-full accent-white cursor-pointer"
          @input="pushImage({ offset: { x: imageFill.offset?.x ?? 0, y: Number(($event.target as HTMLInputElement).value) } })" />
      </label>
    </div>
  </template>
</template>
<GradientEditor v-else-if="fill.type === 'gradient'" … />   <!-- existing chain continues unchanged -->
```

Ensure the existing `GradientEditor`/`ShaderFillEditor`/color chain becomes `v-else-if` after this `v-if` block (so exactly one branch renders).

- [ ] **Step 4: Guard `toFill` against an ImageFill**

In `FillControl.vue`'s `toFill(props.modelValue)` normalization, make sure an `ImageFill` is NOT coerced into a solid `Fill` (which would corrupt `fill.a`). At the top of `toFill`:

```ts
function toFill(p: Paint | undefined): Fill {
  if (isImageFill(p)) return { ...DEFAULT_FILL, type: 'solid', a: '#3b82f6' }  // parked; image UI reads imageFill ref, not this
  // …existing branches…
}
```

- [ ] **Step 5: Typecheck the changed files**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "FillControl|FillImagePicker|paint|resolve|useCompositorLayers|imageFill" | head`
Expected: no NEW errors referencing these files (baseline is ~328 unrelated errors; compare against `git stash` baseline if unsure — an error naming a type THIS feature introduced is not pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/FillControl.vue frontend/app/components/vue-canvas/compositor/FillImagePicker.vue
git commit -m "feat(compositor): image-fill picker + fit/scale/offset UI in FillControl"
```

---

### Task 7: Runtime verification in the browser

**Files:** none (manual/browser verification via the preview tools).

- [ ] **Step 1: Start the dev server**

Use `preview_start` with the project's dev config (Nuxt). Reach the Vue node canvas at `127.0.0.1` (not `localhost` — the IPv6 WS listener 426s).

- [ ] **Step 2: Reproduce the scenario**

Add an image node and a Frame with a shape (rect) to the canvas. Open the shape's fill editor (Compositor modal → select the shape → Fill), choose the `image` type, and pick the image node from the grid.

- [ ] **Step 3: Verify each fit mode**

Cycle Cover / Contain / Tile / Stretch and confirm the shape's fill visibly changes (cover crops, contain letterboxes, tile repeats, stretch distorts). Adjust Scale and Offset X/Y and confirm the image moves/zooms within the shape. Screenshot for proof.

- [ ] **Step 4: Verify parity + snapshot**

Confirm the same fill renders identically on the Frame node's inline canvas and in the Compositor modal. Delete the source image node and confirm the fill still renders (snapshot). Check `read_console_messages` for errors.

- [ ] **Step 5: Full unit run (no regressions)**

Run: `cd frontend && npx vitest run tests/unit/image-fill-model.unit.spec.ts tests/unit/image-fill-rect.unit.spec.ts tests/unit/image-fill-cache.unit.spec.ts tests/unit/image-fill-resolve.unit.spec.ts tests/unit/image-fill-collect.unit.spec.ts`
Expected: PASS (all image-fill specs).

---

## Self-Review

**Spec coverage:**
- §1 data model → Task 1. ✅
- §2 rendering (cache, host preload, pattern construction) → Tasks 3, 5, 4. ✅
- §3 UI (image type, picker, fit/scale/offset) → Task 6. ✅
- §4 edge cases: empty picker (Task 6 template), loading→transparent (Task 4 arm), deleted node/snapshot (Task 7 verify), SVG export fast-follow (Task 4 guard). ✅

**Placeholder scan:** none — every code step shows real code. The `toVector` `null` return is an explicit, tested v1 decision, not a TODO.

**Type consistency:** `ImageFill` fields (`src`/`fit`/`scale`/`offset`) identical across Tasks 1/2/4/6. `imageFillRect` signature matches between definition (Task 2) and callers (Task 4). `getFillBitmap`/`ensureFillBitmaps`/`collectFillImageSrcs` names consistent across Tasks 3/4/5. `isImageFill` guard used identically everywhere.
