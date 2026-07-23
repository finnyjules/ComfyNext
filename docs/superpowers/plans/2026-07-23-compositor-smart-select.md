# Compositor Smart Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Smart select" mode in the Compositor: roughly scribble over an object on the selected image layer, SAM-2 refines it into a precise selection, and a floating action bar offers New layer / Cut out / Generate fill / Use as mask / Delete.

**Architecture:** Pure geometry/mask helpers in `frontend/app/lib/compositor/smartSelect.ts` (node-safe, unit-tested); a `useSmartSelect` composable owning point accumulation + busy/queue/fallback; the existing `/api/inpaint/segment` route extended to multi-point prompts via a pure `buildSamInput` server util; all canvas/DOM wiring lives in `CompositorModal.vue`, reusing the Generate-mode plumbing (artboard-space mask canvas, `useRegionFx` overlay, the artboard↔image affine from `runRegionFill`).

**Tech Stack:** Vue 3 SFC (Nuxt 4), Canvas 2D, Replicate `meta/sam-2` via existing Nitro route, vitest for units.

**Spec:** `docs/superpowers/specs/2026-07-22-compositor-smart-select-design.md`

## Global Constraints

- Graceful degradation is a hard requirement: if the segment API errors/times out, the raw scribble IS the selection and every action still works.
- Segmentation runs on the **selected image layer's own pixels** (capped at 1536 via `capDims`), never the composed artboard.
- `segment.post.ts` must stay byte-identical in behavior for the legacy single-point body (`xPx`/`yPx`) — the Inpaint modal depends on it.
- Unit tests run in vitest `environment: 'node'` — no `document`, no canvas. Anything unit-tested must operate on plain arrays/points. Canvas work stays in the modal.
- Typecheck: the repo has ~400 pre-existing `vue-tsc` errors. Only NEW errors in touched files matter: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i -E "smartSelect|useSmartSelect|samInput"` → expect no output.
- Do not stash or touch other sessions' hunks; `git add` only the files this plan names (see memory `parallel-sessions-commit-hygiene`).
- All commits on `main` directly.

---

### Task 1: Pure geometry + mask helpers (`smartSelect.ts`)

**Files:**
- Create: `frontend/app/lib/compositor/smartSelect.ts`
- Test: `frontend/tests/unit/smart-select.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 3–5):
  - `interface Pt { x: number; y: number }`
  - `interface SamPoint { x: number; y: number; label: 0 | 1 }`
  - `interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }`
  - `samplePointsFromStroke(stroke: Pt[], opts?: { max?: number; minDist?: number }): Pt[]`
  - `layerAffine(layer: { x: number; y: number; w: number; h: number; rotation?: number }, W: number, H: number, capW: number, capH: number): Affine` — artboard px → image px
  - `invertAffine(m: Affine): Affine`
  - `applyAffine(m: Affine, p: Pt): Pt`
  - `luminanceToAlpha(data: Uint8ClampedArray): void` — in place
  - `alphaBounds(data: Uint8ClampedArray, w: number, h: number, thresh?: number): { minX: number; minY: number; maxX: number; maxY: number } | null`
  - `cutoutPlacement(bbox: { minX: number; minY: number; maxX: number; maxY: number }, layer: { x: number; y: number; w: number; h: number; rotation?: number }, capW: number, capH: number, W: number, H: number): { x: number; y: number; w: number; h: number; rotation: number }`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/smart-select.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  samplePointsFromStroke, layerAffine, invertAffine, applyAffine,
  luminanceToAlpha, alphaBounds, cutoutPlacement, type Pt,
} from '~/lib/compositor/smartSelect'

describe('samplePointsFromStroke', () => {
  it('returns the single point for a click', () => {
    expect(samplePointsFromStroke([{ x: 10, y: 20 }])).toEqual([{ x: 10, y: 20 }])
  })
  it('spreads ≤ max points evenly along a long stroke', () => {
    const stroke: Pt[] = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0 }))
    const pts = samplePointsFromStroke(stroke, { max: 8 })
    expect(pts.length).toBe(8)
    // Even arc-length coverage: first sample in the first eighth, last in the last eighth.
    expect(pts[0]!.x).toBeLessThan(200 / 8)
    expect(pts[7]!.x).toBeGreaterThan(200 - 200 / 8)
    // Strictly increasing (no bunching/backtracking on a monotone stroke).
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x).toBeGreaterThan(pts[i - 1]!.x)
  })
  it('drops samples closer than minDist (tiny scribble → fewer points)', () => {
    const stroke: Pt[] = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: 0 })) // 4.9px long
    const pts = samplePointsFromStroke(stroke, { max: 8, minDist: 6 })
    expect(pts.length).toBe(1)
  })
})

describe('affine (artboard ↔ image)', () => {
  // Layer centered at (0.5, 0.5) of a 1000×800 artboard, box 400×300 artboard px
  // (w,h width-normalized: 0.4, 0.3), rotated 30°, image capped at 1024×768.
  const layer = { x: 0.5, y: 0.5, w: 0.4, h: 0.3, rotation: 30 }
  const m = layerAffine(layer, 1000, 800, 1024, 768)
  it('maps the layer center to the image center', () => {
    const p = applyAffine(m, { x: 500, y: 400 })
    expect(p.x).toBeCloseTo(512, 6)
    expect(p.y).toBeCloseTo(384, 6)
  })
  it('round-trips through the inverse', () => {
    const inv = invertAffine(m)
    const q = applyAffine(inv, applyAffine(m, { x: 123, y: 456 }))
    expect(q.x).toBeCloseTo(123, 6)
    expect(q.y).toBeCloseTo(456, 6)
  })
  it('matches runRegionFill for the unrotated case: layer top-left corner → image (0,0)', () => {
    const m0 = layerAffine({ x: 0.5, y: 0.5, w: 0.4, h: 0.3, rotation: 0 }, 1000, 800, 1024, 768)
    const p = applyAffine(m0, { x: 500 - 200, y: 400 - 150 })
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })
})

describe('luminanceToAlpha', () => {
  it('white → opaque white, black → transparent, gray → partial', () => {
    //                     white          black        mid gray (opaque source alpha)
    const d = new Uint8ClampedArray([255,255,255,255,  0,0,0,255,  128,128,128,255])
    luminanceToAlpha(d)
    expect([d[0], d[1], d[2], d[3]]).toEqual([255, 255, 255, 255])
    expect(d[7]).toBe(0)
    expect(d[11]).toBeGreaterThan(100)
    expect(d[11]).toBeLessThan(160)
    // RGB forced white so the mask composites as a pure silhouette.
    expect([d[4], d[5], d[6]]).toEqual([255, 255, 255])
  })
})

