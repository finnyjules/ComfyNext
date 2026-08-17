# Torn Paper Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-layer "torn paper" edge effect to the Compositor — a ragged, grain-dissolved alpha boundary with a variable-width, textured white lip — controllable in the layer inspector and settable by the agent from a prompt.

**Architecture:** A new pure module `lib/compositor/tornEdge.ts` owns the `TornEdgeSpec` type, seeded noise, an approximate signed-distance transform of the layer's alpha, and a per-pixel pass that carves the edge + paints the lip. `paintLayer` (the existing effected-offscreen path) calls it on the device-sized offscreen before stamping, so preview and export share one code path. The agent surface gains a `setLayerTornEdge` command; the modal gains a control panel.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, Canvas 2D, Vitest.

## Global Constraints

- Effect is **per-layer only** (no whole-frame). No motion keyframing.
- Tear noise MUST be **seeded / deterministic** (no `Math.random`) — required for preview==render and for future caching.
- The per-pixel pass MUST be **bounded to a band near the alpha edge** (interior pixels skipped) so it doesn't scan whole layers.
- Texture (`grainTexture`) applies to the **lip band only**, never image content.
- Follow existing patterns: agent clamps mirror `sanitizePostEffect`; modal helpers mirror `setLayerBlur`/`setInnerShadow` via `setLocal(id, patch)`.
- Colours: action blue is the only accent; no purple. (Project convention.)
- Tests live in `frontend/tests/unit/*.unit.spec.ts`; run with `cd frontend && npx vitest run <file>`.
- Commit after each task. Repo works main-direct; stage only the files listed per task.

---

### Task 1: `tornEdge.ts` module scaffold — types, defaults, predicate, sanitizer

**Files:**
- Create: `frontend/app/lib/compositor/tornEdge.ts`
- Test: `frontend/tests/unit/torn-edge.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TornEdgeStyle = 'ripped' | 'deckle' | 'shredded'`
  - `interface TornEdgeSpec { style, amount, roughness, grain, grainTexture, lipWidth, lipVariation, lipColor, seed }`
  - `const DEFAULT_TORN_EDGE: TornEdgeSpec`
  - `function tornEdgeActive(t): t is TornEdgeSpec`
  - `function sanitizeTornEdge(raw: unknown, cur?: TornEdgeSpec): TornEdgeSpec`
  - `const TORN_EDGE_STYLES: readonly TornEdgeStyle[]`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/torn-edge.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TORN_EDGE, tornEdgeActive, sanitizeTornEdge, TORN_EDGE_STYLES,
} from '~/lib/compositor/tornEdge'

