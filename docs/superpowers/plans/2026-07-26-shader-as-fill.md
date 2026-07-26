# Shader as Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a shader a legal *fill*, so the 63-effect catalog can be poured into glyphs, shapes, brush strokes, frame backgrounds, and 3D surfaces — alive, and anchored either to the object or to the frame.

**Architecture:** One new `FillType` (`'shader'`) whose spec nests another `Fill` as its input, making `Fill` recursive at depth 1. A new `lib/shaderfill/` module is the single place that turns a shader fill into pixels, backed by a descriptor-keyed LRU so N shapes sharing one fill cost one render. Four consumers hook it: Space Type (`fillShaderTexture`), Shape Studio (free — it delegates to Space Type), the Compositor (`resolveFill`), and Scene3D (`materialFor`). Rendering reuses the existing `shaderFx` WebGL singleton via a readback bridge; the context-agnostic renderer is explicitly out of scope.

**Tech Stack:** TypeScript, Nuxt 4 / Vue 3, three.js 0.171, raw WebGL2 (`lib/shaderfx/renderer.ts`), Canvas2D, vitest (unit), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-07-26-shader-as-fill-design.md`

## Global Constraints

- Unit tests run in **node environment** (`vitest.config.ts`) — no `document`, no `HTMLCanvasElement`, no WebGL. Any module imported by a `.unit.spec.ts` must not touch the DOM or import `three` at module scope.
- `lib/spacetype/fillTile.ts` is **CPU-only by contract** (see its header comment). Do not import `three` or `lib/shaderfx` into it.
- Control keys under `fill.shader.*` are **frozen** once shipped — Collection bindings persist them. Only `fill.shader.p.<paramId>` is derived/dynamic.
- Depth-1 nesting is **absolute**: a shader fill's `input` must never itself be a shader fill.
- Never cap silently — when the live-field ceiling is hit, surface a visible hint.
- three is pinned at `0.171.0`. `THREE.ExternalTexture` does **not** exist; do not use it.
- Commit style: `feat(shaderfill): ...` / `test(shaderfill): ...`. Stage only the paths a task touches — other sessions have work in this tree.
- Run unit tests with `npm run test:unit` from `frontend/`.

---

### Task 0: Readback spike (go / no-go)

**This task gates the whole plan.** If it fails, stop and escalate — the batching assumption is wrong and the design needs approach C.

**Files:**
- Create: `frontend/app/pages/dev/shaderfill-bench.vue`

**Interfaces:**
- Consumes: `shaderFx` from `~/lib/shaderfx/renderer`, `fetchShaderFxCatalog` from `~/lib/shaderfx/catalog`
- Produces: nothing consumed by later tasks — a measurement and a decision

- [ ] **Step 1: Build the bench page**

Model it on the existing `frontend/app/pages/dev/shader-bake-bench.vue`. It must: pick one animated effect from the catalog, render a 512×512 field via `shaderFx.render()` every animation frame, blit it into a 2D canvas with `drawImage`, upload it to a `THREE.CanvasTexture` on a spinning textured quad in a separate `THREE.WebGLRenderer`, and display a rolling 120-frame average of (a) total frame time and (b) time spent in the blit alone.

```vue
<script setup lang="ts">
import * as THREE from 'three'
import { shaderFx } from '~/lib/shaderfx/renderer'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'

const stats = ref({ frame: 0, blit: 0, fields: 1 })
// ...render loop: for (i of fields) { shaderFx.render(passes, base, 512, 512); t0=performance.now(); ctx.drawImage(shaderFx.canvas,0,0); blit += performance.now()-t0 }
</script>
```

Add a control for **number of distinct fields per frame** (1, 2, 4, 8) so the ceiling in Task 2 is chosen from data rather than guessed.

- [ ] **Step 2: Measure**

Run the dev server and open `/dev/shaderfill-bench`. Record frame time and blit time at 1, 2, 4 and 8 distinct fields.

**Pass condition:** 2 distinct 512² fields sustain ≥30fps with total frame time under 33ms.

- [ ] **Step 3: Record the result and set the ceiling**

Write the measured numbers into the spec under Risks, replacing "the readback is unmeasured". Choose `LIVE_FIELD_CEILING` from the data (the largest N that held 30fps), which Task 2 will encode.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/dev/shaderfill-bench.vue docs/superpowers/specs/2026-07-26-shader-as-fill-design.md
git commit -m "perf(shaderfill): readback spike bench + measured field ceiling"
```

**If the pass condition fails:** stop. Do not continue to Task 1. Report the numbers and reopen the renderer decision.

---

### Task 1: The recursive Fill model