describe('alphaBounds', () => {
  it('finds the tight bbox of alpha above threshold', () => {
    const w = 4, h = 3
    const d = new Uint8ClampedArray(w * h * 4)
    const set = (x: number, y: number, a: number) => { d[(y * w + x) * 4 + 3] = a }
    set(1, 0, 255); set(2, 2, 255); set(3, 1, 10) // 10 is below default thresh 20
    expect(alphaBounds(d, w, h)).toEqual({ minX: 1, minY: 0, maxX: 2, maxY: 2 })
  })
  it('returns null when empty', () => {
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })
})

describe('cutoutPlacement', () => {
  it('a full-image bbox reproduces the source layer transform', () => {
    const layer = { x: 0.3, y: 0.6, w: 0.4, h: 0.3, rotation: 25 }
    const p = cutoutPlacement({ minX: 0, minY: 0, maxX: 1023, maxY: 767 }, layer, 1024, 768, 1000, 800)
    expect(p.x).toBeCloseTo(0.3, 6)
    expect(p.y).toBeCloseTo(0.6, 6)
    expect(p.w).toBeCloseTo(0.4, 6)
    expect(p.h).toBeCloseTo(0.3, 6)
    expect(p.rotation).toBe(25)
  })
  it('an unrotated quarter crop lands at the right sub-position', () => {
    // Layer: center (500,400)px, box 400×300 artboard px. Crop = top-left quadrant
    // of the 1024×768 image → its center is at artboard (500-100, 400-75).
    const layer = { x: 0.5, y: 0.5, w: 0.4, h: 0.3, rotation: 0 }
    const p = cutoutPlacement({ minX: 0, minY: 0, maxX: 511, maxY: 383 }, layer, 1024, 768, 1000, 800)
    expect(p.x).toBeCloseTo(400 / 1000, 6)
    expect(p.y).toBeCloseTo(325 / 800, 6)
    expect(p.w).toBeCloseTo(0.2, 6)
    expect(p.h).toBeCloseTo(0.15, 6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/smart-select.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/smartSelect`.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/compositor/smartSelect.ts`:

```ts
/**
 * Smart select — pure geometry and mask math (no DOM, unit-tested in node).
 *
 * The Compositor's smart-select mode scribbles in ARTBOARD px, but SAM-2 runs
 * on the target layer's own pixels (capped by capDims). Everything that maps
 * between those two spaces, or crunches raw RGBA arrays, lives here; canvas
 * plumbing stays in CompositorModal.vue.
 *
 * The affine convention matches runRegionFill's inline math (artboard→image):
 *   xi = a*xa + c*ya + e ;  yi = b*xa + d*ya + f
 * with the layer model's transforms: x,y as fractions of artboard W/H, and
 * w,h both normalized to artboard WIDTH.
 */

export interface Pt { x: number; y: number }
export interface SamPoint { x: number; y: number; label: 0 | 1 }
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

export interface LayerBox { x: number; y: number; w: number; h: number; rotation?: number }
export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/** Even arc-length resample of a stroke polyline into ≤ max prompt points.
 *  Sampling at (i+0.5)/max fractions avoids the exact endpoints (which often
 *  overshoot the object); minDist collapses tiny scribbles to fewer points. */
export function samplePointsFromStroke(stroke: Pt[], opts: { max?: number; minDist?: number } = {}): Pt[] {
  const max = opts.max ?? 8
  const minDist = opts.minDist ?? 6
  if (stroke.length === 0) return []
  if (stroke.length === 1) return [{ ...stroke[0]! }]

  const cum: number[] = [0]
  for (let i = 1; i < stroke.length; i++) {
    const dx = stroke[i]!.x - stroke[i - 1]!.x, dy = stroke[i]!.y - stroke[i - 1]!.y
    cum.push(cum[i - 1]! + Math.hypot(dx, dy))
  }
  const total = cum[cum.length - 1]!
  if (total === 0) return [{ ...stroke[0]! }]

  const at = (dist: number): Pt => {
    let i = 1
    while (i < cum.length - 1 && cum[i]! < dist) i++
    const seg = cum[i]! - cum[i - 1]!
    const t = seg > 0 ? (dist - cum[i - 1]!) / seg : 0
    return {
      x: stroke[i - 1]!.x + (stroke[i]!.x - stroke[i - 1]!.x) * t,
      y: stroke[i - 1]!.y + (stroke[i]!.y - stroke[i - 1]!.y) * t,
    }
  }

  const out: Pt[] = []
  for (let i = 0; i < max; i++) {
    const p = at(((i + 0.5) / max) * total)
    const prev = out[out.length - 1]
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < minDist) continue
    out.push(p)
  }
  return out.length ? out : [at(total / 2)]
}

/** Artboard px → image px, mirroring runRegionFill's inline affine. */
export function layerAffine(layer: LayerBox, W: number, H: number, capW: number, capH: number): Affine {
  const cx = layer.x * W, cy = layer.y * H
  const bw = (layer.w || 0.0001) * W, bh = (layer.h || 0.0001) * W
  const th = ((layer.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(th), sin = Math.sin(th)
  const a = (capW * cos) / bw, c = (capW * sin) / bw
  const b = (-capH * sin) / bh, d = (capH * cos) / bh
  const e = capW / 2 - a * cx - c * cy
  const f = capH / 2 - b * cx - d * cy
  return { a, b, c, d, e, f }
}

export function applyAffine(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

export function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) }
}

/** SAM returns an OPAQUE white-on-black mask; the compositor composites masks
 *  by ALPHA. Convert in place: alpha ← luminance, RGB ← white. */
export function luminanceToAlpha(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    const a = data[i + 3]! / 255
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255
    data[i + 3] = Math.round(lum * a)
  }
}

/** Tight bbox of pixels with alpha > thresh (same convention as genMaskBounds). */
export function alphaBounds(data: Uint8ClampedArray, w: number, h: number, thresh = 20): BBox | null {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3]! > thresh) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY }
}

/** Layer-model transform for a crop of the source image: where an image-space
 *  bbox lands on the artboard when extracted as its own layer. Keeps the
 *  source rotation; w/h follow the layer convention (width-normalized). */
export function cutoutPlacement(
  bbox: BBox, layer: LayerBox, capW: number, capH: number, W: number, H: number,
): { x: number; y: number; w: number; h: number; rotation: number } {
  const inv = invertAffine(layerAffine(layer, W, H, capW, capH))
  const center = applyAffine(inv, { x: (bbox.minX + bbox.maxX + 1) / 2, y: (bbox.minY + bbox.maxY + 1) / 2 })
  const cropW = bbox.maxX - bbox.minX + 1, cropH = bbox.maxY - bbox.minY + 1
  return {
    x: center.x / W,
    y: center.y / H,
    w: cropW * (layer.w || 0.0001) / capW,
    h: cropH * (layer.h || 0.0001) / capH,
    rotation: layer.rotation || 0,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/smart-select.unit.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/smartSelect.ts frontend/tests/unit/smart-select.unit.spec.ts
git commit -m "feat(compositor): smart-select geometry + mask helpers (pure, unit-tested)"
```

---

### Task 2: Multi-point SAM server support

**Files:**
- Create: `frontend/server/utils/samInput.ts`
- Modify: `frontend/server/api/inpaint/segment.post.ts`
- Test: `frontend/tests/unit/sam-input.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 3's client): `POST /api/inpaint/segment` now also accepts `points: { x: number; y: number; label: 0 | 1 }[]`; response unchanged `{ mask: string }`.
- `buildSamInput(body: { image?: string; xPx?: number; yPx?: number; points?: { x: number; y: number; label: 0 | 1 }[] }): Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/sam-input.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSamInput } from '~~/server/utils/samInput'

describe('buildSamInput', () => {
  it('legacy single point body → one foreground point (back-compat)', () => {
    expect(buildSamInput({ image: 'data:x', xPx: 10.6, yPx: 20.2 })).toEqual({
      image: 'data:x',
      point_coords: [[11, 20]],
      point_labels: [1],
    })
  })
  it('points array wins over xPx/yPx and preserves labels', () => {
    expect(buildSamInput({
      image: 'data:x', xPx: 1, yPx: 2,
      points: [{ x: 5.4, y: 6.6, label: 1 }, { x: 9, y: 10, label: 0 }],
    })).toEqual({
      image: 'data:x',
      point_coords: [[5, 7], [9, 10]],
      point_labels: [1, 0],
    })
  })
  it('empty points array falls back to the legacy point', () => {
    expect(buildSamInput({ image: 'data:x', xPx: 3, yPx: 4, points: [] })).toEqual({
      image: 'data:x',
      point_coords: [[3, 4]],
      point_labels: [1],
    })
  })
  it('never emits undefined values', () => {
    const input = buildSamInput({ image: 'data:x' })
    for (const v of Object.values(input)) expect(v).not.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/sam-input.unit.spec.ts`
Expected: FAIL — cannot resolve `~~/server/utils/samInput`.

- [ ] **Step 3: Implement the util**

Create `frontend/server/utils/samInput.ts`:

```ts
/**
 * Map our /api/inpaint/segment request body to SAM-2's point-prompt input.
 * Kept as a pure util (out of the route file) so it's unit-testable and so
 * swapping SAM models stays a one-spot change (see segment.post.ts NOTE).
 *
 * Two body shapes:
 *  - legacy v3 click-to-select: { xPx, yPx } → one foreground point
 *  - smart select scribble:     { points: [{x, y, label}] } — label 1 =
 *    foreground, 0 = background (subtract). Wins when non-empty.
 */
export interface SamRequestPoint { x: number; y: number; label: 0 | 1 }
export interface SamRequestBody {
  image?: string
  xPx?: number
  yPx?: number
  points?: SamRequestPoint[]
}

export function buildSamInput(body: SamRequestBody): Record<string, unknown> {
  const pts = (body.points?.length)
    ? body.points
    : [{ x: body.xPx ?? 0, y: body.yPx ?? 0, label: 1 as const }]
  return {
    image: body.image,
    point_coords: pts.map(p => [Math.round(p.x), Math.round(p.y)]),
    point_labels: pts.map(p => (p.label === 0 ? 0 : 1)),
  }
}
```

Note: no `image: undefined` case escapes in practice — the route 400s without an image before calling this; the "never emits undefined" test passes because `image: 'data:x'` is set. Keep the route's existing strip-undefined loop anyway (belt and braces).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/sam-input.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Rewire the route**

In `frontend/server/api/inpaint/segment.post.ts`:

1. Update the header comment's Body section to:

```
 * Body:
 *   image   string  data URL (or public http URL) of the source image
 *   xPx     number  click X in the source image's pixel space (legacy single point)
 *   yPx     number  click Y in the source image's pixel space (legacy single point)
 *   points  {x,y,label}[]  optional multi-point prompt (smart select); label 1 =
 *           foreground, 0 = background. Non-empty points wins over xPx/yPx.
```

2. Delete the local `interface Body` and the local `buildInput` function (lines 23–36).
3. Replace the handler's body-typed lines:

```ts
export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<SamRequestBody>(event)
  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })

  const input = buildSamInput(body)
  // Strip undefined keys so we never send fields the model rejects.
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k]
  ...
```

(`buildSamInput` and `SamRequestBody` come from `server/utils` — Nitro auto-imports them, same as `requireReplicateToken`; add `import type { SamRequestBody } from '../../utils/samInput'` only if the editor needs it, but prefer the auto-import.)

- [ ] **Step 6: Verify no type regressions**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i -E "samInput|segment.post"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/utils/samInput.ts frontend/server/api/inpaint/segment.post.ts frontend/tests/unit/sam-input.unit.spec.ts
git commit -m "feat(inpaint): segment route accepts multi-point SAM prompts (smart select)"
```

---

### Task 3: `segmentPoints` client + `useSmartSelect` composable

**Files:**
- Modify: `frontend/app/composables/useInpaint.ts` (add `segmentPoints` next to `segment`, ~line 306)
- Create: `frontend/app/composables/useSmartSelect.ts`
- Test: `frontend/tests/unit/use-smart-select.unit.spec.ts`

**Interfaces:**
- Consumes: `SamPoint` from `~/lib/compositor/smartSelect` (Task 1).
- Produces (used by Tasks 4–5):
  - `useInpaint().segmentPoints(image: string, points: SamPoint[]): Promise<string>` — mask data URL, white = selected.
  - `useSmartSelect(deps: { segment: (image: string, points: SamPoint[]) => Promise<string> })` returning:
    - `points: Ref<SamPoint[]>` — accumulated prompt points (image space)
    - `busy: Ref<boolean>`
    - `maskUrl: Ref<string | null>` — latest refined mask data URL, null = none/failed
    - `failed: Ref<boolean>` — last refine errored (fallback-to-scribble in effect)
    - `addPoints(pts: SamPoint[]): void`
    - `refine(image: string): Promise<void>` — busy-guarded; a call during flight queues exactly one trailing re-run
    - `reset(): void` — clears everything and invalidates in-flight results

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/use-smart-select.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useSmartSelect } from '~/composables/useSmartSelect'

/** Manually-resolvable segment stub. */
function deferredSegment() {
  const calls: { points: { x: number; y: number; label: 0 | 1 }[]; resolve: (m: string) => void; reject: (e: Error) => void }[] = []
  const segment = (_image: string, points: { x: number; y: number; label: 0 | 1 }[]) =>
    new Promise<string>((resolve, reject) => { calls.push({ points, resolve, reject }) })
  return { calls, segment }
}
const tick = () => new Promise<void>(r => setTimeout(r, 0))

describe('useSmartSelect', () => {
  it('accumulates points and refines with ALL of them', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 2, label: 1 }])
    const p = s.refine('img')
    expect(s.busy.value).toBe(true)
    expect(calls[0]!.points).toEqual([{ x: 1, y: 2, label: 1 }])
    calls[0]!.resolve('data:mask1')
    await p
    expect(s.busy.value).toBe(false)
    expect(s.maskUrl.value).toBe('data:mask1')
    expect(s.failed.value).toBe(false)
  })

  it('collapses refines during flight into ONE trailing re-run with the latest points', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p1 = s.refine('img')
    s.addPoints([{ x: 2, y: 2, label: 1 }])
    void s.refine('img')
    s.addPoints([{ x: 3, y: 3, label: 0 }])
    void s.refine('img')
    expect(calls.length).toBe(1)
    calls[0]!.resolve('data:mask1')
    await p1; await tick()
    expect(calls.length).toBe(2)              // exactly one queued re-run
    expect(calls[1]!.points.length).toBe(3)   // with all accumulated points
    calls[1]!.resolve('data:mask2')
    await tick()
    expect(s.maskUrl.value).toBe('data:mask2')
  })

  it('failure sets failed and clears maskUrl (fallback-to-scribble)', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p = s.refine('img')
    calls[0]!.reject(new Error('boom'))
    await p
    expect(s.failed.value).toBe(true)
    expect(s.maskUrl.value).toBeNull()
    expect(s.busy.value).toBe(false)
  })

  it('reset drops in-flight results (stale response never lands)', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p = s.refine('img')
    s.reset()
    calls[0]!.resolve('data:stale')
    await p
    expect(s.maskUrl.value).toBeNull()
    expect(s.points.value).toEqual([])
    expect(s.busy.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/use-smart-select.unit.spec.ts`
Expected: FAIL — cannot resolve `~/composables/useSmartSelect`.

- [ ] **Step 3: Implement the composable**

Create `frontend/app/composables/useSmartSelect.ts`:

```ts
/**
 * Smart-select state machine: accumulated SAM point prompts + the busy/queue/
 * fallback rules around the segment call. Framework-light on purpose (explicit
 * vue imports, injected segment fn, no DOM) so it unit-tests in node — all
 * canvas/overlay plumbing stays in CompositorModal.vue.
 *
 * Rules:
 *  - refine() during a flight queues exactly ONE trailing re-run (latest points).
 *  - a failed refine sets failed=true and clears maskUrl — the caller falls
 *    back to using the raw scribble as the selection (hard spec requirement).
 *  - reset() invalidates any in-flight response (session counter).
 */
import { ref } from 'vue'
import type { SamPoint } from '~/lib/compositor/smartSelect'

export interface SmartSelectDeps {
  segment: (image: string, points: SamPoint[]) => Promise<string>
}

export function useSmartSelect(deps: SmartSelectDeps) {
  const points = ref<SamPoint[]>([])
  const busy = ref(false)
  const maskUrl = ref<string | null>(null)
  const failed = ref(false)
  let queued: string | null = null // image for the queued trailing re-run
  let session = 0

  function addPoints(pts: SamPoint[]) {
    points.value = [...points.value, ...pts]
  }

  function reset() {
    session++
    points.value = []
    maskUrl.value = null
    failed.value = false
    busy.value = false
    queued = null
  }

  async function refine(image: string): Promise<void> {
    if (busy.value) { queued = image; return }
    if (!points.value.length) return
    const mySession = session
    busy.value = true
    try {
      const mask = await deps.segment(image, points.value)
      if (mySession !== session) return
      maskUrl.value = mask
      failed.value = false
    } catch {
      if (mySession !== session) return
      maskUrl.value = null
      failed.value = true
    } finally {
      if (mySession === session) {
        busy.value = false
        const next = queued
        queued = null
        if (next) void refine(next)
      }
    }
  }

  return { points, busy, maskUrl, failed, addPoints, refine, reset }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/use-smart-select.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the client fetch helper**

In `frontend/app/composables/useInpaint.ts`, directly after the existing `segment` function (ends ~line 312), add:

```ts
  /** Multi-point SAM prompt (smart select): points are in the source image's
   *  pixel space; label 1 = foreground, 0 = background/subtract. Returns a
   *  mask data URL, white = selected. */
  async function segmentPoints(image: string, points: { x: number; y: number; label: 0 | 1 }[]): Promise<string> {
    const res = await $fetch<{ mask: string }>('/api/inpaint/segment', {
      method: 'POST',
      body: { image, points },
    })
    return res.mask
  }
```

And add `segmentPoints` to the return object on the last line (after `segment`):

```ts
  return { busy, error, results, fluxFill, kontext, segment, segmentPoints, text2img, loraGen, nanoGen, pose, removeBackground, uploadDataUrl }
```

- [ ] **Step 6: Type check the touched files**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i -E "useSmartSelect|useInpaint"`
Expected: no output (useInpaint has no pre-existing errors; if grep shows lines, compare against `git show HEAD:frontend/app/composables/useInpaint.ts` to confirm they're new before fixing).

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useSmartSelect.ts frontend/app/composables/useInpaint.ts frontend/tests/unit/use-smart-select.unit.spec.ts
git commit -m "feat(compositor): useSmartSelect composable + multi-point segment client"
```

---

### Task 4: Modal wiring — mode, scribble, refine, overlay

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

All anchors below are given by content, not line numbers — parallel sessions edit this file.

**Interfaces:**
- Consumes: Tasks 1–3 (`smartSelect` lib, `useSmartSelect`, `inpaint.segmentPoints`), plus existing modal internals: `canvasDisplay`, `clientToNorm`, `canvasRef`, `selectedLocal`, `localLayers`, `useRegionFx`, `imageLayerUrl`, `loadImage`, `capDims`, `imageToDataUrl`, `selectTool`, `exitNodeEdit`, `pen`, `brush`, `aiOpen`, `exitGenMode`, `genActive`.
- Produces (used by Task 5): `smartActive: Ref<boolean>`, `smartCapture` (`{ img, capW, capH, dataUrl, affine }`), `smartScribbleCanvas`, `smartRefinedCanvas`, `smartProjCanvas()`, `smartBnd: Ref<BBox | null>`, `smartTarget: ComputedRef`, `exitSmartMode()`, `smart` (the composable instance).

- [ ] **Step 1: Imports**

In the icon import from `lucide-vue-next` (search `Wand2`), add `Lasso`.
Below the existing lib imports (search `from '~/lib/compositor/`), add:

```ts
import {
  samplePointsFromStroke, layerAffine, invertAffine, applyAffine,
  luminanceToAlpha, alphaBounds, type Affine, type BBox, type Pt, type SamPoint,
} from '~/lib/compositor/smartSelect'
```

- [ ] **Step 2: Script section — state, mode enter/exit, capture, scribble, refine**

Insert a new section directly AFTER the generative-fill section's final function (`runRegionFill`'s closing brace, before the `// Cloud background removal` comment):

```ts
// ── Smart select: scribble → SAM-refined selection ───────────────────────────
// Roughly brush over an object on the SELECTED image layer; the scribble is
// sampled into SAM point prompts (in the layer's own pixel space, via the same
// artboard→image affine as runRegionFill) and the returned silhouette becomes
// the active selection. Alt-scribble subtracts (label 0). If the API fails the
// raw scribble IS the selection — every action still works (spec requirement).
const smart = useSmartSelect({ segment: (image, points) => inpaint.segmentPoints(image, points) })
const smartActive = ref(false)
const smartBrush = ref(48)                     // brush diameter, artboard px
const smartTargetId = ref<string | null>(null)
const smartCursor = reactive({ x: -999, y: -999, on: false })
const smartVersion = ref(0)                    // bump → regionFx rebuild
const smartBnd = ref<BBox | null>(null)        // selection bbox, ARTBOARD px (action bar anchor)
const smartHasScribble = ref(false)

const smartTarget = computed<any | null>(() =>
  smartTargetId.value
    ? localLayers.value.find((l: any) => l.id === smartTargetId.value && l.kind === 'image') ?? null
    : null,
)

// Source capture: the target layer's pixels at capped resolution + the
// artboard→image affine, cached for the whole mode session.
type SmartCapture = { img: HTMLImageElement; capW: number; capH: number; dataUrl: string; affine: Affine }
let smartCapture: SmartCapture | null = null
async function ensureSmartCapture(): Promise<SmartCapture | null> {
  if (smartCapture) return smartCapture
  const layer = smartTarget.value
  if (!layer) return null
  const img = await loadImage(imageLayerUrl(layer.filename))
  const { w: capW, h: capH } = capDims(img.naturalWidth || 1024, img.naturalHeight || 1024)
  smartCapture = {
    img, capW, capH,
    dataUrl: imageToDataUrl(img, capW, capH),
    affine: layerAffine(layer, canvasDisplay.w, canvasDisplay.h, capW, capH),
  }
  return smartCapture
}

// Raw scribble, ARTBOARD px (overlay + API-failure fallback). White = selected.
let smartScribbleCanvas: HTMLCanvasElement | null = null
function smartScribbleCtx(): CanvasRenderingContext2D | null {
  const W = Math.max(1, Math.round(canvasDisplay.w)), H = Math.max(1, Math.round(canvasDisplay.h))
  if (!smartScribbleCanvas) smartScribbleCanvas = document.createElement('canvas')
  if (smartScribbleCanvas.width !== W || smartScribbleCanvas.height !== H) { smartScribbleCanvas.width = W; smartScribbleCanvas.height = H }
  return smartScribbleCanvas.getContext('2d')
}

// Refined SAM mask, IMAGE space (capW×capH), white-on-transparent alpha.
let smartRefinedCanvas: HTMLCanvasElement | null = null
// Artboard-space projection of the active selection (refined if present, else
// scribble) — what the overlay shows and what Generate fill consumes.
let smartProjCache: HTMLCanvasElement | null = null
function smartProjCanvas(): HTMLCanvasElement | null {
  if (smartProjCache) return smartProjCache
  const W = Math.max(1, Math.round(canvasDisplay.w)), H = Math.max(1, Math.round(canvasDisplay.h))
  if (smartRefinedCanvas && smartCapture) {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    const m = invertAffine(smartCapture.affine)   // image px → artboard px
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
    ctx.drawImage(smartRefinedCanvas, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    smartProjCache = c
    return c
  }
  if (smartHasScribble.value && smartScribbleCanvas) { smartProjCache = smartScribbleCanvas; return smartScribbleCanvas }
  return null
}
// `light` skips the getImageData bbox scan — used on every pointer-move, where
// a full-canvas readback per event would jank; the bbox refreshes on stroke end.
function smartInvalidateProjection(light = false) {
  smartProjCache = null
  if (!light) {
    const proj = smartProjCanvas()
    smartBnd.value = proj
      ? alphaBounds(proj.getContext('2d')!.getImageData(0, 0, proj.width, proj.height).data, proj.width, proj.height)
      : null
  }
  smartVersion.value++
}

function enterSmartMode() {
  const sel = selectedLocal.value?.kind === 'image' ? selectedLocal.value.id : null
  if (!sel) return
  selectTool(); exitNodeEdit()
  if (pen.active.value) pen.setActive(false)
  brush.setActive(false)
  aiOpen.value = false
  if (genActive.value) exitGenMode()
  smartActive.value = true
  smartTargetId.value = sel
  smart.reset()
  smartCapture = null
  smartRefinedCanvas = null
  smartHasScribble.value = false
  const ctx = smartScribbleCtx()
  if (ctx && smartScribbleCanvas) ctx.clearRect(0, 0, smartScribbleCanvas.width, smartScribbleCanvas.height)
  smartInvalidateProjection()
  void ensureSmartCapture()   // warm the capture so the first stroke refines fast
}
function exitSmartMode() {
  smartActive.value = false
  smartCursor.on = false
  smartTargetId.value = null
  smart.reset()
  smartCapture = null
  smartRefinedCanvas = null
  smartHasScribble.value = false
  smartProjCache = null
  smartBnd.value = null
}
function toggleSmartMode() { smartActive.value ? exitSmartMode() : enterSmartMode() }

// Pointer handling: record the raw polyline (for point sampling) and paint the
// scribble (white; Alt = erase) for the overlay/fallback.
const smartDraw = ref<{ sub: boolean; pts: Pt[]; lx: number; ly: number } | null>(null)
function onSmartPointerDown(e: PointerEvent) {
  const p = genPointFromEvent(e); if (!p) return
  e.preventDefault(); e.stopPropagation()
  canvasRef.value?.setPointerCapture?.(e.pointerId)
  smartDraw.value = { sub: e.altKey, pts: [{ x: p.x, y: p.y }], lx: p.x, ly: p.y }
  smartStrokeTo(p.x, p.y)
}
function smartStrokeTo(x: number, y: number) {
  const d = smartDraw.value
  const ctx = smartScribbleCtx(); if (!ctx || !d) return
  ctx.globalCompositeOperation = d.sub ? 'destination-out' : 'source-over'
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = smartBrush.value
  ctx.beginPath(); ctx.moveTo(d.lx, d.ly); ctx.lineTo(x, y); ctx.stroke()
  ctx.beginPath(); ctx.arc(x, y, smartBrush.value / 2, 0, Math.PI * 2); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  if (!d.sub) smartHasScribble.value = true
}
function onSmartPointerMove(e: PointerEvent) {
  const p = genPointFromEvent(e); if (!p) return
  smartCursor.x = p.x; smartCursor.y = p.y; smartCursor.on = true
  const d = smartDraw.value; if (!d) return
  e.preventDefault(); e.stopPropagation()
  smartStrokeTo(p.x, p.y)
  d.pts.push({ x: p.x, y: p.y }); d.lx = p.x; d.ly = p.y
  smartInvalidateProjection(true)
}
async function onSmartPointerUp(e: PointerEvent) {
  const d = smartDraw.value; if (!d) return
  e.preventDefault(); e.stopPropagation()
  smartDraw.value = null
  smartInvalidateProjection()
  const cap = await ensureSmartCapture(); if (!cap) return
  const label = d.sub ? 0 : 1
  const imgPts: SamPoint[] = samplePointsFromStroke(d.pts)
    .map(pt => applyAffine(cap.affine, pt))
    .filter(pt => pt.x >= 0 && pt.y >= 0 && pt.x < cap.capW && pt.y < cap.capH)
    .map(pt => ({ x: pt.x, y: pt.y, label: label as 0 | 1 }))
  if (!imgPts.length) return   // scribble entirely off the target layer
  smart.addPoints(imgPts)
  await smart.refine(cap.dataUrl)
}

// Refined mask arrived → normalize (SAM returns opaque white-on-black; we
// composite by ALPHA) into image space and re-project.
watch(() => smart.maskUrl.value, async (url) => {
  if (!url || !smartCapture) { smartRefinedCanvas = null; smartInvalidateProjection(); return }
  try {
    const img = await loadImage(url)
    const c = document.createElement('canvas')
    c.width = smartCapture.capW; c.height = smartCapture.capH
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const id = ctx.getImageData(0, 0, c.width, c.height)
    luminanceToAlpha(id.data)
    ctx.putImageData(id, 0, 0)
    smartRefinedCanvas = c
  } catch {
    smartRefinedCanvas = null   // unloadable mask → scribble fallback
  }
  smartInvalidateProjection()
})

// Overlay: a second useRegionFx instance over the smart canvases (gen and
// smart modes are mutually exclusive, but each keeps its own canvas pair).
const smartOverlayCanvas = ref<HTMLCanvasElement | null>(null)
const smartSweepCanvas = ref<HTMLCanvasElement | null>(null)
const smartFx = useRegionFx({
  overlay: smartOverlayCanvas,
  sweep: smartSweepCanvas,
  getMask: () => smartProjCanvas(),
  getDims: () => canvasDisplay,
  busy: () => smart.busy.value,
})
const { sweepMaskUrl: smartSweepMaskUrl } = smartFx
watch(smartActive, (on) => { on ? smartFx.start() : smartFx.stop() })
watch([smartVersion, () => canvasDisplay.w, () => canvasDisplay.h], () => smartFx.rebuild())
```

- [ ] **Step 3: Pointer routing**

In `onCanvasPointerDownCapture`, after the `[data-gen-bar]` guard, add a smart-bar guard and the smart branch (BEFORE the `genActive` branch):

```ts
  if ((e.target as HTMLElement)?.closest?.('[data-smart-bar]')) return
  if (smartActive.value) { onSmartPointerDown(e); return } // smart select owns the canvas
```

In `onCanvasPointerMoveCapture`, add as the FIRST lines:

```ts
  if (smartActive.value) { onSmartPointerMove(e); return }
```

In `onCanvasPointerUpCapture`, add as the FIRST lines:

```ts
  if (smartActive.value) { void onSmartPointerUp(e); return }
```

In `onCanvasClick` and `onStageBackgroundClick`, add next to the gen guards:

```ts
  if (smartActive.value) return // smart select owns the canvas
```

In `handleKeydown`, before the `genActive` Escape branch, add:

```ts
    if (smartActive.value) { exitSmartMode(); return }
```

and extend the Delete/Backspace guard's condition with `&& !smartActive.value` (protects the target layer while scribbling).

In `@pointerleave` on the canvas element (search `genCursor.on = false`), extend to also set `smartCursor.on = false`:

```
@pointerleave="genCursor.on = false; smartCursor.on = false; brush.cursor.value = null"
```

- [ ] **Step 4: Template — canvases, cursor ring, toolbar button, panel**

After the gen sweep `<canvas>` (search `ref="genSweepCanvas"`, insert after its closing `/>`), add:

```html
        <!-- Smart-select overlay (tinted selection preview) + busy sweep -->
        <canvas
          v-show="smartActive"
          ref="smartOverlayCanvas"
          class="absolute inset-0 pointer-events-none"
          :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px', opacity: 0.9 }"
        />
        <canvas
          v-show="smartActive"
          ref="smartSweepCanvas"
          class="absolute inset-0 pointer-events-none"
          :style="{
            width: canvasDisplay.w + 'px',
            height: canvasDisplay.h + 'px',
            opacity: smart.busy.value ? 1 : 0,
            transition: 'opacity 240ms ease',
            maskImage: smartSweepMaskUrl ? `url(${smartSweepMaskUrl})` : 'none',
            WebkitMaskImage: smartSweepMaskUrl ? `url(${smartSweepMaskUrl})` : 'none',
            maskSize: '100% 100%', WebkitMaskSize: '100% 100%',
            maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
          }"
        />
        <!-- Brush cursor ring (smart select) -->
        <div
          v-if="smartActive && smartCursor.on"
          class="absolute pointer-events-none rounded-full border border-white/90 bg-white/10"
          :style="{ left: (smartCursor.x - smartBrush / 2) + 'px', top: (smartCursor.y - smartBrush / 2) + 'px', width: smartBrush + 'px', height: smartBrush + 'px', zIndex: 30 }"
        />
```

Cursor style: in the canvas `:class` binding (search `genTool === 'brush') || brush.active.value) ? 'cursor-none'`), include smart mode in the `cursor-none` group:

```
((genActive && genTool === 'brush') || brush.active.value || smartActive) ? 'cursor-none' : ''
```

Toolbar: after the Generate (`Wand2`) button, add:

```html
        <button
          class="flex items-center justify-center size-8 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default"
          :class="smartActive ? 'bg-white text-neutral-900' : 'hover:bg-white/10 text-white/80'"
          :disabled="!smartActive && selectedLocal?.kind !== 'image'"
          :title="selectedLocal?.kind === 'image' || smartActive ? 'Smart select — scribble over an object, AI refines the selection' : 'Smart select — select an image layer first'"
          data-testid="smart-select-toggle"
          @click="toggleSmartMode"
        >
          <Lasso class="size-4" />
        </button>
```

Inspector panel: find the gen-mode panel's `<template v-else-if=` chain (the branch testing `genActive`) and add a sibling branch BEFORE the brush branch (`v-else-if="brush.active.value"`):

```html
      <!-- Smart select options -->
      <template v-else-if="smartActive">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Lasso class="size-3.5 text-white/70" />
          <span class="text-sm font-medium">Smart select</span>
          <button class="ml-auto text-white/40 hover:text-white/80 p-1" title="Done (Esc)" @click="exitSmartMode"><X class="size-3.5" /></button>
        </div>
        <div class="p-5 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
          <p class="text-[11px] text-white/45 leading-snug">
            Scribble roughly over an object on <span class="text-white/70">{{ smartTarget ? 'the selected image' : 'an image layer' }}</span> —
            the selection snaps to it. Hold <kbd class="px-1 rounded bg-white/10">Alt</kbd> to subtract.
          </p>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-white/40 w-12 shrink-0">Brush</span>
            <input type="range" min="8" max="240" step="2" v-model.number="smartBrush" class="flex-1 accent-white cursor-pointer" />
            <span class="text-[10px] text-white/50 w-8 text-right tabular-nums">{{ smartBrush }}</span>
          </div>
          <div class="text-[11px]" :class="smart.failed.value ? 'text-amber-400' : 'text-white/40'">
            <template v-if="smart.busy.value">Refining selection…</template>
            <template v-else-if="smart.failed.value">Smart refine unavailable — using your scribble.</template>
            <template v-else-if="smart.maskUrl.value">Selection refined. Scribble to add, Alt-scribble to subtract.</template>
            <template v-else-if="smartHasScribble">Using your scribble as the selection.</template>
          </div>
          <button
            class="h-8 px-2.5 rounded bg-white/[0.06] hover:bg-white/12 text-[11px] cursor-pointer disabled:opacity-30 disabled:cursor-default self-start"
            :disabled="!smartBnd" @click="enterSmartMode()"
          >Clear selection</button>
        </div>
      </template>
```

(`enterSmartMode()` doubles as "clear": it resets points, scribble, and refined state while staying in the mode.)

- [ ] **Step 5: Compile + type check**

With a dev server available (see memory: use Julien's on 127.0.0.1:3000 or a preview slot):

Run: `curl -s http://127.0.0.1:3000/_nuxt/components/vue-canvas/CompositorModal.vue | grep -c "smartActive"`
Expected: a number ≥ 10 (the SFC transformed without a compile error; an error page contains 0).

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "smart"`
Expected: no NEW errors (compare any hits against `git show HEAD:...`).

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): smart-select mode — scribble, SAM refine, overlay (no actions yet)"
```

---

### Task 5: Action bar + the five actions

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: Task 4's state (`smartCapture`, `smartRefinedCanvas`, `smartProjCanvas`, `smartBnd`, `smartTarget`, `exitSmartMode`), Task 1 helpers, existing `inpaint.uploadDataUrl`, `addImageFromName`, `setLocal`, `enterGenMode`, `genMaskCtx`, `genHasMask`, `genVersion`.
- Produces: user-facing actions; nothing downstream.

- [ ] **Step 1: Script — image-space mask + extraction + actions**

Append to the smart-select section (after the `smartFx` watches):

```ts
// ── Smart-select actions ──────────────────────────────────────────────────────
// All actions consume the IMAGE-space mask: the refined SAM mask, or (fallback)
// the scribble projected into image space through the artboard→image affine.
const smartActionBusy = ref(false)
const smartSelectionReady = computed(() => !!smartBnd.value && !smart.busy.value)

function smartImageMask(): HTMLCanvasElement | null {
  if (smartRefinedCanvas) return smartRefinedCanvas
  if (!smartCapture || !smartHasScribble.value || !smartScribbleCanvas) return null
  const c = document.createElement('canvas')
  c.width = smartCapture.capW; c.height = smartCapture.capH
  const ctx = c.getContext('2d')!
  const m = smartCapture.affine
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
  ctx.drawImage(smartScribbleCanvas, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return c
}

// Masked source pixels (image space) + their tight bbox, or null if empty.
function smartExtract(): { canvas: HTMLCanvasElement; bbox: BBox } | null {
  const cap = smartCapture; const mask = smartImageMask()
  if (!cap || !mask) return null
  const c = document.createElement('canvas'); c.width = cap.capW; c.height = cap.capH
  const ctx = c.getContext('2d')!
  ctx.drawImage(cap.img, 0, 0, cap.capW, cap.capH)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  const bbox = alphaBounds(ctx.getImageData(0, 0, cap.capW, cap.capH).data, cap.capW, cap.capH)
  return bbox ? { canvas: c, bbox } : null
}

function cropToDataUrl(src: HTMLCanvasElement, bbox: BBox): string {
  const w = bbox.maxX - bbox.minX + 1, h = bbox.maxY - bbox.minY + 1
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d')!.drawImage(src, bbox.minX, bbox.minY, w, h, 0, 0, w, h)
  return c.toDataURL('image/png')
}

// Upload a crop and add it as a layer placed exactly over its source pixels.
async function smartAddCropAsLayer(src: HTMLCanvasElement, bbox: BBox, nameHint: string) {
  const cap = smartCapture!; const layer = smartTarget.value!
  const name = await inpaint.uploadDataUrl(cropToDataUrl(src, bbox), nameHint)
  const place = cutoutPlacement(bbox, layer, cap.capW, cap.capH, canvasDisplay.w, canvasDisplay.h)
  const aspect = (bbox.maxX - bbox.minX + 1) / (bbox.maxY - bbox.minY + 1)
  addImageFromName(name, aspect, place as any)   // records history + selects
}

// Bake the inverse of the mask into the source layer (remove selected pixels).
async function smartBakeHole() {
  const cap = smartCapture!; const layer = smartTarget.value!; const mask = smartImageMask()!
  const c = document.createElement('canvas'); c.width = cap.capW; c.height = cap.capH
  const ctx = c.getContext('2d')!
  ctx.drawImage(cap.img, 0, 0, cap.capW, cap.capH)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(mask, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  const name = await inpaint.uploadDataUrl(c.toDataURL('image/png'), 'smarthole')
  setLocal(layer.id, { filename: name })
}

// Guard wrapper: every action needs a ready selection + capture, sets busy,
// logs failures, and (unless told otherwise) leaves smart mode when done.
async function smartAction(fn: () => Promise<void>, opts: { exit?: boolean } = {}) {
  if (!smartSelectionReady.value || smartActionBusy.value || !smartCapture || !smartTarget.value) return
  smartActionBusy.value = true
  try {
    await fn()
    if (opts.exit !== false) exitSmartMode()
  } catch (err) {
    console.error('[smart select]', err)
  } finally {
    smartActionBusy.value = false
  }
}

// New layer — non-destructive copy of the selection.
function smartNewLayer() {
  return smartAction(async () => {
    const ex = smartExtract(); if (!ex) return
    await smartAddCropAsLayer(ex.canvas, ex.bbox, 'smartcut')
  })
}
// Cut out — copy to a new layer AND remove from the source (two undo steps:
// the layer add, then the source swap).
function smartCutOut() {
  return smartAction(async () => {
    const ex = smartExtract(); if (!ex) return
    await smartAddCropAsLayer(ex.canvas, ex.bbox, 'smartcut')
    await smartBakeHole()
  })
}
// Delete — punch the selection out of the source (transparent hole; Generate
// fill is the content-aware alternative).
function smartDelete() {
  return smartAction(() => smartBakeHole())
}
// Use as mask — add the silhouette as a white stencil layer other layers can
// clip by via the existing Layer-mask (maskedByKey) picker.
function smartUseAsMask() {
  return smartAction(async () => {
    const mask = smartImageMask(); if (!mask) return
    const bbox = alphaBounds(mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data, mask.width, mask.height)
    if (!bbox) return
    await smartAddCropAsLayer(mask, bbox, 'smartmask')
  })
}
// Generate fill — hand the artboard-space selection to Generate mode as its
// region and let its prompt/Generate flow take over (target = same layer).
function smartGenerateFill() {
  return smartAction(async () => {
    const proj = smartProjCanvas(); if (!proj) return
    const snapshot = document.createElement('canvas')
    snapshot.width = proj.width; snapshot.height = proj.height
    snapshot.getContext('2d')!.drawImage(proj, 0, 0)
    exitSmartMode()                          // clears smart state (proj is snapshotted)
    enterGenMode()                           // locks target to the still-selected image
    const ctx = genMaskCtx()
    if (ctx) { ctx.drawImage(snapshot, 0, 0); genHasMask.value = true; genVersion.value++ }
  }, { exit: false })
}
```

- [ ] **Step 2: Template — floating action bar**

After the gen mini toolbar `<div v-if="genResult" data-gen-bar ...>` block, add:

```html
        <!-- Smart-select action bar -->
        <div
          v-if="smartActive && smartBnd"
          data-smart-bar
          class="absolute z-40 -translate-x-1/2 flex items-center gap-0.5 bg-[#1a1a1a]/95 backdrop-blur-sm rounded-[10px] p-1 border border-[#2a2a2a] shadow-lg"
          :style="{ left: Math.min(Math.max((smartBnd.minX + smartBnd.maxX) / 2, 130), canvasDisplay.w - 130) + 'px', top: Math.min(smartBnd.maxY + 12, canvasDisplay.h - 44) + 'px' }"
          @pointerdown.stop @click.stop
        >
          <button class="h-8 px-2 rounded-[8px] hover:bg-white/10 text-white/80 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
            :disabled="!smartSelectionReady || smartActionBusy" title="Copy the selection to a new layer (source untouched)"
            data-testid="smart-action-new-layer" @click="smartNewLayer">New layer</button>
          <button class="h-8 px-2 rounded-[8px] hover:bg-white/10 text-white/80 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
            :disabled="!smartSelectionReady || smartActionBusy" title="Lift the selection to a new layer and remove it from the source"
            data-testid="smart-action-cut-out" @click="smartCutOut">Cut out</button>
          <button class="h-8 px-2 rounded-[8px] hover:bg-white/10 text-white/80 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
            :disabled="!smartSelectionReady || smartActionBusy" title="Regenerate the selected area with a prompt (Generate mode)"
            data-testid="smart-action-generate-fill" @click="smartGenerateFill">Generate fill</button>
          <button class="h-8 px-2 rounded-[8px] hover:bg-white/10 text-white/80 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
            :disabled="!smartSelectionReady || smartActionBusy" title="Add the silhouette as a stencil layer for Layer mask clipping"
            data-testid="smart-action-use-as-mask" @click="smartUseAsMask">Use as mask</button>
          <button class="h-8 px-2 rounded-[8px] hover:bg-white/10 text-rose-300/90 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
            :disabled="!smartSelectionReady || smartActionBusy" title="Erase the selection from the layer (transparent hole)"
            data-testid="smart-action-delete" @click="smartDelete">Delete</button>
        </div>
```

- [ ] **Step 3: Compile + type check**

Run: `curl -s http://127.0.0.1:3000/_nuxt/components/vue-canvas/CompositorModal.vue | grep -c "smartAction"`
Expected: ≥ 8.

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "smart"`
Expected: no NEW errors vs `git show HEAD:frontend/app/components/vue-canvas/CompositorModal.vue`.

Run: `cd frontend && npx vitest run tests/unit/smart-select.unit.spec.ts tests/unit/use-smart-select.unit.spec.ts tests/unit/sam-input.unit.spec.ts`
Expected: all PASS (regression sweep).

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): smart-select action bar — new layer / cut out / generate fill / mask / delete"
```

---

### Task 6: E2E verification in the running app

**Files:** none (verification only; fix-forward anything found, committing to the files above).

This exercises the paid SAM path once (Replicate `meta/sam-2` point prompts — cents). The free fallback path is verified by the unit tests (failure → `failed=true` → scribble fallback) plus the panel copy check below.

- [ ] **Step 1: Get a preview + a frame with an image**

Start/attach a dev server (`.claude/launch.json` / preview_start; if no slot free, use 127.0.0.1:3000). Home → "Start a blank project" → close the start modal → `window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: 'Compositor' } }))` → open it via `window.dispatchEvent(new CustomEvent('sailor:openCompositor', { detail: { nodeId } }))`. Add an image layer (toolbar "Add image" or a brand image) — any photo with a clear subject.

- [ ] **Step 2: Verify the flow**

1. With the image selected, the Lasso toolbar button (`[data-testid="smart-select-toggle"]`) is enabled; click it → Smart select panel shows.
2. Scribble over the subject → animated overlay appears; "Refining selection…" → overlay snaps to the object's silhouette; action bar appears below the selection.
3. Alt-scribble over part of it → selection shrinks after re-refine.
4. `New layer` → new image layer over the same spot; move it aside → source intact underneath.
5. Undo twice → back to pre-action state; redo; then `Cut out` → object lifts, source has a hole.
6. Re-select the source image, re-enter Smart select, scribble, `Delete` → transparent hole.
7. Re-enter, scribble, `Generate fill` → Generate mode opens with the refined region tinted and the image as target; type a prompt and Generate (one flux-fill call) → region replaced.
8. `Use as mask` → a white stencil layer appears; select another layer → its Layer mask picker lists the stencil; picking it clips correctly.
9. Deselect all layers → Lasso button disabled with the "select an image layer first" title.

- [ ] **Step 3: Update memory + report**

Record outcome (landed + verified, or list what's owed) in the auto-memory per its conventions.