describe('tornEdge spec helpers', () => {
  it('DEFAULT_TORN_EDGE is a complete, active spec', () => {
    expect(DEFAULT_TORN_EDGE.style).toBe('shredded')
    expect(tornEdgeActive(DEFAULT_TORN_EDGE)).toBe(true)
  })

  it('tornEdgeActive is false for undefined and for a fully-zero spec', () => {
    expect(tornEdgeActive(undefined)).toBe(false)
    expect(tornEdgeActive(null)).toBe(false)
    expect(tornEdgeActive({ ...DEFAULT_TORN_EDGE, amount: 0, grain: 0, lipWidth: 0 })).toBe(false)
  })

  it('sanitizeTornEdge clamps out-of-range numbers and rejects bad style/colour', () => {
    const s = sanitizeTornEdge({
      style: 'nope', amount: 9999, roughness: 5, grain: -3,
      grainTexture: 2, lipWidth: 1000, lipVariation: -1, lipColor: 'blurple', seed: 3,
    })
    expect(TORN_EDGE_STYLES).toContain(s.style)   // fell back to a valid style
    expect(s.amount).toBeLessThanOrEqual(200)
    expect(s.roughness).toBe(1)
    expect(s.grain).toBe(0)
    expect(s.grainTexture).toBe(1)
    expect(s.lipWidth).toBeLessThanOrEqual(80)
    expect(s.lipVariation).toBe(0)
    expect(s.lipColor).toBe(DEFAULT_TORN_EDGE.lipColor)  // invalid hex → default
    expect(s.seed).toBe(3)
  })

  it('sanitizeTornEdge merges partial patch over current', () => {
    const cur = { ...DEFAULT_TORN_EDGE, amount: 20 }
    const s = sanitizeTornEdge({ grain: 4 }, cur)
    expect(s.amount).toBe(20)   // preserved from cur
    expect(s.grain).toBe(4)     // overridden
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/torn-edge.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/tornEdge`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/compositor/tornEdge.ts
export type TornEdgeStyle = 'ripped' | 'deckle' | 'shredded'

export const TORN_EDGE_STYLES: readonly TornEdgeStyle[] = ['ripped', 'deckle', 'shredded']

export interface TornEdgeSpec {
  style: TornEdgeStyle
  amount: number        // tear depth into the element (px)
  roughness: number     // fray/meander detail, 0..1
  grain: number         // grain dissolve band width (px, 0 = crisp)
  grainTexture: number  // paper-fibre texture strength on the lip, 0..1
  lipWidth: number      // average white-lip band width (px, 0 = no lip)
  lipVariation: number  // how much the lip width varies along the edge, 0..1
  lipColor: string      // hex, warm paper-white default
  seed: number          // deterministic — same seed = same tear
}

export const DEFAULT_TORN_EDGE: TornEdgeSpec = {
  style: 'shredded',
  amount: 37,
  roughness: 0.18,
  grain: 7,
  grainTexture: 0.6,
  lipWidth: 10,
  lipVariation: 0.73,
  lipColor: '#fbf6ee',
  seed: 12,
}

/** Bounds each numeric field is clamped to. */
const CLAMP: Record<string, [number, number]> = {
  amount: [0, 200], roughness: [0, 1], grain: [0, 60], grainTexture: [0, 1],
  lipWidth: [0, 80], lipVariation: [0, 1], seed: [0, 1e9],
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Active when it would visibly change the edge (some tear, grain, or lip). */
export function tornEdgeActive(t: TornEdgeSpec | undefined | null): t is TornEdgeSpec {
  return !!t && (t.amount > 0 || t.grain > 0 || t.lipWidth > 0)
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Merge a partial/raw patch over `cur` (or DEFAULT), clamping every field. */
export function sanitizeTornEdge(raw: unknown, cur?: TornEdgeSpec): TornEdgeSpec {
  const base = cur ? { ...cur } : { ...DEFAULT_TORN_EDGE }
  const r = (raw ?? {}) as Record<string, unknown>
  const style = TORN_EDGE_STYLES.includes(r.style as TornEdgeStyle) ? (r.style as TornEdgeStyle) : base.style
  const color = typeof r.lipColor === 'string' && HEX.test(r.lipColor) ? r.lipColor : base.lipColor
  return {
    style,
    amount: num(r.amount, ...CLAMP.amount!, base.amount),
    roughness: num(r.roughness, ...CLAMP.roughness!, base.roughness),
    grain: num(r.grain, ...CLAMP.grain!, base.grain),
    grainTexture: num(r.grainTexture, ...CLAMP.grainTexture!, base.grainTexture),
    lipWidth: num(r.lipWidth, ...CLAMP.lipWidth!, base.lipWidth),
    lipVariation: num(r.lipVariation, ...CLAMP.lipVariation!, base.lipVariation),
    lipColor: color,
    seed: num(r.seed, ...CLAMP.seed!, base.seed),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/torn-edge.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/tornEdge.ts frontend/tests/unit/torn-edge.unit.spec.ts
git commit -m "feat(compositor): torn-edge spec types, defaults, sanitizer"
```

---

### Task 2: Torn-edge render algorithm — noise, distance transform, per-pixel pass

**Files:**
- Modify: `frontend/app/lib/compositor/tornEdge.ts`
- Test: `frontend/tests/unit/torn-edge.unit.spec.ts` (add cases)

**Interfaces:**
- Consumes: `TornEdgeSpec`, `tornEdgeActive` (Task 1).
- Produces:
  - `function applyTornEdgeToData(data: Uint8ClampedArray, W: number, H: number, spec: TornEdgeSpec, scale: number): void` — mutates RGBA `data` in place.
  - `function applyTornEdge(canvas: HTMLCanvasElement, spec: TornEdgeSpec, opts?: { scale?: number }): void` — reads/writes the canvas' ImageData via `applyTornEdgeToData`.

- [ ] **Step 1: Write the failing test**

```ts
// append to frontend/tests/unit/torn-edge.unit.spec.ts
import { applyTornEdgeToData, DEFAULT_TORN_EDGE as D } from '~/lib/compositor/tornEdge'

/** Build a WxH RGBA buffer with an opaque red square inset by `pad`. */
function squareBuffer(W: number, H: number, pad: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const solid = x >= pad && x < W - pad && y >= pad && y < H - pad
    if (solid) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 40; data[i + 3] = 255 }
  }
  return data
}
const alphaAt = (d: Uint8ClampedArray, W: number, x: number, y: number) => d[(y * W + x) * 4 + 3]

describe('applyTornEdgeToData', () => {
  const W = 80, H = 80, PAD = 10
  const spec = { ...D, amount: 8, grain: 4, lipWidth: 4, lipVariation: 0.6 }

  it('leaves the deep interior fully opaque but erases some edge pixels', () => {
    const d = squareBuffer(W, H, PAD)
    applyTornEdgeToData(d, W, H, spec, 1)
    expect(alphaAt(d, W, 40, 40)).toBe(255)              // centre untouched
    // count transparent pixels in the top edge row band that were solid before
    let erased = 0
    for (let x = PAD; x < W - PAD; x++) for (let y = PAD; y < PAD + 12; y++) {
      if (alphaAt(d, W, x, y) === 0) erased++
    }
    expect(erased).toBeGreaterThan(0)                    // the edge actually tore
  })

  it('is deterministic for a fixed seed and changes with the seed', () => {
    const a = squareBuffer(W, H, PAD); applyTornEdgeToData(a, W, H, spec, 1)
    const b = squareBuffer(W, H, PAD); applyTornEdgeToData(b, W, H, spec, 1)
    expect(Array.from(a)).toEqual(Array.from(b))         // same seed → identical
    const c = squareBuffer(W, H, PAD); applyTornEdgeToData(c, W, H, { ...spec, seed: 99 }, 1)
    expect(Array.from(c)).not.toEqual(Array.from(a))     // different seed → different
  })

  it('paints lip pixels in the lip colour near the torn edge', () => {
    const d = squareBuffer(W, H, PAD)
    applyTornEdgeToData(d, W, H, { ...spec, lipColor: '#00ff00', lipWidth: 6, grain: 0 }, 1)
    let greenish = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255 && d[i + 1] > 180 && d[i]! < 80 && d[i + 2]! < 80) greenish++
    }
    expect(greenish).toBeGreaterThan(0)                  // a green lip band appeared
  })

  it('does nothing to a fully transparent buffer', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    applyTornEdgeToData(d, W, H, spec, 1)
    expect(d.every(v => v === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/torn-edge.unit.spec.ts`
Expected: FAIL — `applyTornEdgeToData` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/app/lib/compositor/tornEdge.ts`:

```ts
// ── Seeded noise ─────────────────────────────────────────────────────────────
function makeNoise(seed: number) {
  const h2 = (ix: number, iy: number) => {
    const x = Math.sin(ix * 127.1 + iy * 311.7 + seed * 13.7) * 43758.5453
    return x - Math.floor(x)
  }
  const value2 = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
    const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1)
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  const fbm2 = (x: number, y: number, oct: number, pers: number) => {
    let amp = 1, sum = 0, norm = 0, f = 1
    for (let o = 0; o < oct; o++) { sum += value2(x * f + o * 17.3, y * f + o * 17.3) * amp; norm += amp; f *= 2; amp *= pers }
    return sum / norm
  }
  const fineHash = (x: number, y: number) => {
    const v = Math.sin(x * 12.98 + y * 78.23 + seed * 3.7) * 43758.5453
    return v - Math.floor(v)
  }
  return { value2, fbm2, fineHash }
}

/** Approx Euclidean distance (chamfer 1 / √2) from each inside pixel to the
 *  nearest background pixel, computed only within [x0..x1]×[y0..y1]. */
function distanceInside(
  inside: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number,
): Float32Array {
  const INF = 1e9, a = 1, b = Math.SQRT2
  const d = new Float32Array(W * (y1 + 1))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; d[i] = inside[i] ? INF : 0 }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x; if (d[i] === 0) continue
    let m = d[i]
    if (x > x0) m = Math.min(m, d[i - 1] + a)
    if (y > y0) m = Math.min(m, d[i - W] + a)
    if (x > x0 && y > y0) m = Math.min(m, d[i - W - 1] + b)
    if (x < x1 && y > y0) m = Math.min(m, d[i - W + 1] + b)
    d[i] = m
  }
  for (let y = y1; y >= y0; y--) for (let x = x1; x >= x0; x--) {
    const i = y * W + x; if (d[i] === 0) continue
    let m = d[i]
    if (x < x1) m = Math.min(m, d[i + 1] + a)
    if (y < y1) m = Math.min(m, d[i + W] + a)
    if (x < x1 && y < y1) m = Math.min(m, d[i + W + 1] + b)
    if (x > x0 && y < y1) m = Math.min(m, d[i + W - 1] + b)
    d[i] = m
  }
  return d
}

function parseHexRGB(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Carve the ragged edge + paint the lip directly on an RGBA buffer. Mutates `data`.
 *  `scale` = device px per logical px; keeps feature sizes physically stable on retina. */
export function applyTornEdgeToData(
  data: Uint8ClampedArray, W: number, H: number, spec: TornEdgeSpec, scale: number,
): void {
  const s = scale > 0 ? scale : 1
  // 1. binary alpha mask + bounding box of opaque content
  const inside = new Uint8Array(W * H)
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3]! > 8) {
      inside[y * W + x] = 1
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
    }
  }
  if (maxx < 0) return   // fully transparent — nothing to tear

  const amountDev = Math.max(0, spec.amount * s)
  const grainDev = Math.max(0, spec.grain * s)
  const lipDev = Math.max(0, spec.lipWidth * s)
  const lipVar = Math.max(0, Math.min(1, spec.lipVariation))
  const rough = Math.max(0, Math.min(1, spec.roughness))
  const tex = Math.max(0, Math.min(1, spec.grainTexture))
  const maxLipDev = lipDev * (1 + lipVar * 1.4)
  const band = amountDev + maxLipDev + grainDev + 2

  const x0 = Math.max(0, Math.floor(minx - band)), y0 = Math.max(0, Math.floor(miny - band))
  const x1 = Math.min(W - 1, Math.ceil(maxx + band)), y1 = Math.min(H - 1, Math.ceil(maxy + band))
  const dist = distanceInside(inside, W, x0, y0, x1, y1)

  const { value2, fbm2, fineHash } = makeNoise(spec.seed)
  const fBase = spec.style === 'deckle' ? 0.03 : spec.style === 'ripped' ? 0.018 : 0.02
  const f = fBase / s
  const fl = 0.016 / s
  const [lr, lg, lb] = parseHexRGB(spec.lipColor)

  const depthMul = (x: number, y: number): number => {
    if (spec.style === 'deckle') return 0.15 + 0.85 * fbm2(x * f, y * f, 3, 0.45)
    if (spec.style === 'ripped') {
      const warp = fbm2(x * f * 0.45 + 3.1, y * f * 0.45 + 3.1, 3, 0.5) * 1.4 * (0.4 + rough)
      return 0.15 + 0.85 * fbm2(x * f + warp, y * f + warp, 5, 0.4 + 0.35 * rough)
    }
    const b2 = fbm2(x * f, y * f, 6, 0.55 + 0.4 * rough)
    const sp = Math.pow(fbm2(x * f * 1.7 + 9, y * f * 1.7 + 9, 4, 0.6), 2.2)
    return Math.max(0, 0.15 + 0.7 * b2 + 0.9 * sp * rough)
  }
  const lipMul = (x: number, y: number): number => {
    const env = fbm2(x * fl + 41, y * fl + 41, 3, 0.55)
    return Math.max(0, 1 + lipVar * 1.4 * ((env - 0.5) * 2))
  }
  const grainField = (x: number, y: number): number => {
    const clump = value2(x * 0.35 / s, y * 0.35 / s)
    const fine = 0.5 * value2(x * 0.9 / s, y * 0.9 / s) + 0.5 * fineHash(x, y)
    return clump * 0.55 + fine * 0.45
  }
  const paperTex = (x: number, y: number): number =>
    0.6 * value2(x * 0.12 / s + 7, y * 0.12 / s + 7)
    + 0.25 * value2(x * 0.5 / s + 3, y * 0.5 / s + 3)
    + 0.15 * fineHash(x + 11, y + 11)

  const bw = grainDev > 0 ? grainDev : 0.0001

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x
    if (!inside[i]) continue
    const dEdge = dist[i]!
    if (dEdge >= band) continue           // deep interior — untouched (boundary-band bound)
    const sT = dEdge - amountDev * depthMul(x, y)
    const g = grainField(x, y)
    const paper = sT <= 0 ? 0 : (sT >= bw ? 1 : (g < sT / bw ? 1 : 0))
    const o = i * 4
    if (!paper) { data[o + 3] = 0; continue }
    const sC = sT - lipDev * lipMul(x, y)
    const content = sC <= 0 ? 0 : (sC >= bw ? 1 : (g < sC / bw ? 1 : 0))
    if (!content) {                       // lip band — paper colour + fibre texture
      const lf = 1 + (paperTex(x, y) - 0.5) * 0.55 * tex
      data[o] = Math.max(0, Math.min(255, lr * lf))
      data[o + 1] = Math.max(0, Math.min(255, lg * lf))
      data[o + 2] = Math.max(0, Math.min(255, lb * lf))
      data[o + 3] = 255
    }
    // content pixel: left exactly as drawn (no texture)
  }
}

