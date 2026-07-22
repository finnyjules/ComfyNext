# Compositor Post-Processing Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-layer post-processing effects (adjust / bloom / grain / vignette / duotone) plus a doc-level post stack applied to the whole composite, rendered by the compositor's shared Canvas-2D painter so every surface (modal, frame node, bakes, agent) stays in parity.

**Architecture:** New pure-kernel module `frontend/app/lib/compositor/postEffects.ts` owns the five effect types, their defaults/clamps, and an `applyEffectChain(offscreenCanvas, effects, opts)` that mutates an offscreen in the fixed order adjust → duotone → bloom → vignette → grain. `paintLayer` (per-layer) and a new trailing `post` param on `paintLayerStack` (doc-level) both call it — one code path for both scopes. Doc-level state persists as `sailor_localFx` on the node's properties, alongside `sailor_localBg`.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), Canvas 2D (`ctx.filter` already a hard dependency via `layer_blur`), Vitest (node env, stubbed canvas), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-22-compositor-post-effects-design.md`

## Global Constraints

- **Parallel sessions are active in this repo.** Stage ONLY the files each task lists (`git add <explicit paths>`); NEVER `git add -A`/`-u`, never `git stash`. Commit directly to `main`.
- **Typecheck baseline is ~328 pre-existing errors** (`cd frontend && npx nuxt typecheck`). Do not chase pre-existing errors; only ensure your changes add none. The faster compile check: with the dev server running, `curl -s "http://127.0.0.1:3000/" > /dev/null` and watch the Vite terminal/preview logs for compile errors.
- All frontend commands run from `frontend/`. Unit tests: `npx vitest run <file>`.
- Dev server must be reached at `127.0.0.1`, not `localhost` (IPv6 listener gotcha).
- Effect spatial params are **normalized to canvas width** and multiplied by `W` at draw time, matching existing effects.
- No Python/server changes — all bakes are client-side.
- The fixed chain order is **adjust → duotone → bloom → vignette → grain** and lives in exactly one place (`applyEffectChain`).

---

### Task 1: Pure kernels + effect types (`postEffects.ts`)

**Files:**
- Create: `frontend/app/lib/compositor/postEffects.ts`
- Test: `frontend/tests/unit/post-effects.unit.spec.ts`

**Interfaces:**
- Produces (used by Tasks 2–6):
  - Types `AdjustEffect`, `BloomEffect`, `GrainEffect`, `VignetteEffect`, `DuotoneEffect`, `PostEffect` (union of the five)
  - `POST_EFFECT_DEFAULTS: Record<PostEffect['type'], PostEffect>`, `defaultPostEffect(type): PostEffect`
  - `POST_FX_PARAM_CLAMP: Record<string, Record<string, [number, number]>>`
  - `isChainEffect(e: { type: string }): boolean`, `chainActive(effects?: { type: string; visible?: boolean }[]): boolean`
  - Pure kernels: `adjustFilterString(fx)`, `noiseBytes(seed, count)`, `brightPassInPlace(data, threshold)`, `duotoneInPlace(data, shadows, highlights, mix)`, `vignetteStops(size, softness)`, `hexToRgb(hex)`
  - (Task 2 adds `applyEffectChain` / `applyStackPost` / `grainTile` to this same file)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/post-effects.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  adjustFilterString, noiseBytes, brightPassInPlace, duotoneInPlace,
  vignetteStops, hexToRgb, chainActive, isChainEffect, defaultPostEffect,
  POST_EFFECT_DEFAULTS, type AdjustEffect,
} from '~/lib/compositor/postEffects'

const adjust = (p: Partial<AdjustEffect>): AdjustEffect =>
  ({ type: 'adjust', brightness: 1, contrast: 1, saturation: 1, hue: 0, visible: true, ...p })

describe('adjustFilterString', () => {
  it('is empty at neutral values (no wasted filter pass)', () => {
    expect(adjustFilterString(adjust({}))).toBe('')
  })
  it('emits only non-neutral functions, clamped', () => {
    expect(adjustFilterString(adjust({ brightness: 1.5 }))).toBe('brightness(1.5)')
    expect(adjustFilterString(adjust({ brightness: 9, hue: -400 })))
      .toBe('brightness(2) hue-rotate(-180deg)')
    expect(adjustFilterString(adjust({ contrast: 0.5, saturation: 0, hue: 90 })))
      .toBe('contrast(0.5) saturate(0) hue-rotate(90deg)')
  })
})

describe('noiseBytes', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = noiseBytes(1234, 64), b = noiseBytes(1234, 64), c = noiseBytes(99, 64)
    expect([...a]).toEqual([...b])
    expect([...a]).not.toEqual([...c])
    expect(a.length).toBe(64)
  })
})

describe('brightPassInPlace', () => {
  it('zeroes alpha below the luminance threshold, keeps it above', () => {
    // px0 = dark gray (lum ~64), px1 = near-white (lum ~230)
    const d = new Uint8ClampedArray([64, 64, 64, 255, 230, 230, 230, 255])
    brightPassInPlace(d, 0.5)
    expect(d[3]).toBe(0)
    expect(d[7]).toBe(255)
  })
})

describe('duotoneInPlace', () => {
  const S = { r: 26, g: 26, b: 64 }, H = { r: 255, g: 232, b: 214 }
  it('maps luminance 0 → shadows and 1 → highlights at mix 1', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    duotoneInPlace(d, S, H, 1)
    expect([d[0], d[1], d[2]]).toEqual([S.r, S.g, S.b])
    expect([d[4], d[5], d[6]]).toEqual([H.r, H.g, H.b])
  })
  it('leaves pixels untouched at mix 0 and never touches alpha', () => {
    const d = new Uint8ClampedArray([10, 200, 30, 128])
    duotoneInPlace(d, S, H, 0)
    expect([...d]).toEqual([10, 200, 30, 128])
  })
})

describe('vignetteStops', () => {
  it('returns inner < outer with both clamped sane', () => {
    const { inner, outer } = vignetteStops(0.5, 0.5)
    expect(inner).toBeGreaterThanOrEqual(0)
    expect(outer).toBeGreaterThan(inner)
    const z = vignetteStops(0, 0) // softness 0 must not collapse the ramp
    expect(z.outer).toBeGreaterThan(z.inner)
  })
})

describe('hexToRgb', () => {
  it('parses #RGB, #RRGGBB and strips alpha from #RRGGBBAA', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#1a1a40')).toEqual({ r: 26, g: 26, b: 64 })
    expect(hexToRgb('#1a1a40cc')).toEqual({ r: 26, g: 26, b: 64 })
  })
})

describe('chain membership', () => {
  it('recognises exactly the five post types', () => {
    for (const t of ['adjust', 'bloom', 'grain', 'vignette', 'duotone']) expect(isChainEffect({ type: t })).toBe(true)
    for (const t of ['drop_shadow', 'layer_blur', 'inner_shadow', 'background_blur']) expect(isChainEffect({ type: t })).toBe(false)
  })
  it('chainActive requires a visible chain effect', () => {
    expect(chainActive(undefined)).toBe(false)
    expect(chainActive([{ type: 'drop_shadow', visible: true }])).toBe(false)
    expect(chainActive([{ type: 'bloom', visible: false }])).toBe(false)
    expect(chainActive([{ type: 'bloom', visible: true }])).toBe(true)
  })
})

