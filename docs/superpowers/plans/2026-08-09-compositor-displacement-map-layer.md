# Compositor Displacement Map Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-image-layer "Displacement map" toggle in the Compositor that turns that layer into a lens which warps (displaces) everything stacked below it, instead of drawing its own pixels.

**Architecture:** Two small pure functions (`buildDisplacementField`, `resampleBilinear`) in a new `lib/compositor/displace.ts` carry all the warp math and are unit-tested with plain typed-array fixtures. A module-private helper `applyDisplaceFromLayer` in `useCompositorLayers.ts` snapshots the already-painted backdrop (the same moment `applyBackdropBlur` uses), renders the map layer to a device-sized offscreen, builds an offset field, bilinear-resamples the backdrop, and writes it back — hooked in as one branch of the `paintLayerStack` bottom-to-top loop. The inspector gets a toggle group that adds/removes an optional `displaceMap` field on the image layer.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Canvas 2D, Vitest. `~/` alias = `frontend/app/`.

## Global Constraints

- Frontend lives in `frontend/`; run all `npm`/`npx` commands from `frontend/`.
- Unit tests: Vitest, files under `frontend/tests/unit/` named `*.unit.spec.ts`, imports via the `~/` alias, no DOM/canvas (plain `Uint8ClampedArray` fixtures).
- Typecheck baseline is ~328 pre-existing errors — do NOT add any NEW error that names the types this feature introduces (`DisplaceMapSpec`, `displaceMap`, `buildDisplacementField`, `resampleBilinear`). Pre-existing unrelated errors stay as-is.
- Colour convention: action blue is the only accent; no purple. Reuse existing `panel-label` / input styles verbatim.
- Dev server host is `127.0.0.1` (never `localhost` — that hits the IPv6 WS listener and 426s).
- Commit hygiene: commit directly to `main`, staging ONLY this feature's own files/hunks (parallel sessions share this checkout).
- UI labels use plain language ("Displacement map", "Amount", "Read").

---

## File Structure

- **Create** `frontend/app/lib/compositor/displace.ts` — the `DisplaceMapSpec` type, `DEFAULT_DISPLACE_MAP`, and the two pure functions. One responsibility: turn a map image into an offset field and resample a backdrop through it. No DOM.
- **Create** `frontend/tests/unit/compositor-displace.unit.spec.ts` — unit tests for the pure functions.
- **Modify** `frontend/app/composables/useCompositorLayers.ts` — add `displaceMap?` to `ImageLayer`, add the module-private `applyDisplaceFromLayer` helper, and add the dispatch branch in `paintLayerStack`.
- **Modify** `frontend/app/components/vue-canvas/CompositorModal.vue` — inspector toggle group + getter/setters, and hide Blend/Opacity while the layer is a map.

---

## Task 1: Displacement pure functions (`displace.ts`)

**Files:**
- Create: `frontend/app/lib/compositor/displace.ts`
- Test: `frontend/tests/unit/compositor-displace.unit.spec.ts`

**Interfaces:**
- Consumes: `toHeightPixels(rgba: Uint8ClampedArray, invert?: boolean, contrast?: number): Uint8ClampedArray` from `~/lib/scene3d/relief`.
- Produces (relied on by Tasks 2 & 3):
  - `interface DisplaceMapSpec { read: 'height' | 'channels'; amount: number; invert?: boolean; softness?: number }`
  - `const DEFAULT_DISPLACE_MAP: DisplaceMapSpec`
  - `buildDisplacementField(map: Uint8ClampedArray, w: number, h: number, spec: DisplaceMapSpec): Float32Array` — length `w*h*2`, interleaved `[dx,dy,...]`, each component in normalized `[-1,1]`, gated by the map's alpha.
  - `resampleBilinear(src: Uint8ClampedArray, field: Float32Array, amount: number, w: number, h: number): Uint8ClampedArray` — length `w*h*4`; `outUV = xy + field*amount`, edge-clamped bilinear sample.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/compositor-displace.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildDisplacementField,
  resampleBilinear,
  DEFAULT_DISPLACE_MAP,
} from '~/lib/compositor/displace'