**Files:**
- Modify: `frontend/app/lib/spacetype/fillTile.ts:11-19` (type, `FILL_TYPES`, `DEFAULT_FILL`), `:32+` (`normalizeFill`)
- Modify: `frontend/tests/unit/compositor-fills.unit.spec.ts:38` (the frozen `FILL_TYPES` assertion)
- Create: `frontend/tests/unit/shader-fill-model.unit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FillType = 'solid'|'gradient'|'ombre'|'grid'|'noise'|'checkerboard'|'stripes'|'qr'|'shader'
  export interface ShaderSpec {
    effectId: string
    params: Record<string, number>
    anchor: 'object' | 'frame'
    speed: number
    input: Fill                    // never type 'shader'
  }
  export interface Fill { type: FillType; a: string; b: string; textColor: string; angle: number; density: number; shader?: ShaderSpec }
  export const DEFAULT_SHADER_SPEC: ShaderSpec
  export function fillIsShader(f: Fill): f is Fill & { shader: ShaderSpec }
  ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/shader-fill-model.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  type Fill, FILL_TYPES, DEFAULT_FILL, DEFAULT_SHADER_SPEC,
  normalizeFill, parseFills, fillIsShader,
} from '~/lib/spacetype/fillTile'

const shaderFill = (over: Partial<Fill> = {}): Fill => ({
  ...DEFAULT_FILL, type: 'shader', shader: { ...DEFAULT_SHADER_SPEC }, ...over,
})

describe('shader fill model', () => {
  it('shader is the ninth fill type, appended so picker order is stable', () => {
    expect(FILL_TYPES).toEqual(['solid','gradient','ombre','grid','noise','checkerboard','stripes','qr','shader'])
  })

  it('fillIsShader narrows only a shader fill carrying a spec', () => {
    expect(fillIsShader(shaderFill())).toBe(true)
    expect(fillIsShader({ ...DEFAULT_FILL })).toBe(false)
    expect(fillIsShader({ ...DEFAULT_FILL, type: 'shader' })).toBe(false) // type without spec
  })

  it('normalizeFill fills a default spec when type is shader but spec is missing', () => {
    const n = normalizeFill({ type: 'shader' })
    expect(n.type).toBe('shader')
    expect(n.shader).toEqual(DEFAULT_SHADER_SPEC)
  })

  it('normalizeFill drops a spec when the type is not shader', () => {
    const n = normalizeFill({ type: 'grid', shader: { ...DEFAULT_SHADER_SPEC } })
    expect(n.shader).toBeUndefined()
  })

  it('enforces depth-1: a nested shader input collapses to its own input', () => {
    const nested = normalizeFill({
      type: 'shader',
      shader: { ...DEFAULT_SHADER_SPEC, input: { ...DEFAULT_FILL, type: 'shader', shader: { ...DEFAULT_SHADER_SPEC } } },
    })
    expect(nested.shader!.input.type).not.toBe('shader')
    expect(nested.shader!.input.shader).toBeUndefined()
  })

  it('coerces a junk spec rather than throwing', () => {
    const n = normalizeFill({ type: 'shader', shader: { effectId: 42, anchor: 'sideways', speed: 'fast', params: null } })
    expect(n.shader!.effectId).toBe(DEFAULT_SHADER_SPEC.effectId)
    expect(n.shader!.anchor).toBe('object')
    expect(typeof n.shader!.speed).toBe('number')
    expect(n.shader!.params).toEqual({})
  })

  it('round-trips through parseFills (the save/reload path)', () => {
    const original = shaderFill({
      shader: { effectId: 'kaleidoscope', params: { segments: 6 }, anchor: 'frame', speed: 0.5,
                input: { ...DEFAULT_FILL, type: 'gradient', a: '#ff0000' } },
    })
    const [back] = parseFills(JSON.stringify([original]))
    expect(back).toEqual(original)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shader-fill-model.unit.spec.ts`
Expected: FAIL — `DEFAULT_SHADER_SPEC` and `fillIsShader` are not exported.

- [ ] **Step 3: Implement in `fillTile.ts`**

```ts
export type FillType = 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise' | 'checkerboard' | 'stripes' | 'qr' | 'shader'

/** A shader fill runs `input` through a catalog effect. `input` is NEVER itself a shader
 *  fill — depth-1 is enforced in normalizeFill, because unbounded nesting hangs the renderer. */
export interface ShaderSpec {
  effectId: string
  params: Record<string, number>
  anchor: 'object' | 'frame'
  speed: number
  input: Fill
}

export interface Fill {
  type: FillType; a: string; b: string; textColor: string; angle: number; density: number
  shader?: ShaderSpec
}

export const FILL_TYPES: FillType[] = ['solid','gradient','ombre','grid','noise','checkerboard','stripes','qr','shader']

export const DEFAULT_SHADER_SPEC: ShaderSpec = {
  effectId: 'fbm_warp', params: {}, anchor: 'object', speed: 1,
  input: { type: 'gradient', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 },
}

export function fillIsShader(f: Fill): f is Fill & { shader: ShaderSpec } {
  return f.type === 'shader' && !!f.shader
}
```

Then extend `normalizeFill`. Add a `depth` parameter defaulting to 0 — at depth 1 the shader type is refused outright, which is what collapses a nested stack:

```ts
export function normalizeFill(f: unknown, depth = 0): Fill {
  const o = (f ?? {}) as Record<string, unknown>
  let type = FILL_TYPES.includes(o.type as FillType) ? (o.type as FillType) : 'solid'
  // Depth-1 guard: an input fill may not itself be a shader fill.
  if (type === 'shader' && depth > 0) type = DEFAULT_SHADER_SPEC.input.type
  const base: Fill = {
    type,
    a: typeof o.a === 'string' ? o.a : '#ffffff',
    b: typeof o.b === 'string' ? o.b : '#000000',
    textColor: typeof o.textColor === 'string' ? o.textColor : '#ffffff',
    angle: Number.isFinite(o.angle) ? (o.angle as number) : 45,
    density: Number.isFinite(o.density) ? (o.density as number) : 8,
  }
  if (type !== 'shader') return base            // a spec on a non-shader fill is dropped
  return { ...base, shader: normalizeShaderSpec(o.shader, depth) }
}

function normalizeShaderSpec(s: unknown, depth: number): ShaderSpec {
  const o = (s ?? {}) as Record<string, unknown>
  const params: Record<string, number> = {}
  if (o.params && typeof o.params === 'object') {
    for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) {
      if (Number.isFinite(v)) params[k] = v as number
    }
  }
  return {
    effectId: typeof o.effectId === 'string' && o.effectId ? o.effectId : DEFAULT_SHADER_SPEC.effectId,
    params,
    anchor: o.anchor === 'frame' ? 'frame' : 'object',
    speed: Number.isFinite(o.speed) ? (o.speed as number) : 1,
    input: normalizeFill(o.input ?? DEFAULT_SHADER_SPEC.input, depth + 1),
  }
}
```