/** Canvas wrapper — reads the device pixels, tears them, writes them back. */
export function applyTornEdge(
  canvas: HTMLCanvasElement, spec: TornEdgeSpec, opts: { scale?: number } = {},
): void {
  const W = canvas.width, H = canvas.height
  if (!W || !H) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, W, H)
  applyTornEdgeToData(img.data, W, H, spec, opts.scale ?? 1)
  ctx.putImageData(img, 0, 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/torn-edge.unit.spec.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/tornEdge.ts frontend/tests/unit/torn-edge.unit.spec.ts
git commit -m "feat(compositor): torn-edge render algorithm (noise + distance transform)"
```

---

### Task 3: Wire `tornEdge` into the layer model and render path

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (LayerCommon `:148-183`; imports near top; `paintLayer` `:1012`, `:1021-1025`, `:1133`, `:1161-1176`)

**Interfaces:**
- Consumes: `applyTornEdge`, `tornEdgeActive`, `TornEdgeSpec` from `~/lib/compositor/tornEdge`.
- Produces: `LayerCommon.tornEdge?: TornEdgeSpec` — read by the render, written by Tasks 4 & 5.

- [ ] **Step 1: Add the import**

Add near the other `~/lib/compositor/*` imports at the top of `useCompositorLayers.ts`:

```ts
import { applyTornEdge, tornEdgeActive } from '~/lib/compositor/tornEdge'
```

- [ ] **Step 2: Add the field to `LayerCommon`**

In the `LayerCommon` interface (after the `animation?` field at `:182`), add:

```ts
  /** Torn-paper edge: raggedizes this layer's alpha boundary + optional white
   *  lip. Absent/inactive ⇒ a clean edge. See lib/compositor/tornEdge. */
  tornEdge?: import('~/lib/compositor/tornEdge').TornEdgeSpec
```

- [ ] **Step 3: Read it in `paintLayer` and add it to the effect condition**

In `paintLayer`, alongside the other effect lookups (after `:1025` `const chain = ...`):

```ts
  const tornEdge = tornEdgeActive(layer.tornEdge) ? layer.tornEdge : undefined
```

Change the effected-path guard at `:1133` from:

```ts
    if (shadow || blur || inner || chain.length) {
```

to:

```ts
    if (shadow || blur || inner || chain.length || tornEdge) {
```

- [ ] **Step 4: Apply the tear on the offscreen before the stamp**

In the effected block, after the chain line at `:1161` (`if (chain.length) applyEffectChain(off, chain, { W, scale: s })`) and before `ctx.save()` at `:1162`, add:

```ts
        // Torn edge carves the offscreen's alpha + paints the lip, in device px,
        // so preview and export tear identically. Runs after content + 2D effects
        // so grain/adjust sit inside the tear, and before the stamp so drop-shadow
        // and blur (applied below) follow the torn silhouette.
        if (tornEdge) applyTornEdge(off, tornEdge, { scale: s })
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i tornedge`
Expected: no output (no torn-edge type errors). A nonzero baseline of unrelated errors (~328) is expected; only new `tornEdge` errors matter.

- [ ] **Step 6: Manual render check**

Start the dev server and confirm a torn edge renders. In the browser console on a Compositor frame with at least one layer:

```js
// pick the first local layer of the selected frame and give it a torn edge
window.sailor?.setLocalLayerTornEdge?.(/* see note */)
```

If no console hook exists, verify instead via Task 5's UI once built. Minimum bar for this task: the app compiles and an existing frame still renders unchanged (no torn edge set ⇒ byte-identical output).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts
git commit -m "feat(compositor): render layer.tornEdge in the effected offscreen path"
```

---

### Task 4: Agent command `setLayerTornEdge`

**Files:**
- Modify: `frontend/app/lib/agent/surfaces/compositor.ts` (`COMPOSITOR_COMMANDS` `:96-112`; `applyCompositorCommand` switch, add a case near `:301`; `describeCompositor` `:119-130`)
- Test: `frontend/tests/unit/agent-torn-edge.unit.spec.ts`

**Interfaces:**
- Consumes: `sanitizeTornEdge`, `DEFAULT_TORN_EDGE`, `tornEdgeActive` from `~/lib/compositor/tornEdge`; `applyCompositorCommand`, `describeCompositor` (existing).
- Produces: a `setLayerTornEdge` op writing `layer.tornEdge`; `remove:true` clears it.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/agent-torn-edge.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyCompositorCommand, describeCompositor } from '~/lib/agent/surfaces/compositor'
import type { CompositorState } from '~/lib/agent/surfaces/compositor'

const baseState = (): CompositorState => ({
  layers: [{ id: 'a', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.4, h: 0.3, fill: '#fff', stroke: '', strokeWidth: 0, radius: 0 } as any],
})

describe('setLayerTornEdge', () => {
  it('sets a torn edge with clamped params and defaults', () => {
    const r = applyCompositorCommand(baseState(), {
      op: 'setLayerTornEdge', target: 'a', args: { patch: { style: 'ripped', amount: 9999, lipWidth: 12 } },
    })
    expect(r.ok).toBe(true)
    const layer = (r as any).template.layers[0]
    expect(layer.tornEdge.style).toBe('ripped')
    expect(layer.tornEdge.amount).toBeLessThanOrEqual(200)
    expect(layer.tornEdge.lipWidth).toBe(12)
  })

  it('merges a partial patch over an existing torn edge', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerTornEdge', target: 'a', args: { patch: { amount: 20 } } }) as any).template
    const s2 = (applyCompositorCommand(s1, { op: 'setLayerTornEdge', target: 'a', args: { patch: { grain: 5 } } }) as any).template
    expect(s2.layers[0].tornEdge.amount).toBe(20)
    expect(s2.layers[0].tornEdge.grain).toBe(5)
  })

  it('remove:true clears the torn edge', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerTornEdge', target: 'a', args: { patch: { amount: 20 } } }) as any).template
    const s2 = (applyCompositorCommand(s1, { op: 'setLayerTornEdge', target: 'a', args: { remove: true } }) as any).template
    expect(s2.layers[0].tornEdge).toBeUndefined()
  })

  it('errors on an unknown layer', () => {
    const r = applyCompositorCommand(baseState(), { op: 'setLayerTornEdge', target: 'nope', args: { patch: {} } })
    expect(r.ok).toBe(false)
  })

  it('describeCompositor reports an active torn edge', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerTornEdge', target: 'a', args: { patch: { amount: 20 } } }) as any).template
    const snap = describeCompositor(s1)
    expect(JSON.stringify(snap)).toContain('tornEdge')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/agent-torn-edge.unit.spec.ts`
Expected: FAIL — `setLayerTornEdge` is unhandled (result `ok:false` "unknown op" or similar) and `describe` lacks `tornEdge`.

- [ ] **Step 3: Implement — add the import, command spec, case, and describe field**

Add to the imports at the top of `compositor.ts`:

```ts
import { sanitizeTornEdge, tornEdgeActive } from '~/lib/compositor/tornEdge'
```

Add to `COMPOSITOR_COMMANDS` (after the `setPostEffect` entry at `:111`):

```ts
  { op: 'setLayerTornEdge', hint: 'Give a layer a TORN-PAPER edge (ragged, grain-dissolved boundary with an optional white "lip"). target = layer id; args: { patch: {...}, remove? }. patch keys: style ("ripped"=organic meandering tear | "deckle"=soft handmade-paper edge | "shredded"=aggressive spiky rip), amount (tear depth in px, ~10 subtle … 60 deep), roughness (0..1 fray detail), grain (px, edge crumble/dissolve; 0 = crisp), grainTexture (0..1 paper-fibre texture on the lip only), lipWidth (px white underside band; 0 = no lip), lipVariation (0..1 how uneven the lip width is), lipColor ("#RRGGBB", warm white default), seed (integer; change it for a different random tear). Omitted keys keep their current value. remove:true removes the torn edge. This is what "torn paper edge", "ripped edges", "rough deckle border" mean.' },
```

Add a case in `applyCompositorCommand` (after the `setLayerEffect` case ends at `:301`):

```ts
    case 'setLayerTornEdge': {
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      if (cmd.args?.remove === true) { delete (layer as Record<string, unknown>).tornEdge; return { ok: true, template: state, inverse: snapshot() } }
      const patch = (cmd.args?.patch ?? {}) as Record<string, unknown>
      ;(layer as Record<string, unknown>).tornEdge = sanitizeTornEdge(patch, layer.tornEdge)
      return { ok: true, template: state, inverse: snapshot() }
    }
```

In `describeCompositor`, add after the effects line at `:126` (`if (l.effects?.length) ...`):

```ts
    if (tornEdgeActive(l.tornEdge)) cur.tornEdge = `${l.tornEdge.style} (amount ${l.tornEdge.amount}, lip ${l.tornEdge.lipWidth})`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/agent-torn-edge.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/agent/surfaces/compositor.ts frontend/tests/unit/agent-torn-edge.unit.spec.ts
git commit -m "feat(agent): setLayerTornEdge command for the Compositor surface"
```

---

### Task 5: Layer inspector UI — torn-edge panel

**Files:**
- Create: `frontend/app/components/vue-canvas/compositor/CompositorTornEdgePanel.vue`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (import + register the sub-panel near the other `compositor/*` imports; mount it in the Design inspector beside the blur/shadow/mask blocks; add helper `setLocal`-based handlers mirroring `setLayerBlur`/`setInnerShadow` around `:2158-2198`)

**Interfaces:**
- Consumes: `DEFAULT_TORN_EDGE`, `TornEdgeSpec`, `TORN_EDGE_STYLES` from `~/lib/compositor/tornEdge`; the modal's `setLocal(id, patch)`.
- Produces: user edits write `layer.tornEdge` (rendered by Task 3, same field the agent writes in Task 4).

- [ ] **Step 1: Create the panel component**

```vue
<!-- frontend/app/components/vue-canvas/compositor/CompositorTornEdgePanel.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_TORN_EDGE, TORN_EDGE_STYLES, type TornEdgeSpec } from '~/lib/compositor/tornEdge'

const props = defineProps<{ value?: TornEdgeSpec }>()
const emit = defineEmits<{
  (e: 'update', patch: Partial<TornEdgeSpec>): void
  (e: 'toggle', on: boolean): void
}>()

const on = computed(() => !!props.value)
const v = computed<TornEdgeSpec>(() => props.value ?? DEFAULT_TORN_EDGE)
const set = (patch: Partial<TornEdgeSpec>) => emit('update', patch)
const reseed = () => emit('update', { seed: Math.floor(Math.abs(Math.sin(v.value.seed + 1) * 99999)) + 1 })
</script>

<template>
  <div class="space-y-2">
    <label class="flex items-center justify-between text-xs">
      <span>Torn edge</span>
      <input type="checkbox" :checked="on" @change="emit('toggle', ($event.target as HTMLInputElement).checked)">
    </label>

    <template v-if="on">
      <label class="block text-xs">Edge style
        <select class="w-full" :value="v.style" @change="set({ style: ($event.target as HTMLSelectElement).value as TornEdgeSpec['style'] })">
          <option v-for="st in TORN_EDGE_STYLES" :key="st" :value="st">{{ st }}</option>
        </select>
      </label>

      <label class="block text-xs">Tear depth
        <input type="range" min="0" max="70" step="1" :value="v.amount" @input="set({ amount: +($event.target as HTMLInputElement).value })">
      </label>
      <label class="block text-xs">Roughness
        <input type="range" min="0" max="100" step="1" :value="Math.round(v.roughness * 100)" @input="set({ roughness: +($event.target as HTMLInputElement).value / 100 })">
      </label>
      <label class="block text-xs">Grain
        <input type="range" min="0" max="18" step="1" :value="v.grain" @input="set({ grain: +($event.target as HTMLInputElement).value })">
      </label>
      <label class="block text-xs">Grain texture
        <input type="range" min="0" max="100" step="1" :value="Math.round(v.grainTexture * 100)" @input="set({ grainTexture: +($event.target as HTMLInputElement).value / 100 })">
      </label>
      <label class="block text-xs">Lip width
        <input type="range" min="0" max="20" step="1" :value="v.lipWidth" @input="set({ lipWidth: +($event.target as HTMLInputElement).value })">
      </label>
      <label class="block text-xs">Lip width var
        <input type="range" min="0" max="100" step="1" :value="Math.round(v.lipVariation * 100)" @input="set({ lipVariation: +($event.target as HTMLInputElement).value / 100 })">
      </label>
      <label class="flex items-center justify-between text-xs">Lip color
        <input type="color" :value="v.lipColor" @input="set({ lipColor: ($event.target as HTMLInputElement).value })">
      </label>

      <button type="button" class="text-xs underline" @click="reseed">New tear</button>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Register + mount in `CompositorModal.vue`**

Add to the `compositor/*` imports (near `CompositorClonerPanel` / `MotionLayerEditor` at `:53-58`):

```ts
import CompositorTornEdgePanel from '~/components/vue-canvas/compositor/CompositorTornEdgePanel.vue'
```

Add the helper handlers in the `<script setup>` near the other layer-effect helpers (after `toggleBgBlur` at `:2198`):

```ts
// ── Torn paper edge ─────────────────────────────────────────────────────────
import { DEFAULT_TORN_EDGE } from '~/lib/compositor/tornEdge'
function setTornEdge(l: any, patch: Record<string, any>) {
  if (!l) return
  const cur = l.tornEdge || { ...DEFAULT_TORN_EDGE }
  setLocal(l.id, { tornEdge: { ...cur, ...patch } })
}
function toggleTornEdge(l: any, on: boolean) {
  if (!l) return
  setLocal(l.id, { tornEdge: on ? { ...DEFAULT_TORN_EDGE } : undefined })
}
```

(If `CompositorModal.vue` disallows mid-file `import`, hoist the `DEFAULT_TORN_EDGE` import to the top import block instead.)

Mount the panel in the Design inspector where per-layer effect controls render (beside the blur/mask blocks). Use the currently-selected layer variable the neighbouring blocks use (the same `l` passed to `setLayerBlur(l, …)`):

```vue
<CompositorTornEdgePanel
  :value="l.tornEdge"
  @update="patch => setTornEdge(l, patch)"
  @toggle="on => toggleTornEdge(l, on)"
/>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE 'tornedge|TornEdge'`
Expected: no torn-edge-related errors.

- [ ] **Step 4: Manual verification (dev server + browser)**

Start the dev server (`cd frontend && npm run dev`, on `127.0.0.1`), open a Compositor frame with an image or shape layer, select the layer, enable "Torn edge", and confirm:
- Toggling on shows a ragged, grain-dissolved edge with a white lip.
- Each slider changes the render live (verify with a **broken control**: drag "Tear depth" — the tear must deepen; drag "Lip width" — the white band must widen).
- "New tear" reshuffles the pattern.
- Download/export the frame and confirm the exported PNG shows the **same** torn edge as the preview (render parity).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/CompositorTornEdgePanel.vue frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): torn-edge control panel in the layer inspector"
```

---

## Self-Review

**Spec coverage:**
- Data model (`TornEdgeSpec` on `LayerCommon`) → Tasks 1, 3. ✓
- Per-pixel raster on device offscreen, boundary-band bound, seeded → Task 2 (`applyTornEdgeToData`, `dEdge >= band` skip, `makeNoise(seed)`). ✓
- Style presets (ripped/deckle/shredded), grain dissolve, variable lip, lip-only texture → Task 2. ✓
- Render parity via `paintLayer` → Task 3. ✓
- Agent `setLayerTornEdge` + describe + clamps → Task 4. ✓
- UI panel (9 controls) → Task 5. ✓
- Performance (band bound + bbox) → built into Task 2; deeper caching left as a noted follow-up if benchmarks demand (interior skip already bounds cost to a ring).
- Arbitrary-alpha boundary (spec open question, option a) → Task 2 distance transform over the layer's actual alpha. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `TornEdgeSpec`, `DEFAULT_TORN_EDGE`, `tornEdgeActive`, `sanitizeTornEdge`, `applyTornEdge`/`applyTornEdgeToData` names are used identically across Tasks 1–5. Field names match the spec throughout.

**Note for the implementer:** Task 5's exact JSX mount point depends on the modal's current Design-inspector markup; place the panel next to the existing blur/shadow/mask controls and pass the same selected-layer object those blocks use. If `vitest` cannot resolve the `~` alias in the new test files, mirror the alias config already used by `frontend/tests/unit/action-catalog.unit.spec.ts`.
