# Compositor Depth of Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a depth-of-field post effect to Compositor image layers, driven by a locally-computed depth map, rendered through a new WebGL2 post stage.

**Architecture:** A Nitro endpoint runs Depth Anything V2 via transformers.js and caches greyscale depth PNGs by content hash. A module-level registry holds ready depth images so `paintLayer` stays synchronous. A small WebGL2 pass runner takes the layer's rendered content plus its depth map and applies a shaped-aperture, linear-light defocus, then hands a canvas back to the existing Canvas 2D chain.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Nitro server routes, vitest 4, WebGL2, `@huggingface/transformers`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-28-compositor-depth-of-field-design.md`. Read it before Task 1.
- Chain order is `dof → adjust → duotone → bloom → vignette → grain`. DOF is applied to layer content **before** the 2D chain runs.
- `DofEffect` must **not** be a member of `CHAIN_TYPES`. It is routed by a separate `GPU_TYPES` set.
- `aperture` is normalised to canvas width, exactly as `bloom.radius` already is. A bake at 2× must produce the same visual blur as the preview.
- No silent fallbacks. If WebGL2 is missing or depth is unavailable, DOF renders as pass-through and the panel says why. Never substitute a 2D blur.
- DOF is offered only on `kind: 'image'` layers.
- Render path stays synchronous. No `await` may be introduced into `paintLayer` or `paintLayerStack`.
- Unit tests run with `cd frontend && npm run test:unit`.
- Commit only files this plan names. Other sessions have uncommitted work in this tree — never `git add -A`, never `git stash`.

---

### Task 1: `DofEffect` type, defaults, clamps and GPU routing

Pure type and table work in the existing effects module. No rendering yet.