Keep the existing `angle`/`density` coercion behaviour if it differs from the above — match what is already in the file rather than changing it.

- [ ] **Step 4: Update the frozen assertion in the existing test**

In `frontend/tests/unit/compositor-fills.unit.spec.ts`, change the `FILL_TYPES` expectation to include `'shader'` as the ninth entry. Do **not** reorder the first eight — picker order is user-visible.

- [ ] **Step 5: Run all unit tests**

Run: `cd frontend && npm run test:unit`
Expected: PASS, including the two fill spec files.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/fillTile.ts frontend/tests/unit/shader-fill-model.unit.spec.ts frontend/tests/unit/compositor-fills.unit.spec.ts
git commit -m "feat(shaderfill): recursive Fill model with depth-1 guard"
```

---

### Task 2: Field descriptor — keys, time quantisation, ceiling

**Files:**
- Create: `frontend/app/lib/shaderfill/descriptor.ts`
- Create: `frontend/tests/unit/shaderfill-descriptor.unit.spec.ts`

**Interfaces:**
- Consumes: `ShaderSpec`, `Fill` from `~/lib/spacetype/fillTile`
- Produces:
  ```ts
  export function quantizeTime(t: number, fps: number): number
  export function fieldKey(spec: ShaderSpec, w: number, h: number, tq: number): string
  export const LIVE_FIELD_CEILING: number
  export function planFields(keys: string[]): { live: string[]; frozen: string[] }
  ```

This module is **pure** — no canvas, no GL, no three — so it is unit-testable in the node environment.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/shaderfill-descriptor.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_FILL, DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { quantizeTime, fieldKey, planFields, LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'

const spec = (o: Partial<ShaderSpec> = {}): ShaderSpec => ({ ...DEFAULT_SHADER_SPEC, ...o })

describe('quantizeTime', () => {
  it('snaps to the host frame interval', () => {
    expect(quantizeTime(0.51, 30)).toBeCloseTo(0.5)     // 15.3 -> 15 frames
    expect(quantizeTime(0.51, 60)).toBeCloseTo(0.5)     // 30.6 -> 30 frames
    expect(quantizeTime(0.52, 60)).toBeCloseTo(0.5167)  // 31.2 -> 31 frames
  })
  it('uses the host fps rather than a fixed 30 — a 60fps bake gets 60 distinct fields', () => {
    const at30 = new Set([0.50, 0.51, 0.52, 0.53].map(t => quantizeTime(t, 30)))
    const at60 = new Set([0.50, 0.51, 0.52, 0.53].map(t => quantizeTime(t, 60)))
    expect(at60.size).toBeGreaterThan(at30.size)
  })
})

describe('fieldKey', () => {
  it('is stable for identical descriptors — this is what makes batching work', () => {
    expect(fieldKey(spec(), 512, 512, 0.5)).toBe(fieldKey(spec(), 512, 512, 0.5))
  })
  it('separates on effect, params, anchor, size and time', () => {
    const base = fieldKey(spec(), 512, 512, 0.5)
    expect(fieldKey(spec({ effectId: 'droste' }), 512, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec({ params: { segments: 6 } }), 512, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec({ anchor: 'frame' }), 512, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec(), 256, 512, 0.5)).not.toBe(base)
    expect(fieldKey(spec(), 512, 512, 0.6)).not.toBe(base)
  })
  it('includes the input fill — gradient-in differs from grid-in', () => {
    const a = fieldKey(spec({ input: { ...DEFAULT_FILL, type: 'gradient' } }), 512, 512, 0)
    const b = fieldKey(spec({ input: { ...DEFAULT_FILL, type: 'grid' } }), 512, 512, 0)
    expect(a).not.toBe(b)
  })
  it('ignores param key ORDER so two equal descriptors share one field', () => {
    const a = fieldKey(spec({ params: { a: 1, b: 2 } }), 512, 512, 0)
    const b = fieldKey(spec({ params: { b: 2, a: 1 } }), 512, 512, 0)
    expect(a).toBe(b)
  })
  it('drops time entirely when speed is 0, so a frozen field caches once', () => {
    const frozen = spec({ speed: 0 })
    expect(fieldKey(frozen, 512, 512, 0)).toBe(fieldKey(frozen, 512, 512, 99))
  })
})

describe('planFields', () => {
  it('keeps the first N distinct keys live and freezes the rest', () => {
    const keys = Array.from({ length: LIVE_FIELD_CEILING + 3 }, (_, i) => `k${i}`)
    const { live, frozen } = planFields(keys)
    expect(live.length).toBe(LIVE_FIELD_CEILING)
    expect(frozen.length).toBe(3)
  })
  it('deduplicates — ten shapes sharing one descriptor cost one live field', () => {
    const { live, frozen } = planFields(['same','same','same','same','same','same'])
    expect(live).toEqual(['same'])
    expect(frozen).toEqual([])
  })
  it('never silently truncates — every key lands in exactly one bucket', () => {
    const keys = ['a','b','c','d','e','f','g']
    const { live, frozen } = planFields(keys)
    expect([...live, ...frozen].sort()).toEqual([...new Set(keys)].sort())
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shaderfill-descriptor.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/shaderfill/descriptor`.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/shaderfill/descriptor.ts`:

```ts
/**
 * Pure descriptor logic for shader fills — cache keys, time quantisation, and the
 * live-field budget. Deliberately free of canvas/GL/three so it is unit-testable in
 * the node environment; all rendering lives in ./field.ts.
 */