describe('defaults', () => {
  it('every type has a default whose type matches its key, visible: true', () => {
    for (const [k, v] of Object.entries(POST_EFFECT_DEFAULTS)) {
      expect(v.type).toBe(k)
      expect(v.visible).toBe(true)
    }
  })
  it('defaultPostEffect returns a fresh clone', () => {
    const a = defaultPostEffect('adjust')
    ;(a as any).brightness = 99
    expect((POST_EFFECT_DEFAULTS.adjust as any).brightness).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/post-effects.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/postEffects`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/compositor/postEffects.ts
/**
 * Post-processing effects for the Compositor — pure kernels + the canvas
 * effect chain shared by per-layer rendering (paintLayer) and the doc-level
 * post stack (paintLayerStack). Spatial params are normalized to canvas
 * width; `opts.W` is the logical width, `opts.scale` device px per logical px.
 *
 * Fixed chain order (applyEffectChain is the single source of truth):
 *   adjust → duotone → bloom → vignette → grain
 */

export interface AdjustEffect {
  type: 'adjust'
  brightness: number  // 1 = neutral, CSS brightness() multiplier, 0..2
  contrast: number    // 1 = neutral, 0..2
  saturation: number  // 1 = neutral, 0..2
  hue: number         // degrees, -180..180, 0 = neutral
  visible: boolean
}
export interface BloomEffect {
  type: 'bloom'
  threshold: number   // 0..1 — luminance cutoff for the bright pass
  radius: number      // blur radius, normalized to canvas width
  intensity: number   // 0..2 — strength of the additive composite
  visible: boolean
}
export interface GrainEffect {
  type: 'grain'
  amount: number      // 0..1 — composite alpha
  size: number        // 1..8 — noise texel scale
  visible: boolean
}
export interface VignetteEffect {
  type: 'vignette'
  amount: number      // 0..1 — darkening strength
  size: number        // 0..1 — inner radius where falloff starts
  softness: number    // 0..1 — falloff width
  visible: boolean
}
export interface DuotoneEffect {
  type: 'duotone'
  shadows: string     // hex colour mapped to luminance 0
  highlights: string  // hex colour mapped to luminance 1
  mix: number         // 0..1 — blend between original and duotone result
  visible: boolean
}
export type PostEffect = AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect

export const POST_EFFECT_DEFAULTS: Record<PostEffect['type'], PostEffect> = {
  adjust: { type: 'adjust', brightness: 1, contrast: 1, saturation: 1, hue: 0, visible: true },
  bloom: { type: 'bloom', threshold: 0.6, radius: 0.02, intensity: 0.8, visible: true },
  grain: { type: 'grain', amount: 0.25, size: 2, visible: true },
  vignette: { type: 'vignette', amount: 0.5, size: 0.5, softness: 0.5, visible: true },
  duotone: { type: 'duotone', shadows: '#1a1a40', highlights: '#ffe8d6', mix: 1, visible: true },
}
export function defaultPostEffect(type: PostEffect['type']): PostEffect {
  return JSON.parse(JSON.stringify(POST_EFFECT_DEFAULTS[type])) as PostEffect
}

/** Shared param bounds — the panel sliders and the agent's sanitizer both obey these. */
export const POST_FX_PARAM_CLAMP: Record<string, Record<string, [number, number]>> = {
  adjust: { brightness: [0, 2], contrast: [0, 2], saturation: [0, 2], hue: [-180, 180] },
  bloom: { threshold: [0, 1], radius: [0, 0.5], intensity: [0, 2] },
  grain: { amount: [0, 1], size: [1, 8] },
  vignette: { amount: [0, 1], size: [0, 1], softness: [0, 1] },
  duotone: { mix: [0, 1] },
}

const CHAIN_TYPES = new Set<string>(['adjust', 'duotone', 'bloom', 'vignette', 'grain'])
export const isChainEffect = (e: { type: string }): boolean => CHAIN_TYPES.has(e.type)
export const chainActive = (effects?: { type: string; visible?: boolean }[]): boolean =>
  !!effects?.some(e => e.visible !== false && CHAIN_TYPES.has(e.type))

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6) // 8-digit hex: strip alpha
  const n = parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** CSS filter string for an adjust effect — '' when every param is neutral. */
export function adjustFilterString(fx: AdjustEffect): string {
  const b = clamp(fx.brightness ?? 1, 0, 2)
  const c = clamp(fx.contrast ?? 1, 0, 2)
  const s = clamp(fx.saturation ?? 1, 0, 2)
  const h = clamp(fx.hue ?? 0, -180, 180)
  const parts: string[] = []
  if (b !== 1) parts.push(`brightness(${b})`)
  if (c !== 1) parts.push(`contrast(${c})`)
  if (s !== 1) parts.push(`saturate(${s})`)
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`)
  return parts.join(' ')
}

/** Deterministic PRNG bytes (mulberry32) — grain must render identically every
 *  frame/bake or motion sequences shimmer. */
export function noiseBytes(seed: number, count: number): Uint8Array {
  let a = seed >>> 0
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 255
  }
  return out
}

/** Bloom bright pass: zero the alpha of every pixel whose luminance is below
 *  threshold. Hard cutoff — the subsequent blur softens the knee. */
export function brightPassInPlace(data: Uint8ClampedArray, threshold: number): void {
  const t = clamp01(threshold) * 255
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    if (lum < t) data[i + 3] = 0
  }
}

/** Gradient-map RGB toward shadows→highlights by luminance; alpha untouched. */
export function duotoneInPlace(
  data: Uint8ClampedArray,
  shadows: { r: number; g: number; b: number },
  highlights: { r: number; g: number; b: number },
  mix: number,
): void {
  const m = clamp01(mix)
  if (m === 0) return
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    data[i] = data[i]! + (shadows.r + (highlights.r - shadows.r) * lum - data[i]!) * m
    data[i + 1] = data[i + 1]! + (shadows.g + (highlights.g - shadows.g) * lum - data[i + 1]!) * m
    data[i + 2] = data[i + 2]! + (shadows.b + (highlights.b - shadows.b) * lum - data[i + 2]!) * m
  }
}

/** Radial-gradient stops (fractions of the half-diagonal) for a vignette.
 *  softness 0 still keeps a minimal ramp so the edge never bands. */
