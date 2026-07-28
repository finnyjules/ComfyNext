# Web Embed Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a Sailor studio piece as a single self-contained `.html` file that renders live in a browser instead of as baked pixels.

**Architecture:** Define an `EmbedSurface` contract (`mount` / `setTime` / `setSize` / `destroy`) that wraps the *existing* per-surface renderers rather than adding a new render path. Each adapter is compiled by a separate Vite library build into `public/embed/<kind>.js`. Export is string assembly: prebuilt adapter JS + config JSON + inlined poster PNG + a small clock loop, written into one HTML file the user downloads. Shader Studio is the first adapter, used as the fixture that proves the contract.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, WebGL2, Vite (library mode), Vitest (unit), Playwright (browser).

**Spec:** [2026-07-28-web-embed-export-design.md](../specs/2026-07-28-web-embed-export-design.md)

## Global Constraints

- **Unit tests** live at `frontend/tests/unit/**/*.unit.spec.ts`, run with `npm run test:unit` (vitest, `environment: 'node'`). No DOM, no WebGL — pure logic only.
- **Browser tests** live at `frontend/tests/*.spec.ts`, run with `npx playwright test`. They require a running dev server; override the base URL with `PW_BASE_URL=http://127.0.0.1:<port>`.
- **The exported HTML must contain zero external references.** No `http://`, no `https://`, no `//cdn`, no `src="/`. This is asserted by test, not by inspection.
- **Vue and Nuxt must never appear in an embed bundle.** The adapters import only from `~/lib/**`.
- **All surfaces require WebGL2.** Absence is a fallback case, not an error case.
- **Alpha is declared per-surface, never assumed.** `app/lib/engine/gl/glRenderer.ts` uses `alpha: false`; adapters must state their own capability.
- **A test that cannot fail is not a test.** Task 8 exists specifically to prove the parity gate has teeth.
- Run `npm run test:unit` before every commit. The typecheck baseline is ~328 pre-existing errors — do not treat that count as a regression, but do not add to it.

---

### Task 1: The contract and the registry

**Files:**
- Create: `frontend/app/lib/embed/contract.ts`
- Create: `frontend/app/lib/embed/surfaces.ts`
- Test: `frontend/tests/unit/embed-registry.unit.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EmbedSurface`, `EmbedHandle`, `EmbedSnapshot`, `EmbedCaps` types; `embedSurfaceKinds(): string[]`; `isEmbeddable(kind: string): boolean`; `loadEmbedSurface(kind: string): Promise<EmbedSurface | null>`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/embed-registry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { embedSurfaceKinds, isEmbeddable, loadEmbedSurface } from '~/lib/embed/surfaces'