import type { Fill, ShaderSpec } from '~/lib/spacetype/fillTile'

/** Chosen from the Task 0 bench: the most distinct live fields that held 30fps. */
export const LIVE_FIELD_CEILING = 4

/** Snap time to the HOST's frame interval, not a fixed constant — a 60fps bake must
 *  get 60 distinct fields per second or the fill stutters against everything else. */
export function quantizeTime(t: number, fps: number): number {
  const f = fps > 0 ? fps : 30
  return Math.floor(t * f) / f
}

function inputKey(f: Fill): string {
  return `${f.type}|${f.a}|${f.b}|${f.angle}|${f.density}`
}

function paramsKey(p: Record<string, number>): string {
  return Object.keys(p).sort().map(k => `${k}=${p[k]}`).join(',')
}

/** Fields are keyed by DESCRIPTOR, not by consumer. That is the whole batching rule:
 *  ten shapes sharing one shader fill produce one key and therefore one render. */
export function fieldKey(spec: ShaderSpec, w: number, h: number, tq: number): string {
  const t = spec.speed === 0 ? 'static' : String(tq)
  return [spec.effectId, paramsKey(spec.params), spec.anchor, spec.speed,
          inputKey(spec.input), `${w}x${h}`, t].join('|')
}

/** Split distinct field keys into those rendered live and those frozen at t=0.
 *  Callers MUST surface a hint when `frozen` is non-empty — never truncate silently. */
