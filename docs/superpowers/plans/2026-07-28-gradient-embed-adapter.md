# Gradient Embed Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gradient Studio the second embeddable surface, proving the `EmbedSurface` contract generalises beyond the fixture it was designed against.

**Architecture:** Reuse everything. The contract, bundler, export path, and download flow are unchanged — this adds one adapter, one registry line, one prebuilt bundle, and one button. Gradient's renderer is already a single choke point (`render(cfg, w, h, time)` applies motion internally), so the adapter is thinner than Shader's.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, WebGL2, Vite (library mode), Vitest, Playwright.

**Prior work:** [Web Embed Export plan](2026-07-28-web-embed-export.md) · [spec](../specs/2026-07-28-web-embed-export-design.md)

## What already exists (do not rebuild)

- `frontend/app/lib/embed/contract.ts` — `EmbedSurface` = `{ kind, caps, mount(container, config) → EmbedHandle }`; `EmbedHandle` = `{ setTime(t01), setSize(w,h), destroy() }`.
- `frontend/app/lib/embed/surfaces.ts` — the registry. Currently one entry: `shader`.
- `frontend/app/lib/embed/bundle.ts` — `buildEmbedHtml`, `externalRefs`. Surface-agnostic already.
- `frontend/app/lib/embed/export.ts` — `exportEmbedHtml({ kind, config, duration, width, height })`, `downloadEmbed`. Already takes `kind` and fetches `/embed/<kind>.js`.
- `frontend/vite.embed.config.ts` — emits `public/embed/shader.js`. Wired to `predev` and `prebuild`.
- `frontend/app/pages/dev/embed-harness.vue` — shader-specific today; Task 3 generalises it.

## Global Constraints

- **Unit tests**: `frontend/tests/unit/**/*.unit.spec.ts`, `cd frontend && npx vitest run` (vitest, `environment: 'node'`). No DOM, no WebGL.
- **Browser tests**: `frontend/tests/*.spec.ts`, Playwright. A dev server is expected at `PW_BASE_URL`; on this machine use `http://127.0.0.1:3000`. **Always `127.0.0.1`, never `localhost`** — localhost hits the IPv6 listener and returns HTTP 426.
- **Vue and Nuxt must never appear in an embed bundle.** `frontend/app/lib/gradientfx/renderer.ts` imports only sibling `./` modules and `~/lib/studio/blend` — verified clean. Do **not** import `~/lib/gradientfx/frameSource.ts` from the adapter: it has a module-level `ref(0)` and would drag Vue in.
- **The exported HTML must contain zero network references.** `externalRefs()` enforces it; `exportEmbedHtml` already throws on a violation.
- **Alpha is declared per-surface, never assumed.**
- **Run `npm run build:embed` after changing anything under `app/lib/embed/surfaces/`.** Exports inline the PREBUILT bundle; skipping this makes changes appear to have no effect.
- TypeScript typecheck has ~328 pre-existing errors repo-wide — the known baseline, NOT a gate. vitest is the gate.
- 16-17 unit tests fail on main for unrelated pre-existing reasons — ignore them.
- Git: commit directly to main, staging only explicit paths. A parallel session shares this checkout. Never `git add -A` or `git stash`.

## Facts established by investigation (trust these)

- `GradientFxRenderer` is declared at `frontend/app/lib/gradientfx/renderer.ts:24` and is **not exported**. `export const gradientFx = resolveGradientFx(globalThis as unknown as GradientFxScope)` at `:381` caches one instance on `globalThis.__sailorGradientFx`.
- `render(cfg: GradientConfig, width: number, height: number, time = 0): HTMLCanvasElement` at `:155`. **`applyMotion` is applied inside `render()`** (imported at `:7`) — the adapter must NOT apply motion itself.
- `time` is in **seconds**, not normalized.
- Duration lives at `config.motion.duration` (fallback 4). See `GradientStudioSurface.vue`'s `loop()`.
- Gradient animates even with **zero motion tracks** — flow speed and mesh drift are "living drift". See the `animated` computed in `GradientStudioSurface.vue`.
- `GradientConfig` references no images, textures, or URLs. Fully procedural.
- The studio renders a frame via `gradientFx.render(config.value, w, h, t)` (`GradientStudioSurface.vue:278`) and bakes via `gradientFx.renderToBlob(...)` (`:582`).