export function vignetteStops(size: number, softness: number): { inner: number; outer: number } {
  const inner = clamp01(size)
  const outer = Math.min(1.5, inner + Math.max(0.02, clamp01(softness)))
  return { inner, outer }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/post-effects.unit.spec.ts`
Expected: PASS (all describes green)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/postEffects.ts frontend/tests/unit/post-effects.unit.spec.ts
git commit -m "feat(compositor): post-effect types + pure kernels (adjust/bloom/grain/vignette/duotone)"
```

---

### Task 2: `applyEffectChain` + painter integration

**Files:**
- Modify: `frontend/app/lib/compositor/postEffects.ts` (append chain applicator)
- Modify: `frontend/app/composables/useCompositorLayers.ts` (union + `paintLayer` + `paintLayerStack`)
- Test: `frontend/tests/unit/post-effects-paint.unit.spec.ts`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces:
  - `applyEffectChain(off: HTMLCanvasElement, effects: PostEffect[], opts: { W: number; scale?: number }): void`
  - `applyStackPost(ctx: CanvasRenderingContext2D, post: PostEffect[], W: number): void`
  - `grainTile(): HTMLCanvasElement`
  - `useCompositorLayers` re-exports the five types + `PostEffect`; `LayerEffect` union includes them
  - `paintLayerStack(ctx, W, H, items, localLayers, skip?, t?, motion?, wiredTreatments?, background?, groups?, post?)` — **new trailing `post?: PostEffect[]`** (12th param). Tasks 3/5/6 rely on this exact position.

- [ ] **Step 1: Write the failing test**

The unit env is `node` — no DOM. Stub `document.createElement('canvas')` the way `tests/unit/cross-source-mask.unit.spec.ts` does, extended with the 2D APIs the chain touches. The test asserts routing/structure (offscreen path taken, post pass stamps back), not pixels — pixels are covered by E2E in Task 6.

```ts
// frontend/tests/unit/post-effects-paint.unit.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { paintLayerStack, type StackItem, type LocalLayer } from '~/composables/useCompositorLayers'
import { applyEffectChain, defaultPostEffect, type PostEffect } from '~/lib/compositor/postEffects'

function stubCtx(tag = 'ctx') {
  const ctx: any = {
    _tag: tag,
    _filters: [] as string[],
    _ops: [] as string[],
    canvas: { width: 20, height: 20 },
    save: vi.fn(), restore: vi.fn(),
    drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    setTransform: vi.fn(), getTransform: () => ({ a: 1 }),
    translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), transform: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), clip: vi.fn(),
    roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => ({})),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) =>
      ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: vi.fn(),
    createImageData: vi.fn((w: number, h: number) =>
      ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    measureText: vi.fn(() => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })),
    fillText: vi.fn(), strokeText: vi.fn(),
    globalCompositeOperation: 'source-over', globalAlpha: 1,
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
  }
  // Record filter assignments so tests can assert which filters were applied.
  let _filter = 'none'
  Object.defineProperty(ctx, 'filter', {
    get: () => _filter,
    set: (v: string) => { _filter = v; ctx._filters.push(v) },
  })
  return ctx
}

function mkStubCanvas() {
  const c: any = { width: 0, height: 0 }
  const ctx = stubCtx('offscreen')
  ctx.canvas = c
  c.getContext = () => ctx
  return c
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'canvas' ? mkStubCanvas() : ({} as any)),
  })
})

const rect = (effects: any[]): LocalLayer => ({
  id: 'r1', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1,
  w: 0.4, h: 0.4, radius: 0, fill: '#ff0000', stroke: '', strokeWidth: 0,
  effects,
} as any)

describe('applyEffectChain', () => {
  it('applies an adjust filter via a self-copy pass', () => {
    const off = mkStubCanvas()
    off.width = 20; off.height = 20
    applyEffectChain(off, [{ ...defaultPostEffect('adjust'), brightness: 1.5 } as PostEffect], { W: 20 })
    const ctx = off.getContext()
    expect(ctx._filters.some((f: string) => f.includes('brightness(1.5)'))).toBe(true)
  })
  it('bloom composites additively (lighter)', () => {
    const off = mkStubCanvas()
    off.width = 20; off.height = 20
    const ctx = off.getContext()
    const ops: string[] = []
    Object.defineProperty(ctx, 'globalCompositeOperation', {
      get: () => 'source-over', set: (v: string) => { ops.push(v) },
    })
    applyEffectChain(off, [defaultPostEffect('bloom')], { W: 20 })
    expect(ops).toContain('lighter')
  })
  it('does nothing for an empty chain', () => {
    const off = mkStubCanvas()
    off.width = 20; off.height = 20
    applyEffectChain(off, [], { W: 20 })
    expect(off.getContext().drawImage).not.toHaveBeenCalled()
  })
})

describe('paintLayer routing', () => {
  it('routes a layer with only a chain effect through the offscreen path', () => {
    const main = stubCtx('main')
    const items: StackItem[] = [{ type: 'local', key: 'l:r1', layer: rect([{ ...defaultPostEffect('adjust'), brightness: 1.5 }]) }]
    paintLayerStack(main, 20, 20, items, [(items[0] as any).layer])
    // Effected path: the layer lands on main via drawImage of the offscreen,
    // not via direct fill on the main ctx.
    expect(main.drawImage).toHaveBeenCalled()
    expect(main.fill).not.toHaveBeenCalled()
  })
  it('fast path unchanged when no effects (no offscreen drawImage)', () => {
    const main = stubCtx('main')
    const items: StackItem[] = [{ type: 'local', key: 'l:r1', layer: rect([]) }]
    paintLayerStack(main, 20, 20, items, [(items[0] as any).layer])
    expect(main.fill).toHaveBeenCalled()
    expect(main.drawImage).not.toHaveBeenCalled()
  })
})

describe('paintLayerStack doc-level post', () => {
  it('with post effects: snapshots, processes, and stamps back onto the main ctx', () => {
    const main = stubCtx('main')
    paintLayerStack(main, 20, 20, [], [], undefined, undefined, undefined, undefined, undefined, undefined,
      [{ ...defaultPostEffect('adjust'), saturation: 1.4 } as PostEffect])
    expect(main.clearRect).toHaveBeenCalled()      // device canvas cleared before the stamp
    expect(main.drawImage).toHaveBeenCalledTimes(1) // processed snapshot stamped back
  })
  it('absent/empty post ⇒ byte-identical (no extra draw on the main ctx)', () => {
    const main = stubCtx('main')
    paintLayerStack(main, 20, 20, [], [])
    paintLayerStack(main, 20, 20, [], [], undefined, undefined, undefined, undefined, undefined, undefined, [])
    expect(main.drawImage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/post-effects-paint.unit.spec.ts`
Expected: FAIL — `applyEffectChain` not exported; post param ignored.

- [ ] **Step 3: Append the chain applicator to `postEffects.ts`**

```ts
// ── Canvas chain (appended to frontend/app/lib/compositor/postEffects.ts) ────

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = mkCanvas(src.width, src.height)
  c.getContext('2d')?.drawImage(src, 0, 0)
  return c
}

// Cached 128×128 mid-gray noise tile. Fixed seed: grain must be identical
// across renders/bakes (motion frames would shimmer otherwise).
let _grainTile: HTMLCanvasElement | null = null
export function grainTile(): HTMLCanvasElement {
  if (_grainTile) return _grainTile
  const N = 128
  const c = mkCanvas(N, N)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const bytes = noiseBytes(0x5a1108, N * N)
  for (let i = 0; i < N * N; i++) {
    const v = bytes[i]!
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  _grainTile = c
  return c
}

/**
 * Apply the visible chain effects to an offscreen canvas, in the fixed order
 * adjust → duotone → bloom → vignette → grain. Mutates `off` in place; every
 * op runs in identity transform space (the caller's ctx transform is preserved).
 * `opts.W` = logical canvas width (normalized params scale by it);
 * `opts.scale` = device px per logical px (default 1 — pass the ctx transform's
 * `.a` when `off` is a device-resolution snapshot).
 */
export function applyEffectChain(
  off: HTMLCanvasElement,
  effects: PostEffect[],
  opts: { W: number; scale?: number },
): void {
  const fx = effects.filter(e => e.visible)
  if (!fx.length) return
  const ctx = off.getContext('2d')
  if (!ctx) return
  const scale = opts.scale ?? 1
  const find = <T extends PostEffect>(t: T['type']) => fx.find((e): e is T => e.type === t)

  const adjust = find<AdjustEffect>('adjust')
  if (adjust) {
    const f = adjustFilterString(adjust)
    if (f) {
      const src = cloneCanvas(off)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, off.width, off.height)
      ctx.filter = f
      ctx.drawImage(src, 0, 0)
      ctx.restore()
    }
  }

  const duotone = find<DuotoneEffect>('duotone')
  if (duotone && duotone.mix > 0) {
    const img = ctx.getImageData(0, 0, off.width, off.height)
    duotoneInPlace(img.data, hexToRgb(duotone.shadows), hexToRgb(duotone.highlights), duotone.mix)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.putImageData(img, 0, 0)
    ctx.restore()
  }

  const bloom = find<BloomEffect>('bloom')
  if (bloom && bloom.intensity > 0 && bloom.radius > 0) {
    const bp = cloneCanvas(off)
    const bctx = bp.getContext('2d')
    if (bctx) {
      const img = bctx.getImageData(0, 0, bp.width, bp.height)
      brightPassInPlace(img.data, bloom.threshold)
      bctx.putImageData(img, 0, 0)
      const blurred = mkCanvas(off.width, off.height)
      const blctx = blurred.getContext('2d')
      if (blctx) {
        blctx.filter = `blur(${Math.max(0, bloom.radius * opts.W * scale)}px)`
        blctx.drawImage(bp, 0, 0)
        blctx.filter = 'none'
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'lighter'
        const k = Math.min(2, Math.max(0, bloom.intensity))
        ctx.globalAlpha = Math.min(1, k)
        ctx.drawImage(blurred, 0, 0)
        if (k > 1) { ctx.globalAlpha = k - 1; ctx.drawImage(blurred, 0, 0) }
        ctx.restore()
      }
    }
  }

  const vignette = find<VignetteEffect>('vignette')
  if (vignette && vignette.amount > 0) {
    const w = off.width, h = off.height
    const R = Math.hypot(w, h) / 2
    const { inner, outer } = vignetteStops(vignette.size, vignette.softness)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // source-atop = clip to existing alpha, so a per-layer vignette never
    // halos beyond the silhouette (doc snapshots are opaque where content is).
    ctx.globalCompositeOperation = 'source-atop'
    const g = ctx.createRadialGradient(w / 2, h / 2, inner * R, w / 2, h / 2, outer * R)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, Math.max(0, vignette.amount))})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  const grain = find<GrainEffect>('grain')
  if (grain && grain.amount > 0) {
    const gc = mkCanvas(off.width, off.height)
    const gctx = gc.getContext('2d')
    if (gctx) {
      const pat = gctx.createPattern(grainTile(), 'repeat')
      if (pat) {
        const s = Math.max(1, grain.size) * scale
        gctx.save()
        gctx.scale(s, s)
        gctx.fillStyle = pat
        gctx.fillRect(0, 0, gc.width / s, gc.height / s)
        gctx.restore()
        gctx.globalCompositeOperation = 'destination-in'
        gctx.drawImage(off, 0, 0) // clip noise to the layer/content alpha
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'overlay'
        ctx.globalAlpha = Math.min(1, Math.max(0, grain.amount))
        ctx.drawImage(gc, 0, 0)
        ctx.restore()
      }
    }
  }
}

/**
 * Doc-level post pass: snapshot the device canvas, run the chain on it, stamp
 * it back in identity space. Called by paintLayerStack when `post` is active.
 */
export function applyStackPost(ctx: CanvasRenderingContext2D, post: PostEffect[], W: number): void {
  const dev = ctx.canvas
  const t = ctx.getTransform()
  const snap = mkCanvas(dev.width, dev.height)
  const sctx = snap.getContext('2d')
  if (!sctx) return
  sctx.drawImage(dev, 0, 0)
  applyEffectChain(snap, post, { W, scale: t.a || 1 })
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, dev.width, dev.height)
  ctx.drawImage(snap, 0, 0)
  ctx.restore()
}
```

- [ ] **Step 4: Wire into `useCompositorLayers.ts`**

4a. Near the existing effect interfaces (after the `BackgroundBlurEffect` block, around line 103–108), replace the union and re-export the new types:

```ts
import {
  applyEffectChain, applyStackPost, chainActive, isChainEffect,
  type AdjustEffect, type BloomEffect, type DuotoneEffect, type GrainEffect,
  type PostEffect, type VignetteEffect,
} from '~/lib/compositor/postEffects'
export type { AdjustEffect, BloomEffect, DuotoneEffect, GrainEffect, PostEffect, VignetteEffect }
export type LayerEffect =
  | DropShadowEffect | LayerBlurEffect | InnerShadowEffect | BackgroundBlurEffect
  | AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect
```

(Add the import at the top of the file with the other `~/lib/compositor/*` imports; this mirrors the existing `export type { PaintStroke } from '~/lib/compositor/brushStamp'` precedent. `postEffects.ts` imports nothing from this file, so there is no cycle.)

4b. In `paintLayer` (around line 992–997), detect the chain next to the existing finds:

```ts
  const chain = fx.filter(isChainEffect) as PostEffect[]
```

4c. Extend the effected-path condition (currently `if (shadow || blur || inner) {` around line 1049) and apply the chain after the inner shadow:

```ts
    if (shadow || blur || inner || chain.length) {
      const off = document.createElement('canvas')
      off.width = Math.max(1, Math.round(W))
      off.height = Math.max(1, Math.round(H))
      const octx = off.getContext('2d')
      if (octx) {
        applyXform(octx, lx, ly, lrot, ls)
        drawContent(octx)
        if (inner) compositeInnerShadow(off, inner, W)
        if (chain.length) applyEffectChain(off, chain, { W })
        // …existing composite (ctx.save / globalAlpha / blendOp / blur filter /
        // shadow params / drawImage / restore / continue) stays byte-identical…
```

4d. Add the trailing param to `paintLayerStack` (after `groups?: LayerGroup[],` around line 1410):

```ts
  /** Doc-level post-processing chain, applied to the finished composite.
   *  Absent/empty ⇒ byte-identical output. */
  post?: PostEffect[],
```

and at the very end of the function body (after the item loop):

```ts
  if (post && chainActive(post)) applyStackPost(ctx, post, W)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/post-effects.unit.spec.ts tests/unit/post-effects-paint.unit.spec.ts`
Expected: PASS

Also run the existing painter regression suites (they must stay green — byte-identical guarantee):

Run: `cd frontend && npx vitest run tests/unit/cross-source-mask.unit.spec.ts tests/unit/compositor-fills.unit.spec.ts tests/unit/layer-groups.unit.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/postEffects.ts frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/post-effects-paint.unit.spec.ts
git commit -m "feat(compositor): render post-effect chain per layer + doc-level paintLayerStack post param"
```

---

### Task 3: Doc-level state + threading through every surface

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (state + history)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (3 paint calls, source key, watch)
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` (2 paint calls, watch)

**Interfaces:**
- Consumes: `paintLayerStack(..., post?)` from Task 2; `PostEffect` type.
- Produces: `useLocalLayerEditor` returns `postEffects: ComputedRef<PostEffect[]>` and `setPostEffects(fx: PostEffect[]): void`; persisted as `sailor_localFx` on `node.data.properties`. Tasks 4/5 rely on these names.

- [ ] **Step 1: Editor state (`useLocalLayerEditor.ts`)**

After the background block (around line 103–112, `writeBg` / `setBackground`):

```ts
  // Doc-level post-processing chain (adjust/bloom/grain/vignette/duotone over
  // the finished composite). Persisted like the background: on node properties.
  const postEffects = computed<PostEffect[]>(() =>
    ((node()?.data?.properties as any)?.sailor_localFx as PostEffect[]) ?? [])
  function writeFx(fx: PostEffect[] | undefined) {
    const n = node(); if (!n) return
    if (!n.data.properties) n.data.properties = {}
    if (!fx || !fx.length) delete (n.data.properties as any).sailor_localFx
    else (n.data.properties as any).sailor_localFx = fx
  }
  function setPostEffects(fx: PostEffect[]) { recordHistory(); writeFx(fx) }
```

Import the type: add `PostEffect` to the file's existing type import from `~/composables/useCompositorLayers`.

Fold into undo history — extend the `Snapshot` type and its two call sites (around line 118–123):

```ts
  type Snapshot = { layers: LocalLayer[]; order: string[]; bg: Paint | undefined; fx: PostEffect[]; groups: LayerGroup[] }
  // snapshot():  add  fx: JSON.parse(JSON.stringify(postEffects.value)),
  // restore(s):  add  writeFx(s.fx?.length ? s.fx : undefined)
```

(Old snapshots taken before this change can't exist at runtime — the stack is per-session — so no migration is needed.)

Export both from the composable's return object, next to `background, setBackground,` (around line 733):

```ts
    postEffects, setPostEffects,
```

- [ ] **Step 2: Thread through `CompositorModal.vue`**

2a. Destructure (line ~314, after `background, setBackground,`):

```ts
  postEffects, setPostEffects,
```

2b. Append `postEffects.value` as the new final argument to all three `paintLayerStack` calls:
- `renderSceneForHarmonize` (~line 1480–1481)
- `renderStaticComposite` (~line 1555–1556)
- `renderStack` (~line 1637–1640)

Each becomes `…, wiredTreatments.value, background.value, localGroups.value, postEffects.value)`.

2c. `staticSourceKey()` (~line 1532): add `fx: postEffects.value,` to the JSON.stringify object — a post-effect edit must mark the static render stale.

2d. The render watch deps array (~line 1642–1653): add `JSON.stringify(postEffects.value),` after the `JSON.stringify(background.value),` line.

- [ ] **Step 3: Thread through `ArtifactFrameNode.vue`**

3a. Both `paintLayerStack` calls (`renderStack` ~line 474–475 and `exportCompositeCanvas` ~line 581–582): append `, editor.postEffects.value` after `editor.localGroups.value`.

3b. Watch deps (~line 529): add `JSON.stringify(editor.postEffects.value ?? []),` after the `JSON.stringify(editor.background.value ?? null),` line.

- [ ] **Step 4: Verify compilation + suites**

Run: `cd frontend && npx vitest run tests/unit/`
Expected: all green (same failures as `main` baseline, if any — check `git stash` is NOT used; just compare to a pre-change run if unsure).

With the dev server running (`./dev.sh` from repo root if not already up): `curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/"` → `200`, and no compile errors in the Vite output.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useLocalLayerEditor.ts frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/components/vue-canvas/ArtifactFrameNode.vue
git commit -m "feat(compositor): doc-level postEffects state (sailor_localFx) threaded through modal + frame node"
```

---

### Task 4: Effects UI — shared `PostEffectsControls` + both panels

**Files:**
- Create: `frontend/app/components/vue-canvas/PostEffectsControls.vue`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (two panel placements + one `data-testid`)

**Interfaces:**
- Consumes: `PostEffect`, `defaultPostEffect`, `isChainEffect` from `~/lib/compositor/postEffects` / `~/composables/useCompositorLayers`; `postEffects` / `setPostEffects` / `setLocal` from Task 3.
- Produces: `<PostEffectsControls :effects="..." @update="..." />` — props `effects: PostEffect[]`, emits `update` with the full replacement array. Test ids `postfx-add-<type>` (Add/Remove button) and `postfx-<type>-<param>` (sliders) that Task 6's E2E clicks.

- [ ] **Step 1: Write the component**

One component renders all five sections and is mounted twice (per-layer + doc), so the two UIs can't drift. Styling matches the existing effect sections (`panel-label`, `panel-sublabel`, same button classes).

```vue
<!-- frontend/app/components/vue-canvas/PostEffectsControls.vue -->
<script setup lang="ts">
// Post-processing effect sections (adjust/bloom/grain/vignette/duotone).
// Emits the FULL replacement chain array — the owner decides where it lives
// (layer.effects for a layer, sailor_localFx for the document).
import { defaultPostEffect, type PostEffect } from '~/lib/compositor/postEffects'