**Files:**
- Modify: `frontend/app/lib/compositor/postEffects.ts`
- Test: `frontend/tests/unit/post-effects.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DofEffect`, `GPU_TYPES`, `isGpuEffect(e: { type: string }): e is DofEffect`, `POST_EFFECT_DEFAULTS.dof`, `POST_FX_PARAM_CLAMP.dof`. `PostEffect` union gains `DofEffect`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/post-effects.unit.spec.ts`. Add `isGpuEffect`, `GPU_TYPES` and `type DofEffect` to the existing import block at the top of the file.

```ts
describe('dof effect routing', () => {
  it('has defaults inside its own clamp ranges', () => {
    const d = defaultPostEffect('dof') as DofEffect
    expect(d.type).toBe('dof')
    for (const [k, [lo, hi]] of Object.entries(POST_FX_PARAM_CLAMP.dof!)) {
      const v = (d as unknown as Record<string, number>)[k]!
      expect(v).toBeGreaterThanOrEqual(lo)
      expect(v).toBeLessThanOrEqual(hi)
    }
  })

  it('is a GPU effect and NOT a 2D chain effect', () => {
    const d = defaultPostEffect('dof')
    expect(isGpuEffect(d)).toBe(true)
    expect(isChainEffect(d)).toBe(false)
    expect(GPU_TYPES.has('dof')).toBe(true)
  })

  it('does not activate the 2D chain on its own', () => {
    expect(chainActive([defaultPostEffect('dof')])).toBe(false)
  })

  it('defaultPostEffect returns a fresh object each call', () => {
    const a = defaultPostEffect('dof') as DofEffect
    a.aperture = 0.9
    expect((defaultPostEffect('dof') as DofEffect).aperture).not.toBe(0.9)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:unit -- post-effects.unit
```

Expected: FAIL — `isGpuEffect` is not exported.

- [ ] **Step 3: Write the implementation**

In `frontend/app/lib/compositor/postEffects.ts`, add the interface after `DuotoneEffect` (around line 45):

```ts
/** Depth of field. GPU-only — applied to layer content BEFORE the 2D chain, because
 *  defocus happens at the lens. Requires a depth map; renders through without one. */
export interface DofEffect {
  type: 'dof'
  focus: number          // 0..1 — normalized depth of the focal plane
  range: number          // 0..1 — depth band that stays sharp
  aperture: number       // 0..1 — max blur radius, NORMALIZED TO CANVAS WIDTH
  bladeCount: number     // 0..12 — iris sides; < 3 renders a circle
  bladeRotation: number  // 0..360 degrees
  bloomThreshold: number // 0..1 — linear-light luminance cutoff
  bloomStrength: number  // 0..4 — highlight boost before accumulation
  visible: boolean
}
```

Extend the union (line 46) to include `DofEffect`, then add the default and clamp entries:

```ts
// in POST_EFFECT_DEFAULTS
dof: {
  type: 'dof', focus: 0.5, range: 0.15, aperture: 0.02,
  bladeCount: 6, bladeRotation: 0, bloomThreshold: 0.75, bloomStrength: 1.5,
  visible: true,
},

// in POST_FX_PARAM_CLAMP
dof: {
  focus: [0, 1], range: [0, 1], aperture: [0, 1],
  bladeCount: [0, 12], bladeRotation: [0, 360],
  bloomThreshold: [0, 1], bloomStrength: [0, 4],
},
```

Then, immediately after the `CHAIN_TYPES` block (line 68-71), add the parallel GPU routing. `CHAIN_TYPES` itself must not change:

```ts
/** GPU-stage effects. Deliberately disjoint from CHAIN_TYPES: applyEffectChain must
 *  never see these, or they'd be silently skipped while appearing to be handled. */
export const GPU_TYPES = new Set<string>(['dof'])
export const isGpuEffect = (e: { type: string }): e is DofEffect => GPU_TYPES.has(e.type)
export const gpuActive = (effects?: { type: string; visible?: boolean }[]): boolean =>
  !!effects?.some(e => e.visible !== false && GPU_TYPES.has(e.type))
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:unit -- post-effects.unit
```

Expected: PASS, and the pre-existing tests in that file still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/postEffects.ts frontend/tests/unit/post-effects.unit.spec.ts
git commit -m "feat(compositor): add DofEffect type with GPU routing disjoint from the 2D chain"
```

---

### Task 2: Circle-of-confusion and aperture kernel maths

Pure functions, no DOM. This is where the bake/preview scale bug is prevented.

**Files:**
- Create: `frontend/app/lib/compositor/dofMath.ts`
- Test: `frontend/tests/unit/dof-math.unit.spec.ts`

**Interfaces:**
- Consumes: `DofEffect` from Task 1.
- Produces:
  - `cocFor(depth: number, focus: number, range: number): number` — 0..1 defocus amount.
  - `apertureRadiusPx(aperture: number, W: number): number` — normalised → device pixels.
  - `apertureOffsets(taps: number, bladeCount: number, bladeRotationDeg: number): Array<{ x: number; y: number }>` — unit-disc sample offsets clipped to the iris polygon.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/dof-math.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cocFor, apertureRadiusPx, apertureOffsets } from '~/lib/compositor/dofMath'

describe('cocFor', () => {
  it('is zero inside the sharp band and grows outside it', () => {
    expect(cocFor(0.5, 0.5, 0.2)).toBe(0)
    expect(cocFor(0.55, 0.5, 0.2)).toBe(0)   // within range/2
    expect(cocFor(0.8, 0.5, 0.2)).toBeGreaterThan(0)
  })
  it('is symmetric in front of and behind the focal plane', () => {
    expect(cocFor(0.2, 0.5, 0.1)).toBeCloseTo(cocFor(0.8, 0.5, 0.1), 10)
  })
  it('never exceeds 1', () => {
    expect(cocFor(0, 1, 0)).toBeLessThanOrEqual(1)
    expect(cocFor(1, 0, 0)).toBeLessThanOrEqual(1)
  })
  it('a full-width sharp band defocuses nothing', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) expect(cocFor(d, 0.5, 2)).toBe(0)
  })
})

describe('apertureRadiusPx', () => {
  it('scales with canvas width so preview and bake match', () => {
    expect(apertureRadiusPx(0.02, 1000)).toBeCloseTo(20, 10)
    expect(apertureRadiusPx(0.02, 2000)).toBeCloseTo(40, 10)
  })
  it('is zero at zero aperture', () => {
    expect(apertureRadiusPx(0, 4000)).toBe(0)
  })
})

describe('apertureOffsets', () => {
  it('returns the requested tap count', () => {
    expect(apertureOffsets(32, 6, 0)).toHaveLength(32)
  })
  it('keeps every sample inside the unit disc', () => {
    for (const o of apertureOffsets(64, 6, 0)) {
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
  it('bladeCount < 3 gives a circular iris reaching the rim', () => {
    const r = apertureOffsets(128, 0, 0).map(o => Math.hypot(o.x, o.y))
    expect(Math.max(...r)).toBeGreaterThan(0.95)
  })
  it('a polygonal iris is tighter than a circular one', () => {
    const area = (n: number) => apertureOffsets(256, n, 0)
      .reduce((s, o) => s + Math.hypot(o.x, o.y), 0)
    expect(area(3)).toBeLessThan(area(0))
  })
  it('rotation changes the sample set but not its size', () => {
    const a = apertureOffsets(32, 6, 0), b = apertureOffsets(32, 6, 30)
    expect(b).toHaveLength(32)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })
  it('is deterministic — bakes must not shimmer', () => {
    expect(apertureOffsets(32, 6, 15)).toEqual(apertureOffsets(32, 6, 15))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:unit -- dof-math
```

Expected: FAIL — cannot resolve `~/lib/compositor/dofMath`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/compositor/dofMath.ts`:

```ts
/**
 * Depth-of-field maths. Pure — no DOM, no GL — so the shader, the unit tests and
 * any future CPU path all agree on the same numbers.
 *
 * The one rule that matters here: `aperture` is normalized to canvas width (like
 * bloom.radius in postEffects.ts). CoC is measured in pixels, so an un-normalized
 * value renders half the blur on a 2x bake — correct in preview, wrong on export.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Defocus amount 0..1 for a normalized depth, given the focal plane and sharp band. */
export function cocFor(depth: number, focus: number, range: number): number {
  const d = Math.abs(clamp01(depth) - clamp01(focus)) - Math.max(0, range) / 2
  return clamp01(d)
}

/** Max blur radius in device pixels. */
export function apertureRadiusPx(aperture: number, W: number): number {
  return clamp01(aperture) * Math.max(0, W)
}

/**
 * Unit-disc sample offsets on a golden-angle spiral, clipped to an iris polygon.
 * `bladeCount < 3` leaves the disc circular. Deterministic: no RNG, so a bake
 * produces identical output every frame.
 */
export function apertureOffsets(
  taps: number, bladeCount: number, bladeRotationDeg: number,
): Array<{ x: number; y: number }> {
  const n = Math.max(1, Math.floor(taps))
  const blades = Math.floor(bladeCount)
  const rot = (bladeRotationDeg * Math.PI) / 180
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))
  const out: Array<{ x: number; y: number }> = []

  for (let i = 0; i < n; i++) {
    // sqrt keeps the samples area-uniform rather than clustered at the centre.
    const r = Math.sqrt((i + 0.5) / n)
    const a = i * GOLDEN
    let scale = 1
    if (blades >= 3) {
      // Distance from centre to the polygon edge along this angle, normalized so
      // the polygon is inscribed in the unit circle.
      const seg = (2 * Math.PI) / blades
      const local = ((a - rot) % seg + seg) % seg - seg / 2
      scale = Math.cos(Math.PI / blades) / Math.cos(local)
    }
    const rr = r * scale
    out.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr })
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:unit -- dof-math
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/dofMath.ts frontend/tests/unit/dof-math.unit.spec.ts
git commit -m "feat(compositor): add DOF circle-of-confusion and iris kernel maths"
```

---

### Task 3: Depth cache keying (pure) and the depth endpoint

The model call is isolated behind a pure, testable cache module so CI never downloads weights.

**Files:**
- Create: `frontend/server/utils/depthCache.ts`
- Create: `frontend/server/api/depth/estimate.post.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts:27`
- Modify: `frontend/package.json` (add `@huggingface/transformers`)
- Test: `frontend/tests/unit/depth-cache.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `depthCacheKey(bytes: Uint8Array): string` — 16-hex content hash.
  - `depthCacheName(key: string): string` — `depth_<key>.png`.
  - `POST /api/depth/estimate` with body `{ filename: string }` → `{ depthFilename: string, subfolder: string, cached: boolean }`.

**`subfolder` is returned separately, not joined into `depthFilename`.** `/view` proxies
to ComfyUI, which takes `subfolder` as its own query param — a slash inside `filename`
does not resolve. The client URL is
`/view?filename=<depthFilename>&subfolder=<subfolder>&type=input`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/depth-cache.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { depthCacheKey, depthCacheName } from '~~/server/utils/depthCache'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('depthCacheKey', () => {
  it('is stable for identical content', () => {
    expect(depthCacheKey(bytes('abc'))).toBe(depthCacheKey(bytes('abc')))
  })
  it('differs for different content', () => {
    expect(depthCacheKey(bytes('abc'))).not.toBe(depthCacheKey(bytes('abd')))
  })
  it('is filename-safe hex of fixed length', () => {
    expect(depthCacheKey(bytes('x'))).toMatch(/^[0-9a-f]{16}$/)
  })
  it('keys content, not identity — the same photo under two names shares a key', () => {
    const a = bytes('same-pixels'), b = bytes('same-pixels')
    expect(depthCacheKey(a)).toBe(depthCacheKey(b))
  })
})

describe('depthCacheName', () => {
  it('derives a png name from a key', () => {
    expect(depthCacheName('0123456789abcdef')).toBe('depth_0123456789abcdef.png')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:unit -- depth-cache
```

Expected: FAIL — cannot resolve `~~/server/utils/depthCache`.

- [ ] **Step 3: Write the pure cache module**

Create `frontend/server/utils/depthCache.ts`:

```ts
/**
 * Content-addressed naming for cached depth maps. Pure and dependency-free so the
 * unit tests never touch the model or the filesystem.
 *
 * Keyed by CONTENT, not filename: the same photo dropped into two documents (or
 * re-uploaded under a new name) reuses one depth map.
 */
import { createHash } from 'node:crypto'

export function depthCacheKey(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export function depthCacheName(key: string): string {
  return `depth_${key}.png`
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:unit -- depth-cache
```

Expected: PASS (5 tests).

- [ ] **Step 5: Install the runtime**

```bash
cd frontend && pnpm add @huggingface/transformers
```

**This project uses pnpm, not npm.** `npm install` crashes on the pnpm-structured
`node_modules` with `Cannot read properties of null (reading 'matches')`. pnpm will warn
that it skipped build scripts for `onnxruntime-node`, `protobufjs` and `sharp` — on
darwin/arm64 the native binaries ship prebuilt, so no approval is needed.

- [ ] **Step 6: Allowlist the route**

In `frontend/server/middleware/comfyui-proxy.ts:27`, add `'/api/depth'` to `NITRO_API_PREFIXES`. Without this the proxy forwards the route to ComfyUI and it 404s.

```ts
const NITRO_API_PREFIXES = ['/api/templates', '/api/cloud-train', '/api/voice-clone', '/api/training-queue', '/api/krea', '/api/vector', '/api/inpaint', '/api/house-styles', '/api/brand-kits', '/api/template-fonts', '/api/characters-local', '/api/lipsync', '/api/meter', '/api/pool', '/api/scene3d', '/api/style-profile', '/api/fonts', '/api/depth']
```

- [ ] **Step 7: Write the endpoint**

Create `frontend/server/api/depth/estimate.post.ts`:

```ts
/**
 * POST /api/depth/estimate — monocular depth for an image in ComfyUI's input dir.
 *
 * Body: { filename }  — an ImageLayer.filename, read straight off disk (no data-URL
 *                       round trip).
 * Returns: { depthFilename, cached }
 *
 * Runs Depth Anything V2 locally via transformers.js. The pipeline is a module-level
 * singleton so weights load once and stay warm; a cache hit never touches it.
 * /api/depth is allowlisted in server/middleware/comfyui-proxy.ts.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'

import { depthCacheKey, depthCacheName } from '~~/server/utils/depthCache'

const MODEL = 'onnx-community/depth-anything-v2-small'
const INPUT_DIR = join(process.cwd(), '..', 'input')
const CACHE_DIR = join(INPUT_DIR, 'sailor_depth')

let pipePromise: Promise<any> | null = null
function depthPipeline(): Promise<any> {
  if (!pipePromise) {
    pipePromise = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline('depth-estimation', MODEL))
      .catch((err) => { pipePromise = null; throw err })
  }
  return pipePromise
}

const exists = (p: string) => access(p).then(() => true, () => false)

export default defineEventHandler(async (event) => {
  const body = await readBody<{ filename?: string }>(event)
  const filename = (body?.filename ?? '').trim()
  if (!filename || filename.includes('/') || filename.includes('..')) {
    throw createError({ statusCode: 400, message: 'a bare filename is required' })
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(join(INPUT_DIR, filename)))
  } catch {
    throw createError({ statusCode: 404, message: `not found in input dir: ${filename}` })
  }

  const name = depthCacheName(depthCacheKey(bytes))
  const outPath = join(CACHE_DIR, name)
  const depthFilename = `sailor_depth/${name}`
  if (await exists(outPath)) return { depthFilename, cached: true }

  let png: Uint8Array
  try {
    const pipe = await depthPipeline()
    const { depth } = await pipe(join(INPUT_DIR, filename))
    png = new Uint8Array(await depth.toBlob().then((b: Blob) => b.arrayBuffer()))
  } catch (err) {
    throw createError({
      statusCode: 502,
      message: `depth estimation failed: ${(err as Error).message}`,
    })
  }

  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(outPath, png)
  return { depthFilename, cached: false }
})
```

- [ ] **Step 8: Verify the endpoint by hand**

Start the dev server, then with a real filename from the input dir:

```bash
curl -s -X POST http://127.0.0.1:3000/api/depth/estimate -H 'Content-Type: application/json' -d '{"filename":"REPLACE_WITH_A_REAL_INPUT_FILENAME.png"}'
```

Expected: first call returns `{"depthFilename":"sailor_depth/depth_<hash>.png","cached":false}` after a pause; the second identical call returns `"cached":true` immediately. Open the written PNG and confirm it is a plausible greyscale depth map — near objects light, far objects dark.

- [ ] **Step 9: Commit**

```bash
git add frontend/server/utils/depthCache.ts frontend/server/api/depth/estimate.post.ts \
        frontend/server/middleware/comfyui-proxy.ts frontend/tests/unit/depth-cache.unit.spec.ts \
        frontend/package.json frontend/package-lock.json
git commit -m "feat(depth): local depth estimation endpoint with content-addressed cache"
```

---

### Task 4: Depth registry — async fetch, synchronous reads

Keeps the model call out of `paintLayer`. Depth readiness becomes state.

**Files:**
- Create: `frontend/app/lib/compositor/depthRegistry.ts`
- Test: `frontend/tests/unit/depth-registry.unit.spec.ts`

**Interfaces:**
- Consumes: `POST /api/depth/estimate` from Task 3.
- Produces:
  - `depthStatusFor(filename: string): 'idle' | 'loading' | 'ready' | 'error'`
  - `depthImageFor(filename: string): HTMLImageElement | null` — synchronous.
  - `requestDepth(filename: string): void` — fire and forget.
  - `onDepthChange(cb: () => void): () => void` — returns an unsubscribe.
  - `__resetDepthRegistry(): void` — test seam.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/depth-registry.unit.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  depthStatusFor, depthImageFor, requestDepth, onDepthChange, __resetDepthRegistry,
} from '~/lib/compositor/depthRegistry'

beforeEach(() => { __resetDepthRegistry(); vi.restoreAllMocks() })

describe('depthRegistry', () => {
  it('starts idle and reads synchronously as null', () => {
    expect(depthStatusFor('a.png')).toBe('idle')
    expect(depthImageFor('a.png')).toBeNull()
  })

  it('goes loading immediately on request, without awaiting', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    requestDepth('a.png')
    expect(depthStatusFor('a.png')).toBe('loading')
  })

  it('only fetches once per filename', () => {
    const f = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', f)
    requestDepth('a.png'); requestDepth('a.png'); requestDepth('a.png')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('records an error and notifies, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })))
    const seen = vi.fn()
    onDepthChange(seen)
    requestDepth('a.png')
    await vi.waitFor(() => expect(depthStatusFor('a.png')).toBe('error'))
    expect(seen).toHaveBeenCalled()
    expect(depthImageFor('a.png')).toBeNull()
  })

  it('unsubscribes cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const seen = vi.fn()
    onDepthChange(seen)()
    requestDepth('a.png')
    await vi.waitFor(() => expect(depthStatusFor('a.png')).toBe('error'))
    expect(seen).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:unit -- depth-registry
```

Expected: FAIL — cannot resolve `~/lib/compositor/depthRegistry`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/compositor/depthRegistry.ts`:

```ts
/**
 * Depth maps for image layers, held so that paintLayer can read them SYNCHRONOUSLY.
 *
 * paintLayer must never await. So depth readiness is state, not a render-time fetch:
 * a layer with no depth yet renders through unchanged, and subscribers re-render when
 * it arrives. One in-flight request per filename.
 */

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface Entry { status: Status; img: HTMLImageElement | null; message?: string }

let entries = new Map<string, Entry>()
let listeners = new Set<() => void>()

const notify = () => { for (const cb of [...listeners]) cb() }

export function depthStatusFor(filename: string): Status {
  return entries.get(filename)?.status ?? 'idle'
}

export function depthImageFor(filename: string): HTMLImageElement | null {
  const e = entries.get(filename)
  return e?.status === 'ready' ? e.img : null
}

export function depthMessageFor(filename: string): string {
  return entries.get(filename)?.message ?? ''
}

export function onDepthChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function fail(filename: string, message: string) {
  entries.set(filename, { status: 'error', img: null, message })
  notify()
}

export function requestDepth(filename: string): void {
  if (!filename) return
  const cur = entries.get(filename)
  if (cur && cur.status !== 'idle' && cur.status !== 'error') return

  entries.set(filename, { status: 'loading', img: null })
  notify()

  void (async () => {
    let depthFilename = ''
    try {
      const res = await fetch('/api/depth/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      if (!res.ok) return fail(filename, `depth request failed (${res.status})`)
      depthFilename = (await res.json())?.depthFilename ?? ''
      if (!depthFilename) return fail(filename, 'depth request returned no file')
    } catch (err) {
      return fail(filename, `depth request failed: ${(err as Error).message}`)
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { entries.set(filename, { status: 'ready', img }); notify() }
    img.onerror = () => fail(filename, 'depth map could not be decoded')
    img.src = `/view?filename=${encodeURIComponent(depthFilename)}&type=input`
  })()
}

/** Test seam — clears cached entries and subscribers. */
export function __resetDepthRegistry(): void {
  entries = new Map()
  listeners = new Set()
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:unit -- depth-registry
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/depthRegistry.ts frontend/tests/unit/depth-registry.unit.spec.ts
git commit -m "feat(compositor): depth registry keeping paintLayer synchronous"
```

---

### Task 5: WebGL2 post stage and the DOF pass

**Files:**
- Create: `frontend/app/lib/compositor/gpuPost.ts`
- Create: `frontend/app/lib/compositor/dofPass.ts`
- Test: `frontend/tests/unit/dof-pass.unit.spec.ts`

**Interfaces:**
- Consumes: `apertureOffsets`, `apertureRadiusPx` (Task 2); `DofEffect` (Task 1).
- Produces:
  - `class GpuPost { constructor(frag: string); available(): boolean; render(color, depth, w, h, uniforms): HTMLCanvasElement | null; runs: number }`
  - `DOF_FRAG: string`
  - `applyDof(color, depth, fx: DofEffect, W: number, w: number, h: number): HTMLCanvasElement | null`
  - `__dofRuns(): number` — assertion marker distinguishing "applied" from "silently skipped".

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/dof-pass.unit.spec.ts`. These tests cover what is testable without a GL context — the shader source contract and the skip logic. Pixel behaviour is verified in Task 7.

```ts
import { describe, it, expect } from 'vitest'
import { DOF_FRAG, dofShouldRun } from '~/lib/compositor/dofPass'
import { defaultPostEffect } from '~/lib/compositor/postEffects'
import type { DofEffect } from '~/lib/compositor/postEffects'

const dof = (p: Partial<DofEffect> = {}): DofEffect =>
  ({ ...(defaultPostEffect('dof') as DofEffect), ...p })

describe('DOF_FRAG', () => {
  it('is GLSL ES 3.00', () => {
    expect(DOF_FRAG.startsWith('#version 300 es')).toBe(true)
  })
  it('declares the uniforms the pass sets', () => {
    for (const u of ['uColor', 'uDepth', 'uFocus', 'uRange', 'uRadius',
                     'uBloomThreshold', 'uBloomStrength', 'uOffsets', 'uTapCount']) {
      expect(DOF_FRAG).toContain(u)
    }
  })
  it('accumulates in linear light — the bokeh-disc requirement', () => {
    expect(DOF_FRAG).toMatch(/toLinear/)
    expect(DOF_FRAG).toMatch(/toSrgb/)
  })
})

describe('dofShouldRun', () => {
  it('skips when invisible', () => {
    expect(dofShouldRun(dof({ visible: false }), true)).toBe(false)
  })
  it('skips at zero aperture — nothing to blur', () => {
    expect(dofShouldRun(dof({ aperture: 0 }), true)).toBe(false)
  })
  it('skips without a depth map rather than guessing', () => {
    expect(dofShouldRun(dof(), false)).toBe(false)
  })
  it('runs when visible, open and supplied with depth', () => {
    expect(dofShouldRun(dof({ aperture: 0.05 }), true)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:unit -- dof-pass
```

Expected: FAIL — cannot resolve `~/lib/compositor/dofPass`.

- [ ] **Step 3: Write the GL pass runner**

Create `frontend/app/lib/compositor/gpuPost.ts`:

```ts
/**
 * Minimal WebGL2 post stage for the Compositor. Modelled on lib/shaderfx/renderer.ts.
 *
 * The Compositor's post chain is Canvas 2D; this exists for effects that genuinely
 * cannot run there. Output is an offscreen canvas the 2D chain drawImage()s.
 *
 * TRAP: reading back from a WebGL canvas without forcing the frame to complete
 * returns STALE pixels. gl.finish() before returning is load-bearing, not defensive.
 */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

export class GpuPost {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private texColor: WebGLTexture | null = null
  private texDepth: WebGLTexture | null = null
  private failed = false
  /** Assertion marker: how many times a real GL draw happened. */
  runs = 0

  constructor(private frag: string) {}

  available(): boolean {
    this.init()
    return !this.failed && !!this.gl
  }

  private init() {
    if (this.gl || this.failed) return
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) { this.failed = true; return }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[gpuPost] shader compile failed:', gl.getShaderInfoLog(s))
        return null
      }
      return s
    }
    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, this.frag)
    if (!vs || !fs) { this.failed = true; return }

    const program = gl.createProgram()!
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[gpuPost] link failed:', gl.getProgramInfoLog(program))
      this.failed = true; return
    }

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const mkTex = () => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return t
    }
    this.canvas = canvas; this.gl = gl; this.program = program
    this.texColor = mkTex(); this.texDepth = mkTex()
  }

  render(
    color: CanvasImageSource, depth: CanvasImageSource,
    w: number, h: number,
    uniforms: Record<string, number | Float32Array>,
  ): HTMLCanvasElement | null {
    this.init()
    const { gl, program, canvas } = this
    if (this.failed || !gl || !program || !canvas) return null

    canvas.width = Math.max(1, Math.round(w))
    canvas.height = Math.max(1, Math.round(h))
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texColor)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, color as TexImageSource)
    gl.uniform1i(gl.getUniformLocation(program, 'uColor'), 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.texDepth)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depth as TexImageSource)
    gl.uniform1i(gl.getUniformLocation(program, 'uDepth'), 1)

    for (const [name, value] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(program, name)
      if (!loc) continue
      if (value instanceof Float32Array) gl.uniform2fv(loc, value)
      else gl.uniform1f(loc, value)
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.finish() // load-bearing: without it drawImage() reads stale pixels
    this.runs++
    return canvas
  }
}
```

- [ ] **Step 4: Write the DOF pass**

Create `frontend/app/lib/compositor/dofPass.ts`:

```ts
/**
 * Depth-of-field pass. Shaped-aperture, linear-light defocus driven by a depth map.
 *
 * The linear-light accumulation with a highlight boost is what turns bright
 * out-of-focus points into glowing DISCS. Blur in display gamma and they average away
 * into grey mush — "blurry photo" rather than "depth of field".
 *
 * Known limitation: occlusion bleed is mitigated (taps weighted by whether their own
 * CoC reaches the centre) but not solved. A correct fix needs layer separation.
 */
import { apertureOffsets, apertureRadiusPx, cocFor } from './dofMath'
import { GpuPost } from './gpuPost'
import type { DofEffect } from './postEffects'

const TAPS = 32

export const DOF_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform float uFocus;
uniform float uRange;
uniform float uRadius;          // max blur radius, in UV units
uniform float uBloomThreshold;
uniform float uBloomStrength;
uniform int   uTapCount;
uniform vec2  uOffsets[${TAPS}];

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

float coc(float depth) {
  return clamp(abs(depth - uFocus) - uRange * 0.5, 0.0, 1.0);
}

void main() {
  float centerCoc = coc(texture(uDepth, vUv).r);
  float radius = centerCoc * uRadius;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${TAPS}; i++) {
    if (i >= uTapCount) break;
    vec2 uv = vUv + uOffsets[i] * radius;
    vec3 c = toLinear(texture(uColor, uv).rgb);

    // Highlight boost BEFORE accumulation — this is what makes bokeh discs.
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if (lum > uBloomThreshold) c *= 1.0 + uBloomStrength * (lum - uBloomThreshold);

    // Mitigate bleed: a sharp sample should not smear onto a blurred centre.
    float sampleCoc = coc(texture(uDepth, uv).r);
    float w = clamp(sampleCoc / max(centerCoc, 1e-4), 0.0, 1.0);
    w = mix(0.15, 1.0, w);

    acc += c * w;
    wsum += w;
  }

  vec3 outc = wsum > 0.0 ? acc / wsum : toLinear(texture(uColor, vUv).rgb);
  fragColor = vec4(toSrgb(outc), texture(uColor, vUv).a);
}`

let pass: GpuPost | null = null
const getPass = () => (pass ??= new GpuPost(DOF_FRAG))

/** Whether the pass should run at all. Pure, so the skip logic is unit-testable. */
export function dofShouldRun(fx: DofEffect, hasDepth: boolean): boolean {
  return fx.visible !== false && fx.aperture > 0 && hasDepth
}

export function dofAvailable(): boolean {
  return getPass().available()
}

/** Assertion marker — distinguishes "DOF applied" from "DOF silently skipped". */
export function __dofRuns(): number {
  return getPass().runs
}

/**
 * @param W logical canvas width — `aperture` is normalized to it, so a 2x bake and
 *          the preview produce the same visual blur.
 */
export function applyDof(
  color: CanvasImageSource, depth: CanvasImageSource,
  fx: DofEffect, W: number, w: number, h: number,
): HTMLCanvasElement | null {
  if (!dofShouldRun(fx, true)) return null

  const offsets = apertureOffsets(TAPS, fx.bladeCount, fx.bladeRotation)
  const flat = new Float32Array(TAPS * 2)
  offsets.forEach((o, i) => { flat[i * 2] = o.x; flat[i * 2 + 1] = o.y })

  // Radius is normalized to canvas width, then expressed in UV units of this surface.
  const radiusUv = apertureRadiusPx(fx.aperture, W) / Math.max(1, w)

  return getPass().render(color, depth, w, h, {
    uFocus: fx.focus,
    uRange: fx.range,
    uRadius: radiusUv,
    uBloomThreshold: fx.bloomThreshold,
    uBloomStrength: fx.bloomStrength,
    uTapCount: TAPS,
    uOffsets: flat,
  })
}

export { cocFor }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd frontend && npm run test:unit -- dof-pass
```

Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/compositor/gpuPost.ts frontend/app/lib/compositor/dofPass.ts \
        frontend/tests/unit/dof-pass.unit.spec.ts
git commit -m "feat(compositor): WebGL2 post stage and shaped-aperture DOF pass"
```

---

### Task 6: Wire DOF into `paintLayer`

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`paintLayer`, from line 938)
- Test: `frontend/tests/unit/dof-paint.unit.spec.ts`

**Interfaces:**
- Consumes: `applyDof`, `dofShouldRun`, `dofAvailable` (Task 5); `depthImageFor`, `requestDepth` (Task 4); `isGpuEffect` (Task 1).
- Produces: `drawLayerContent` output for `kind: 'image'` layers is routed through the DOF pass when a visible `dof` effect and a depth map are both present.

Follow the existing corner-pin pattern in `paintLayer` (around lines 970-990): render content into a box-sized offscreen, transform it, then draw. DOF does the same, with the GL pass between.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/dof-paint.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dofShouldRun } from '~/lib/compositor/dofPass'
import { defaultPostEffect, isGpuEffect, isChainEffect } from '~/lib/compositor/postEffects'
import type { DofEffect } from '~/lib/compositor/postEffects'

describe('dof paint routing contract', () => {
  it('a dof effect never reaches the 2D chain filter', () => {
    const fx = [defaultPostEffect('dof'), defaultPostEffect('grain')]
    expect(fx.filter(isChainEffect).map(e => e.type)).toEqual(['grain'])
    expect(fx.filter(isGpuEffect).map(e => e.type)).toEqual(['dof'])
  })

  it('is inert until depth exists, so a layer always renders', () => {
    const d = defaultPostEffect('dof') as DofEffect
    expect(dofShouldRun(d, false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:unit -- dof-paint
```

Expected: PASS for the first test and FAIL only if Task 1/5 exports are missing. If both pass immediately, that is correct — this task's real verification is Steps 4-6.

- [ ] **Step 3: Wire the pass into `paintLayer`**

In `frontend/app/composables/useCompositorLayers.ts`, add to the imports:

```ts
import { applyDof, dofShouldRun, dofAvailable } from '~/lib/compositor/dofPass'
import { depthImageFor, requestDepth } from '~/lib/compositor/depthRegistry'
```

Inside `paintLayer`, alongside the existing `const shadow = ...` / `const blur = ...` lines (around line 943), add:

```ts
const dof = layer.kind === 'image'
  ? fx.find((e): e is DofEffect => e.type === 'dof')
  : undefined
```

Then wrap `drawContent`. Replace the body of `drawContent` so the non-DOF path is byte-identical to before:

```ts
const drawContent = (c: CanvasRenderingContext2D) => {
  if (dof && dofAvailable()) {
    const filename = (layer as ImageLayer).filename
    const depth = depthImageFor(filename)
    if (!depth) requestDepth(filename)
    if (dofShouldRun(dof, !!depth) && depth) {
      const box = localLayerBox(measureCtx(), layer, W, H)
      const bw = Math.max(1, Math.round(box.w)), bh = Math.max(1, Math.round(box.h))
      const src = document.createElement('canvas'); src.width = bw; src.height = bh
      const sctx = src.getContext('2d')
      if (sctx) {
        sctx.translate(bw / 2, bh / 2)
        drawLayerContent(sctx, layer, W)
        const out = applyDof(src, depth, dof, W, bw, bh)
        if (out) { c.drawImage(out, -bw / 2, -bh / 2, bw, bh); return }
      }
    }
  }
  if (!cp) { drawLayerContent(c, layer, W); return }
  // ...existing corner-pin branch unchanged...
}
```

Import `DofEffect` and `ImageLayer` types at the top of the file if not already in scope.

- [ ] **Step 4: Subscribe to depth arrival so the canvas re-renders**

In `CompositorModal.vue`, register `onDepthChange` on mount and call the existing repaint function, unsubscribing on unmount. Without this the layer stays unblurred until some other interaction forces a repaint.

- [ ] **Step 5: Run the full unit suite**

```bash
cd frontend && npm run test:unit
```

Expected: PASS, with no regressions in `compositor.unit.spec.ts` or `post-effects-paint.unit.spec.ts`.

- [ ] **Step 6: Verify in the running app**

Open the Compositor, drop in a photo with clear foreground/background separation, add the DOF effect. Expected: a brief computing state, then visible defocus. Drag `focus` from 0 to 1 and confirm the sharp band travels through the scene at interactive rates.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts \
        frontend/app/components/vue-canvas/CompositorModal.vue \
        frontend/tests/unit/dof-paint.unit.spec.ts
git commit -m "feat(compositor): route image layers through the DOF pass in paintLayer"
```

---

### Task 7: Panel controls, agent surface, and scale-parity proof

**Files:**
- Modify: `frontend/app/components/vue-canvas/PostEffectsControls.vue`
- Modify: `frontend/app/lib/agent/surfaces/compositor.ts`
- Modify: `frontend/app/lib/agent/studioTune.ts`
- Test: `frontend/tests/unit/dof-parity.unit.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: DOF sliders in the panel; DOF params reachable by the agent and round-tripping through `studioTune`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/dof-parity.unit.spec.ts`. This is the test that catches the bake/preview mismatch — the highest-consequence bug in this feature.

```ts
import { describe, it, expect } from 'vitest'
import { apertureRadiusPx, cocFor, apertureOffsets } from '~/lib/compositor/dofMath'

describe('bake/preview scale parity', () => {
  it('the same aperture covers the same FRACTION of the image at any scale', () => {
    const aperture = 0.03
    const preview = apertureRadiusPx(aperture, 1000) / 1000
    const bake = apertureRadiusPx(aperture, 3000) / 3000
    expect(preview).toBeCloseTo(bake, 12)
  })

  it('an un-normalized radius would NOT be scale-stable — guards the fix', () => {
    const fixedPx = 20
    expect(fixedPx / 1000).not.toBeCloseTo(fixedPx / 3000, 6)
  })
})

describe('agent-facing param sanity', () => {
  it('focus sweeps the sharp band across the full depth range', () => {
    expect(cocFor(0.1, 0.1, 0.1)).toBe(0)
    expect(cocFor(0.1, 0.9, 0.1)).toBeGreaterThan(0)
    expect(cocFor(0.9, 0.9, 0.1)).toBe(0)
  })
  it('blade count changes the iris shape', () => {
    expect(apertureOffsets(64, 6, 0)).not.toEqual(apertureOffsets(64, 0, 0))
  })
})
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd frontend && npm run test:unit -- dof-parity
```

Expected: PASS (4 tests). These assert properties of Task 2's code; they fail if a later change de-normalises the radius.

- [ ] **Step 3: Add the panel controls**

In `PostEffectsControls.vue`, add a `dof` branch following the existing `bloom` / `vignette` pattern exactly. Sliders, using the ranges from `POST_FX_PARAM_CLAMP.dof`:

- Focus (`focus`, 0-1), Sharp band (`range`, 0-1), Aperture (`aperture`, 0-1)
- Blades (`bladeCount`, 0-12, step 1), Blade angle (`bladeRotation`, 0-360)
- Highlight threshold (`bloomThreshold`, 0-1), Highlight boost (`bloomStrength`, 0-4)

Above the sliders, render depth state from `depthStatusFor(filename)`:
- `loading` → "Reading depth…"
- `error` → the message from `depthMessageFor`, plus a Retry that calls `requestDepth`
- WebGL2 unavailable (`!dofAvailable()`) → "Depth of field needs WebGL2, which this browser doesn't support." **Do not fall back to a 2D blur.**

Offer the DOF effect only when the selected layer is `kind: 'image'`.

- [ ] **Step 4: Expose DOF to the agent**

In `frontend/app/lib/agent/surfaces/compositor.ts`, add the seven DOF params to the control list following the existing post-effect entries. In `frontend/app/lib/agent/studioTune.ts`, ensure `dof` round-trips — the existing post-effect handling must not drop the new type. Confirm by tuning a DOF param through the agent path and reading it back.

- [ ] **Step 5: Run the full suite**

```bash
cd frontend && npm run test:unit
```

Expected: PASS.

- [ ] **Step 6: Verify the whole feature end to end**

In the running app: add DOF to a photo layer; confirm hexagonal bokeh at `bladeCount: 6` on a shot with bright background highlights; set `bladeCount: 0` and confirm the discs become circular; set `aperture: 0` and confirm the image is pixel-identical to no effect; export/bake at 2× and confirm the blur covers the same fraction of the frame as the preview.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/PostEffectsControls.vue \
        frontend/app/lib/agent/surfaces/compositor.ts \
        frontend/app/lib/agent/studioTune.ts \
        frontend/tests/unit/dof-parity.unit.spec.ts
git commit -m "feat(compositor): DOF panel controls, agent surface and scale-parity tests"
```

---

## Self-review notes

**Spec coverage.** Endpoint + cache → Task 3. GPU stage → Task 5. Shader with linear-light bloom and blade polygon → Task 5. Chain position (DOF applied to content before the 2D chain) → Task 6. `GPU_TYPES` disjoint from `CHAIN_TYPES` → Task 1, asserted in Tasks 1 and 6. Aperture normalisation → Task 2, asserted in Task 7. Synchronous render → Task 4. No silent fallbacks → Task 7 Step 3. Bake parity via the single `paintLayer` choke point → Task 6. Persistence (params only, depth derived) → Task 4, which holds depth outside layer state.

**Known gap, deliberate.** The spec asks for a visual test that renders at `aperture: 0` versus maximum and diffs pixels. That needs a real GL context, so it lives in Task 7 Step 6 as a manual check rather than an automated one. If this is later moved into Playwright, the assertion must include the inverse: deliberately break the depth binding and confirm the test *fails*. A visual test that passes while the feature is disconnected proves nothing.