export function planFields(keys: string[]): { live: string[]; frozen: string[] } {
  const distinct = [...new Set(keys)]
  return { live: distinct.slice(0, LIVE_FIELD_CEILING), frozen: distinct.slice(LIVE_FIELD_CEILING) }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shaderfill-descriptor.unit.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderfill/descriptor.ts frontend/tests/unit/shaderfill-descriptor.unit.spec.ts
git commit -m "feat(shaderfill): descriptor keys, time quantisation, field budget"
```

---

### Task 3: The field renderer

**Files:**
- Create: `frontend/app/lib/shaderfill/field.ts`
- Modify: `frontend/app/pages/dev/shaderfill-bench.vue` (drive it through `resolveField` instead of raw `shaderFx`)

**Interfaces:**
- Consumes: `fieldKey`, `quantizeTime`, `planFields` from `./descriptor`; `shaderFx` from `~/lib/shaderfx/renderer`; `getEffect` from `~/lib/shaderfx/catalog`; `fillTileCanvas` from `~/lib/spacetype/fillTile`
- Produces:
  ```ts
  export interface FieldRequest { spec: ShaderSpec; w: number; h: number; t: number; fps: number }
  export function resolveField(req: FieldRequest): HTMLCanvasElement | null
  export function beginFieldFrame(requests: FieldRequest[]): { frozenCount: number }
  export function clearFieldCache(): void
  ```

Not unit-testable — it touches canvas and WebGL. Verified through the bench page and the Playwright pass in Task 10.

- [ ] **Step 1: Implement the module**

```ts
/**
 * Turns a ShaderFill into pixels — the ONLY place in the product that does so.
 * Every surface (Space Type, Shape Studio, frames, Scene3D) goes through here, which
 * is what keeps bake and preview from drifting: same function, different resolution.
 *
 * Rendering is a readback bridge: the shared `shaderFx` WebGL2 singleton renders the
 * field, and we blit its canvas into a per-field 2D canvas. shaderFx's own canvas is
 * only valid until the next call, so the blit MUST happen before anything else renders.
 */
import { fillTileBox, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { shaderFx, expandPasses, type Uniforms } from '~/lib/shaderfx/renderer'
import { getEffect } from '~/lib/shaderfx/catalog'
import { fieldKey, quantizeTime, planFields } from './descriptor'

export interface FieldRequest {
  spec: ShaderSpec; w: number; h: number; t: number; fps: number
  /** Bake renders at the requested size; live playback is clamped to LIVE_FIELD_PX. */
  bake?: boolean
}

const CACHE_MAX = 32
/** Live fields are capped so an on-canvas node cannot ask for a 4K readback per frame.
 *  Bakes opt out via `bake: true` — same function, same time, different resolution,
 *  which is what keeps preview and bake from drifting. */
const LIVE_FIELD_PX = 512

function fieldSize(req: FieldRequest): { w: number; h: number } {
  if (req.bake) return { w: req.w, h: req.h }
  const k = Math.min(1, LIVE_FIELD_PX / Math.max(req.w, req.h, 1))
  return { w: Math.max(1, Math.round(req.w * k)), h: Math.max(1, Math.round(req.h * k)) }
}
const cache = new Map<string, HTMLCanvasElement>()
let liveKeys = new Set<string>()

/** Call once per host frame with every field the frame wants. Decides which stay live
 *  and which freeze, so the ceiling is applied per surface per frame. */
export function beginFieldFrame(requests: FieldRequest[]): { frozenCount: number } {
  const keys = requests.map(r => {
    const { w, h } = fieldSize(r)
    return fieldKey(r.spec, w, h, quantizeTime(r.t, r.fps))
  })
  const { live, frozen } = planFields(keys)
  liveKeys = new Set(live)
  return { frozenCount: frozen.length }
}

export function resolveField(req: FieldRequest): HTMLCanvasElement | null {
  const { spec } = req
  const { w, h } = fieldSize(req)
  const tq = quantizeTime(req.t, req.fps)
  const liveKey = fieldKey(spec, w, h, tq)
  // Not live this frame -> fall back to the frozen (t=0) variant of the same descriptor.
  const key = liveKeys.size === 0 || liveKeys.has(liveKey) ? liveKey : fieldKey(spec, w, h, 0)
  const hit = cache.get(key)
  if (hit) return hit

  const effect = getEffect(spec.effectId)
  if (!effect) return null                       // caller falls back to the input fill

  // The shader's input image is the nested fill, rasterised on the CPU.
  const base = fillTileBox(spec.input, w, h)
  const t = spec.speed === 0 ? 0 : tq * spec.speed
  // Defaults first, then the user's params — an effect switch can leave stale keys,
  // and an unknown key must not shadow a real default.
  const uniforms: Uniforms = { u_time: t, u_seed: 42, u_hasInput: 1 }
  for (const p of effect.params) uniforms[`u_${p.key}`] = p.default as number
  for (const [k, v] of Object.entries(spec.params)) {
    if (effect.params.some(p => p.key === k)) uniforms[`u_${k}`] = v
  }

  let rendered: HTMLCanvasElement
  try {
    // render() RETURNS the canvas, valid only until the next render call.
    rendered = shaderFx.render(expandPasses(effect.id, effect.source, uniforms, undefined, effect.passes ?? 1), base, w, h)
  } catch {
    return null                                  // context loss -> input fill
  }
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  out.getContext('2d')!.drawImage(rendered, 0, 0)   // must precede the next shaderFx call

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value          // Map preserves insertion order
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, out)
  return out
}

export function clearFieldCache(): void { cache.clear(); liveKeys = new Set() }
```

Verified signatures this code depends on — do not guess at these:

- `shaderFx.render(passes: ShaderPass[], base: TexImageSource, width: number, height: number): HTMLCanvasElement` (`lib/shaderfx/renderer.ts:229`) — **returns** the canvas; also exposed as `get outputCanvas()` at `:227`. Valid only until the next `render` call.
- `expandPasses(id, source, uniforms, textures, passCount): ShaderPass[]` (`:30`).
- `fillTileBox(fill: Fill, w: number, h: number): HTMLCanvasElement` (`lib/spacetype/fillTile.ts:149`) — the box-sized builder. `fillTileCanvas(fill, size)` at `:107` is square-only; do not use it here.
- The uniform trio every effect expects — `u_time`, `u_seed`, `u_hasInput` — matches how `lib/shaderstudio/passes.ts:34` composes its own passes. Follow that file rather than inventing a second convention.

**Effect params are prefixed `u_` as uniforms but stored unprefixed as keys.** Keep `spec.params` unprefixed (that is what the control schema in Task 8 addresses as `fill.shader.p.<key>`) and prefix only at the uniform boundary, as above.

- [ ] **Step 2: Point the bench at it**

Replace the raw `shaderFx` loop in `frontend/app/pages/dev/shaderfill-bench.vue` with `beginFieldFrame(...)` + `resolveField(...)` per field. Verify the measured numbers from Task 0 are unchanged within noise — if the cache is working, N identical descriptors should now cost the same as one.

- [ ] **Step 3: Verify batching visibly**

On the bench, set 8 fields with **identical** descriptors. Expected: frame time matches the 1-field case, because `fieldKey` collapses them. This is the load-bearing claim of the design — confirm it before building on it.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/shaderfill/field.ts frontend/app/pages/dev/shaderfill-bench.vue
git commit -m "feat(shaderfill): descriptor-batched field renderer over the shaderFx bridge"
```

---

### Task 4: Space Type consumer (object anchor)

**Files:**
- Modify: `frontend/app/lib/spacetype/fills.ts:74-95` (`fillShaderTexture`)
- Modify: `frontend/app/lib/spacetype/engine.ts` (per-frame `needsUpdate` for a live fill texture)

**Interfaces:**
- Consumes: `resolveField`, `beginFieldFrame` from `~/lib/shaderfill/field`
- Produces: a `THREE.CanvasTexture` bound to the existing `uFill` sampler — no new uniform yet; frame anchor arrives in Task 5

- [ ] **Step 1: Add the shader branch to the fill texture builder**

In `fills.ts`, where the fill type is switched to build a texture, add:

```ts
if (fillIsShader(fill)) {
  const canvas = resolveField({ spec: fill.shader, w: size, h: size, t: nowSeconds, fps: 30 })
  if (!canvas) return fillTexture(fill.shader.input)   // graceful fallback to the input fill
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}
```

Keep the existing 1×1-swatch behaviour for `solid` untouched — every other consumer depends on every fill resolving to *some* texture.

- [ ] **Step 2: Drive it per frame**

In the Space Type render loop, before the THREE render, call `beginFieldFrame` with the frame's shader fills, re-resolve the field, assign it to the material's `uFill` value, and set `needsUpdate = true`. Reuse the existing texture object where the canvas identity is unchanged so the GPU upload is skipped on cache hits.

- [ ] **Step 3: Hand-verify in the running app**

Start the dev server (`./dev.sh`), open a Space Type node, set a fill to `shader`, pick an animated effect. Expected: the glyph interior is filled with a moving field; the letters still animate independently.

- [ ] **Step 4: Confirm Shape Studio inherited it for free**

Open a Shape Studio node in surface mode and set the same fill. Expected: it works with **zero** code changes, because `shapefx/surface.ts:23` delegates to `fillTexture()`. If it does not, stop — the single-door claim is wrong and the design needs revisiting.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/fills.ts frontend/app/lib/spacetype/engine.ts
git commit -m "feat(shaderfill): Space Type + Shape Studio object-anchored shader fills"
```

---

### Task 5: Frame anchor across the Space Type effect shaders

**Files:**
- Modify: the **14** files under `frontend/app/lib/spacetype/effects/` that declare `uFill` —
  `ball.ts contour.ts cornerPin.ts coil.ts elastic.ts field.ts onionburst.ts shutter.ts ribbon.ts melt.ts ticker.ts stripes.ts tunnel.ts turntable.ts`
- Modify: `frontend/app/lib/spacetype/fills.ts` (supply the two new uniforms)

> **Corrected 2026-07-26:** an earlier draft said "~28 files". That conflated *effects using
> `ShaderMaterial`* with *effects declaring `uFill`*. The binding number is **14**, verified by
> `grep -l "uFill" *.ts`.

> **⚠ All 14 of these files currently carry uncommitted changes from a parallel session.**
> Stage **only your own hunks** — `git apply --cached` per-hunk, never `git add <file>`, never
> `git stash`. Verify with `git diff --cached` before committing that no foreign hunk is staged.

**Interfaces:**
- Consumes: nothing new
- Produces: every `uFill`-declaring effect honours `uFillAnchor` (0 = object, 1 = frame)

This is the largest chunk and is **mechanical** — good work for parallel subagents, one batch of effects each.

- [ ] **Step 1: Enumerate the affected files**

```bash
cd frontend/app/lib/spacetype/effects && grep -l "uFill" *.ts
```

Record the exact list in the commit message. Every file in it gets the identical edit.

- [ ] **Step 2: Apply the convention to one file first**

Pick `shutter.ts`. Add to the uniform block (near `:113`):

```glsl
uniform float uFillAnchor;   // 0 = object (glyph UV), 1 = frame (screen space)
uniform vec2  uFillScreen;   // render target resolution, for the frame branch
```

and change the fill sampling inside `fillColor()` (near `:134`) from the existing `uv * uFillTiling` form to:

```glsl
vec2 fillUv = uFillAnchor > 0.5 ? gl_FragCoord.xy / uFillScreen : uv * uFillTiling;
```

leaving the rest of the function untouched. Bind both uniforms in the `ShaderMaterial` (near `:221`).

- [ ] **Step 3: Verify the one file before fanning out**

In the app, toggle anchor on a Space Type node using the shutter effect. Expected: object-anchor is unchanged from Task 4; frame-anchor holds the field still while the letters move across it.

**Do not proceed until this is visually confirmed** — 28 files with a wrong convention is 28 files to redo.

- [ ] **Step 4: Fan out to the remaining effects**

Apply the identical edit to every remaining file from Step 1. Supply `uFillAnchor` and `uFillScreen` centrally from `fills.ts` so no effect invents its own default.

- [ ] **Step 5: Sweep for misses**

```bash
cd frontend/app/lib/spacetype/effects && for f in $(grep -l "uFill" *.ts); do grep -L "uFillAnchor" $f; done
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects frontend/app/lib/spacetype/fills.ts
git commit -m "feat(shaderfill): uFillAnchor convention across Space Type effect shaders"
```

---

### Task 6: Frames — shader fills on every primitive

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts:594-629` (replace `fillTileCached`, extend `resolveFill`)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue:1475` (per-frame `beginFieldFrame`)

**Interfaces:**
- Consumes: `resolveField`, `beginFieldFrame` from `~/lib/shaderfill/field`
- Produces: `resolveFill` returns a `CanvasPattern` over a shader field for `type === 'shader'`

Because every primitive already funnels through `resolvePaint` — rect `:1104`, ellipse `:1112`, line `:1135`, brush `:1171`, text `:1219`/`:1221`, expressive text `:1292`/`:1294`, path `:1339`, background `:1429`, with polygon and star delegating to `drawPath` — this single branch reaches all of them.

- [ ] **Step 1: Extend `resolveFill`**

```ts
if (fillIsShader(fill)) {
  const frame = fill.shader.anchor === 'frame'
  // Frame anchor renders ONE field at frame size that every shape samples; object
  // anchor renders per box, as the existing tile path does.
  const fw = frame ? frameW : tw, fh = frame ? frameH : th
  const canvas = resolveField({ spec: fill.shader, w: fw, h: fh, t: playheadSeconds, fps: 30 })
  if (!canvas) return resolveFill(ctx, fill.shader.input, box)   // fallback: the input fill
  const pat = ctx.createPattern(canvas, 'no-repeat')
  if (!pat) return fill.shader.input.a
  if (typeof DOMMatrix !== 'undefined' && pat.setTransform) {
    pat.setTransform(frame
      // frame space: undo the layer transform so the field stays put under moving shapes
      ? new DOMMatrix().translateSelf(-frameW / 2, -frameH / 2)
      : new DOMMatrix().translateSelf(-bw / 2, -bh / 2).scaleSelf(bw / fw, bh / fh))
  }
  return pat
}
```

The frame-anchor matrix must be composed against the current `ctx.getTransform()` so the field is fixed in frame space rather than in the layer's local space — read the transform the same way the existing code does at `:620`.

- [ ] **Step 2: Retire the stale tile cache for shader fills**

`fillTileCached` (`:601`) keys on `type|a|b|angle|density|WxH` with no time and clears wholesale at 64 entries — an animated fill would miss every frame and evict every other layer's tile. Route shader fills to the field cache instead and leave the tile cache serving the other eight types unchanged.

- [ ] **Step 3: Call `beginFieldFrame` once per rendered frame**

In `CompositorModal.vue`, before rendering a frame, collect the shader fills across all layers and call `beginFieldFrame`. When `frozenCount > 0`, show a visible hint ("N shader fills frozen — too many live at once"). **Never let it be silent.**

- [ ] **Step 4: Hand-verify**

In a frame: fill a rectangle, a text layer, a brush stroke and the background with the same shader fill on `frame` anchor. Expected: one shared field visible through all four; moving a shape reveals a different part of it. Switch to `object` anchor: each shape carries its own copy.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(shaderfill): shader fills on every frame primitive"
```

---

### Task 7: Scene3D material (object anchor only)

**Files:**
- Modify: `frontend/app/lib/scene3d/materials.ts:391` (new case alongside `image`), `:433+` (`updateMaterial`)
- Modify: `frontend/app/lib/scene3d/config.ts` (the `SceneMaterial` union + defaults)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue:835` (per-frame texture update)

**Interfaces:**
- Consumes: `resolveField`, `beginFieldFrame`; `ShaderSpec` from `~/lib/spacetype/fillTile`
- Produces: a `shaderFill` material kind carrying `{ shader: ShaderSpec; unlit: boolean }`

Scene3D does **not** consume `Fill`/`FILL_TYPES`, so nothing here is free. It is a second, deliberate reuse seam onto the same field module.

- [ ] **Step 1: Add the material kind**

In `materials.ts`, alongside the `image` case at `:391`:

```ts
case 'shaderFill': {
  const canvas = resolveField({ spec: mat.shader, w: 512, h: 512, t: 0, fps: 30 })
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null
  // Unlit uses Basic so the field glows flat; otherwise Standard so scene lights shade it.
  const t = mat.unlit
    ? new THREE.MeshBasicMaterial({ color: '#ffffff', map: tex })
    : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: mat.roughness, metalness: mat.metalness, map: tex })
  shaderFillMaterials.add(t)
  m = t
  break
}
```

Register a `shaderFillMaterials` set beside the existing `imageMaterials` set so `updateMaterial` and `disposeMaterial` can find them.

- [ ] **Step 2: Update per frame**

In the Scene3D loop, call `beginFieldFrame` then re-resolve each shader-fill material's field, assigning `map.image` and setting `map.needsUpdate = true`. Reuse the texture object across frames — do not allocate a `CanvasTexture` per frame.

- [ ] **Step 3: Hand-verify**

Apply a shader fill to a sphere and to an imported GLB. Expected: the field wraps the UVs and animates; toggling unlit switches between lit and flat.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/scene3d/materials.ts frontend/app/lib/scene3d/config.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(shaderfill): Scene3D shader-fill material with unlit toggle"
```