const props = defineProps<{ effects: PostEffect[] }>()
const emit = defineEmits<{ (e: 'update', effects: PostEffect[]): void }>()

interface ParamSpec { key: string; label: string; min: number; max: number; step: number }
interface SectionSpec { type: PostEffect['type']; label: string; params: ParamSpec[]; colors?: [string, string][] }
const SECTIONS: SectionSpec[] = [
  { type: 'adjust', label: 'Adjust', params: [
    { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
  ] },
  { type: 'bloom', label: 'Bloom', params: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01 },
    { key: 'radius', label: 'Radius', min: 0, max: 0.2, step: 0.002 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01 },
  ] },
  { type: 'grain', label: 'Grain', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    { key: 'size', label: 'Size', min: 1, max: 8, step: 0.5 },
  ] },
  { type: 'vignette', label: 'Vignette', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    { key: 'size', label: 'Size', min: 0, max: 1, step: 0.01 },
    { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01 },
  ] },
  { type: 'duotone', label: 'Duotone', colors: [['shadows', 'Shadows'], ['highlights', 'Highlights']], params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
  ] },
]

function fx(type: string): Record<string, any> | undefined {
  return props.effects.find(e => e.type === type) as Record<string, any> | undefined
}
function toggle(type: PostEffect['type']) {
  if (fx(type)) emit('update', props.effects.filter(e => e.type !== type))
  else emit('update', [...props.effects, defaultPostEffect(type)])
}
function patch(type: PostEffect['type'], key: string, value: number | string) {
  const cur = (fx(type) ?? defaultPostEffect(type)) as Record<string, any>
  emit('update', [
    ...props.effects.filter(e => e.type !== type),
    { ...cur, [key]: value } as PostEffect,
  ])
}
function fmt(v: unknown, step: number): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(step >= 1 ? 0 : 2) : '—'
}
</script>

