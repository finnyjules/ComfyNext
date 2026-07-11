# Type Studio Hardening — Pass 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Type Studio (Space Type) feature production-safe and coherent — survive bad params / missing WebGL / many nodes, render smoothly while authoring, and present one consistent, recoverable, accessible editor — without adding features.

**Architecture:** All work is edits to the existing imperative Three.js engine (`app/lib/spacetype/engine.ts`), the node card (`SpaceTypeNode.vue`), the editor modal (`SpaceTypeSurface.vue`), the shared studio shell/section components, and the effect modules. One new tiny pure helper (`webgl.ts`) and one new optional seam field (`liveKeys` on `SpaceTypeEffect`). Backward compatible throughout.

**Tech Stack:** Nuxt 4, Vue 3 (`<script setup>` + Composition API), TypeScript, Three.js 0.171, Vitest (unit tests in `frontend/tests/unit/`).

## Global Constraints

- **No new features.** Presets, randomize, the effect gallery, color-model unification, and font-picker consolidation are Pass 2 — out of scope.
- **No purple/violet accents.** Accents are white-opacity + type-color + emerald-for-run only.
- All sliders use the unified global `input[type=range]` / `studio-range` look (already in `main.css`) — don't introduce per-component slider styles.
- **Engine handles are never wrapped in a Vue reactive proxy** (`let engine: … | null = null`, plain variable) — follow the existing pattern.
- Run unit tests from `frontend/` with `npm run test:unit` (Vitest). Visual/WebGL changes are verified with the standalone-harness + screenshot loop, not unit tests alone (jsdom has no WebGL).
- Commit after every task with a `type(scope): summary` message; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work directly on `main` — do not create feature branches.

---

## Task 1: Distinct effect display names (C1)

Every effect object sets `label: 'Text'`, so the Effect picker (`SpaceTypeSurface.vue:643`, `{{ e.label }}`) and the modal breadcrumb (`:611`) show "Text" 21×. `label` is the effect's human display name on the `SpaceTypeEffect` seam (`effect.ts:50`) — give each a distinct one. (The per-effect text *input* caption is a separate `text`/`textList` control with its own `label`, untouched here.)

**Files:**
- Modify: every `app/lib/spacetype/effects/*.ts` — the top-level `label:` field on each exported effect object (ribbon, stripes, cylinder, field, coil, cascade, boost, melt, onionburst, elastic, string, blend, echo, sliceGlitch, streamer, spiral, tunnel, contour, ball, turntable, tear, slitScan).
- Test: `frontend/tests/unit/spacetype-effect-labels.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `SPACE_TYPE_EFFECTS` from `app/lib/spacetype/effects/index.ts` (array of `SpaceTypeEffect`, each with `id`, `label`).
- Produces: each effect's `label` is now its unique display name.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-effect-labels.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'

describe('space type effect labels', () => {
  it('every effect has a non-empty label that is not the generic "Text"', () => {
    for (const e of SPACE_TYPE_EFFECTS) {
      expect(e.label, `effect ${e.id}`).toBeTruthy()
      expect(e.label.toLowerCase(), `effect ${e.id}`).not.toBe('text')
    }
  })
  it('labels are unique across effects', () => {
    const labels = SPACE_TYPE_EFFECTS.map(e => e.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-effect-labels.unit.spec.ts`
Expected: FAIL — labels are all "Text" (both assertions fail).

- [ ] **Step 3: Give each effect a distinct label**

In each `app/lib/spacetype/effects/*.ts`, change the effect object's `label: 'Text'` to a distinct display name matching the effect. Suggested names (use the effect's established concept; keep Title Case):

```
ribbon → 'Ribbon'        stripes → 'Stripes'      cylinder → 'Cylinder'
field → 'Field'          coil → 'Coil'            cascade → 'Cascade'
boost → 'Boost'          melt → 'Melt'            onionburst → 'Onion Burst'
elastic → 'Elastic'      string → 'String'        blend → 'Blend'
echo → 'Echo'            sliceGlitch → 'Slice Glitch'  streamer → 'Streamer'
spiral → 'Spiral'        tunnel → 'Tunnel'        contour → 'Contour'
ball → 'Ball'            turntable → 'Turntable'  tear → 'Tear'
slitScan → 'Slit Scan'
```

Only change the **top-level** `label` on the effect object (the one next to `id:` and `controls:`). Do **not** change any control's `label` inside the `controls` array.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-effect-labels.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full spacetype suite to check nothing else asserts on labels**

Run: `cd frontend && npx vitest run tests/unit/spacetype-*.unit.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects frontend/tests/unit/spacetype-effect-labels.unit.spec.ts
git commit -m "fix(space-type): give each effect a distinct display label

Picker + breadcrumb showed 'Text' 21x. Each effect's seam-level label
is now its unique display name; uniqueness guarded by a unit test.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Require `group`; fix section open-state source (C3)

`ControlSpec.group` is optional with a dead `?? 'Other'` fallback (`SpaceTypeSurface.vue:185`) — `'Other'` isn't a section, so a group-less control is silently hidden. The `openSections` map (`:181-183`) is hand-listed: it's missing `'Stroke'` (which IS a section → falls back to always-open) and carries `'Post'` (a surface-injected section not in `SPACE_TYPE_SECTIONS`). Make `group` required and derive `openSections` from the section list plus an explicit `Post`.

**Files:**
- Modify: `app/lib/spacetype/effect.ts` (the `ControlSpec` union, lines 12-28)
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (`:181-186`)
- Test: `frontend/tests/unit/spacetype-sections.unit.spec.ts` (extend existing)

**Interfaces:**
- Consumes: `SPACE_TYPE_SECTIONS` from `app/lib/spacetype/sections.ts`; `SPACE_TYPE_EFFECTS` from the effects registry.
- Produces: every `ControlSpec` has a required `group: string`; `openSections` keys are derived, including `Stroke` and `Post`.

- [ ] **Step 1: Extend the sections test to require a group on every control**

Open `frontend/tests/unit/spacetype-sections.unit.spec.ts` and add a test asserting every control on every registered effect declares a non-empty `group`:

```ts
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'
// ...existing imports/tests...