---

### Task 1: Make GradientFxRenderer instantiable

Two embeds must coexist on one page with independent WebGL contexts. This mirrors exactly what was done for `ShaderFxRenderer` in the prior plan (commit `15477d7aa`).

**Files:**
- Modify: `frontend/app/lib/gradientfx/renderer.ts:24` (add `export` to the class declaration)
- Test: `frontend/tests/unit/gradientfx-instances.unit.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export class GradientFxRenderer` from `~/lib/gradientfx/renderer`, alongside the unchanged `gradientFx` singleton and `resolveGradientFx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/gradientfx-instances.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GradientFxRenderer, gradientFx } from '~/lib/gradientfx/renderer'

describe('GradientFxRenderer instances', () => {
  it('is exported as a constructor', () => {
    expect(typeof GradientFxRenderer).toBe('function')
  })

  it('constructs without touching WebGL', () => {
    expect(() => new GradientFxRenderer()).not.toThrow()
  })

  it('produces independent instances, distinct from the singleton', () => {
    const a = new GradientFxRenderer()
    const b = new GradientFxRenderer()
    expect(a).not.toBe(b)
    expect(a).not.toBe(gradientFx)
  })

  it('keeps the singleton available for existing callers', () => {
    expect(gradientFx).toBeInstanceOf(GradientFxRenderer)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-instances.unit.spec.ts`
Expected: FAIL — `GradientFxRenderer` is not exported

If it instead fails because importing the module throws under node (a browser global touched at module scope), STOP and report — the fix would be different.

- [ ] **Step 3: Export the class**

In `frontend/app/lib/gradientfx/renderer.ts`, change line 24 from `class GradientFxRenderer {` to:

```ts
/**
 * Exported so embeds can hold their own instance — two embeds on one page must
 * not share a GL context. App code should keep using the `gradientFx` singleton
 * below, which is cached on globalThis (browsers cap contexts at ~8-16).
 */
export class GradientFxRenderer {
```

Change nothing else. `resolveGradientFx` and `export const gradientFx` stay exactly as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-instances.unit.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Verify no existing caller broke**

Run: `cd frontend && npx vitest run`
Expected: no NEW failures beyond the known ~16-17 baseline

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/renderer.ts frontend/tests/unit/gradientfx-instances.unit.spec.ts
git commit -m "feat(gradientfx): export GradientFxRenderer for per-instance embed use"
```

---

### Task 2: The Gradient adapter and its bundle

**Files:**
- Create: `frontend/app/lib/embed/surfaces/gradient.ts`
- Create: `frontend/app/lib/embed/entry-gradient.ts`
- Modify: `frontend/app/lib/embed/surfaces.ts` (one registry line)
- Modify: `frontend/vite.embed.config.ts` (parameterise the entry)
- Modify: `frontend/package.json` (`build:embed` builds both bundles)
- Test: `frontend/tests/unit/embed-registry.unit.spec.ts` (extend), `frontend/tests/unit/embed-build-output.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `EmbedSurface`, `EmbedHandle` from `../contract`; `GradientFxRenderer` from `~/lib/gradientfx/renderer`; `GradientConfig` from `~/lib/gradientfx/types`
- Produces: default-exported `EmbedSurface` with `kind: 'gradient'`; `GradientEmbedConfig` = `{ cfg: GradientConfig; duration: number }`; `frontend/public/embed/gradient.js`

- [ ] **Step 1: Write the failing registry test**

In `frontend/tests/unit/embed-registry.unit.spec.ts`, extend the existing suite:

```ts
  it('lists gradient as an embeddable kind', () => {
    expect(embedSurfaceKinds()).toContain('gradient')
  })

  it('loads the gradient surface with the right kind and declared caps', async () => {
    const s = await loadEmbedSurface('gradient')
    expect(s).not.toBeNull()
    expect(s!.kind).toBe('gradient')
    expect(typeof s!.caps.alpha).toBe('boolean')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/embed-registry.unit.spec.ts`
Expected: FAIL — `gradient` is not in the registry

- [ ] **Step 3: Write the adapter**