// Build a w×h RGBA buffer from a per-pixel fill fn returning [r,g,b,a].
function makeMap(w: number, h: number, fill: (x: number, y: number) => number[]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, al] = fill(x, y)
      const p = (y * w + x) * 4
      a[p] = r!; a[p + 1] = g!; a[p + 2] = b!; a[p + 3] = al!
    }
  }
  return a
}
const dx = (f: Float32Array, w: number, x: number, y: number) => f[(y * w + x) * 2]!
const dy = (f: Float32Array, w: number, x: number, y: number) => f[(y * w + x) * 2 + 1]!

describe('buildDisplacementField', () => {
  it('height mode: a flat map produces a ~zero field', () => {
    const w = 5, h = 5
    const map = makeMap(w, h, () => [128, 128, 128, 255])
    const f = buildDisplacementField(map, w, h, { read: 'height', amount: 40, softness: 0 })
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      expect(Math.abs(dx(f, w, x, y))).toBeLessThan(1e-6)
      expect(Math.abs(dy(f, w, x, y))).toBeLessThan(1e-6)
    }
  })

  it('height mode: pushes at a brightness edge, ~zero in flat regions', () => {
    const w = 5, h = 3
    // Left half black (x<=1), right half white (x>=3), step across the middle column.
    const map = makeMap(w, h, (x) => { const v = x <= 1 ? 0 : x >= 3 ? 255 : 128; return [v, v, v, 255] })
    const f = buildDisplacementField(map, w, h, { read: 'height', amount: 40, softness: 0 })
    // Flat interior far from the edge: ~0.
    expect(Math.abs(dx(f, w, 0, 1))).toBeLessThan(1e-6)
    // At the edge column the horizontal push is large and points toward white (+x).
    expect(dx(f, w, 2, 1)).toBeGreaterThan(0.4)
    // Vertical push stays ~0 (edge is vertical).
    expect(Math.abs(dy(f, w, 2, 1))).toBeLessThan(1e-6)
  })

  it('height mode: invert flips the push direction', () => {
    const w = 5, h = 3
    const map = makeMap(w, h, (x) => { const v = x <= 1 ? 0 : x >= 3 ? 255 : 128; return [v, v, v, 255] })
    const normal = buildDisplacementField(map, w, h, { read: 'height', amount: 40, invert: false, softness: 0 })
    const inv = buildDisplacementField(map, w, h, { read: 'height', amount: 40, invert: true, softness: 0 })
    expect(Math.sign(dx(normal, w, 2, 1))).toBe(-Math.sign(dx(inv, w, 2, 1)))
  })

  it('channels mode: R drives x, G drives y', () => {
    const w = 2, h = 2
    const map = makeMap(w, h, () => [255, 128, 0, 255]) // R=1 → dx=+1, G=0.5 → dy=0
    const f = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 })
    expect(dx(f, w, 0, 0)).toBeCloseTo(1, 2)
    expect(dy(f, w, 0, 0)).toBeCloseTo(0, 2)
  })

  it('alpha gates the offset: transparent map pixels push nothing', () => {
    const w = 2, h = 2
    const map = makeMap(w, h, () => [255, 255, 0, 0]) // fully transparent
    const f = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 })
    for (let i = 0; i < f.length; i++) expect(f[i]).toBeCloseTo(0, 6)
  })

  it('channels and height produce different fields on the same colour input', () => {
    const w = 4, h = 4
    const map = makeMap(w, h, (x) => [x * 60, 200 - x * 40, 90, 255])
    const fh = buildDisplacementField(map, w, h, { read: 'height', amount: 40, softness: 0 })
    const fc = buildDisplacementField(map, w, h, { read: 'channels', amount: 40, softness: 0 })
    let diff = 0
    for (let i = 0; i < fh.length; i++) diff += Math.abs(fh[i]! - fc[i]!)
    expect(diff).toBeGreaterThan(0.1)
  })
})