it('every control on every effect declares a non-empty group', () => {
  for (const e of SPACE_TYPE_EFFECTS) {
    for (const c of e.controls) {
      expect(c.group, `${e.id}.${c.key}`).toBeTruthy()
    }
  }
})
```

- [ ] **Step 2: Run the test — it should PASS already (all controls have groups today)**

Run: `cd frontend && npx vitest run tests/unit/spacetype-sections.unit.spec.ts`
Expected: PASS (this locks in the invariant before we make it type-required).

- [ ] **Step 3: Make `group` required in the `ControlSpec` union**

In `app/lib/spacetype/effect.ts`, change `group?: string` to `group: string` in **all seven** variants of the `ControlSpec` union (slider, text, textList, fillList, color, select, font, path — lines 13-27).

- [ ] **Step 4: Remove the dead `'Other'` fallback and derive `openSections`**

In `SpaceTypeSurface.vue`, replace the `openSections` literal and the `sections` computed (lines 181-186) with:

```ts
// Sections that should start collapsed; everything else starts open. 'Post' is a
// surface-injected section (not in SPACE_TYPE_SECTIONS) rendered as a standalone card.
const DEFAULT_COLLAPSED = new Set([
  'Layout', 'Skew', 'Warp', 'Stroke', 'Doodles', 'Shadow', 'Wave', 'Motion', 'Transform', 'Post', 'Output',
])
const openSections = reactive<Record<string, boolean>>(
  Object.fromEntries([...SPACE_TYPE_SECTIONS, 'Post'].map(name => [name, !DEFAULT_COLLAPSED.has(name)])),
)
const sections = computed(() =>
  SECTION_ORDER.map(name => ({ name, controls: effect.value.controls.filter(c => c.group === name) })),
)
```

(`SECTION_ORDER` is already `SPACE_TYPE_SECTIONS` at line 180 — keep it.)

- [ ] **Step 5: Typecheck + run the spacetype suite**

Run: `cd frontend && npx vue-tsc --noEmit && npx vitest run tests/unit/spacetype-sections.unit.spec.ts`
Expected: typecheck clean (every control already has a group, so making it required compiles); test PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/spacetype-sections.unit.spec.ts
git commit -m "fix(space-type): require control group; derive section open-state

group is now required on ControlSpec (kills the dead ?? 'Other' that
silently hid group-less controls). openSections is derived from
SPACE_TYPE_SECTIONS + Post, fixing the missing 'Stroke' key. Test now
fails if any control omits a group.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Make collapsible sections honor `:open` after the first toggle (D1)

`StudioSection.vue` does `const isOpen = ref(props.open)` with no `watch`, so when the modal switches effects (reusing the same `v-for` `<StudioSection>` instances) each section keeps whatever the user last toggled instead of the new effect's intended default. Add a `watch` on `props.open`.

**Files:**
- Modify: `app/components/vue-canvas/StudioSection.vue` (lines 5-9)

**Interfaces:**
- Consumes: `openSections` from Task 2 (the `:open` binding source).
- Produces: `<StudioSection>` re-applies `:open` when it changes. Shared component — Gradient/Shader/Texture studios also use it; behavior change is "respects open prop updates," which they currently don't rely on (they pass static values).

- [ ] **Step 1: Add the watch**

In `StudioSection.vue`, change the script block:

```ts
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ title: string; badge?: string; open?: boolean }>(), { open: true })
const isOpen = ref(props.open)
// Re-apply the open prop when it changes (e.g. switching effects in Type Studio
// re-targets the same section instances at a new effect's default open-state).
watch(() => props.open, v => { isOpen.value = !!v })
```

- [ ] **Step 2: Verify manually in the harness/app**

Run the app (`cd frontend && npm run dev`), open a Type Studio node, expand/collapse a few sections, switch effects, and confirm sections reset to the new effect's defaults (e.g. `Layout`/`Warp` start collapsed). Confirm Gradient/Shader/Texture modals still open/collapse normally.
Expected: section defaults track the active effect; no regression in other studios.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/StudioSection.vue
git commit -m "fix(studio): StudioSection re-applies :open when it changes

Without a watch on props.open, per-effect default collapse state was
dead after the first user toggle (v-for reuses section instances).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Release the WebGL context on engine dispose (A3)

`SpaceTypeEngine.dispose()` calls `renderer.dispose()` but never `renderer.forceContextLoss()`, so each disposed engine's WebGL context lingers until GC. Every other 3D surface in the codebase calls it (`Artifact3DNode.vue:152`, `PoseEditorModal.vue:401`). One-line fix; pairs with Task 7's context budgeting.

**Files:**
- Modify: `app/lib/spacetype/engine.ts` (`dispose()`, lines 211-215)

**Interfaces:**
- Consumes: nothing new.
- Produces: `dispose()` promptly frees the GL context.

- [ ] **Step 1: Add `forceContextLoss()` before `dispose()`**

In `engine.ts`, change `dispose()`:

```ts
  dispose(): void {
    this.disposeRoot()
    this.postChain?.dispose()
    // Free the underlying WebGL context promptly (renderer.dispose alone leaves it
    // alive until GC — with one context per node that hits the browser's ~16 cap).
    this.renderer.forceContextLoss()
    this.renderer.dispose()
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/lib/spacetype/engine.ts
git commit -m "fix(space-type): forceContextLoss() on engine dispose

renderer.dispose() alone leaves the GL context alive until GC; with one
context per node this leaks toward the browser's ~16-context cap.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Guard the render loop so a thrown effect can't freeze the studio (A1)

There's no try/catch around `engine.build()` / `effect.update()` / `renderer.render()`. One bad param combo (NaN geometry, a font-outline failure) escapes the rAF `tick()`, the loop is never rescheduled, and both previews silently die with no recovery. Catch in the engine (so the loop survives a bad frame) and surface a recoverable error flag the UI can show.

**Files:**
- Modify: `app/lib/spacetype/engine.ts` (`build` ~171-178, `renderFrame` ~184-201, add an error accessor)
- Modify: `app/components/vue-canvas/SpaceTypeNode.vue` (tick loop + an error badge)
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (tick loop + an error overlay)

**Interfaces:**
- Consumes: nothing new.
- Produces: `engine.lastError: string | null` (read-only getter) — set when `build`/`renderFrame` throws, cleared on the next successful one. Tasks 6/7 also read engine state but don't depend on this field's name beyond this task; keep the name `lastError`.

- [ ] **Step 1: Add error capture in the engine**

In `engine.ts`, add a private field and a getter, and wrap the throwing calls. Add near the other private fields (after line 39):

```ts
  private _lastError: string | null = null
  /** Last build/render error (null when the most recent frame succeeded). */
  get lastError(): string | null { return this._lastError }
```

Wrap `build` (replace lines 171-178):

```ts
  /** (Re)build the scene from params; call when structural params change. */
  build(params: Params, texOpts: TextTextureOptions): void {
    try {
      this.disposeRoot()
      const tex = makeTextTexture(texOpts)
      this.textTex = tex
      this.root = this.effect.buildScene(THREE, params, tex, { width: this.opts.width, height: this.opts.height, axes: texOpts.axes })
      this.scene.add(this.root)
      this._lastError = null
    } catch (e) {
      this._lastError = e instanceof Error ? e.message : String(e)
      console.error('[space-type] build failed', e)
    }
  }
```

Wrap the body of `renderFrame` (lines 184-201) in try/catch so a bad frame can't kill the caller's loop:

```ts
  renderFrame(index: number, params: Params): void {
    try {
      const t01 = (index % this.frameCount) / this.frameCount
      const scale = Number(params.scale ?? 1) || 1
      this.scene.rotation.set(Number(params.rotateX ?? 0), Number(params.rotateY ?? 0), Number(params.rotateZ ?? 0))
      if (this.opts.projection === 'isometric') {
        this.orthoCam.zoom = scale
        this.orthoCam.updateProjectionMatrix()
        this.applyPan(this.orthoCam)
      } else {
        this.perspCam.position.z = 14 / scale
        this.applyPan(this.perspCam)
      }
      this.effect.update(t01, params)
      if (postEnabled(this.post) && this.postChain) this.postChain.render(this.scene, this.activeCam)
      else this.renderer.render(this.scene, this.activeCam)
      this._lastError = null
    } catch (e) {
      this._lastError = e instanceof Error ? e.message : String(e)
      // Log once per error transition, not every frame.
      if (!this._loggedError) { console.error('[space-type] render failed', e); this._loggedError = true }
    }
  }
```

Add the de-dupe flag with the other private fields and clear it on success. Add after `_lastError`:

```ts
  private _loggedError = false
```

And in the `try` block of `renderFrame`, right after `this._lastError = null`, add `this._loggedError = false`. (In `build`'s success path, also `this._loggedError = false`.)

- [ ] **Step 2: Surface the error in the modal (`SpaceTypeSurface.vue`)**

Add a reactive error mirror polled from the engine in the `tick`. Change the `tick` in `startPreview` (lines 338-345) to copy the engine error each frame:

```ts
  const tick = (ts: number) => {
    if (!previewStart) previewStart = ts
    const total = Math.max(1, Math.round(fps.value * loopDuration.value))
    previewFrame = Math.floor(((ts - previewStart) / 1000) * fps.value) % total
    engine?.renderFrame(previewFrame, params)
    renderError.value = engine?.lastError ?? null
    raf = requestAnimationFrame(tick)
  }
```

Add the ref near the other refs (after line 176):

```ts
const renderError = ref<string | null>(null)
```

Add an overlay inside the preview template, after the `<canvas>` (after line 614):

```vue
<div v-if="renderError"
     class="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-amber-400/30 bg-black/70 px-3 py-2 text-[11px] text-amber-200/90">
  Effect failed to render — adjust a parameter to recover.
</div>
```

- [ ] **Step 3: Surface the error on the node card (`SpaceTypeNode.vue`)**

In `SpaceTypeNode.vue`, mirror the engine error in the `tick` (lines 66-74):

```ts
  const tick = (ts: number) => {
    if (!engine) return
    if (!previewStart) previewStart = ts
    const s = state.value
    const total = Math.max(1, Math.round(s.fps * s.loopDuration))
    const frame = Math.floor(((ts - previewStart) / 1000) * s.fps) % total
    engine.renderFrame(frame, s.params)
    renderError.value = engine.lastError
    raf = requestAnimationFrame(tick)
  }
```

Add the ref after line 49 (`let raf = 0`):

```ts
const renderError = ref<string | null>(null)
```

Add a small badge in the preview block, after the `<canvas>` (after line 175):

```vue
<div v-if="renderError"
     class="absolute inset-x-2 bottom-2 rounded border border-amber-400/30 bg-black/70 px-2 py-1 text-[9px] text-amber-200/90">
  Render error
</div>
```

(The preview `<div>` wrapping the canvas at line 170 needs `class="… relative"` — add `relative` so the absolute badge anchors to it.)

- [ ] **Step 4: Verify manually — force a throw**

Run the app, open a Type Studio node. Temporarily make one effect's `update()` throw (e.g. `throw new Error('test')` at the top of an effect's `update`), confirm: the preview shows the overlay, the loop keeps running, and removing the throw / nudging a param recovers without a reload. Revert the temporary throw.
Expected: no permanent freeze; overlay appears and clears.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/engine.ts frontend/app/components/vue-canvas/SpaceTypeNode.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "fix(space-type): guard the render loop against thrown effects

build/renderFrame now catch and expose engine.lastError instead of
escaping the rAF tick (which permanently froze both previews). Modal
shows a recoverable overlay; node card shows a badge.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: WebGL capability guard + graceful placeholder (A2)

`new THREE.WebGLRenderer()` is constructed unconditionally in `onMounted` on both the node card and the modal. On a machine without WebGL it throws and breaks the mount. Add a pure `detectWebGL()` helper and guard both mounts.

**Files:**
- Create: `app/lib/spacetype/webgl.ts`
- Modify: `app/components/vue-canvas/SpaceTypeNode.vue` (`onMounted` ~83-95, template)
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (`onMounted` ~416-432, template)
- Test: `frontend/tests/unit/spacetype-webgl-detect.unit.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `detectWebGL(): boolean` from `app/lib/spacetype/webgl.ts` — true when a WebGL context can be created.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-webgl-detect.unit.spec.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectWebGL } from '~/lib/spacetype/webgl'

afterEach(() => vi.restoreAllMocks())

describe('detectWebGL', () => {
  it('returns false when no WebGL context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as any)
    expect(detectWebGL()).toBe(false)
  })
  it('returns true when a context is returned', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as any)
    expect(detectWebGL()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-webgl-detect.unit.spec.ts`
Expected: FAIL — module `~/lib/spacetype/webgl` not found.

- [ ] **Step 3: Implement the helper**

Create `app/lib/spacetype/webgl.ts`:

```ts
/** True when the browser can create a WebGL context. Cached after the first probe
 *  (a failed probe is permanent for the session; a success won't regress). */
let _cached: boolean | null = null

export function detectWebGL(): boolean {
  if (_cached !== null) return _cached
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    _cached = !!gl
  } catch {
    _cached = false
  }
  return _cached
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-webgl-detect.unit.spec.ts`
Expected: PASS. (If the cache makes the second assertion observe the first's value, the test mocks before any prior call — keep `detectWebGL` uncalled elsewhere in the test. The cache resets per module import; Vitest isolates modules per file.)

- [ ] **Step 5: Guard the node-card mount**

In `SpaceTypeNode.vue`, import the helper and add a guard ref:

```ts
import { detectWebGL } from '~/lib/spacetype/webgl'
```

Add after line 49:

```ts
const webglOk = ref(true)
```

Wrap the engine construction in `onMounted` (lines 83-95):

```ts
onMounted(async () => {
  if (!canvasEl.value) return
  if (!detectWebGL()) { webglOk.value = false; return }
  const s = state.value
  // …unchanged construction + rebuild + startPreview + registerStudioBaker…
})
```

In the template, replace the `<canvas>` block (lines 170-176) so it falls back to a placeholder:

```vue
<div class="relative flex items-center justify-center bg-neutral-950">
  <canvas v-if="webglOk" ref="canvasEl" class="block w-full" :style="{ height: previewH + 'px' }" />
  <div v-else class="flex w-full items-center justify-center px-3 text-center text-[10px] text-white/40"
       :style="{ height: previewH + 'px' }">3D preview unavailable</div>
</div>
```

- [ ] **Step 6: Guard the modal mount**

In `SpaceTypeSurface.vue`, import the helper (add to the imports near line 9) and add a ref near line 176:

```ts
import { detectWebGL } from '~/lib/spacetype/webgl'
// …
const webglOk = ref(true)
```

In `onMounted` (lines 416-432), bail before constructing the engine:

```ts
onMounted(async () => {
  if (!canvas.value) return
  loadConfig()
  pullTextLines()
  pullFills()
  if (!detectWebGL()) { webglOk.value = false; return }
  engine = new SpaceTypeEngine(canvas.value, { /* …unchanged… */ })
  // …unchanged…
})
```

Add a message over the preview when unavailable, after the canvas (after line 614):

```vue
<div v-if="!webglOk" class="absolute inset-0 flex items-center justify-center text-xs text-white/50">
  3D preview unavailable on this device.
</div>
```

- [ ] **Step 7: Verify + typecheck**

Run: `cd frontend && npx vitest run tests/unit/spacetype-webgl-detect.unit.spec.ts && npx vue-tsc --noEmit`
Expected: PASS + clean. Manually confirm normal machines still render (WebGL present → unchanged path).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/spacetype/webgl.ts frontend/app/components/vue-canvas/SpaceTypeNode.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/spacetype-webgl-detect.unit.spec.ts
git commit -m "fix(space-type): guard WebGL availability with a placeholder

detectWebGL() gates engine construction on the node card and modal so a
WebGL-less device gets a placeholder instead of a thrown onMounted.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Gate the per-node context + rAF on visibility and editing (A4)

Each mounted node holds a live WebGL2 context + a forever-running rAF, with no offscreen/hidden/editing gating, and keeps rendering behind the open modal (a redundant second context+loop). ~10-14 nodes hits the ~16-context cap → black previews. Gate the node's loop: pause when offscreen (IntersectionObserver), when the tab is hidden (`visibilitychange`), and while this node's editor modal is open.

**Files:**
- Modify: `app/components/vue-canvas/SpaceTypeNode.vue` (lifecycle + gating)

**Interfaces:**
- Consumes: the existing `sailor:openSpaceType` CustomEvent (dispatched by `openEditor`, line 146) and a matching close signal. Inspect `VueNodeCanvas.vue` for how the modal closes (the surface emits `close` → the canvas clears `spaceTypeOpenForId`). Listen for the canvas's open/close; if no close event exists, add one: when the modal closes, `VueNodeCanvas` dispatches `window.dispatchEvent(new CustomEvent('sailor:closeSpaceType'))`.
- Produces: node preview runs only when visible, tab-active, and not being edited.

- [ ] **Step 1: Confirm the close signal**

Read `app/components/vue-canvas/VueNodeCanvas.vue` around the `spaceTypeOpenForId` handling (~line 4765) and the `sailor:openSpaceType` listener. Determine the exact event/flow used to close the modal. If the canvas already toggles a known signal, use it; otherwise add a `sailor:closeSpaceType` window event dispatched when `spaceTypeOpenForId` is cleared.

- [ ] **Step 2: Add gating state + a single resume/pause gate**

In `SpaceTypeNode.vue`, after `let previewStart = 0` (line 50), add:

```ts
let io: IntersectionObserver | null = null
let onVisibility: (() => void) | null = null
let onOpen: ((e: Event) => void) | null = null
let onClose: (() => void) | null = null
const gate = { visible: true, tabActive: true, editing: false }

function applyGate() {
  const shouldRun = gate.visible && gate.tabActive && !gate.editing && !!engine && webglOk.value
  if (shouldRun && !raf) startPreview()
  else if (!shouldRun && raf) stopPreview()
}
```

- [ ] **Step 3: Wire the observers in `onMounted`**

At the end of `onMounted` (after `registerStudioBaker(props.id, bakeOutput)`, line 94), add:

```ts
  io = new IntersectionObserver(([entry]) => { gate.visible = !!entry?.isIntersecting; applyGate() }, { threshold: 0.01 })
  if (canvasEl.value?.parentElement) io.observe(canvasEl.value.parentElement)
  onVisibility = () => { gate.tabActive = !document.hidden; applyGate() }
  document.addEventListener('visibilitychange', onVisibility)
  onOpen = (e: Event) => { if ((e as CustomEvent).detail?.nodeId === props.id) { gate.editing = true; applyGate() } }
  onClose = () => { gate.editing = false; applyGate() }
  window.addEventListener('sailor:openSpaceType', onOpen as EventListener)
  window.addEventListener('sailor:closeSpaceType', onClose as EventListener)
```

(If Step 1 found a different close mechanism, listen to that instead of `sailor:closeSpaceType`.)

- [ ] **Step 4: Tear down in `onBeforeUnmount`**

Replace `onBeforeUnmount` (lines 121-126):

```ts
onBeforeUnmount(() => {
  stopPreview()
  io?.disconnect(); io = null
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  if (onOpen) window.removeEventListener('sailor:openSpaceType', onOpen as EventListener)
  if (onClose) window.removeEventListener('sailor:closeSpaceType', onClose as EventListener)
  unregisterStudioBaker(props.id)
  engine?.dispose()
  engine = null
})
```

- [ ] **Step 5: Don't auto-start the loop unconditionally**

In `onMounted`, the existing `startPreview()` call (line 93) is now redundant with the gate — replace it with `applyGate()` so the first start respects visibility/editing. Also ensure `bakeOutput`'s `finally` (line 117) calls `applyGate()` instead of `startPreview()` so a bake while the modal is open / node offscreen doesn't force the loop back on.

- [ ] **Step 6: Verify manually**

Run the app. Add ~15 Type Studio nodes. Scroll some offscreen, switch browser tabs, open/close a node's editor. Watch the console for WebGL "too many contexts" errors and confirm no black previews.
Expected: offscreen/hidden/being-edited nodes pause; no context-cap errors; previews resume on return.

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "perf(space-type): gate node preview on visibility + editing

IntersectionObserver + visibilitychange + pause-while-this-node's-modal-
open. Stops N perpetual WebGL contexts/loops and the redundant behind-
the-modal render that pushed toward the ~16-context cap.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Debounce the modal's structural rebuild (B1)

The modal's structural-params watch (`SpaceTypeSurface.vue:440-477`) calls `rebuild()` → full dispose+rebuild+text-raster + `await ensureEffectFonts()` synchronously on every change. The node debounces this at ~80ms; the modal — where the user actually drags structural sliders — does not. Add the same debounce.

**Files:**
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (the structural watch, lines 440-477)

**Interfaces:**
- Consumes: nothing new.
- Produces: structural edits coalesce into one rebuild ~80ms after the last change.

- [ ] **Step 1: Add a debounced rebuild wrapper**

In `SpaceTypeSurface.vue`, after the `rebuild()` function (line 330), add:

```ts
// Structural edits (geometry/material/texture) are expensive (dispose + rebuild +
// text raster). Coalesce a burst of slider drags into one rebuild, matching the node.
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
function rebuildDebounced() {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null
    await ensureEffectFonts()
    rebuild()
  }, 80)
}
```

- [ ] **Step 2: Use it in the structural watch**

Change the structural watch callback (line 476) from:

```ts
  async () => { await ensureEffectFonts(); rebuild() },
```

to:

```ts
  () => { rebuildDebounced() },
```

- [ ] **Step 3: Clear the timer on unmount**

In `onBeforeUnmount` (line 434), add `if (rebuildTimer) clearTimeout(rebuildTimer)` before `stopPreview()`.

- [ ] **Step 4: Verify manually**

Run the app, open a Type Studio node on an effect with a structural slider (e.g. Tunnel ring count, Blend steps). Drag the slider continuously and confirm the preview stays smooth (no per-tick hitching) and lands on the correct final value.
Expected: smooth drag; correct end state.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "perf(space-type): debounce the modal's structural rebuild

The node debounced rebuilds at 80ms but the modal — where structural
sliders are actually dragged — rebuilt synchronously per tick.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Scope `preserveDrawingBuffer` to the bake path (B2)

The renderer is constructed with `preserveDrawingBuffer: true` for its whole lifetime (needed only so `canvas.toBlob()` works during bake), taxing every preview frame of every node. Make the live preview use `false` and render the bake frame through an explicit RenderTarget readback so the flag isn't needed.

**Files:**
- Modify: `app/lib/spacetype/engine.ts` (constructor ~44, `frameToBlob` ~204-209)

**Interfaces:**
- Consumes: nothing new.
- Produces: `frameToBlob()` returns the current frame as a PNG without relying on `preserveDrawingBuffer`. Signature unchanged (`async frameToBlob(): Promise<Blob>`), so callers in `SpaceTypeNode.vue` (`bakeOutput`) and `SpaceTypeSurface.vue` (`generateImage`/`generateVideo`) are untouched.

- [ ] **Step 1: Turn off `preserveDrawingBuffer` for the preview renderer**

In `engine.ts` constructor (line 44):

```ts
this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: false })
```

- [ ] **Step 2: Re-render immediately before readback in `frameToBlob`**

Because the swap buffer is no longer preserved, read back in the same tick as a render. The bake callers already call `renderFrame(i, params)` immediately before `frameToBlob()` (see `SpaceTypeNode.vue:110-111`, `SpaceTypeSurface.vue:549-550`, `:585`), so the canvas is current synchronously. Keep `frameToBlob` reading the canvas, but guarantee currency by forcing a final render of the active camera right before `toBlob`:

```ts
  /** Read the current canvas back as a PNG blob. Forces a fresh render first so this
   *  works without preserveDrawingBuffer (the preview renderer disables it for perf). */
  async frameToBlob(): Promise<Blob> {
    if (postEnabled(this.post) && this.postChain) this.postChain.render(this.scene, this.activeCam)
    else this.renderer.render(this.scene, this.activeCam)
    const canvas = this.renderer.domElement
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('space type: frame produced no blob')
    return blob
  }
```

(The extra render is one frame at bake time only — negligible, and it makes readback correct without the buffer flag.)

- [ ] **Step 3: Verify the bake output is correct**

Run: `cd frontend && npx vitest run tests/unit/spacetype-bake.unit.spec.ts`
Expected: PASS. Then manually: open a Type Studio node, "Generate as image", confirm the produced still matches the preview (not black/blank). Generate a short video, confirm frames are correct.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/engine.ts
git commit -m "perf(space-type): drop preserveDrawingBuffer; render-before-readback

The always-on preview no longer pays the preserved-back-buffer cost;
frameToBlob forces a fresh render before toBlob so bake stays correct.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Per-frame waste cleanups — elastic + PostChain.dispose (B3)

Two concrete, low-risk cleanups: `elastic` re-rasters its CanvasTexture every frame even when frozen; `PostChain.dispose()` leaks the `gradePass` ShaderMaterial. (The per-frame `new THREE.Color()` micro-allocations in echo/cylinder are deferred — see Deferred — they need per-usage `.copy()` verification not worth the risk in this pass.)

**Files:**
- Modify: `app/lib/spacetype/effects/elastic.ts` (`update` ~218-232, state type)
- Modify: `app/lib/spacetype/post.ts` (`dispose` ~140-143)

**Interfaces:**
- Consumes: nothing new.
- Produces: elastic skips redundant raster when nothing changed; `PostChain.dispose` frees all passes.

- [ ] **Step 1: Skip elastic's redraw when nothing changed**

In `elastic.ts`, extend the `state` shape to carry a last-draw key. Find the `state = { ctx, tex, uniforms, W, H }` assignment (line 204) and add a `lastKey` field; then guard the raster in `update` (lines 218-224):

```ts
  update(t01, params) {
    if (!state) return
    const cycles = Math.max(0, Math.round(n(params, 'speed')))
    const time = cycles === 0 ? 0 : t01 * cycles * TAU
    // drawMatte is a full 2D-canvas raster + GPU re-upload — skip it when the inputs are
    // unchanged (notably when frozen at cycles=0, time stays 0 and params don't move).
    const key = time + '|' + JSON.stringify(params)
    if (key !== state.lastKey) {
      drawMatte(state.ctx, state.W, state.H, params, time)
      state.tex.needsUpdate = true
      state.lastKey = key
    }
    state.uniforms.uTime.value = time
    state.uniforms.uWarp.value = n(params, 'warp')
    state.uniforms.uPoly.value = n(params, 'polygonal')
    state.uniforms.uWarpScale.value = n(params, 'warpScale')
    const fill = parseFills(params.fills)[0]!
    state.uniforms.uFillColor.value.set(fill.a)
    state.uniforms.uTextColor.value.set(fill.textColor)
  },
```

Update the `state` type/assignment: add `lastKey: ''` to the object literal at line 204, and add `lastKey: string` to the type that `state` is declared with (search the top of `elastic.ts` for the `let state` / state interface and add the field).

- [ ] **Step 2: Complete `PostChain.dispose`**

In `post.ts`, replace `dispose()` (lines 140-143):

```ts
  dispose(): void {
    this.composer.dispose()
    this.bloomPass.dispose()
    this.gradePass.material.dispose()
    this.gradePass.fsQuad?.dispose?.()
  }
```

(`ShaderPass` exposes `.material`; `fsQuad?.dispose?.()` is optional-chained because the property name varies by three version — the optional chain is a safe no-op if absent. `RenderPass` owns no extra targets, so nothing to add for it.)

- [ ] **Step 3: Run the effect + post tests**

Run: `cd frontend && npx vitest run tests/unit/spacetype-blend.unit.spec.ts tests/unit/spacetype-effect.unit.spec.ts`
Expected: PASS. Manually confirm in the app that the Elastic effect still animates when `speed > 0` and is correctly static (but still responds to warp/poly/fill edits) when `speed = 0`.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/elastic.ts frontend/app/lib/spacetype/post.ts
git commit -m "perf(space-type): skip elastic's idle raster; full PostChain.dispose

Elastic no longer re-rasters its CanvasTexture every frame when its
inputs are unchanged (notably frozen at speed=0). PostChain.dispose now
frees the gradePass material/fsQuad.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Move the live/structural param split into the seam (C2)

`SpaceTypeSurface.vue:440-475` hardcodes, per effect, which keys are read live in `update()` (zeroed out of the structural-rebuild signature so a drag doesn't trigger a full rebuild). Every new effect must remember to register here, and the globally-excluded `strokeColor`/`strokeWidth`/`perspective` keys are skipped for *all* effects (the hazard that forced `boost` to invent `extrudePerspective`). Move this knowledge onto the effect via an optional `liveKeys` field.

**Files:**
- Modify: `app/lib/spacetype/effect.ts` (`SpaceTypeEffect` interface, lines 48-56)
- Modify: each `app/lib/spacetype/effects/*.ts` that has live keys (the keys currently listed in the hardcoded block)
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (replace the hardcoded block, lines 440-477)
- Test: `frontend/tests/unit/spacetype-livekeys.unit.spec.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SpaceTypeEffect.liveKeys?: string[]` — keys whose changes do NOT force a structural rebuild (read live in `update()`). Absent → all keys are structural (today's safe default).

- [ ] **Step 1: Add `liveKeys` to the seam**

In `effect.ts`, add to the `SpaceTypeEffect` interface (after `update`, line 55):

```ts
  /** Keys read live in update() each frame (vertex/uniform/transform params). Changing one
   *  should NOT trigger a structural rebuild. Omit → every key is treated as structural. */
  liveKeys?: string[]
```

- [ ] **Step 2: Populate `liveKeys` per effect from the existing hardcoded block**

The hardcoded block (`SpaceTypeSurface.vue:443-474`) is the source of truth for which keys belong to which effect. Distribute them onto each effect object as `liveKeys`. The global view keys (`speed`, `scale`, `rotateX/Y/Z`) apply to all effects — keep those handled centrally (Step 3), and put only the effect-specific ones on each effect:

```
string:    ['speedVary']
ribbon:    ['ribbonRotateX','ribbonRotateY','ribbonRotateZ']
cylinder:  ['waveSpeed','waveCount','waveLatitude','waveLongitude','waveRipple','waveRotate',
            'waveXScale','waveYScale','tweakX','tweakY','tweakZ','cylRotate','cylOffset',
            'spinSpeed','spinRingOffset','spinAlternate']
field:     ['ampZ','ampX','ampY','waveSizeX','waveSizeY','zOffset','xOffset','yOffset']
cascade:   ['rowHeight','fontHeight','waveLength']
boost:     ['depth','tumble','holdFraction','extrudeMode','punchDistance','cubeFlip',
            'cubeAlternate','extrudeAngle','extrudeLean']
echo:      ['driftSpeed']
ball:      ['axisTilt','spinSpeed']
turntable: ['ttCols','ttRows','ttGradient','ttTwist']   // NOT ttRings (structural)
tear:      ['tearAmount','tearFreq','tearPhase','tearStyle','tearDir','tearEdge','tearOverlap','tearSlant']
slitScan:  ['ssDelay','ssMapDir','ssBump','ssBumpFreq','ssBands','ssBandSpeed','ssSpeedMode',
            'ssEase','ssTextCycle','ssMotion','ssPhase']   // NOT ssTileX/ssTileY (structural)
tunnel:    ['rotate','innerWidth','innerHeight','view','direction','flowSpeed','flowDir',
            'strokeWidth','strokeColor','perspective','shadow']
contour:   ['rotate','innerWidth','innerHeight','view','direction','flowSpeed','flowDir',
            'strokeWidth','strokeColor','perspective','shadow']
spiral/streamer: ['speedVary'] if present (check their controls; otherwise omit)
```

Add a `liveKeys: [...]` field to each listed effect's object. Effects not listed get no `liveKeys` (all-structural — unchanged behavior). **Note:** putting `strokeColor`/`strokeWidth`/`perspective` on tunnel/contour specifically (not globally) is the whole point — other effects with those keys now correctly rebuild.

- [ ] **Step 3: Replace the hardcoded block in the surface**

In `SpaceTypeSurface.vue`, replace the structural watch (lines 440-477) with a version that builds the zeroed signature from the active effect's `liveKeys` plus the global view keys:

```ts
// Global view keys are live for every effect (camera/scene transform read per frame).
const GLOBAL_LIVE_KEYS = ['speed', 'scale', 'rotateX', 'rotateY', 'rotateZ']
function structuralSignature(): string {
  const live = new Set([...GLOBAL_LIVE_KEYS, ...(effect.value.liveKeys ?? [])])
  const sig: Record<string, unknown> = {}
  for (const k of Object.keys(params)) sig[k] = live.has(k) ? 0 : params[k]
  return JSON.stringify(sig) + JSON.stringify(gradientStops)
}
watch(structuralSignature, () => { rebuildDebounced() })
```

(`rebuildDebounced` comes from Task 8. `watch` on a function source re-evaluates it each tick — same as the previous `() => JSON.stringify(...)`.)

- [ ] **Step 4: Write a test that live keys don't change the structural signature**

Create `frontend/tests/unit/spacetype-livekeys.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'

describe('effect liveKeys', () => {
  it('every liveKey is an actual control key on that effect', () => {
    for (const e of SPACE_TYPE_EFFECTS) {
      if (!e.liveKeys) continue
      const keys = new Set(e.controls.map(c => c.key))
      for (const lk of e.liveKeys) {
        expect(keys.has(lk), `${e.id}.liveKeys → ${lk} is not a declared control`).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx vitest run tests/unit/spacetype-livekeys.unit.spec.ts`
Expected: PASS. If a liveKey isn't a control key, fix the effect's `liveKeys` list (a couple of the keys above — e.g. `extrudeMode` — may be encoded differently; align to the real control keys the effect declares).

- [ ] **Step 6: Verify manually**

Run the app. For a sampling of effects (tunnel, cylinder, boost, turntable), drag a live param (e.g. tunnel `rotate`, cylinder `waveSpeed`) and confirm it updates smoothly *without* a rebuild hitch; drag a structural param (e.g. turntable `ttRings`, slit-scan `ssTileX`) and confirm it does rebuild.
Expected: live params smooth, structural params rebuild — matching prior behavior, now data-driven.

- [ ] **Step 7: Typecheck + full spacetype suite**

Run: `cd frontend && npx vue-tsc --noEmit && npx vitest run tests/unit/spacetype-*.unit.spec.ts`
Expected: clean + PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/spacetype/effects frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/spacetype-livekeys.unit.spec.ts
git commit -m "refactor(space-type): move live/structural param split to the seam

Each effect now declares liveKeys; the surface builds the structural
rebuild signature from them + global view keys, replacing the hardcoded
per-effect block. Fixes the global strokeColor/perspective over-exclusion.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Escape-to-close + dialog semantics on the shared shell (D2)

`StudioModalShell.vue` shows an "esc" hint chip but nothing handles Escape; there's no `role="dialog"`, `aria-modal`, or focus trap. Wire Escape and add basic dialog semantics. Shared shell — verify Gradient/Shader/Texture still behave.

**Files:**
- Modify: `app/components/vue-canvas/StudioModalShell.vue`

**Interfaces:**
- Consumes: the existing `close` emit (line 12).
- Produces: Escape closes; the dialog has `role="dialog"`/`aria-modal`; focus moves into the dialog on open and the listener is cleaned up.

- [ ] **Step 1: Add the Escape handler + dialog semantics**

In `StudioModalShell.vue`, extend the script:

```ts
import { ref, onMounted, onBeforeUnmount } from 'vue'

defineProps<{ title?: string; breadcrumb?: string }>()
const emit = defineEmits<{ close: [] }>()

const rootEl = ref<HTMLElement | null>(null)
const controlsEl = ref<HTMLElement | null>(null)
let raf = 0
function onControlsScroll() { /* unchanged */ }

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  rootEl.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
```

In the template, set the role/aria/focusability on the dialog container (line 28) and a ref on the root:

```vue
<div ref="rootEl" tabindex="-1" role="dialog" aria-modal="true"
     class="flex h-[640px] max-h-[92vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white outline-none">
```

(Keep the rest unchanged. The `controlsEl` ref and `onControlsScroll` stay as-is.)

- [ ] **Step 2: Verify across all studios**

Run the app. For Type, Gradient, Shader, and Texture studios: open the modal, press Escape → it closes (and the node's config is saved via the surface's `closeEditor`/`close` path). Confirm clicking the ✕ still works and that typing in a text field then pressing Escape closes the modal (acceptable) without breaking input.
Expected: Escape closes every studio modal; no regressions.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/StudioModalShell.vue
git commit -m "fix(studio): Escape closes the modal + dialog a11y semantics

The shared shell advertised 'esc' but never handled it. Adds a keydown
handler, role=dialog/aria-modal, and focuses the dialog on open. Applies
to all studio modals.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Per-effect "Reset to defaults" + surface the reset hint (D3)

The only recovery from a bad param state is an undiscoverable double-click-a-slider (`plugins/studio-reset.client.ts`). Add a visible per-effect "Reset" that restores the current effect's defaults (preserving the carried content keys: text/font), and a small hint that sliders reset on double-click.

**Files:**
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (a reset fn + a button in the Effect card)

**Interfaces:**
- Consumes: `defaultsFromControls` (already imported, line 6); `CARRY_ON_SWITCH` (line 485).
- Produces: a `resetEffectParams()` that resets `params` to the active effect's defaults, keeping text/font, then re-syncs derived editors and rebuilds.

- [ ] **Step 1: Add the reset function**

In `SpaceTypeSurface.vue`, after the `effectId` switch watch (after line 499), add:

```ts
// Reset every param of the CURRENT effect to its defaults, keeping the content you're
// working on (text/font). Mirrors the effect-switch reset without changing effect.
async function resetEffectParams() {
  const next = defaultsFromControls(effect.value.controls)
  for (const k of Object.keys(next)) if (CARRY_ON_SWITCH.has(k) && k in params) next[k] = (params as any)[k]
  for (const k of Object.keys(params)) delete (params as any)[k]
  Object.assign(params, next)
  pullTextLines()
  pullFills()
  await ensureEffectFonts()
  rebuild()
}
```

- [ ] **Step 2: Add the Reset button + hint to the Effect card**

In the Effect card (inside the `<div>` at lines 640-660), after the `Effect` `<select>` (line 644), add a reset row:

```vue
<div class="mt-2 flex items-center justify-between">
  <button type="button" @click="resetEffectParams"
          class="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-white/25">
    Reset to defaults
  </button>
  <span class="text-[10px] text-white/30">Double-click a slider to reset it</span>
</div>
```

- [ ] **Step 3: Verify manually**

Run the app. Open a Type Studio node, drag several sliders into a messy state, click "Reset to defaults" → confirm params return to the effect's defaults while the text/font you set are preserved, and the preview rebuilds. Double-click a single slider → confirm it resets to its own default (existing `v-studio-reset` behavior, now hinted).
Expected: reset works; text/font preserved; hint visible.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(space-type): per-effect Reset to defaults + reset hint

Adds a visible Reset (keeps text/font) and surfaces the previously
undiscoverable double-click-to-reset slider affordance.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `cd frontend && npm run test:unit`
Expected: all green (the ~28 spacetype specs + the 3 new ones).

- [ ] **Typecheck the whole frontend**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: clean.

- [ ] **Manual smoke pass in the app**

Open Type Studio, cycle through several effects, drag live + structural params, open/close via Escape, reset, generate an image, and add ~15 nodes to confirm no context-cap errors. Confirm Gradient/Shader/Texture studios still open/close/collapse normally (shared-shell + StudioSection changes).

---

## Deferred (NOT in this plan)

- **Per-frame `new THREE.Color()` hoist** in `echo.ts`/`cylinder.ts` — needs per-usage `.copy()` verification to share a mutable scratch Color safely; P2 micro-opt, do in a follow-up.
- **Pass 2 enrichment:** presets + seeded randomize, the preset/effect **gallery with thumbnails**, `fills`-vs-`textColor` color-model unification, font-picker consolidation onto `widgets/FontPicker.vue`, replacing `alert()` calls with in-theme toasts.
- **Shared/pooled renderer** for node previews (only if Task 7's gating proves insufficient).
- **Vessell color/pattern preset library across the board** — separate project, its own spec.
```