Create `frontend/app/lib/embed/surfaces/gradient.ts`:

```ts
import type { EmbedSurface, EmbedHandle } from '../contract'
import { GradientFxRenderer } from '~/lib/gradientfx/renderer'
import type { GradientConfig } from '~/lib/gradientfx/types'

/**
 * Gradient is fully procedural — GradientConfig references no images, textures
 * or URLs — so an embed carries no asset payload at all.
 *
 * Do NOT import ~/lib/gradientfx/frameSource here: it holds a module-level
 * `ref(0)` and would drag Vue into the bundle.
 */
export interface GradientEmbedConfig {
  cfg: GradientConfig
  /** Loop length in seconds. render() takes seconds, not t01. */
  duration: number
}

const gradientEmbedSurface: EmbedSurface = {
  kind: 'gradient',
  // Declared, not assumed. Task 2 Step 7 measures this empirically; set it to
  // whatever that measurement shows and record the evidence in the report.
  caps: { alpha: false },

  async mount(container: HTMLElement, config: unknown): Promise<EmbedHandle> {
    const embed = config as GradientEmbedConfig
    if (!embed?.cfg) throw new Error('gradient embed: config has no cfg')

    // Own instance, not the globalThis-cached singleton — two embeds on one
    // page must not share a GL context.
    const renderer = new GradientFxRenderer()
    let w = Math.max(1, container.clientWidth || 512)
    let h = Math.max(1, container.clientHeight || 512)
    let mounted: HTMLCanvasElement | null = null

    const draw = (t01: number) => {
      // render() applies motion internally (renderer.ts imports applyMotion),
      // so the adapter must NOT apply it again — that would double-apply.
      // `time` is in SECONDS.
      const out = renderer.render(embed.cfg, w, h, t01 * embed.duration)
      if (out !== mounted) {
        if (mounted) mounted.remove()
        out.style.display = 'block'
        out.style.width = '100%'
        out.style.height = '100%'
        container.appendChild(out)
        mounted = out
      }
    }

    draw(0)

    return {
      setTime: (t01: number) => draw(t01),
      setSize: (nw: number, nh: number) => {
        w = Math.max(1, Math.round(nw))
        h = Math.max(1, Math.round(nh))
      },
      destroy: () => {
        if (mounted) { mounted.remove(); mounted = null }
        // Mirrors the shader adapter: release the GL context, don't just
        // detach the canvas. Browsers cap live contexts at ~16.
        ;(renderer as unknown as { dispose?: () => void }).dispose?.()
      },
    }
  },
}

export default gradientEmbedSurface
```

- [ ] **Step 4: Add a dispose method to GradientFxRenderer**

The shader adapter's `destroy()` calls `ShaderFxRenderer.dispose()`, which releases programs, FBOs and textures then calls `WEBGL_lose_context.loseContext()`. `GradientFxRenderer` needs the equivalent, or a page that mounts and destroys several gradient embeds exhausts the browser's context budget.

Read `frontend/app/lib/shaderfx/renderer.ts`'s `dispose()` as the reference and `frontend/app/lib/engine/gl/glRenderer.ts` for the `loseContext` precedent. Then add a `dispose()` to `GradientFxRenderer` that releases everything that class owns — read its field declarations to enumerate them, do not guess. It must be idempotent and safe before first render (when `gl` is still null).

This is an ADDITIVE change to a shared file. Do not modify anything that already exists in it.

Then replace the defensive optional call in the adapter with a direct one:

```ts
        renderer.dispose()
```

- [ ] **Step 5: Register the surface**

In `frontend/app/lib/embed/surfaces.ts`, add one line to `REGISTRY`:

```ts
  gradient: () => import('./surfaces/gradient'),
```

- [ ] **Step 6: Emit a second bundle**

`vite.embed.config.ts` currently hardcodes the shader entry. Parameterise it by an env var so one config builds either bundle, then have `build:embed` run it once per surface.

In `frontend/app/lib/embed/entry-gradient.ts`:

```ts
import surface from './surfaces/gradient'

// The embed runtime in bundle.ts looks for exactly this global.
;(globalThis as any).__SAILOR_SURFACE__ = surface
```