<template>
  <div>
    <div v-for="s in SECTIONS" :key="s.type" class="mt-3 first:mt-0">
      <div class="flex items-center justify-between mb-1.5">
        <div class="panel-label">{{ s.label }}</div>
        <button class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
          :data-testid="`postfx-add-${s.type}`"
          @click="toggle(s.type)">{{ fx(s.type) ? 'Remove' : 'Add' }}</button>
      </div>
      <div v-if="fx(s.type)" class="space-y-1.5">
        <div v-if="s.colors" class="flex items-center gap-1.5">
          <div v-for="[key, label] in s.colors" :key="key" class="flex-1 flex items-center gap-1.5 min-w-0">
            <input type="color" :value="fx(s.type)![key]" :title="label"
              class="w-8 h-8 rounded bg-transparent border border-[#2a2a2a] cursor-pointer shrink-0"
              @input="patch(s.type, key, ($event.target as HTMLInputElement).value)" />
            <div class="panel-sublabel truncate">{{ label }}</div>
          </div>
        </div>
        <div v-for="p in s.params" :key="p.key" class="flex items-center gap-2">
          <div class="panel-sublabel w-16 shrink-0">{{ p.label }}</div>
          <input type="range" :min="p.min" :max="p.max" :step="p.step" :value="fx(s.type)![p.key]"
            class="flex-1 min-w-0 accent-white/80 cursor-pointer"
            :data-testid="`postfx-${s.type}-${p.key}`"
            @input="patch(s.type, p.key, parseFloat(($event.target as HTMLInputElement).value))" />
          <div class="w-9 shrink-0 text-right text-[10px] text-white/50 tabular-nums">{{ fmt(fx(s.type)![p.key], p.step) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Mount the per-layer instance in `CompositorModal.vue`**

Directly after the Background-blur section's closing `</div>` (the `<!-- Background blur … -->` block ends ~line 3908, just before `<!-- Layer mask: … -->`):

```html
          <!-- Post-processing (adjust / bloom / grain / vignette / duotone) -->
          <PostEffectsControls class="mt-3"
            :effects="(((selectedLocal as any).effects || []).filter(isChainEffect) as any)"
            @update="(fx: any[]) => setLocal(selectedLocal!.id, { effects: [...((selectedLocal as any).effects || []).filter((e: any) => !isChainEffect(e)), ...fx] } as any)" />
```

Add `import { isChainEffect } from '~/lib/compositor/postEffects'` to the modal's script setup (it is a value import — the useCompositorLayers re-export in Task 2 covers only the types). The component itself is Nuxt-auto-imported (same as `CompositorClonerPanel` / `FillControl` — verify neither appears in the modal's import block, and mirror whichever convention is actually used).

- [ ] **Step 3: Mount the doc-level instance**

In the nothing-selected panel, directly after the Background `<div>` closes (~line 4081, before `<!-- Expressive arrange … -->`):

```html
          <!-- Whole-frame post-processing (after all layers composite) -->
          <div class="border-t border-white/[0.06] pt-3">
            <div class="panel-label mb-1.5">Post-processing</div>
            <p class="text-[10px] text-white/30 leading-snug mb-2">Grades the whole frame after all layers composite — bakes into renders, exports and motion stills.</p>
            <PostEffectsControls :effects="postEffects" @update="(fx: any[]) => setPostEffects(fx as any)" />
          </div>
```

- [ ] **Step 4: Add the canvas test id**

On the unified stack canvas (~line 2624–2629), add `data-testid="compositor-stack-canvas"`:

```html
        <canvas
          ref="overlayCanvas"
          data-testid="compositor-stack-canvas"
          class="absolute inset-0 pointer-events-none"
          :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px' }"
        />
```

- [ ] **Step 5: Verify in the browser**

With `./dev.sh` running, open `http://127.0.0.1:3000`, start a blank project, add a Frame (Compositor) node, open its editor, add a rectangle (toolbar button "Add rectangle"):
- Selected rect → right panel shows the five new sections after Background blur; Add **Adjust**, drag Brightness — the rect brightens live.
- Add **Bloom** on a light shape over a dark background — glow extends past the shape edge.
- Click empty canvas to deselect → right panel shows Background + **Post-processing**; add **Grain** and **Vignette** — whole frame gets texture + corner darkening.
- Undo (⌘Z) steps effect edits back.
- Close and reopen the modal — effects persist (they live on node properties).

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/PostEffectsControls.vue frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): post-effects panels (per-layer + whole-frame) via shared PostEffectsControls"
```

---

### Task 5: Agent surface — `setLayerEffect` / `setPostEffect`

**Files:**
- Modify: `frontend/app/lib/agent/surfaces/compositor.ts`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (agent getState/setState, ~line 361–370)
- Modify: `frontend/app/composables/useCompositorAgent.ts` (preview paint call, ~line 161)
- Test: `frontend/tests/unit/agent-compositor-surface.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `PostEffect`, `POST_EFFECT_DEFAULTS`, `defaultPostEffect`, `POST_FX_PARAM_CLAMP`, `isChainEffect` from `~/lib/compositor/postEffects`; `postEffects`/`setPostEffects` from Task 3.
- Produces: `CompositorState.postEffects?: PostEffect[]`; agent ops `setLayerEffect` (target = layer id, args `{ effect: { type, …params }, remove? }`) and `setPostEffect` (args `{ effect, remove? }`).

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/agent-compositor-surface.unit.spec.ts`, following the file's existing state-fixture helpers — read the file first and reuse its `applyCompositorCommand` import and any layer-factory helper)

```ts
describe('post-processing effect commands', () => {
  const baseState = (): any => ({
    layers: [{ id: 't1', kind: 'text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, text: 'Hi', fontFamily: 'Inter', fontWeight: 400, fontSize: 0.1, color: '#fff', align: 'center', lineHeight: 1.1, strokeColor: '', strokeWidth: 0 }],
  })

  it('setLayerEffect adds a bloom with clamped params', () => {
    const r = applyCompositorCommand(baseState(), {
      op: 'setLayerEffect', target: 't1',
      args: { effect: { type: 'bloom', intensity: 99, threshold: -3 } },
    } as any)
    expect(r.ok).toBe(true)
    const fx = (r as any).template.layers[0].effects.find((e: any) => e.type === 'bloom')
    expect(fx.intensity).toBe(2)   // clamped to POST_FX_PARAM_CLAMP
    expect(fx.threshold).toBe(0)
    expect(fx.radius).toBe(0.02)   // default filled in
    expect(fx.visible).toBe(true)
  })

  it('setLayerEffect merges onto an existing effect and remove deletes it', () => {
    const s = baseState()
    s.layers[0].effects = [{ type: 'adjust', brightness: 1.4, contrast: 1, saturation: 1, hue: 0, visible: true }]
    const r1 = applyCompositorCommand(s, { op: 'setLayerEffect', target: 't1', args: { effect: { type: 'adjust', hue: 30 } } } as any)
    const merged = (r1 as any).template.layers[0].effects.find((e: any) => e.type === 'adjust')
    expect(merged.brightness).toBe(1.4) // untouched param survives
    expect(merged.hue).toBe(30)
    const r2 = applyCompositorCommand((r1 as any).template, { op: 'setLayerEffect', target: 't1', args: { effect: { type: 'adjust' }, remove: true } } as any)
    expect((r2 as any).template.layers[0].effects.some((e: any) => e.type === 'adjust')).toBe(false)
  })

  it('setLayerEffect rejects unknown types and missing layers', () => {
    expect(applyCompositorCommand(baseState(), { op: 'setLayerEffect', target: 't1', args: { effect: { type: 'sparkle' } } } as any).ok).toBe(false)
    expect(applyCompositorCommand(baseState(), { op: 'setLayerEffect', target: 'nope', args: { effect: { type: 'bloom' } } } as any).ok).toBe(false)
  })

  it('setPostEffect writes the doc-level chain and restore round-trips it', () => {
    const r = applyCompositorCommand(baseState(), { op: 'setPostEffect', args: { effect: { type: 'grain', amount: 0.5 } } } as any)
    expect(r.ok).toBe(true)
    expect((r as any).template.postEffects[0]).toMatchObject({ type: 'grain', amount: 0.5 })
    // the inverse restores the (empty) original doc chain
    const inv = (r as any).inverse
    const undone = applyCompositorCommand((r as any).template, inv)
    expect(((undone as any).template.postEffects ?? []).length).toBe(0)
  })

  it('duotone colours accept hex strings only', () => {
    const r = applyCompositorCommand(baseState(), {
      op: 'setPostEffect', args: { effect: { type: 'duotone', shadows: '#102030', highlights: 'javascript:alert(1)' } },
    } as any)
    const d = (r as any).template.postEffects.find((e: any) => e.type === 'duotone')
    expect(d.shadows).toBe('#102030')
    expect(d.highlights).toBe('#ffe8d6') // invalid input → default kept
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/agent-compositor-surface.unit.spec.ts`
Expected: FAIL — `unknown op 'setLayerEffect'`

- [ ] **Step 3: Implement in `surfaces/compositor.ts`**

3a. Imports + state:

```ts
import { defaultPostEffect, POST_EFFECT_DEFAULTS, POST_FX_PARAM_CLAMP, type PostEffect } from '~/lib/compositor/postEffects'

export interface CompositorState {
  layers: LocalLayer[]
  background?: Paint
  /** Doc-level post-processing chain (whole-frame grade/bloom/grain/…). */
  postEffects?: PostEffect[]
  brandPalette?: { name: string; hex: string }[]
}
```

3b. Sanitizer (near the other module helpers):

```ts
/** Merge model-provided effect params over current/defaults with clamps; null = invalid type. */
function sanitizePostEffect(raw: unknown, cur?: PostEffect): PostEffect | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const type = r.type as PostEffect['type']
  if (!type || !(type in POST_EFFECT_DEFAULTS)) return null
  const base: Record<string, unknown> = { ...defaultPostEffect(type), ...(cur ? clone(cur) : {}) }
  const clamps = POST_FX_PARAM_CLAMP[type] ?? {}
  for (const [k, v] of Object.entries(r)) {
    if (k === 'type' || k === 'visible') continue
    if (k in clamps && typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = clamps[k]!
      base[k] = Math.min(hi, Math.max(lo, v))
    } else if (type === 'duotone' && (k === 'shadows' || k === 'highlights')
      && typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) {
      base[k] = v
    }
  }
  base.visible = true
  return base as unknown as PostEffect
}
```

3c. Two command specs appended to `COMPOSITOR_COMMANDS`:

```ts
  { op: 'setLayerEffect', hint: 'Add/update/remove a post-processing effect ON ONE LAYER. target = layer id; args: { effect: { type: "adjust"|"bloom"|"grain"|"vignette"|"duotone", ...params }, remove? }. adjust (colour grade): brightness/contrast/saturation 0..2 (1 = neutral), hue -180..180. bloom (glow from bright areas): threshold 0..1, radius ~0.02, intensity 0..2. grain (film noise): amount 0..1, size 1..8. vignette (darkened edges): amount/size/softness 0..1. duotone (two-colour map): shadows "#RRGGBB", highlights "#RRGGBB", mix 0..1. Omitted params keep their current value. remove:true deletes that effect type. This is what "make the logo glow", "desaturate the photo" mean.' },
  { op: 'setPostEffect', hint: 'Add/update/remove a post-processing effect on the WHOLE FRAME — applied after all layers composite. Same args and effect vocabulary as setLayerEffect (no target). This is what "make the whole thing warmer", "add film grain", "give it a vignette", "cinematic colour grade" mean.' },
```

3d. Apply cases (before `case 'restore'`):

```ts
    case 'setLayerEffect': {
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      const raw = cmd.args?.effect as Record<string, unknown> | undefined
      const type = raw?.type as string | undefined
      if (!type || !(type in POST_EFFECT_DEFAULTS)) return { ok: false, reason: 'invalid', detail: `effect.type must be one of ${Object.keys(POST_EFFECT_DEFAULTS).join('|')}` }
      const others = (layer.effects ?? []).filter(e => e.type !== type)
      if (cmd.args?.remove === true) { layer.effects = others; return { ok: true, template: state, inverse: snapshot() } }
      const cur = (layer.effects ?? []).find(e => e.type === type) as PostEffect | undefined
      const next = sanitizePostEffect(raw, cur)
      if (!next) return { ok: false, reason: 'invalid', detail: 'invalid effect' }
      layer.effects = [...others, next]
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setPostEffect': {
      const raw = cmd.args?.effect as Record<string, unknown> | undefined
      const type = raw?.type as string | undefined
      if (!type || !(type in POST_EFFECT_DEFAULTS)) return { ok: false, reason: 'invalid', detail: `effect.type must be one of ${Object.keys(POST_EFFECT_DEFAULTS).join('|')}` }
      const others = (state.postEffects ?? []).filter(e => e.type !== type)
      if (cmd.args?.remove === true) return { ok: true, template: { ...state, postEffects: others }, inverse: snapshot() }
      const cur = (state.postEffects ?? []).find(e => e.type === type)
      const next = sanitizePostEffect(raw, cur)
      if (!next) return { ok: false, reason: 'invalid', detail: 'invalid effect' }
      return { ok: true, template: { ...state, postEffects: [...others, next] }, inverse: snapshot() }
    }
```

3e. Round-trip plumbing:
- `snapshot()` (inside `applyCompositorCommand`): add `postEffects: clone(input.postEffects)` to its args object.
- `case 'restore'`: add `if ('postEffects' in (cmd.args ?? {})) next.postEffects = clone(cmd.args!.postEffects as PostEffect[] | undefined)`.
- `describeCompositor`: in the per-layer `cur`, after the blend line add `if (l.effects?.length) cur.effects = l.effects.filter(e => e.visible).map(e => e.type).join(', ')`; in the document object's `current`, add `postEffects: state.postEffects?.filter(e => e.visible).map(e => e.type).join(', ') || 'none',`.

- [ ] **Step 4: Thread agent state**

`CompositorModal.vue` (~line 361–370):

```ts
  getState: () => ({
    layers: localLayers.value,
    background: background.value,
    postEffects: postEffects.value,
    brandPalette: brandSwatches(projectBrand?.activeKit.value),
  }),
  setState: (s) => {
    commit(s.layers)
    if (s.background !== background.value) setBackground(s.background)
    if (JSON.stringify(s.postEffects ?? []) !== JSON.stringify(postEffects.value)) setPostEffects(s.postEffects ?? [])
  },
```

`useCompositorAgent.ts` preview paint (~line 161): append `, undefined, state.postEffects` after `state.background` (the params are `background, groups, post` — groups stays undefined).

Also `frontend/app/lib/agent/capabilities.ts` (spec requirement — **this file is touched by a parallel session: edit ONLY the Compositor entry's strings, stage only your hunk if other edits appear**): in the `nodeType: 'Compositor'` entry (~line 291), extend the `summary` to end `…masking, motion, post-processing (grade/bloom/grain/vignette/duotone).` and append these intents to its `intents` array:

```ts
      'add film grain', 'vignette', 'colour grade the frame', 'color grade the frame',
      'make it glow', 'bloom effect', 'duotone the image', 'desaturate it', 'make it warmer',
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run tests/unit/agent-compositor-surface.unit.spec.ts tests/unit/agent-coverage-guard.unit.spec.ts`
Expected: PASS. (If the coverage guard asserts every command has a hint/test, follow its failure message.)

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/agent/surfaces/compositor.ts frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/composables/useCompositorAgent.ts frontend/tests/unit/agent-compositor-surface.unit.spec.ts
# capabilities.ts is shared with a parallel session. If `git diff frontend/app/lib/agent/capabilities.ts`
# shows ONLY your Compositor-entry edit, `git add` the file. Otherwise extract just your hunk
# (repo convention — never stash): `git diff -- frontend/app/lib/agent/capabilities.ts > /tmp/cap.patch`,
# delete the hunks that aren't yours from the patch, then `git apply --cached /tmp/cap.patch`.
git commit -m "feat(compositor): agent setLayerEffect/setPostEffect commands over the post-fx chain"
```

---

### Task 6: E2E verification

**Files:**
- Create: `frontend/tests/compositor-post-effects.spec.ts`

**Interfaces:**
- Consumes: `data-testid="compositor-stack-canvas"`, `postfx-add-<type>` / `postfx-<type>-<param>` test ids (Task 4); `sailor:openCompositor` window event; helpers from `tests/_helpers.ts`.

- [ ] **Step 1: Write the spec**

```ts
// frontend/tests/compositor-post-effects.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { openBlankWorkflow, dropNode, waitForBackend } from './_helpers'

/** Data-URL snapshot of the compositor's unified stack canvas. */
async function stackPixels(page: Page): Promise<string> {
  await page.waitForTimeout(500) // let the watch → renderStack settle
  return await page.evaluate(() => {
    const cv = document.querySelector('[data-testid="compositor-stack-canvas"]') as HTMLCanvasElement
    return cv.toDataURL()
  })
}

test.describe('Compositor post-processing effects', () => {
  test('per-layer adjust and whole-frame grain change (and restore) the composite', async ({ page }) => {
    await openBlankWorkflow(page)
    await waitForBackend(page)
    await dropNode(page, 'Compositor')
    const nodeId = await page.locator('.vue-flow__node').first().getAttribute('data-id')
    expect(nodeId).toBeTruthy()

    await page.evaluate((id) =>
      window.dispatchEvent(new CustomEvent('sailor:openCompositor', { detail: { nodeId: id } })), nodeId)
    const canvas = page.locator('[data-testid="compositor-stack-canvas"]')
    await canvas.waitFor({ state: 'visible', timeout: 10_000 })

    // A rectangle to grade (addRect selects it, so the layer panel is showing).
    await page.getByTitle('Add rectangle').click()
    const baseline = await stackPixels(page)

    // Per-layer Adjust: brightness up must change pixels; Remove must restore them.
    await page.locator('[data-testid="postfx-add-adjust"]').click()
    await page.locator('[data-testid="postfx-adjust-brightness"]').fill('1.8')
    const brightened = await stackPixels(page)
    expect(brightened).not.toBe(baseline)
    await page.locator('[data-testid="postfx-add-adjust"]').click() // now reads "Remove"
    expect(await stackPixels(page)).toBe(baseline)

    // Deselect by clicking an empty artboard corner → doc panel appears.
    const box = await canvas.boundingBox()
    if (!box) throw new Error('stack canvas has no box')
    await page.mouse.click(box.x + 4, box.y + 4)
    await expect(page.getByText('Post-processing', { exact: true })).toBeVisible()

    // Whole-frame grain changes the composite.
    const preGrain = await stackPixels(page)
    await page.locator('[data-testid="postfx-add-grain"]').click()
    await page.locator('[data-testid="postfx-grain-amount"]').fill('0.9')
    expect(await stackPixels(page)).not.toBe(preGrain)

    // Persistence: reopen the modal — the doc chain survives (node properties).
    await page.keyboard.press('Escape')
    await canvas.waitFor({ state: 'hidden', timeout: 5_000 })
    await page.evaluate((id) =>
      window.dispatchEvent(new CustomEvent('sailor:openCompositor', { detail: { nodeId: id } })), nodeId)
    await canvas.waitFor({ state: 'visible', timeout: 10_000 })
    await page.mouse.click(box.x + 4, box.y + 4)
    await expect(page.locator('[data-testid="postfx-add-grain"]')).toHaveText('Remove')
  })
})
```

Selector reality-check while writing this test: the empty-corner click assumes the rect spawns centred (it does — `addRect` centres at 0.5/0.5) and that clicking empty artboard deselects (the editor's `onCanvasPointerDown` handles this). If Escape closes the modal while a layer is selected instead of deselecting, keep the corner-click approach as written. Adjust only if the live DOM disproves an assumption — and if you must change a selector, prefer adding a `data-testid` over a brittle class chain.

- [ ] **Step 2: Run the E2E**

Both servers must be up: from the repo root, `./dev.sh` (kills strays, starts frontend 3000 + ComfyUI 8188).

Run: `cd frontend && npx playwright test tests/compositor-post-effects.spec.ts`
Expected: 1 passed

- [ ] **Step 3: Full verification sweep**

```bash
cd frontend
npx vitest run                       # entire unit suite green
npx nuxt typecheck 2>&1 | tail -3    # error count at or below the ~328 baseline
```

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/tests/compositor-post-effects.spec.ts
git commit -m "test(compositor): E2E for per-layer + whole-frame post effects"
```