---

### Task 8: Control schema — declare the frame, derive the contents

**Files:**
- Create: `frontend/app/lib/shaderfill/controls.ts`
- Modify: `frontend/app/lib/gradientfx/agentControls.ts`, `frontend/app/lib/shapefx/agentControls.ts` (include derived shader-fill specs)
- Create: `frontend/tests/unit/shaderfill-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `ControlSpec` from `~/lib/spacetype/effect`; `EffectDef` from `~/lib/shaderfx/types`
- Produces:
  ```ts
  export const SHADER_FILL_CONTROLS: ControlSpec[]          // the three frozen keys
  export function derivedShaderFillControls(effect: EffectDef, prefix: string): ControlSpec[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { SHADER_FILL_CONTROLS, derivedShaderFillControls } from '~/lib/shaderfill/controls'

const effect = { id: 'kaleidoscope', name: 'Kaleidoscope', params: [
  { key: 'segments', label: 'Segments', type: 'float', min: 2, max: 24, default: 6 },
] } as any

describe('shader fill controls', () => {
  it('declares exactly the three frozen keys', () => {
    expect(SHADER_FILL_CONTROLS.map(c => c.key))
      .toEqual(['fill.shader.effectId', 'fill.shader.anchor', 'fill.shader.speed'])
  })
  it('derives one spec per effect param under the reserved namespace', () => {
    const d = derivedShaderFillControls(effect, 'fill.shader')
    expect(d.map(c => c.key)).toEqual(['fill.shader.p.segments'])
    expect(d[0]).toMatchObject({ kind: 'slider', min: 2, max: 24, default: 6 })
  })
  it('derived params are animatable, so motion tracks come free', () => {
    expect(derivedShaderFillControls(effect, 'fill.shader')[0]!.animatable).not.toBe(false)
  })
  it('speed is animatable and anchor is not — anchor is a mode, not a value', () => {
    const byKey = Object.fromEntries(SHADER_FILL_CONTROLS.map(c => [c.key, c]))
    expect(byKey['fill.shader.speed']!.animatable).not.toBe(false)
    expect(byKey['fill.shader.anchor']!.animatable).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shaderfill-controls.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Follow the shape of `frontend/app/lib/shaderstudio/agentControls.ts:21`, which already builds `ControlSpec[]` imperatively from a live `EffectDef`. Declare the three frozen keys as literals; map each `EffectParamDef` to a `slider` (or `select` for `enum`) under `<prefix>.p.<key>`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shaderfill-controls.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the two studios that have schemas**

Append `SHADER_FILL_CONTROLS` plus the derived specs to the Gradient and Shape agent vocabularies. Scene3D is deliberately excluded — it exposes no control descriptors, so its shader-fill controls stay hand-wired and agent-invisible. Note this in a comment so it reads as a decision rather than an oversight.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shaderfill/controls.ts frontend/app/lib/gradientfx/agentControls.ts frontend/app/lib/shapefx/agentControls.ts frontend/tests/unit/shaderfill-controls.unit.spec.ts
git commit -m "feat(shaderfill): declared frame + derived per-effect control vocabulary"
```

---

### Task 9: Inspector UI — the nested fill editor

**Files:**
- Create: `frontend/app/components/vue-canvas/widgets/ShaderFillEditor.vue`
- Modify: every fill-picker call site surfaced by `grep -rl "FILL_TYPES" frontend/app`

**Interfaces:**
- Consumes: `ShaderSpec`, `DEFAULT_SHADER_SPEC`; `derivedShaderFillControls`; the existing CatalogModal
- Produces: a component taking `modelValue: ShaderSpec` and emitting `update:modelValue`

- [ ] **Step 1: Build the editor**

Four sections: effect picker (CatalogModal), derived param sliders from `derivedShaderFillControls`, anchor toggle, speed slider — then the **nested input fill editor**, which is the existing fill editor bound to `spec.input` with `'shader'` removed from its type list (the depth-1 guard, made visible rather than merely enforced).

- [ ] **Step 2: Mount it wherever a fill is edited**

For each call site, render `ShaderFillEditor` when the selected type is `shader`. The inspector is hand-written, not derived from `ControlSpec` — matching the note at `frontend/app/lib/gradientfx/controls.ts:9-11`.

- [ ] **Step 3: Hand-verify persistence**

Set a shader fill on a Space Type node, reload the page, confirm the effect, params, anchor, speed, and the nested input fill all survive. This is the failure mode the round-trip test in Task 1 guards, checked here end-to-end.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/widgets/ShaderFillEditor.vue
git commit -m "feat(shaderfill): nested shader fill editor"
```

---

### Task 10: Bake parity, goldens, E2E

**Files:**
- Modify: the bake paths for Space Type, Shape Studio, frames, Scene3D
- Create: `frontend/tests/shader-fill.spec.ts` (Playwright)

- [ ] **Step 1: Route every bake through `resolveField`**

Each bake calls the same `resolveField` with the bake's own fps and full resolution — no second code path. Confirm by grep that no bake constructs a field any other way:

```bash
grep -rn "shaderFx.render" frontend/app | grep -v "lib/shaderfill/field.ts" | grep -v "pages/dev"
```
Expected: only Shader Studio's own surfaces and `lib/texturefx/stylize.ts`.

- [ ] **Step 2: Golden coverage**

Add goldens for one shader fill per surface, at both anchors where supported. **The `crystal_prism` and `oil_paint` goldens are already broken — the suite is not a green baseline.** Record the pre-existing failures before adding new goldens so a reviewer can tell yours from theirs.

- [ ] **Step 3: E2E**

Write a Playwright spec that: adds a Space Type node, sets a shader fill, asserts the rendered canvas is non-uniform, toggles anchor and asserts the output changes, reloads and asserts the fill survives. Use the `sailor:applyEffect` headless graph-wiring helper rather than synthetic drags.

- [ ] **Step 4: Run everything**

```bash
cd frontend && npm run test:unit && npx playwright test tests/shader-fill.spec.ts
```
Expected: unit PASS; E2E PASS.

- [ ] **Step 5: Update the build dashboard**

Update `docs/STATE.md` and `docs/ROADMAP.md` together — both, per the standing rule that they move as a pair.

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/shader-fill.spec.ts docs/STATE.md docs/ROADMAP.md
git commit -m "test(shaderfill): bake parity, goldens, E2E + dashboard update"
```

---

## Notes for the implementer

- **Every surface that calls `beginFieldFrame` must surface the frozen hint**, not only the Compositor (Task 6 Step 3). Space Type (Task 4) and Scene3D (Task 7) need the same treatment — a `frozenCount > 0` that nobody displays is exactly the silent cap the spec forbids.
- **Task 0 is a gate, not a formality.** If 2 live fields cannot hold 30fps, the batching assumption fails and the design needs the context-agnostic renderer. Stop and escalate rather than pressing on.
- **Task 5 Step 3 is also a gate.** Confirm the convention visually on one shader before touching 28.
- The single-door claim is checked in **Task 4 Step 4**: Shape Studio must work with zero code changes. If it needs any, say so — that is a finding about the architecture, not a snag to work around.