In `frontend/vite.embed.config.ts`, replace the hardcoded entry and `fileName` with values derived from `process.env.SAILOR_EMBED_SURFACE` (defaulting to `shader` so an unparameterised run still works). Keep `formats: ['iife']`, `copyPublicDir: false`, and `outDir: 'public/embed'`.

**Important:** `emptyOutDir: true` would make the second build delete the first bundle. Set `emptyOutDir: false` and note why in a comment.

In `frontend/package.json`:

```json
"build:embed": "SAILOR_EMBED_SURFACE=shader vite build --config vite.embed.config.ts && SAILOR_EMBED_SURFACE=gradient vite build --config vite.embed.config.ts"
```

- [ ] **Step 7: Extend the build-output test and measure alpha**

In `frontend/tests/unit/embed-build-output.unit.spec.ts`, generalise the existing assertions to run over both `shader.js` and `gradient.js` — each must exist, assign `__SAILOR_SURFACE__`, contain no Vue markers, contain no `import` statements, and sit under the 60,000-byte ceiling.

Separately, determine empirically whether Gradient can render a transparent background: inspect how `renderer.ts` creates its GL context and whether `GRADIENT_FS` ever writes alpha < 1. Set `caps.alpha` to what you find and record the evidence in your report. If it is genuinely `true`, say so prominently — Gradient would be the first surface where the transparency plumbing does anything, and that is worth knowing.

- [ ] **Step 8: Build and verify**

Run: `cd frontend && npm run build:embed`
Expected: writes BOTH `public/embed/shader.js` and `public/embed/gradient.js`

Run: `cd frontend && npx vitest run tests/unit/embed-registry.unit.spec.ts tests/unit/embed-build-output.unit.spec.ts`
Expected: PASS

Report both bundle sizes.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/embed/surfaces/gradient.ts frontend/app/lib/embed/entry-gradient.ts frontend/app/lib/embed/surfaces.ts frontend/app/lib/gradientfx/renderer.ts frontend/vite.embed.config.ts frontend/package.json frontend/tests/unit/embed-registry.unit.spec.ts frontend/tests/unit/embed-build-output.unit.spec.ts
git commit -m "feat(embed): gradient adapter, registry entry and second prebuilt bundle"
```

---

### Task 3: Generalise the harness and prove the contract for Gradient

**Files:**
- Modify: `frontend/app/pages/dev/embed-harness.vue`
- Test: `frontend/tests/embed-gradient.spec.ts`

**Interfaces:**
- Consumes: `loadEmbedSurface`, `exportEmbedHtml`, the `GradientEmbedConfig` type
- Produces: `window.__embedHarness.mount(slot, kind?)`, `.exportHtml(kind?)`, `.studioRef(t01, kind?)`, `.corrupt(kind?)` — all defaulting to `'shader'` so existing suites are unaffected

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/embed-gradient.spec.ts`. Mirror the structure of `frontend/tests/embed-contract.spec.ts` and `frontend/tests/embed-parity.spec.ts` — read them first and follow their conventions rather than inventing new ones. Cover:

1. mounts and puts a canvas in the container
2. `setTime` changes the rendered pixels (use a gradient config with flow drift or a motion track, so time genuinely matters)
3. `setSize` resizes the canvas
4. `destroy` removes the canvas
5. two instances on one page render independently
6. the adapter matches the studio path at the same t01 (`studioRef` for gradient must call `gradientFx.render(cfg, w, h, t01 * duration)` — the studio's actual call)
7. the exported file renders live, not just its poster (assert `#sailor-poster` is hidden)
8. the parity check fails when the config is deliberately corrupted

For (8), perturb a parameter that provably changes pixels. Do **not** use anything that could be a no-op — verify your choice by running the test both ways.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-gradient.spec.ts --project=chromium`
Expected: FAIL — the harness has no gradient support

- [ ] **Step 3: Generalise the harness**

In `frontend/app/pages/dev/embed-harness.vue`, keep the existing shader fixture exactly as-is and add a gradient fixture alongside it. Every `window.__embedHarness` method takes an optional `kind` defaulting to `'shader'`, so `frontend/tests/embed-contract.spec.ts`, `embed-export.spec.ts` and `embed-parity.spec.ts` keep passing untouched.

Build the gradient fixture from the studio's own defaults — read how `GradientStudioSurface.vue` obtains its initial config (there is a presets/defaults module in `frontend/app/lib/gradientfx/`) rather than hand-authoring a config shape the real code would never produce.

Give the fixture visible motion so test (2) is meaningful: either a motion track or non-zero `flow.speed` with non-zero `flow.intensity`.

Add slots for the gradient tests following the existing `#slot-a` / `#slot-b` pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run build:embed`
Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-gradient.spec.ts --project=chromium`
Expected: PASS, 8 tests

- [ ] **Step 5: Confirm no regression in the existing suites**

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-contract.spec.ts tests/embed-export.spec.ts tests/embed-parity.spec.ts --project=chromium`
Expected: PASS, 15 tests

- [ ] **Step 6: Commit**

```bash
git add frontend/app/pages/dev/embed-harness.vue frontend/tests/embed-gradient.spec.ts
git commit -m "test(embed): contract and parity coverage for the gradient adapter"
```

---

### Task 4: Export button in Gradient Studio

**Files:**
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue`

**Interfaces:**
- Consumes: `exportEmbedHtml`, `downloadEmbed` from `~/lib/embed/export`; `GradientEmbedConfig` from `~/lib/embed/surfaces/gradient`
- Produces: nothing consumed downstream

- [ ] **Step 1: Read the shader implementation first**

Read `exportWebEmbed` in `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`. It handles: an in-flight guard, computing dimensions, building the embed config, showing the size **before** downloading, and distinguishing an error message from a success message. Mirror all of that. Gradient's version is simpler — no source image, no def filtering, no animated-source refusal.

- [ ] **Step 2: Add the handler**

In `frontend/app/components/vue-canvas/GradientStudioSurface.vue`, add the imports and a handler following the shader pattern. Derive width/height the same way the file's existing save/bake path does (see around `:470` and `:532`) — do not invent new sizing logic. Duration is `config.value.motion?.duration ?? 4`, matching `loop()`.

The embed config is just:

```ts
const embedConfig: GradientEmbedConfig = {
  cfg: structuredClone(toRaw(config.value)),
  duration,
}
```

Confirm `toRaw` is imported in this file; add it to the existing `vue` import if not.

- [ ] **Step 3: Add the button**

Place it beside the existing footer actions, matching the shader studio's markup including the disabled-while-exporting state and the message span.

- [ ] **Step 4: Verify end to end**

Run: `cd frontend && npm run build:embed`

Then drive it through Playwright rather than by hand: extend `frontend/tests/embed-gradient.spec.ts` with a check that a gradient export produced through the harness has no external references (`externalRefs(html)` is `[]`) and reports a plausible size. Report the actual exported file size in KB — it should be far smaller than the shader export's 47 KB, since Gradient carries no source image.

- [ ] **Step 5: Run everything**

Run: `cd frontend && npx vitest run tests/unit/embed-registry.unit.spec.ts tests/unit/embed-build-output.unit.spec.ts tests/unit/embed-bundle.unit.spec.ts tests/unit/embed-clock.unit.spec.ts tests/unit/gradientfx-instances.unit.spec.ts tests/unit/shaderfx-instances.unit.spec.ts`

Run: `cd frontend && PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-contract.spec.ts tests/embed-export.spec.ts tests/embed-parity.spec.ts tests/embed-gradient.spec.ts --project=chromium`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/GradientStudioSurface.vue frontend/tests/embed-gradient.spec.ts
git commit -m "feat(embed): export action in Gradient Studio"
```

---

## Done when

- Both `public/embed/shader.js` and `public/embed/gradient.js` are emitted by one `npm run build:embed`
- The gradient suite passes, and the three existing embed suites still pass unchanged
- Clicking **Export embed** in Gradient Studio downloads an `.html` that animates when opened from disk
- `caps.alpha` for Gradient reflects a measurement, not a guess

## The real question this plan answers

Shader was chosen as the fixture *because* it was already shaped like the contract. Gradient is the first surface that wasn't designed against it. If the adapter lands in roughly the shape above with no changes to `contract.ts`, `bundle.ts`, or `export.ts`, the contract generalises. **If any of those three files needs to change, that is the most important finding of this work — report it prominently rather than quietly making the edit.**