describe('embed surface registry', () => {
  it('lists shader as an embeddable kind', () => {
    expect(embedSurfaceKinds()).toContain('shader')
  })

  it('reports unknown kinds as not embeddable', () => {
    expect(isEmbeddable('shader')).toBe(true)
    expect(isEmbeddable('lipsync')).toBe(false)
    expect(isEmbeddable('')).toBe(false)
  })

  it('returns null for an unknown kind rather than throwing', async () => {
    await expect(loadEmbedSurface('nope')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/embed-registry.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/embed/surfaces`

- [ ] **Step 3: Write the contract**

Create `frontend/app/lib/embed/contract.ts`:

```ts
/**
 * The contract every embeddable studio implements. Deliberately four methods:
 * set up, draw at a normalized time, react to a size change, clean up.
 *
 * `container` rather than `canvas`: ShaderFxRenderer, GradientFxRenderer and the
 * texturefx renderer each already own their canvas and GL context and hand the
 * canvas back. Adapters append that canvas here. Handing them a canvas to draw
 * into would force a per-frame copy, and drawImage off a studio WebGL canvas is
 * known to read stale in this codebase.
 */
export interface EmbedCaps {
  /** True only if this surface genuinely renders with a transparent background. */
  alpha: boolean
}

export interface EmbedHandle {
  /** Draw at normalized loop position. Synchronous — no awaits in the hot path. */
  setTime(t01: number): void
  setSize(w: number, h: number): void
  destroy(): void
}

export interface EmbedSurface {
  readonly kind: string
  readonly caps: EmbedCaps
  /** All compiling, decoding and asset inflation happens here, once. */
  mount(container: HTMLElement, config: unknown): Promise<EmbedHandle>
}

/** What a single exported .html file carries, before it is serialized. */
export interface EmbedSnapshot {
  kind: string
  config: unknown
  /** Loop length in seconds. Drives the clock; must be > 0. */
  duration: number
  width: number
  height: number
  /** Baked still frame, inlined as a data: URI. Fallback and pre-mount frame. */
  posterDataUrl: string
  transparent: boolean
}
```

- [ ] **Step 4: Write the registry**

Create `frontend/app/lib/embed/surfaces.ts`:

```ts
import type { EmbedSurface } from './contract'

/**
 * One entry per embeddable surface. This list IS the feature's scope — the same
 * declaration-per-capability shape as shader_effects/manifest.json.
 * Dynamic imports so an embed bundle only ever pulls in its own adapter.
 */
const REGISTRY: Record<string, () => Promise<{ default: EmbedSurface }>> = {
  shader: () => import('./surfaces/shader'),
}

export function embedSurfaceKinds(): string[] {
  return Object.keys(REGISTRY)
}

export function isEmbeddable(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, kind)
}

export async function loadEmbedSurface(kind: string): Promise<EmbedSurface | null> {
  const loader = REGISTRY[kind]
  if (!loader) return null
  return (await loader()).default
}
```

- [ ] **Step 5: Create a placeholder adapter so the dynamic import resolves**

Create `frontend/app/lib/embed/surfaces/shader.ts`:

```ts
import type { EmbedSurface } from '../contract'

// Filled in by Task 4. Present now so the registry's dynamic import resolves.
const shaderEmbedSurface: EmbedSurface = {
  kind: 'shader',
  caps: { alpha: false },
  async mount() {
    throw new Error('shader embed adapter not implemented yet')
  },
}

export default shaderEmbedSurface
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/embed-registry.unit.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/embed/contract.ts frontend/app/lib/embed/surfaces.ts frontend/app/lib/embed/surfaces/shader.ts frontend/tests/unit/embed-registry.unit.spec.ts
git commit -m "feat(embed): EmbedSurface contract and surface registry"
```

---

### Task 2: The clock

**Files:**
- Create: `frontend/app/lib/embed/clock.ts`
- Test: `frontend/tests/unit/embed-clock.unit.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `t01At(elapsedMs: number, durationSec: number): number`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/embed-clock.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { t01At } from '~/lib/embed/clock'

describe('t01At', () => {
  it('is 0 at the start', () => {
    expect(t01At(0, 30)).toBe(0)
  })

  it('is 0.5 at the halfway point', () => {
    expect(t01At(15_000, 30)).toBeCloseTo(0.5, 6)
  })

  it('wraps at the loop boundary rather than reaching 1', () => {
    expect(t01At(30_000, 30)).toBe(0)
    expect(t01At(45_000, 30)).toBeCloseTo(0.5, 6)
  })

  it('stays in [0, 1) for very long runs', () => {
    const v = t01At(9_999_999, 30)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(1)
  })

  it('returns 0 for a non-positive duration instead of dividing by zero', () => {
    expect(t01At(1234, 0)).toBe(0)
    expect(t01At(1234, -5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/embed-clock.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/embed/clock`

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/embed/clock.ts`:

```ts
/**
 * Normalized loop position from elapsed wall-clock time.
 *
 * Wall clock rather than a frame counter: an embed has no fps, only a refresh
 * rate, so 60Hz and 120Hz displays must show the same motion at the same moment.
 * Wraps to [0, 1) so t=duration is the loop's start, not its end — a seam-free
 * loop depends on never emitting exactly 1.
 */
export function t01At(elapsedMs: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0
  const durMs = durationSec * 1000
  const wrapped = elapsedMs % durMs
  return (wrapped < 0 ? wrapped + durMs : wrapped) / durMs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/embed-clock.unit.spec.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/embed/clock.ts frontend/tests/unit/embed-clock.unit.spec.ts
git commit -m "feat(embed): wall-clock loop position helper"
```

---

### Task 3: Make ShaderFxRenderer instantiable

`frontend/app/lib/shaderfx/renderer.ts` currently exports only the singleton `shaderFx`. Two embeds must be able to coexist on one page, so the class itself has to be constructible. The singleton stays for every existing caller.

**Files:**
- Modify: `frontend/app/lib/shaderfx/renderer.ts:81` (add `export` to the class declaration)
- Test: `frontend/tests/unit/shaderfx-instances.unit.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export class ShaderFxRenderer` from `~/lib/shaderfx/renderer` (alongside the unchanged `shaderFx` singleton)

- [ ] **Step 1: Verify the module imports under vitest's node environment**

The renderer imports `BLEND_LAYERS_GLSL` from `~/lib/studio/blend`. Confirm that chain is pure (GLSL strings, no browser globals at module scope) before writing the test:

Run: `cd frontend && node --input-type=module -e "console.log('checked manually')"` — then read `app/lib/studio/blend.ts` and confirm no top-level `document`/`window`/`navigator` access.

If it does touch browser globals at module scope, STOP and move this test to Playwright (`tests/embed-contract.spec.ts`, added in Task 4) instead of vitest. Record which you chose in the commit message.

The renderer's own constructor is safe: `canvas` and `gl` start `null` and GL is only touched lazily in `ensure()`.

- [ ] **Step 2: Write the failing test**

Create `frontend/tests/unit/shaderfx-instances.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ShaderFxRenderer, shaderFx } from '~/lib/shaderfx/renderer'

describe('ShaderFxRenderer instances', () => {
  it('is exported as a constructor', () => {
    expect(typeof ShaderFxRenderer).toBe('function')
  })

  it('constructs without touching WebGL', () => {
    expect(() => new ShaderFxRenderer()).not.toThrow()
  })

  it('produces independent instances, distinct from the singleton', () => {
    const a = new ShaderFxRenderer()
    const b = new ShaderFxRenderer()
    expect(a).not.toBe(b)
    expect(a).not.toBe(shaderFx)
  })

  it('keeps the singleton available for existing callers', () => {
    expect(shaderFx).toBeInstanceOf(ShaderFxRenderer)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shaderfx-instances.unit.spec.ts`
Expected: FAIL — `ShaderFxRenderer` is not exported

- [ ] **Step 4: Export the class**

In `frontend/app/lib/shaderfx/renderer.ts`, change line 81 from:

```ts
class ShaderFxRenderer {
```

to:

```ts
/**
 * Exported so embeds can hold their own instance — two embeds on one page must
 * not share a GL context. App code should keep using the `shaderFx` singleton
 * below (browsers cap contexts at ~8-16).
 */
export class ShaderFxRenderer {
```

Change nothing else. `export const shaderFx = new ShaderFxRenderer()` at line 372 stays exactly as it is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/shaderfx-instances.unit.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Verify no existing caller broke**

Run: `cd frontend && npm run test:unit`
Expected: all suites pass, no new failures

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/shaderfx/renderer.ts frontend/tests/unit/shaderfx-instances.unit.spec.ts
git commit -m "feat(shaderfx): export ShaderFxRenderer for per-instance embed use"
```

---

### Task 4: The shader adapter

**Files:**
- Modify: `frontend/app/lib/embed/surfaces/shader.ts` (replace the Task 1 placeholder)
- Create: `frontend/app/pages/dev/embed-harness.vue`
- Test: `frontend/tests/embed-contract.spec.ts`

**Interfaces:**
- Consumes: `EmbedSurface`, `EmbedHandle` from `../contract`; `ShaderFxRenderer` from `~/lib/shaderfx/renderer`; `composePasses` from `~/lib/shaderstudio/passes`; `ShaderStudioConfig` from `~/lib/shaderstudio/types`; `EffectDef` from `~/lib/shaderfx/types`
- Produces: default-exported `EmbedSurface` with `kind: 'shader'`; `ShaderEmbedConfig` type — `{ cfg: ShaderStudioConfig; defs: EffectDef[]; duration: number }`

**Critical:** the adapter MUST compose passes with the studio's own `composePasses` (`frontend/app/lib/shaderstudio/passes.ts:34`). That function handles layer enable flags, blend modes, opacity, `captureSource`/`snapshot` sequencing, and the duotone → adjust → lens-blur → chromatic post stack. Reimplementing any of it creates a second composer and guarantees drift — the exact failure this design exists to prevent.

Two consequences that follow from reusing it:

- `composePasses` takes **`t` in seconds**, not `t01`. The adapter converts: `t = t01 * duration`. That is why `duration` lives in the config.
- The config carries the effects' `EffectDef`s **inlined** (each with its GLSL `source`), because the export must never fetch `/sailor/shader_effects` at runtime. `resolveDef` reads that inlined array.

- [ ] **Step 1: Write the failing browser test**

Create `frontend/tests/embed-contract.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Contract conformance for embed adapters, exercised on /dev/embed-harness.
// Requires a dev server: PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-contract.spec.ts --project=chromium

test.describe('EmbedSurface contract — shader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessReady === true)
  })

  test('mounts and puts a canvas in the container', async ({ page }) => {
    const n = await page.evaluate(async () => {
      const h = await (window as any).__embedHarness.mount('a')
      return h ? document.querySelectorAll('#slot-a canvas').length : -1
    })
    expect(n).toBe(1)
  })

  test('setTime changes the rendered pixels', async ({ page }) => {
    const [p0, p1] = await page.evaluate(async () => {
      const H = (window as any).__embedHarness
      const h = await H.mount('a')
      h.setTime(0.0)
      const a = H.snapshot('a')
      h.setTime(0.5)
      const b = H.snapshot('a')
      return [a, b]
    })
    expect(p0).not.toBe(p1)
  })

  test('setSize resizes the canvas', async ({ page }) => {
    const dims = await page.evaluate(async () => {
      const h = await (window as any).__embedHarness.mount('a')
      h.setSize(320, 200)
      h.setTime(0.25)
      const c = document.querySelector('#slot-a canvas') as HTMLCanvasElement
      return [c.width, c.height]
    })
    expect(dims).toEqual([320, 200])
  })

  test('destroy removes the canvas', async ({ page }) => {
    const after = await page.evaluate(async () => {
      const h = await (window as any).__embedHarness.mount('a')
      h.destroy()
      return document.querySelectorAll('#slot-a canvas').length
    })
    expect(after).toBe(0)
  })

  // The test that catches shared-state bugs. Two embeds on one page is the
  // real-world case (two pieces on one slide) and the reason ShaderFxRenderer
  // had to become instantiable.
  test('two instances on one page render independently', async ({ page }) => {
    const { aAt0, aAt0Again, bAt5 } = await page.evaluate(async () => {
      const H = (window as any).__embedHarness
      const ha = await H.mount('a')
      const hb = await H.mount('b')
      ha.setTime(0.0)
      const aAt0 = H.snapshot('a')
      hb.setTime(0.5)
      const bAt5 = H.snapshot('b')
      const aAt0Again = H.snapshot('a')
      return { aAt0, aAt0Again, bAt5 }
    })
    expect(aAt0).toBe(aAt0Again)   // b's render must not have disturbed a
    expect(aAt0).not.toBe(bAt5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-contract.spec.ts --project=chromium`
Expected: FAIL — `/dev/embed-harness` 404s, `__embedHarnessReady` never becomes true

- [ ] **Step 3: Implement the adapter**

Replace `frontend/app/lib/embed/surfaces/shader.ts` entirely:

```ts
import type { EmbedSurface, EmbedHandle } from '../contract'
import { ShaderFxRenderer } from '~/lib/shaderfx/renderer'
import { composePasses } from '~/lib/shaderstudio/passes'
import type { ShaderStudioConfig } from '~/lib/shaderstudio/types'
import type { EffectDef } from '~/lib/shaderfx/types'

/**
 * A shader embed carries the studio config verbatim PLUS the EffectDefs it
 * references, inlined. The exported file must never reach the network, so it
 * cannot resolve ids against the catalog (`~/lib/shaderfx/catalog`) the way the
 * studio does — `resolveDef` below reads the inlined array instead.
 */
export interface ShaderEmbedConfig {
  cfg: ShaderStudioConfig
  defs: EffectDef[]
  /** Loop length in seconds — composePasses wants `t` in seconds, not t01. */
  duration: number
  /**
   * The studio's source image, inlined as a data: URI. Shader Studio is
   * input-driven ("Add a source first"), so a real piece stacks passes over an
   * image — it must travel with the export. Null only for generative effects
   * that ignore their input.
   */
  baseDataUrl: string | null
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('shader embed: inlined source image failed to decode'))
    img.src = dataUrl
  })
}

/**
 * Generative shader effects synthesize their own image, so the base texture is a
 * 1x1 opaque black pixel rather than an uploaded asset. Keeping it 1x1 means an
 * export carries no image payload at all.
 */
function blackPixel(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 1, 1)
  return c
}

const shaderEmbedSurface: EmbedSurface = {
  kind: 'shader',
  // ShaderFxRenderer composites onto an opaque base; it does not currently
  // produce a transparent result. Declared false rather than assumed.
  caps: { alpha: false },

  async mount(container: HTMLElement, config: unknown): Promise<EmbedHandle> {
    const embed = config as ShaderEmbedConfig
    if (!embed?.cfg?.effects?.length) throw new Error('shader embed: config has no effects')

    // v1 covers generative, texture-free effects only (see the spec's asset
    // decision). Throw loudly rather than render something subtly wrong —
    // a silent wrong-looking export is worse than a failed one.
    const textured = embed.defs.filter(d => d.textures?.length)
    if (textured.length) {
      throw new Error(
        `shader embed: effects with texture assets are not supported yet (${textured.map(d => d.id).join(', ')})`,
      )
    }

    const resolveDef = (id: string): EffectDef | null =>
      embed.defs.find(d => d.id === id) ?? null

    // Own instance, not the app singleton — two embeds must not share a context.
    const renderer = new ShaderFxRenderer()
    // Decoding happens here, at mount, so setTime stays synchronous.
    const base: TexImageSource = embed.baseDataUrl
      ? await loadImage(embed.baseDataUrl)
      : blackPixel()
    let w = container.clientWidth || 512
    let h = container.clientHeight || 512
    let mounted: HTMLCanvasElement | null = null

    const draw = (t01: number) => {
      // composePasses is the studio's own composer — layer blend, opacity,
      // captureSource sequencing and the post stack all live in it. Never
      // reimplement any of that here.
      const passes = composePasses(embed.cfg, resolveDef, t01 * embed.duration)
      const out = renderer.render(passes, base, w, h)
      if (out !== mounted) {
        if (mounted) mounted.remove()
        out.style.display = 'block'
        out.style.width = '100%'
        out.style.height = '100%'
        container.appendChild(out)
        mounted = out
      }
    }

    // Draw once at mount so the container is never empty before the first tick.
    draw(0)

    return {
      setTime: (t01: number) => draw(t01),
      setSize: (nw: number, nh: number) => {
        w = Math.max(1, Math.round(nw))
        h = Math.max(1, Math.round(nh))
      },
      destroy: () => {
        if (mounted) { mounted.remove(); mounted = null }
      },
    }
  },
}

export default shaderEmbedSurface
```

- [ ] **Step 4: Build the harness page**

Create `frontend/app/pages/dev/embed-harness.vue`. It follows the existing `/dev/shaderfx-harness` convention: fetch the catalog, expose an imperative API on `window` for Playwright, signal readiness with a flag.

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { loadEmbedSurface } from '~/lib/embed/surfaces'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { defaultConfig, newLayerId } from '~/lib/shaderstudio/types'
import type { EmbedHandle } from '~/lib/embed/contract'
import type { ShaderEmbedConfig } from '~/lib/embed/surfaces/shader'

// Test-only page. Exposes mount/snapshot so tests drive the contract directly
// rather than through studio UI.
const handles: Record<string, EmbedHandle> = {}

const DURATION = 30

onMounted(async () => {
  const cat = await fetchShaderFxCatalog()
  // Generative AND texture-free: needs no input image and no asset payload,
  // which is exactly what the v1 adapter supports.
  const effect = cat.effects.find(e => e.generative && !e.textures?.length)
    ?? cat.effects.find(e => !e.textures?.length)!

  const cfg = defaultConfig()
  cfg.effects = [{
    id: effect.id,
    params: {},          // resolveUniforms fills catalog defaults
    enabled: true,
    blend: 'normal',
    opacity: 1,
    layerId: newLayerId(),
  }]

  // baseDataUrl null: the harness deliberately uses a generative effect so the
  // contract tests carry no image payload.
  const config: ShaderEmbedConfig = { cfg, defs: [effect], duration: DURATION, baseDataUrl: null }

  ;(window as any).__embedHarness = {
    config,
    async mount(slot: string) {
      const surface = await loadEmbedSurface('shader')
      if (!surface) return null
      const el = document.getElementById(`slot-${slot}`)!
      const h = await surface.mount(el, config)
      handles[slot] = h
      return h
    },
    snapshot(slot: string): string {
      const c = document.querySelector(`#slot-${slot} canvas`) as HTMLCanvasElement | null
      return c ? c.toDataURL('image/png') : ''
    },
  }
  ;(window as any).__embedHarnessReady = true
})
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-sm opacity-60">embed harness (test only)</h1>
    <div id="slot-a" class="w-[512px] h-[512px] bg-black" />
    <div id="slot-b" class="w-[512px] h-[512px] bg-black" />
  </div>
</template>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-contract.spec.ts --project=chromium`
Expected: PASS, 5 tests

If "two instances render independently" fails, that is a genuine shared-state bug in `ShaderFxRenderer` — the program cache or FBO sizing is being shared. Fix the renderer; do not weaken the test.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/embed/surfaces/shader.ts frontend/app/pages/dev/embed-harness.vue frontend/tests/embed-contract.spec.ts
git commit -m "feat(embed): shader adapter and contract conformance tests"
```

---

### Task 5: The bundler

Assembles an `EmbedSnapshot` plus prebuilt adapter JS into one HTML string. Pure string work, so it is unit-testable in node — including the self-containment guarantee.

**Files:**
- Create: `frontend/app/lib/embed/bundle.ts`
- Test: `frontend/tests/unit/embed-bundle.unit.spec.ts`

**Interfaces:**
- Consumes: `EmbedSnapshot` from `./contract`
- Produces: `buildEmbedHtml(snapshot: EmbedSnapshot, adapterJs: string): string`; `EXTERNAL_REF_PATTERN: RegExp`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/embed-bundle.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildEmbedHtml, EXTERNAL_REF_PATTERN } from '~/lib/embed/bundle'
import type { EmbedSnapshot } from '~/lib/embed/contract'

const POSTER = 'data:image/png;base64,iVBORw0KGgo='

function snap(over: Partial<EmbedSnapshot> = {}): EmbedSnapshot {
  return {
    kind: 'shader',
    config: { effects: [{ effectId: 'aurora', source: '// glsl', params: { u_amount: 0.5 }, seed: 42, passes: 1 }] },
    duration: 30,
    width: 800,
    height: 450,
    posterDataUrl: POSTER,
    transparent: false,
    ...over,
  }
}

describe('buildEmbedHtml', () => {
  it('inlines the adapter javascript', () => {
    const html = buildEmbedHtml(snap(), 'globalThis.__SAILOR_SURFACE__ = {};')
    expect(html).toContain('globalThis.__SAILOR_SURFACE__')
  })

  it('inlines the config and the poster', () => {
    const html = buildEmbedHtml(snap(), '')
    expect(html).toContain('aurora')
    expect(html).toContain(POSTER)
  })

  it('contains no external references', () => {
    const html = buildEmbedHtml(snap(), 'const x = 1;')
    expect(html.match(EXTERNAL_REF_PATTERN)).toBeNull()
  })

  it('escapes a closing script tag hidden in the config', () => {
    const html = buildEmbedHtml(
      snap({ config: { effects: [{ effectId: '</script><img src=x>', source: '', params: {}, seed: 1, passes: 1 }] } }),
      '',
    )
    expect(html).not.toContain('</script><img')
  })

  it('rejects a non-positive duration', () => {
    expect(() => buildEmbedHtml(snap({ duration: 0 }), '')).toThrow(/duration/i)
  })

  it('rejects a poster that is not a data URI', () => {
    expect(() => buildEmbedHtml(snap({ posterDataUrl: 'https://example.com/p.png' }), '')).toThrow(/data:/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/embed-bundle.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/embed/bundle`

- [ ] **Step 3: Write the bundler**

Create `frontend/app/lib/embed/bundle.ts`:

```ts
import type { EmbedSnapshot } from './contract'

/**
 * Any reference that would make the file reach the network. Asserted against
 * every built embed — self-containment is a guarantee, not an intention.
 * `data:` URIs are explicitly fine and must not match.
 */
export const EXTERNAL_REF_PATTERN = /(https?:)?\/\/[^\s"')]+|(?:src|href)\s*=\s*["']\/(?!\/)/gi

/** Neutralize sequences that would break out of the inline <script> block. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029')
}

export function buildEmbedHtml(snapshot: EmbedSnapshot, adapterJs: string): string {
  if (!(snapshot.duration > 0)) {
    throw new Error(`embed: duration must be positive, got ${snapshot.duration}`)
  }
  if (!snapshot.posterDataUrl.startsWith('data:')) {
    throw new Error('embed: poster must be a data: URI — an external poster would break self-containment')
  }

  const bg = snapshot.transparent ? 'transparent' : '#000'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sailor embed</title>
<style>
  html,body{margin:0;padding:0;background:${bg};overflow:hidden}
  #sailor-embed{position:relative;width:100vw;height:100vh}
  #sailor-embed canvas{display:block;width:100%;height:100%}
  #sailor-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  #sailor-poster[hidden]{display:none}
</style>
</head>
<body>
<div id="sailor-embed"><img id="sailor-poster" alt=""></div>
<script>
window.__SAILOR_SNAPSHOT__ = ${safeJson({ ...snapshot, posterDataUrl: '' })};
window.__SAILOR_POSTER__ = ${safeJson(snapshot.posterDataUrl)};
document.getElementById('sailor-poster').src = window.__SAILOR_POSTER__;
</script>
<script>
${adapterJs}
</script>
<script>
(function () {
  var box = document.getElementById('sailor-embed');
  var poster = document.getElementById('sailor-poster');
  var snap = window.__SAILOR_SNAPSHOT__;
  var surface = window.__SAILOR_SURFACE__;

  function t01At(ms, dur) {
    if (!(dur > 0)) return 0;
    var d = dur * 1000, w = ms % d;
    return (w < 0 ? w + d : w) / d;
  }

  // Poster stays visible until the live renderer has actually produced a frame.
  // If anything below throws, it simply never hides — a still frame, never a
  // blank rectangle and never an error in someone else's console.
  if (!surface || typeof surface.mount !== 'function') return;

  surface.mount(box, snap.config).then(function (handle) {
    poster.hidden = true;
    var t0 = null, raf = 0, visible = true;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function size() {
      handle.setSize(box.clientWidth || snap.width, box.clientHeight || snap.height);
    }
    size();
    window.addEventListener('resize', size);

    if (reduce) { handle.setTime(0); return; }

    function tick(now) {
      if (t0 === null) t0 = now;
      handle.setTime(t01At(now - t0, snap.duration));
      raf = requestAnimationFrame(tick);
    }
    function play() { if (!raf) raf = requestAnimationFrame(tick); }
    function pause() { if (raf) { cancelAnimationFrame(raf); raf = 0; } t0 = null; }

    // Ten embeds on one page should not cook a laptop.
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        visible ? play() : pause();
      }).observe(box);
    } else { play(); }
    if (visible) play();
  }).catch(function () { /* poster remains visible */ });
})();
</script>
</body>
</html>
`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/embed-bundle.unit.spec.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/embed/bundle.ts frontend/tests/unit/embed-bundle.unit.spec.ts
git commit -m "feat(embed): single-file HTML bundler with self-containment assertions"
```

---

### Task 6: Prebuilt adapter bundles

The adapter must reach the exported file as plain JS. A separate Vite library build emits it to `public/embed/<kind>.js` as an IIFE assigning `globalThis.__SAILOR_SURFACE__`, which the bundler's runtime script reads.

**Files:**
- Create: `frontend/vite.embed.config.ts`
- Create: `frontend/app/lib/embed/entry-shader.ts`
- Modify: `frontend/package.json` (add the `build:embed` script)
- Modify: `frontend/.gitignore` (ignore the emitted bundle)
- Test: `frontend/tests/unit/embed-build-output.unit.spec.ts`

**Interfaces:**
- Consumes: the default export of `~/lib/embed/surfaces/shader`
- Produces: `frontend/public/embed/shader.js`, an IIFE that sets `globalThis.__SAILOR_SURFACE__`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/embed-build-output.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = path.join(ROOT, 'public', 'embed', 'shader.js')

// Guards the contract between the Vite library build and the runtime script in
// bundle.ts. Run `npm run build:embed` first — this test asserts its output.
describe('prebuilt shader embed bundle', () => {
  it('exists — run `npm run build:embed` if this fails', () => {
    expect(fs.existsSync(OUT)).toBe(true)
  })

  it('assigns the global the runtime script reads', () => {
    expect(fs.readFileSync(OUT, 'utf8')).toContain('__SAILOR_SURFACE__')
  })

  it('does not drag Vue into the embed', () => {
    const js = fs.readFileSync(OUT, 'utf8')
    expect(js).not.toContain('createElementVNode')
    expect(js).not.toContain('@vue/runtime-core')
  })

  it('emits a single self-contained file with no import statements', () => {
    const js = fs.readFileSync(OUT, 'utf8')
    expect(js).not.toMatch(/^\s*import\s/m)
    expect(js).not.toMatch(/\bfrom\s+["'][./]/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/embed-build-output.unit.spec.ts`
Expected: FAIL — `public/embed/shader.js` does not exist

- [ ] **Step 3: Write the entry point**

Create `frontend/app/lib/embed/entry-shader.ts`:

```ts
import surface from './surfaces/shader'

// The embed runtime in bundle.ts looks for exactly this global.
;(globalThis as any).__SAILOR_SURFACE__ = surface
```

- [ ] **Step 4: Write the Vite config**

Create `frontend/vite.embed.config.ts`:

```ts
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Builds each embed adapter as a standalone IIFE for inlining into exported
// .html files. Separate from the Nuxt build on purpose: nothing here may pull
// in Vue, Nuxt, or anything that reaches the network.
export default defineConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  build: {
    outDir: 'public/embed',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./app/lib/embed/entry-shader.ts', import.meta.url)),
      formats: ['iife'],
      name: '__SailorEmbedShader',
      fileName: () => 'shader.js',
    },
    minify: 'esbuild',
    // Everything must be inlined — an embed has no module loader and no network.
    rollupOptions: { external: [] },
  },
})
```

- [ ] **Step 5: Add the build script**

In `frontend/package.json`, add to `"scripts"`:

```json
"build:embed": "vite build --config vite.embed.config.ts"
```

- [ ] **Step 6: Ignore the emitted bundle**

Append to `frontend/.gitignore`:

```
# Emitted by `npm run build:embed`
public/embed/
```

- [ ] **Step 7: Build and verify**

Run: `cd frontend && npm run build:embed`
Expected: writes `public/embed/shader.js`

Run: `cd frontend && npx vitest run tests/unit/embed-build-output.unit.spec.ts`
Expected: PASS, 4 tests

If the "does not drag Vue in" assertion fails, something in the `~/lib/shaderfx` import chain reaches a Vue module. Find it and break the dependency in the adapter — do not relax the assertion.

- [ ] **Step 8: Commit**

```bash
git add frontend/vite.embed.config.ts frontend/app/lib/embed/entry-shader.ts frontend/package.json frontend/.gitignore frontend/tests/unit/embed-build-output.unit.spec.ts
git commit -m "build(embed): Vite library build emitting standalone adapter bundles"
```

---

### Task 7: Export action in Shader Studio

Wires it together: bake a poster from the adapter itself, fetch the prebuilt JS, build the HTML, download it.

**Files:**
- Create: `frontend/app/lib/embed/export.ts`
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (add the footer action)
- Test: `frontend/tests/embed-export.spec.ts`

**Interfaces:**
- Consumes: `buildEmbedHtml` from `./bundle`; `loadEmbedSurface` from `./surfaces`; `EmbedSnapshot` from `./contract`
- Produces: `exportEmbedHtml(opts: { kind: string; config: unknown; duration: number; width: number; height: number; transparent?: boolean; posterT01?: number }): Promise<string>`; `downloadEmbed(filename: string, html: string): void`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/embed-export.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// End-to-end: build an embed on the harness page, then load the produced HTML
// in a blank page and confirm the LIVE renderer runs — not the poster.
test.describe('embed export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessReady === true)
  })

  test('produces self-contained html with no external references', async ({ page }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())
    expect(html).toContain('<!doctype html>')
    expect(html).not.toMatch(/(https?:)?\/\/[^\s"')]+/)
  })

  test('the exported file renders live, not just its poster', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())

    const embed = await context.newPage()
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    // The poster must be hidden — if it is still showing, the live path failed
    // and a graceful fallback is masking it.
    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)

    // And it must actually animate.
    const first = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    await embed.waitForTimeout(600)
    const later = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    expect(first).not.toBe(later)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-export.spec.ts --project=chromium`
Expected: FAIL — `__embedHarness.exportHtml` is not a function

- [ ] **Step 3: Write the export module**

Create `frontend/app/lib/embed/export.ts`:

```ts
import { buildEmbedHtml } from './bundle'
import { loadEmbedSurface } from './surfaces'
import type { EmbedSnapshot } from './contract'

export interface ExportEmbedOptions {
  kind: string
  config: unknown
  duration: number
  width: number
  height: number
  transparent?: boolean
  /** Loop position the still frame is baked from. */
  posterT01?: number
}

/**
 * Bakes the poster using the EMBED adapter rather than the studio's own bake
 * path, so the fallback frame is guaranteed to match what the embed renders.
 */
async function bakePoster(
  kind: string, config: unknown, width: number, height: number, t01: number,
): Promise<string> {
  const surface = await loadEmbedSurface(kind)
  if (!surface) throw new Error(`embed: unknown surface kind "${kind}"`)

  const box = document.createElement('div')
  box.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px`
  document.body.appendChild(box)
  try {
    const handle = await surface.mount(box, config)
    handle.setSize(width, height)
    handle.setTime(t01)
    const canvas = box.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) throw new Error('embed: adapter produced no canvas')
    const url = canvas.toDataURL('image/png')
    handle.destroy()
    return url
  } finally {
    box.remove()
  }
}

export async function exportEmbedHtml(opts: ExportEmbedOptions): Promise<string> {
  const surface = await loadEmbedSurface(opts.kind)
  if (!surface) throw new Error(`embed: unknown surface kind "${opts.kind}"`)

  const transparent = !!opts.transparent && surface.caps.alpha
  const posterDataUrl = await bakePoster(
    opts.kind, opts.config, opts.width, opts.height, opts.posterT01 ?? 0,
  )

  // Emitted by `npm run build:embed`. Same-origin, read once at export time —
  // the produced file itself never fetches anything.
  const res = await fetch(`/embed/${opts.kind}.js`)
  if (!res.ok) {
    throw new Error(`embed: /embed/${opts.kind}.js missing — run \`npm run build:embed\``)
  }
  const adapterJs = await res.text()

  const snapshot: EmbedSnapshot = {
    kind: opts.kind,
    config: opts.config,
    duration: opts.duration,
    width: opts.width,
    height: opts.height,
    posterDataUrl,
    transparent,
  }
  return buildEmbedHtml(snapshot, adapterJs)
}

export function downloadEmbed(filename: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Extend the harness**

In `frontend/app/pages/dev/embed-harness.vue`, add the import:

```ts
import { exportEmbedHtml } from '~/lib/embed/export'
```

and add this method to the `window.__embedHarness` object literal, alongside `mount` and `snapshot`:

```ts
    async exportHtml() {
      return await exportEmbedHtml({
        kind: 'shader',
        config,
        duration: DURATION,
        width: 512,
        height: 512,
      })
    },
```

- [ ] **Step 5: Build the bundle and run the tests**

Run: `cd frontend && npm run build:embed`
Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-export.spec.ts --project=chromium`
Expected: PASS, 2 tests

- [ ] **Step 6: Add the Shader Studio footer action**

In `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`, add the imports:

```ts
import { exportEmbedHtml, downloadEmbed } from '~/lib/embed/export'
import type { ShaderEmbedConfig } from '~/lib/embed/surfaces/shader'
```

Add a size-reporting ref beside the file's existing `bakeMsg`:

```ts
const embedMsg = ref('')
```

Add the handler. It mirrors the dimension and clock derivation the file's existing bake handler already uses at `ShaderStudioSurface.vue:462-463` — `resolved.value` is the source image, `exportClock(...)` owns the duration, `outputDims(..., config.value.resolution, { upscale: true })` gives the output size. Do not invent new state:

```ts
async function exportWebEmbed() {
  if (!resolved.value) { embedMsg.value = 'Add a source first'; return }
  embedMsg.value = 'Building…'
  try {
    const src = resolved.value!
    const clock = exportClock(src, config.value.motion.duration, config.value.motion.fps)
    const { w, h } = outputDims(src.width, src.height, config.value.resolution, { upscale: true })

    // Inline the source image — the exported file must not fetch it. Drawing
    // the resolved source through a 2D canvas gives a data: URI regardless of
    // whether it arrived as an <img>, a canvas, or a bitmap.
    const flat = document.createElement('canvas')
    flat.width = w
    flat.height = h
    flat.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, w, h)

    // Only the defs actually referenced by enabled layers travel with the export.
    const ids = new Set(config.value.effects.filter(e => e.enabled && e.id).map(e => e.id))
    const defs = (catalog.value?.effects ?? []).filter(d => ids.has(d.id))

    const embedConfig: ShaderEmbedConfig = {
      cfg: structuredClone(toRaw(config.value)),
      defs,
      duration: clock.duration,
      baseDataUrl: flat.toDataURL('image/png'),
    }

    const html = await exportEmbedHtml({
      kind: 'shader',
      config: embedConfig,
      duration: clock.duration,
      width: w,
      height: h,
    })

    // Size is shown, not discovered later when a page takes eight seconds to load.
    const mb = (new Blob([html]).size / 1_048_576).toFixed(1)
    embedMsg.value = `Downloaded — ${mb} MB`
    downloadEmbed('sailor-shader-embed.html', html)
  } catch (err) {
    console.error('[ShaderStudio] embed export failed:', err)
    embedMsg.value = err instanceof Error ? err.message : 'Export failed'
  }
}
```

`toRaw` and `structuredClone` strip Vue reactivity so the config serializes cleanly — `toRaw` is already imported in this file (used by `duplicateLayer` at line 527).

Add the button and its message beside the existing footer actions:

```vue
<StudioButton @click="exportWebEmbed">Export embed</StudioButton>
<span v-if="embedMsg" class="text-xs opacity-60">{{ embedMsg }}</span>
```

- [ ] **Step 7: Verify in the running app**

Open Shader Studio, click **Export embed**, then open the downloaded file directly in a browser. Confirm it animates and matches the studio. A screenshot of the opened file is the evidence — "it downloaded" is not.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/embed/export.ts frontend/app/pages/dev/embed-harness.vue frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/tests/embed-export.spec.ts
git commit -m "feat(embed): export action wiring poster bake, bundler and download"
```

---

### Task 8: Parity gate, with teeth

Proves the exported file matches the studio — and that the comparison can actually fail. Follows the established `tests/shaderfx-golden.spec.ts` pattern (pixel diff with calibrated tolerance).

**Files:**
- Create: `frontend/tests/embed-parity.spec.ts`
- Modify: `frontend/app/pages/dev/embed-harness.vue` (add a corruption hook)

**Interfaces:**
- Consumes: `__embedHarness.exportHtml`, `__embedHarness.mount`, `__embedHarness.snapshot` from Tasks 4 and 7
- Produces: nothing consumed downstream

- [ ] **Step 1: Add the studio reference and corruption hooks to the harness**

The parity test needs a **studio-path** render to compare against — otherwise it only compares the adapter to itself and proves nothing about drift. Add these imports to `frontend/app/pages/dev/embed-harness.vue`:

```ts
import { shaderFx } from '~/lib/shaderfx/renderer'
import { composePasses } from '~/lib/shaderstudio/passes'
```

Add a shared base canvas at module scope in the same `<script setup>`, matching the adapter's 1×1 black base:

```ts
function blackBase(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1; c.height = 1
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1)
  return c
}
const BASE = blackBase()
```

Then add these two methods to `window.__embedHarness`:

```ts
    /**
     * Renders through the STUDIO path — the shaderFx singleton plus
     * composePasses — exactly as ShaderStudioSurface does. This is the parity
     * reference: if the adapter diverges from this, the adapter has drifted.
     */
    studioRef(t01: number): string {
      const passes = composePasses(
        config.cfg,
        (id: string) => config.defs.find(d => d.id === id) ?? null,
        t01 * DURATION,
      )
      return shaderFx.render(passes, BASE, 512, 512).toDataURL('image/png')
    },

    /**
     * Test-only: perturb the config so the parity diff MUST fail. Changes a real
     * float uniform rather than opacity — a single base layer takes no composite
     * pass (`stacked` is false in composePasses), so opacity alone can be a no-op.
     */
    corrupt() {
      const p = config.defs[0]!.params.find(x => x.type === 'float')
      if (!p) throw new Error('harness: chosen effect has no float param to corrupt')
      const bad = p.max ?? (p.default + 1)
      for (const layer of config.cfg.effects) {
        layer.params = { ...layer.params, [p.uniform]: bad === p.default ? p.min ?? 0 : bad }
      }
    },
```

- [ ] **Step 2: Write the parity test**

Create `frontend/tests/embed-parity.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const T = 0.37   // arbitrary non-zero, non-half position — a t both sides must agree on

async function studioFrame(page: any): Promise<string> {
  return await page.evaluate(async (t: number) => {
    const H = (window as any).__embedHarness
    const h = await H.mount('a')
    h.setSize(512, 512)
    h.setTime(t)
    const png = H.snapshot('a')
    h.destroy()
    return png
  }, T)
}

async function embedFrame(context: any, html: string): Promise<string> {
  const p = await context.newPage()
  // Runs before any page script, so the runtime sees the flag at startup and
  // renders exactly this frame instead of starting its clock. No debug global
  // is shipped in the export itself.
  await p.addInitScript((t: number) => { (window as any).__SAILOR_FREEZE_T01__ = t }, T)
  await p.setContent(html)
  await p.waitForFunction(() => {
    const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
    return !!c && c.width > 1
  }, undefined, { timeout: 15_000 })

  // Assert the LIVE path ran. Without this, an export that silently fell back to
  // its poster would sail through the diff and look like a pass.
  expect(await p.locator('#sailor-poster').isHidden()).toBe(true)

  const png = await p.evaluate(() =>
    (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
  await p.close()
  return png
}

test.describe('embed parity with the studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessReady === true)
  })

  // Layer 1 — the adapter must match the STUDIO render path, not just itself.
  // This is the test that catches drift between composePasses-via-adapter and
  // composePasses-via-studio.
  test('adapter matches the studio path at the same t01', async ({ page }) => {
    const studio = await page.evaluate((t: number) =>
      (window as any).__embedHarness.studioRef(t), T)
    const adapter = await studioFrame(page)
    expect(adapter).toBe(studio)
  })

  // Layer 2 — the exported file must match the adapter. This is what the
  // bundling and serialization path can break.
  test('exported file matches the adapter at the same t01', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())
    const adapter = await studioFrame(page)
    const exported = await embedFrame(context, html)
    expect(exported).toBe(adapter)
  })

  // Layer 3 — the gate on the gates. If this passes, the two tests above prove
  // nothing, because the comparison would accept a broken render.
  test('the parity check fails when the config is deliberately broken', async ({ page, context }) => {
    const before = await studioFrame(page)
    await page.evaluate(() => (window as any).__embedHarness.corrupt())
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())
    const after = await embedFrame(context, html)
    expect(after).not.toBe(before)
  })
})
```

- [ ] **Step 3: Add deterministic still mode to the embed runtime**

The parity test must compare a *specific* frame, not whatever the clock happens to be showing. Do **not** expose the handle as a debug global — every exported file is user-facing, and a leaked `window.__sailorHandle` would ship in all of them.

Instead give the runtime a real feature: if `window.__SAILOR_FREEZE_T01__` is a number when the runtime starts, it renders that one frame and never starts the loop. This is the same code path `prefers-reduced-motion` already needs, and it is legitimately useful (a still embed).

In `frontend/app/lib/embed/bundle.ts`, replace this line inside the `surface.mount(...).then(function (handle) {` block:

```js
    if (reduce) { handle.setTime(0); return; }
```

with:

```js
    // Deterministic still mode: an explicit frozen frame, or the reduced-motion
    // still. Both render exactly once and never start the loop.
    var frozen = typeof window.__SAILOR_FREEZE_T01__ === 'number'
      ? window.__SAILOR_FREEZE_T01__
      : null;
    if (frozen !== null || reduce) { handle.setTime(frozen === null ? 0 : frozen); return; }
```

The parity test sets that global with Playwright's `addInitScript`, which runs before page scripts — see Task 8 Step 2.

- [ ] **Step 4: Run the parity tests**

Run: `cd frontend && npm run build:embed`
Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-parity.spec.ts --project=chromium`
Expected: PASS, 3 tests

If "adapter matches the studio path" fails, the adapter has diverged from `composePasses` — fix the adapter, never the reference.

If exact `toDataURL` equality proves flaky across the two contexts, switch to a pixel diff using `pngjs` with the tolerances already calibrated in `tests/shaderfx-golden.spec.ts` (`MAX_MEAN = 2.5/255`, `MAX_PCT_OVER = 0.06`). Do **not** widen tolerance until the corruption test still fails — a threshold loose enough to pass a broken config is worthless.

- [ ] **Step 5: Run the full suites**

Run: `cd frontend && npm run test:unit`
Expected: all pass

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-contract.spec.ts tests/embed-export.spec.ts tests/embed-parity.spec.ts --project=chromium`
Expected: 10 tests pass (5 contract, 2 export, 3 parity)

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/embed-parity.spec.ts frontend/app/pages/dev/embed-harness.vue frontend/app/lib/embed/bundle.ts
git commit -m "test(embed): studio/export parity gate with a deliberate-break check"
```

---

## Done when

- `npm run test:unit` passes, including the four new unit suites
- The three Playwright embed suites pass (10 tests)
- The corruption test genuinely fails the parity diff — verified, not assumed
- Clicking **Export embed** in Shader Studio downloads an `.html` that animates when opened directly from disk, with no network access

## Deliberately not in this plan

Per the spec: publishing/hosting, scroll and pointer input, a public JS API, and any surface other than Shader. `gradientFx`'s `globalThis` binding and `field.ts`'s module-level cache are only fixed when their adapters are built — Task 3 fixes `ShaderFxRenderer` alone, which is all the fixture needs.