describe('resampleBilinear', () => {
  const W = 4, H = 4
  // A distinct value per pixel so shifts are detectable: r = x*10, g = y*10.
  const src = (() => {
    const a = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4; a[p] = x * 10; a[p + 1] = y * 10; a[p + 2] = 0; a[p + 3] = 255
    }
    return a
  })()

  it('amount 0 returns the source byte-identical', () => {
    const field = new Float32Array(W * H * 2).fill(0.7) // non-zero field, but amount 0
    const out = resampleBilinear(src, field, 0, W, H)
    expect(Array.from(out)).toEqual(Array.from(src))
  })

  it('a constant field shifts interior pixels by the expected amount', () => {
    // field dx=+1 everywhere, amount 1 → each output samples src one px to the right.
    const field = new Float32Array(W * H * 2)
    for (let i = 0; i < W * H; i++) field[i * 2] = 1
    const out = resampleBilinear(src, field, 1, W, H)
    // interior pixel (1,1) should now hold src(2,1): r = 20
    expect(out[(1 * W + 1) * 4]).toBe(20)
  })

  it('edge clamp: sampling past the right edge reads the last column, never out of bounds', () => {
    const field = new Float32Array(W * H * 2)
    for (let i = 0; i < W * H; i++) field[i * 2] = 10 // huge push right
    const out = resampleBilinear(src, field, 5, W, H)
    // (3,0) pushed way right → clamped to x=3 → r = 30
    expect(out[(0 * W + 3) * 4]).toBe(30)
  })

  it('DEFAULT_DISPLACE_MAP has height read and a sane amount', () => {
    expect(DEFAULT_DISPLACE_MAP.read).toBe('height')
    expect(DEFAULT_DISPLACE_MAP.amount).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/compositor-displace.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/displace` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/compositor/displace.ts`:

```ts
import { toHeightPixels } from '~/lib/scene3d/relief'

/**
 * Displacement-map spec attached to an image layer. Presence on the layer = active:
 * the layer stops drawing its own pixels and instead warps everything below it.
 */
export interface DisplaceMapSpec {
  /** How a map pixel's value becomes a push direction. */
  read: 'height' | 'channels'
  /** Max push in SCREEN px (dpr-invariant); the renderer scales it to device px. */
  amount: number
  /** Height mode only: flip high/low. */
  invert?: boolean
  /** Blur the offset field by this px radius before warping (smooths jaggies). 0 = off. */
  softness?: number
}

export const DEFAULT_DISPLACE_MAP: DisplaceMapSpec = {
  read: 'height',
  amount: 40,
  invert: false,
  softness: 2,
}

/**
 * Turn a map image into a per-pixel offset field.
 * Returns a Float32Array of length w*h*2, interleaved [dx0,dy0,dx1,dy1,...], each
 * component normalized to roughly [-1,1] (the resample multiplies by `amount`).
 * The map's own alpha gates the offset — transparent map pixels push nothing — so a
 * small pasted image only distorts the backdrop under its footprint.
 */
export function buildDisplacementField(
  map: Uint8ClampedArray,
  w: number,
  h: number,
  spec: DisplaceMapSpec,
): Float32Array {
  const field = new Float32Array(w * h * 2)
  if (w < 1 || h < 1) return field

  if (spec.read === 'channels') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        const a = map[p + 3]! / 255
        const o = (y * w + x) * 2
        field[o] = (map[p]! / 255 - 0.5) * 2 * a
        field[o + 1] = (map[p + 1]! / 255 - 0.5) * 2 * a
      }
    }
  } else {
    // Height: grayscale height field; push along its gradient (steepest ascent).
    const height = toHeightPixels(map, spec.invert ?? false)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : x
        const xr = x < w - 1 ? x + 1 : x
        const yt = y > 0 ? y - 1 : y
        const yb = y < h - 1 ? y + 1 : y
        const hl = height[(y * w + xl) * 4]!
        const hr = height[(y * w + xr) * 4]!
        const ht = height[(yt * w + x) * 4]!
        const hb = height[(yb * w + x) * 4]!
        // Central difference, normalized: /255 → ~[-1,1]; /(span||1) halves at the borders.
        const gx = (hr - hl) / (255 * ((xr - xl) || 1))
        const gy = (hb - ht) / (255 * ((yb - yt) || 1))
        const p = (y * w + x) * 4
        const a = map[p + 3]! / 255
        const o = (y * w + x) * 2
        field[o] = gx * a
        field[o + 1] = gy * a
      }
    }
  }

  const soft = Math.round(spec.softness ?? 0)
  if (soft >= 1) blurFieldInPlace(field, w, h, soft)
  return field
}

/** Separable box blur of the interleaved (dx,dy) field, radius r px, edge-clamped. In place. */
function blurFieldInPlace(field: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(field.length)
  // Horizontal pass → tmp.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0, sy = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const cx = Math.min(w - 1, Math.max(0, x + k))
        sx += field[(y * w + cx) * 2]!; sy += field[(y * w + cx) * 2 + 1]!; n++
      }
      tmp[(y * w + x) * 2] = sx / n; tmp[(y * w + x) * 2 + 1] = sy / n
    }
  }
  // Vertical pass → field.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0, sy = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const cy = Math.min(h - 1, Math.max(0, y + k))
        sx += tmp[(cy * w + x) * 2]!; sy += tmp[(cy * w + x) * 2 + 1]!; n++
      }
      field[(y * w + x) * 2] = sx / n; field[(y * w + x) * 2 + 1] = sy / n
    }
  }
}

/**
 * Resample a backdrop through an offset field. For each output pixel:
 *   sampleUV = (x,y) + field*amount, edge-clamped, bilinear.
 * amount is in the same px space as the src buffer (device px at render time).
 * amount 0 returns the source byte-identical.
 */
export function resampleBilinear(
  src: Uint8ClampedArray,
  field: Float32Array,
  amount: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  const sample = (sxRaw: number, syRaw: number, ch: number): number => {
    const sx = sxRaw < 0 ? 0 : sxRaw > w - 1 ? w - 1 : sxRaw
    const sy = syRaw < 0 ? 0 : syRaw > h - 1 ? h - 1 : syRaw
    const x0 = Math.floor(sx), y0 = Math.floor(sy)
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
    const fx = sx - x0, fy = sy - y0
    const i00 = (y0 * w + x0) * 4 + ch, i10 = (y0 * w + x1) * 4 + ch
    const i01 = (y1 * w + x0) * 4 + ch, i11 = (y1 * w + x1) * 4 + ch
    const top = src[i00]! * (1 - fx) + src[i10]! * fx
    const bot = src[i01]! * (1 - fx) + src[i11]! * fx
    return top * (1 - fy) + bot * fy
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fo = (y * w + x) * 2
      const sx = x + field[fo]! * amount
      const sy = y + field[fo + 1]! * amount
      const po = (y * w + x) * 4
      out[po] = sample(sx, sy, 0)
      out[po + 1] = sample(sx, sy, 1)
      out[po + 2] = sample(sx, sy, 2)
      out[po + 3] = sample(sx, sy, 3)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/compositor-displace.unit.spec.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/lib/compositor/displace.ts tests/unit/compositor-displace.unit.spec.ts
git commit -m "feat(compositor): displacement-map pure functions (field + bilinear resample)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire displacement into the render loop (`useCompositorLayers.ts`)

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (ImageLayer at `:280-287`; new helper near the other device-space effects; loop branch at `~:1647`)

**Interfaces:**
- Consumes: `DisplaceMapSpec`, `buildDisplacementField`, `resampleBilinear` from `~/lib/compositor/displace`; module-private `drawLocalLayerSelf`, exported `localBlendOp` (unused here), `ImageLayer`, `LocalLayer`.
- Produces: the runtime behaviour (a map layer warps the backdrop). No new exports.

**Verification note:** Canvas compositing isn't cleanly unit-testable, so this task is verified by typecheck + a live Browser-pane hand-check with a deliberately-broken control (per the spec's testing section). Green units are not proof here.

- [ ] **Step 1: Add the `displaceMap` field to `ImageLayer`**

Add the import near the top of `useCompositorLayers.ts` (with the other `~/lib/compositor/*` imports):

```ts
import { buildDisplacementField, resampleBilinear, type DisplaceMapSpec } from '~/lib/compositor/displace'
```

Extend `ImageLayer` (`:280-287`) — add the field as the last member:

```ts
export interface ImageLayer extends LayerCommon {
  kind: 'image'
  filename: string        // uploaded image in ComfyUI's input dir
  w: number; h: number    // normalized to canvas width (aspect preserved on drop)
  tint?: Paint            // optional fill blended over the image, clipped to its alpha
  tintBlend?: string      // blend mode for the tint (same names as layer blend)
  tintOpacity?: number    // 0..1 tint strength; default 1
  displaceMap?: DisplaceMapSpec // present ⇒ layer is a lens warping everything below
}
```

- [ ] **Step 2: Add the `applyDisplaceFromLayer` helper**

Add this module-private function next to `applyBackdropBlur` (after its closing brace, ~`:1483`). It reuses the exact device-space idiom from `applyBackdropBlur` / `drawLocalLayerSelf`:

```ts
// Displacement map: the layer's pixels are NOT drawn — instead they warp the backdrop
// already painted below this layer. Called from paintLayerStack's item loop. `ghost` draws
// a faint preview of the map in the editor so the layer doesn't appear to vanish (never in bake).
function applyDisplaceFromLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  W: number,
  H: number,
  opts?: { ghost?: boolean },
) {
  const spec = layer.displaceMap
  if (!spec) return
  const dev = ctx.canvas
  const w = dev.width, h = dev.height
  if (w < 1 || h < 1) return
  const t = ctx.getTransform()

  // 1. Snapshot the backdrop below this layer (device pixels; getImageData ignores transform).
  const src = ctx.getImageData(0, 0, w, h)

  // 2. Render the map layer (full colour, its transform baked in) to a device-sized offscreen.
  const off = document.createElement('canvas')
  off.width = w; off.height = h
  const octx = off.getContext('2d')
  if (!octx) return
  octx.setTransform(t)
  const mapGhost = { ...layer, opacity: 1, effects: undefined, blend: undefined, displaceMap: undefined } as LocalLayer
  drawLocalLayerSelf(octx, mapGhost, W, H)
  const mapData = octx.getImageData(0, 0, w, h)

  // 3+4. Build the offset field and resample the backdrop. amount is SCREEN px → scale to device.
  const field = buildDisplacementField(mapData.data, w, h, spec)
  const amountDev = spec.amount * (t.a || 1)
  const outArr = resampleBilinear(src.data, field, amountDev, w, h)

  // 5. Write the warped backdrop back (putImageData is always device-space).
  ctx.putImageData(new ImageData(outArr, w, h), 0, 0)

  // Editor affordance: faint ghost of the map so it's visible/selectable. Never in bake.
  if (opts?.ghost) {
    const g = { ...layer, opacity: 0.14, effects: undefined, blend: undefined, displaceMap: undefined } as LocalLayer
    drawLocalLayerSelf(ctx, g, W, H)
  }
}
```

- [ ] **Step 3: Add the dispatch branch in `paintLayerStack`**

In the item loop, immediately after the `layerHidden`/`skip` guards (`:1651-1652`) and BEFORE the mask resolution (`:1655`), insert:

```ts
      // Displacement map: consume this image layer as a lens over everything below.
      // Placed before mask/blend/motion — a map layer ignores all of those.
      if (layer.kind === 'image' && (layer as ImageLayer).displaceMap) {
        applyDisplaceFromLayer(ctx, layer as ImageLayer, W, H, { ghost: !bake })
        continue
      }
```

(`bake` is already in scope in `paintLayerStack` — it is captured into `_fieldCtx` at `:1558-1563`. `layer` is `item.layer` from `:1647`; this branch only runs for `item.type === 'local'` since the wired branch `continue`s earlier at the `item.type === 'wired'` check.)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck 2>&1 | grep -Ei "displace|displaceMap|buildDisplacementField|resampleBilinear" || echo "no new errors naming displacement types"`
Expected: `no new errors naming displacement types` (pre-existing ~328 baseline errors unrelated to this feature are fine).

- [ ] **Step 5: Live hand-check with a broken control**

Start/verify the dev server and open the Compositor in the Browser pane (host `127.0.0.1`). Then:

1. In a Compositor, add a background image or shapes (the thing to be warped), then paste/add a second image on top.
2. Manually set `displaceMap` on the top image to confirm the render path before the UI exists — in the Browser pane console:
   ```js
   // Select the top image layer in the UI first, then in console find & mutate it via the app store,
   // OR temporarily hard-code a displaceMap default on the top image in devtools state.
   ```
   If direct state mutation is impractical, defer this step to the end of Task 3 (where the toggle exists) — but still perform the broken-control check there.
3. **Confirm real behaviour:** with the map active and Amount > 0, the layers *below* visibly distort, strongest where the map has content/contrast, and undistorted outside the map's footprint. Layers *above* the map are unaffected.
4. **Broken-control proof:** edit `buildDisplacementField` to `return new Float32Array(w*h*2)` (all-zero field), reload, confirm the warp **disappears entirely** (backdrop renders flat). Then revert. This proves the field is actually driving the warp (guards against a "looks warped but isn't" false pass).
5. Screenshot the before/after for the completion report.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add app/composables/useCompositorLayers.ts
git commit -m "feat(compositor): image layer displaceMap warps the backdrop below it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Inspector toggle + controls (`CompositorModal.vue`)

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (helpers near `:2075`; Opacity block `:4900`; Blend block `:4934`; insertion point `:5060`)

**Interfaces:**
- Consumes: `DEFAULT_DISPLACE_MAP` from `~/lib/compositor/displace`; existing `setLocal(id, patch)` and `selectedLocal`.
- Produces: user-facing toggle/controls that write/clear `layer.displaceMap`.

**Verification note:** Vue wiring is verified by a live Browser-pane hand-check, not units.

- [ ] **Step 1: Import the default spec**

In the component's `<script setup>`, add to the existing `~/lib/compositor/*` imports:

```ts
import { DEFAULT_DISPLACE_MAP } from '~/lib/compositor/displace'
```

- [ ] **Step 2: Add getter/setter/toggle helpers**

Next to `localShadow`/`setLocalShadow` (~`:2095`), mirroring the top-level-field pattern used by `layerMask`/`toggleLayerMask`:

```ts
function localDisplace(l: any): any | undefined { return l?.displaceMap }
function setLocalDisplace(l: any, patch: Record<string, any>) {
  if (!l) return
  const cur = localDisplace(l) || { ...DEFAULT_DISPLACE_MAP }
  setLocal(l.id, { displaceMap: { ...cur, ...patch } })
}
function toggleLocalDisplace(l: any) {
  if (!l) return
  if (localDisplace(l)) setLocal(l.id, { displaceMap: undefined })
  else setLocalDisplace(l, {})
}
```

- [ ] **Step 3: Hide Blend and Opacity while the layer is a map**

Add a `v-if` to the Opacity wrapper `<div>` (`:4900`) and the Blend wrapper `<div>` (`:4935`) so they disappear when displacement mode is active:

Opacity (`:4900`) — change the opening `<div>` to:
```html
            <div v-if="!localDisplace(selectedLocal)">
```
Blend (`:4935`) — change the opening `<div>` to:
```html
          <div v-if="!localDisplace(selectedLocal)">
```

- [ ] **Step 4: Add the Displacement map inspector group**

Insert at `:5060` (just after the Background-blur group closes, immediately before the `<!-- Post-processing ... -->` comment / `PostEffectsControls` mount). Image-layer only:

```html
          <!-- Displacement map: turn this image into a lens that warps everything below it -->
          <div v-if="selectedLocal?.kind === 'image'" class="mt-3">
            <div class="flex items-center justify-between">
              <div class="panel-label">Displacement map</div>
              <button type="button"
                class="text-xs px-2 py-1 rounded border border-white/[0.06] text-white/80 hover:bg-white/[0.06]"
                :class="localDisplace(selectedLocal) ? 'bg-[#2563eb]/30 text-white' : 'bg-white/[0.04]'"
                @click="toggleLocalDisplace(selectedLocal)">
                {{ localDisplace(selectedLocal) ? 'On' : 'Off' }}
              </button>
            </div>
            <div v-if="localDisplace(selectedLocal)" class="mt-2 flex flex-col gap-2">
              <div>
                <div class="panel-label mb-1.5">Read</div>
                <select :value="localDisplace(selectedLocal).read"
                  class="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-xs text-white/90 outline-none cursor-pointer"
                  @change="setLocalDisplace(selectedLocal, { read: ($event.target as HTMLSelectElement).value })">
                  <option value="height">Height (brightness)</option>
                  <option value="channels">Channels (R→x, G→y)</option>
                </select>
              </div>
              <div>
                <div class="panel-label mb-1.5">Amount</div>
                <input type="number" min="0" max="200" step="1" :value="localDisplace(selectedLocal).amount"
                  class="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                  @input="setLocalDisplace(selectedLocal, { amount: Math.max(0, Math.min(200, parseFloat(($event.target as HTMLInputElement).value) || 0)) })" />
              </div>
              <div>
                <div class="panel-label mb-1.5">Softness</div>
                <input type="number" min="0" max="20" step="1" :value="localDisplace(selectedLocal).softness ?? 0"
                  class="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                  @input="setLocalDisplace(selectedLocal, { softness: Math.max(0, Math.min(20, parseFloat(($event.target as HTMLInputElement).value) || 0)) })" />
              </div>
              <label v-if="localDisplace(selectedLocal).read === 'height'" class="flex items-center gap-2 text-xs text-white/80">
                <input type="checkbox" :checked="!!localDisplace(selectedLocal).invert"
                  @change="setLocalDisplace(selectedLocal, { invert: ($event.target as HTMLInputElement).checked })" />
                Invert
              </label>
            </div>
          </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck 2>&1 | grep -Ei "displace|CompositorModal" || echo "no new errors naming displacement"`
Expected: `no new errors naming displacement` (pre-existing baseline unrelated errors are fine).

- [ ] **Step 6: Live hand-check (full flow + broken control)**

In the Browser pane (`127.0.0.1`), open a Compositor with a background to warp:
1. Paste an image on top → confirm it renders as a normal picture (toggle Off by default).
2. Select it → the new "Displacement map" group shows in the inspector. Click the toggle → **On**.
3. Confirm: the image's own pixels stop drawing (faint ghost remains), the Blend and Opacity rows disappear, and the layers below warp.
4. Drag **Amount** 0→200: distortion grows; at 0 the backdrop is undistorted.
5. Switch **Read** to Channels: the warp visibly changes character (chromatic/directional) vs Height.
6. Move/scale the map layer: the warped region follows its footprint.
7. Toggle **Off**: the image returns to a normal picture, Blend/Opacity reappear — non-destructive.
8. **Broken-control proof:** temporarily change `setLocalDisplace`'s default to `amount: 0`, reload, confirm toggling On produces NO warp; revert. (Confirms the amount control is really driving it.)
9. Screenshot On vs Off for the report.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): Displacement map inspector toggle + controls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Data model (`displaceMap?` on ImageLayer) → Task 2 Step 1. ✅
- Scope "everything below" (snapshot backdrop at the layer's loop point) → Task 2 Step 2–3. ✅
- Default read = height, channel option → Task 1 (`DEFAULT_DISPLACE_MAP`), Task 3 Read select. ✅
- Manual toggle, non-destructive/reversible → Task 3 `toggleLocalDisplace` (adds/clears field). ✅
- Footprint gating via map alpha → Task 1 `buildDisplacementField` alpha multiply + test. ✅
- Blend/Opacity hidden in map mode → Task 3 Step 3. ✅
- amount px space (dpr-invariant) → Task 2 `amountDev = amount * t.a`; spec comment updated to "screen px". ✅
- Testing: pure-fn units (edge-correlation, byte-identical no-op, channels≠height) → Task 1; live broken-control hand-check → Tasks 2 & 3. ✅
- Perf risk → not code; the field builds at device res once per paint (acceptable for v1; caching is a listed future mitigation, out of scope).

**Deliberate scope trims from the spec (surface these at handoff):**
- Driver-layer visibility is v1-implemented as a **faint ghost** everywhere + the inspector's clear "On" state. The spec's **canvas "⤳ Map" badge and dimmed layer-list row** are deferred to a fast-follow (they need overlay/list anchors not required to make the feature work). Not silently dropped — noted here and in the completion report.
- Edge mode is clamp only; wrap/transparent remain out of scope (spec agrees).

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅
**Type consistency:** `DisplaceMapSpec`, `displaceMap`, `buildDisplacementField(map,w,h,spec)`, `resampleBilinear(src,field,amount,w,h)`, `DEFAULT_DISPLACE_MAP`, `localDisplace`/`setLocalDisplace`/`toggleLocalDisplace` used identically across all tasks. ✅

## Notes for the implementer
- Read the surrounding code at each anchor line before editing — line numbers drift as other sessions commit; match by the quoted context, not the raw number.
- `drawLocalLayerSelf`, `applyBackdropBlur`, `paintLayerStack`'s `bake` are all module-private in `useCompositorLayers.ts`; `applyDisplaceFromLayer` lives in the same module so it can call them directly.
- If the live check can't mutate layer state before Task 3, do the Task 2 broken-control proof at the end of Task 3 instead — but do NOT skip it.
