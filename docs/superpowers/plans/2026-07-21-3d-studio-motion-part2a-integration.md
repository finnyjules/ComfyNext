# 3D Studio Motion — Part 2a: Integration & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 3D Studio scenes actually move and export — render a motion frame at time `t`, register a `StudioFrameSource` so a wired Frame animates + exports the scene, add a Build │ Motion tab with a minimal motion panel + transport, and a direct "Export video" button.

**Architecture:** Builds directly on Part 1's `frontend/app/lib/scene3d/motion/` library (`applyMotionToDoc`, `evaluate*`, templates). Adds: a GL render helper (`motion/render.ts`) that composes `home ∘ motion(t)` into the live `SceneEngine` and renders a beauty frame; a frame-source factory (`motion/frameSource.ts`) mirroring `spacetype/frameSource.ts`; registration from the node card via a lazily-created headless `SceneEngine` gated on `sceneHasMotion`; and Motion-tab UI + transport + export in `Scene3DStudioSurface.vue`, reusing the existing bake→`/sailor/spacetype_encode` pipeline.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Three.js, Vitest 4. Reuses `SceneEngine` (`~/lib/scene3d/engine`), `applyMotionToDoc` (Part 1), `registerStudioFrameSource`/`isAnimatedSource` (`~/lib/studio/frameSource`), `ensureSpaceTypeBake` (`~/lib/spacetype/bake`), house controls `StudioSection`/`StudioSlider`/`StudioSegmented`/`StudioSwitch`/`StudioButton`/`StudioSelect`.

## Global Constraints

- **Depends on Part 1 being merged** (`2026-07-21-3d-studio-motion-part1-foundation.md`). All of `~/lib/scene3d/motion/{types,ease,presets,evaluate,apply,defaults}` exist and are green.
- **Test runner:** Vitest from `frontend/` cwd; tests in `frontend/tests/unit/scene3d-motion.unit.spec.ts` (extend the Part 1 file); alias `~` → `frontend/app`.
- **Verification reality:** this repo has **no Vue-component test harness** (zero component specs). So pure helpers use TDD; Vue/GL wiring tasks are verified by `npx vue-tsc --noEmit` + a written **manual runtime check** (dev server + the studio). This is the same split the existing scene3d/spacetype plans use for their surface tasks.
- **Per-task gate:** `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` green, AND `npx vue-tsc --noEmit | grep -iE 'scene3d'` empty.
- **`parseDoc` takes a STRING.** Round-trip via `parseDoc(serializeDoc(doc))`.
- **Dev servers:** use `127.0.0.1` not `localhost` (IPv6 WS listener). Frontend `cd frontend && npm run dev`; there is a repo `./dev.sh` that launches + reaps 3000/8188.
- **`git add` only the named files.** Main-direct commits; stage your own hunks only.
- **Guardrail:** band-timeline richness (drag, `CurveEditor` custom bézier, templates gallery) is **Part 2b** — not here. Part 2a's panel is minimal preset dropdowns + Animate.

---

## File Structure

New:
- `frontend/app/lib/scene3d/motion/render.ts` — `sceneHasMotion(doc)`, `renderMotionFrame(engine, doc, t01)`.
- `frontend/app/lib/scene3d/motion/frameSource.ts` — `makeScene3DFrameSource(deps)`.

Modified:
- `frontend/app/lib/scene3d/engine.ts` — add `applyObjectOpacities(map)` method.
- `frontend/app/components/vue-canvas/Scene3DStudioNode.vue` — headless engine + frame-source registration gated on motion.
- `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` — Build│Motion tab, motion panel, transport, playback in RAF, Export-video button.

Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts` (extend).

**Deferred to Part 2b:** the draggable band-timeline component, `CurveEditor.vue` custom-bézier wiring, per-object direction/stagger UI, the templates gallery. **Deferred to Phase 2 (separate feature):** Frame node local-layer motion.

---

## Task 1: `sceneHasMotion` + engine opacity + `renderMotionFrame`

**Files:**
- Create: `frontend/app/lib/scene3d/motion/render.ts`
- Modify: `frontend/app/lib/scene3d/engine.ts` (add `applyObjectOpacities`)
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `SceneEngine` (`~/lib/scene3d/engine`), `applyMotionToDoc` (`./apply`), `SceneDoc` (`~/lib/scene3d/config`).
- Produces:
  - `sceneHasMotion(doc: SceneDoc): boolean` — true if any non-light object has a `loop.kind !== 'none'` / `in` / `out`, or camera motion `preset !== 'none'`.
  - `SceneEngine.applyObjectOpacities(map: Record<string, number>): void` — for each root, set every mesh material `transparent`/`opacity`; ids absent from `map` are reset to opaque.
  - `renderMotionFrame(engine, doc, t01): HTMLCanvasElement` — clone+compose via `applyMotionToDoc`, `syncFromDoc`, `applyCameraFromDoc`, `applyObjectOpacities`, `render()`, return `engine.renderer.domElement`.

- [ ] **Step 1: Write the failing test** (pure `sceneHasMotion` only — GL parts verified by typecheck + spy)

```ts
// append to scene3d-motion.unit.spec.ts
import { sceneHasMotion } from '~/lib/scene3d/motion/render'

describe('scene3d motion — sceneHasMotion', () => {
  it('false for a motion-less scene', () => {
    const doc = defaultDoc(); doc.objects.push(createPrimitive('box'))
    expect(sceneHasMotion(doc)).toBe(false)
  })
  it('true when an object loops', () => {
    const doc = defaultDoc(); const b = createPrimitive('box')
    b.motion = { loop: { kind: 'spin', speed: 1, amount: 1 } }; doc.objects.push(b)
    expect(sceneHasMotion(doc)).toBe(true)
  })
  it('true when camera moves', () => {
    const doc = defaultDoc(); doc.camera.motion = { preset: 'orbit', speed: 1, amount: 1 }
    expect(sceneHasMotion(doc)).toBe(true)
  })
  it('loop kind none does not count', () => {
    const doc = defaultDoc(); const b = createPrimitive('box')
    b.motion = { loop: { kind: 'none', speed: 1, amount: 1 } }; doc.objects.push(b)
    expect(sceneHasMotion(doc)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t sceneHasMotion`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/render`.

- [ ] **Step 3: Add `applyObjectOpacities` to `engine.ts`**

Add this method to `class SceneEngine` (near `render()`):

```ts
/** Set per-object opacity for a motion frame. Ids not in `map` are forced opaque.
 *  Traverses each root's meshes; toggles material.transparent so fades render. */
applyObjectOpacities(map: Record<string, number>): void {
  for (const [id, root] of this.objectRoots) {
    const o = map[id] ?? 1
    root.traverse((n) => {
      const mesh = n as THREE.Mesh
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (!mat) return
      const mats = Array.isArray(mat) ? mat : [mat]
      for (const m of mats) {
        const mm = m as THREE.Material & { opacity?: number; transparent?: boolean }
        mm.opacity = o
        mm.transparent = o < 1
        mm.needsUpdate = true
      }
    })
  }
}
```

- [ ] **Step 4: Create `render.ts`**

```ts
// frontend/app/lib/scene3d/motion/render.ts
import type { SceneEngine } from '~/lib/scene3d/engine'
import type { SceneDoc } from '~/lib/scene3d/config'
import { applyMotionToDoc } from './apply'

export function sceneHasMotion(doc: SceneDoc): boolean {
  for (const o of doc.objects) {
    if (o.kind === 'light') continue
    const m = o.motion
    if (m && ((m.loop && m.loop.kind !== 'none') || m.in || m.out)) return true
  }
  return !!(doc.camera.motion && doc.camera.motion.preset !== 'none')
}

/** Compose home∘motion(t01) into the live engine and render one beauty frame.
 *  Returns the engine's canvas (valid until the next call — upload before re-pulling). */
export function renderMotionFrame(engine: SceneEngine, doc: SceneDoc, t01: number): HTMLCanvasElement {
  const { doc: sampled, opacities } = applyMotionToDoc(doc, t01)
  engine.syncFromDoc(sampled)
  engine.applyCameraFromDoc(sampled)
  engine.applyObjectOpacities(opacities)
  engine.render()
  return engine.renderer.domElement as HTMLCanvasElement
}
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t sceneHasMotion`
Expected: PASS (4 tests).
Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'scene3d/motion/render|scene3d/engine'`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/motion/render.ts frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): sceneHasMotion + engine opacity + renderMotionFrame"
```

---

## Task 2: `makeScene3DFrameSource` factory

**Files:**
- Create: `frontend/app/lib/scene3d/motion/frameSource.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `StudioFrameSource` (`~/lib/studio/frameSource`); `TexImageSource`.
- Produces: `makeScene3DFrameSource(deps: { getClock: () => { duration: number; fps: number; width: number; height: number }; renderAt: (t01: number, w: number, h: number) => HTMLCanvasElement | null }): StudioFrameSource`. Mirrors `spacetype/frameSource.ts`: getters read the live clock each pull; `getFrame` delegates to `renderAt` and throws if null. `duration<=0` ⇒ still.

- [ ] **Step 1: Write the failing test**

```ts
// append
import { makeScene3DFrameSource } from '~/lib/scene3d/motion/frameSource'

describe('scene3d motion — frame source factory', () => {
  const fakeCanvas = { width: 8, height: 8 } as unknown as HTMLCanvasElement
  it('reflects the live clock via getters', () => {
    let clock = { duration: 4, fps: 30, width: 512, height: 512 }
    const src = makeScene3DFrameSource({ getClock: () => clock, renderAt: () => fakeCanvas })
    expect(src.duration).toBe(4)
    clock = { duration: 6, fps: 24, width: 256, height: 256 }
    expect(src.duration).toBe(6)
    expect(src.fps).toBe(24)
    expect(src.width).toBe(256)
  })
  it('getFrame returns the rendered surface', async () => {
    const src = makeScene3DFrameSource({ getClock: () => ({ duration: 4, fps: 30, width: 8, height: 8 }), renderAt: () => fakeCanvas })
    expect(await src.getFrame(0.5, 8, 8)).toBe(fakeCanvas)
  })
  it('getFrame throws when renderer not ready', async () => {
    const src = makeScene3DFrameSource({ getClock: () => ({ duration: 4, fps: 30, width: 8, height: 8 }), renderAt: () => null })
    await expect(src.getFrame(0, 8, 8)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "frame source factory"`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/frameSource`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/frameSource.ts
import type { StudioFrameSource } from '~/lib/studio/frameSource'

export interface Scene3DFrameSourceDeps {
  getClock: () => { duration: number; fps: number; width: number; height: number }
  renderAt: (t01: number, w: number, h: number) => HTMLCanvasElement | null
}

/** Live frame puller for a 3D Studio node — mirrors spacetype/frameSource.ts.
 *  Getters read the current clock each pull so a downstream Frame always sees
 *  the latest duration/fps/size. */
export function makeScene3DFrameSource(deps: Scene3DFrameSourceDeps): StudioFrameSource {
  return {
    get duration() { return deps.getClock().duration },
    get fps() { return deps.getClock().fps },
    get width() { return deps.getClock().width },
    get height() { return deps.getClock().height },
    getFrame: async (t01, w, h) => {
      const surface = deps.renderAt(t01, w, h)
      if (!surface) throw new Error('scene3d frame source: engine not ready')
      return surface as unknown as TexImageSource
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "frame source factory"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/frameSource.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): StudioFrameSource factory for motion frames"
```

---

## Task 3: Register the frame source from the node card (headless, gated on motion)

**Context:** `Scene3DStudioNode.vue` is a **backend-node card** — it reads widgets via `props.data.widgetsValues`/`widgetDefs` (read-only) and has no engine. To feed a wired Frame while the modal is closed (the "Both" playback decision), the card lazily builds a **headless `SceneEngine`** from `scene_state` and registers a frame source — but **only when `sceneHasMotion` is true**, so idle 3D nodes spin up no WebGL context.

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioNode.vue`

**Interfaces:**
- Consumes: `parseDoc` (`~/lib/scene3d/config`), `SceneEngine` (`~/lib/scene3d/engine`), `sceneHasMotion`/`renderMotionFrame` (`~/lib/scene3d/motion/render`), `makeScene3DFrameSource` (`~/lib/scene3d/motion/frameSource`), `registerStudioFrameSource`/`unregisterStudioFrameSource` (`~/lib/studio/frameSource`), `sceneLoopCycles` (`~/lib/scene3d/motion/apply`).

- [ ] **Step 1: Add imports + reactive scene doc**

In `<script setup>` add:

```ts
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { parseDoc } from '~/lib/scene3d/config'
import { SceneEngine } from '~/lib/scene3d/engine'
import { sceneHasMotion, renderMotionFrame } from '~/lib/scene3d/motion/render'
import { makeScene3DFrameSource } from '~/lib/scene3d/motion/frameSource'
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'
```

Add a computed for the current scene doc (re-parses when the widget changes):

```ts
const sceneDoc = computed(() => parseDoc(widgetStr('scene_state')))
```

- [ ] **Step 2: Add the headless engine + registration effect**

```ts
let headlessCanvas: HTMLCanvasElement | null = null
let headlessEngine: SceneEngine | null = null
let registered = false

function ensureHeadless(w: number, h: number): SceneEngine | null {
  if (typeof document === 'undefined') return null
  if (!headlessCanvas) headlessCanvas = document.createElement('canvas')
  if (!headlessEngine) {
    try { headlessEngine = new SceneEngine(headlessCanvas, w, h) }
    catch { headlessEngine = null; return null }
  }
  headlessEngine.setSize(w, h)
  return headlessEngine
}

function syncRegistration() {
  const doc = sceneDoc.value
  const animated = sceneHasMotion(doc)
  if (animated && !registered) {
    registerStudioFrameSource(props.id, makeScene3DFrameSource({
      getClock: () => {
        const d = sceneDoc.value
        return { duration: d.motion.duration, fps: d.motion.fps, width: d.output.width, height: d.output.height }
      },
      renderAt: (t01, w, h) => {
        const eng = ensureHeadless(w, h)
        if (!eng) return null
        return renderMotionFrame(eng, sceneDoc.value, t01)
      },
    }))
    registered = true
  } else if (!animated && registered) {
    unregisterStudioFrameSource(props.id)
    registered = false
  }
}

watch(sceneDoc, syncRegistration, { immediate: true, deep: true })

onBeforeUnmount(() => {
  if (registered) unregisterStudioFrameSource(props.id)
  headlessEngine?.renderer.dispose()
  headlessEngine = null
  headlessCanvas = null
})
```

- [ ] **Step 3: Typecheck gate**

Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'Scene3DStudioNode|scene3d'`
Expected: no output.

- [ ] **Step 4: Manual runtime check**

1. `cd frontend && npm run dev` (open `http://127.0.0.1:3000`).
2. Add a 3D Studio node, add a box, in the Motion tab (Task 4–5) enable motion + Animate, close the modal.
3. Wire the 3D Studio's `beauty` output into a Frame node.
4. Expect the Frame's live preview to animate the 3D scene (it pulls `getFrame` each tick). A motion-less 3D node wired to a Frame must stay a still (no headless engine created — confirm no extra WebGL context via devtools Performance/Memory if in doubt).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioNode.vue
git commit -m "feat(scene3d): register live motion frame source from the node card (gated on motion)"
```

---

## Task 4: Build │ Motion tab scaffold in the surface

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

- [ ] **Step 1: Add tab state**

In `<script setup>`:

```ts
const activeTab = ref<'build' | 'motion'>('build')
```

- [ ] **Step 2: Add the tab bar + wrap the inspector**

Directly above the inspector sections (the `<StudioSection v-if="selected" title="Selection">` at ~:1096), add:

```html
<div class="mb-2 flex gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
  <button type="button" class="nodrag flex-1 rounded px-2 py-1"
          :class="activeTab === 'build' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
          @click="activeTab = 'build'">Build</button>
  <button type="button" class="nodrag flex-1 rounded px-2 py-1"
          :class="activeTab === 'motion' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
          @click="activeTab = 'motion'">Motion</button>
</div>
```

Wrap the existing four sections (Selection/Camera/Lighting/Background, ~:1096–:1473) in `<template v-if="activeTab === 'build'"> … </template>`, and add an empty `<template v-else> <!-- Motion panel: Task 5 --> </template>` after it.

- [ ] **Step 3: Typecheck gate**

Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'Scene3DStudioSurface'`
Expected: no output.

- [ ] **Step 4: Manual runtime check** — open the studio; toggling Build/Motion swaps the inspector between the existing sections and an (empty) Motion pane. Viewport unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): Build/Motion tab scaffold in the studio inspector"
```

---

## Task 5: Minimal Motion panel + doc-mutation helpers

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Create: `frontend/app/lib/scene3d/motion/panel.ts` (pure helpers)
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Produces (pure, TDD): in `panel.ts` —
  - `LOOP_OPTIONS`, `IN_OPTIONS`, `OUT_OPTIONS`, `CAMERA_OPTIONS` (arrays of `{ value, label }`).
  - `setObjectLoop(obj, kind)`, `setObjectTransition(obj, slot: 'in'|'out', preset)`, `ensureObjectMotion(obj)` — mutate an object's `motion` with sensible defaults, clearing when set to `'none'`.

- [ ] **Step 1: Write the failing test**

```ts
// append
import { setObjectLoop, setObjectTransition, LOOP_OPTIONS } from '~/lib/scene3d/motion/panel'

describe('scene3d motion — panel helpers', () => {
  it('setObjectLoop assigns and clears', () => {
    const o = createPrimitive('box')
    setObjectLoop(o, 'spin')
    expect(o.motion?.loop?.kind).toBe('spin')
    setObjectLoop(o, 'none')
    expect(o.motion?.loop).toBeUndefined()
  })
  it('setObjectTransition assigns in/out with a default ease', () => {
    const o = createPrimitive('box')
    setObjectTransition(o, 'in', 'fade')
    expect(o.motion?.in?.preset).toBe('fade')
    expect(o.motion?.in?.ease.kind).toBe('bezier')
    setObjectTransition(o, 'in', 'none' as any)
    expect(o.motion?.in).toBeUndefined()
  })
  it('LOOP_OPTIONS includes none + the shipped kinds', () => {
    const values = LOOP_OPTIONS.map(o => o.value)
    expect(values).toContain('none'); expect(values).toContain('spin'); expect(values).toContain('orbit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "panel helpers"`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/panel`.

- [ ] **Step 3: Implement `panel.ts`**

```ts
// frontend/app/lib/scene3d/motion/panel.ts
import type { SceneObject } from '~/lib/scene3d/config'
import type { LoopKind, TransitionPreset } from './types'

export const LOOP_OPTIONS: { value: LoopKind; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'spin', label: 'Spin' }, { value: 'bob', label: 'Bob' },
  { value: 'pulse', label: 'Pulse' }, { value: 'orbit', label: 'Orbit' }, { value: 'sway', label: 'Sway' }, { value: 'tumble', label: 'Tumble' },
]
export const IN_OPTIONS: { value: TransitionPreset | 'none'; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'move', label: 'Move' }, { value: 'rise', label: 'Rise' },
  { value: 'scale', label: 'Scale' }, { value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' },
]
export const OUT_OPTIONS = IN_OPTIONS
export const CAMERA_OPTIONS = [
  { value: 'none', label: 'None' }, { value: 'orbit', label: 'Orbit' }, { value: 'push', label: 'Push in' }, { value: 'sway', label: 'Sway' },
] as const

const DEFAULT_EASE = { kind: 'bezier' as const, cps: [0, 0, 0.58, 1] as [number, number, number, number] }

export function ensureObjectMotion(obj: SceneObject) { if (!obj.motion) obj.motion = {}; return obj.motion }

export function setObjectLoop(obj: SceneObject, kind: LoopKind) {
  const m = ensureObjectMotion(obj)
  if (kind === 'none') { delete m.loop; if (!m.in && !m.out && m.offset === undefined) obj.motion = undefined; return }
  m.loop = { kind, speed: 1, amount: 1, ...(m.loop ? { speed: m.loop.speed, amount: m.loop.amount, phase: m.loop.phase } : {}) }
}

export function setObjectTransition(obj: SceneObject, slot: 'in' | 'out', preset: TransitionPreset | 'none') {
  const m = ensureObjectMotion(obj)
  if (preset === 'none') { delete m[slot]; if (!m.loop && !m.in && !m.out) obj.motion = undefined; return }
  m[slot] = { preset, duration: 0.6, ease: DEFAULT_EASE }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "panel helpers"`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the Motion panel markup + wiring**

In `<script setup>` add imports + Animate/enable helpers:

```ts
import { SCENE_TEMPLATES, animateSceneDefaults } from '~/lib/scene3d/motion/defaults'
import { setObjectLoop, setObjectTransition, LOOP_OPTIONS, IN_OPTIONS, OUT_OPTIONS, CAMERA_OPTIONS } from '~/lib/scene3d/motion/panel'
import { sceneHasMotion } from '~/lib/scene3d/motion/render'

const motionOn = computed({
  get: () => sceneHasMotion(doc),
  set: (on: boolean) => { if (on) animateSceneDefaults(doc); else { doc.objects.forEach(o => (o.motion = undefined)); doc.camera.motion = undefined } },
})
function applyTemplate(name: 'showcase' | 'reveal' | 'loop') { SCENE_TEMPLATES[name](doc) }
const selectedObj = computed(() => doc.objects.find(o => o.id === selectedId.value) ?? null)
```

(Use the surface's existing selected-id ref — it is `selectedId` if present; otherwise reuse whatever `selected`/`selectedId` the Selection section already binds. Confirm the name at ~:1096.)

Replace the empty Motion `<template v-else>` from Task 4 with:

```html
<template v-else>
  <StudioSection title="Motion">
    <div class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Animate scene</span>
      <StudioSwitch v-model="motionOn" />
    </div>
    <template v-if="motionOn">
      <StudioSlider v-model="doc.motion.duration" label="Duration (s)" :min="1" :max="12" :step="0.5" />
      <StudioSlider v-model="doc.motion.fps" label="FPS" :min="12" :max="60" :step="1" />
      <div class="flex gap-1">
        <StudioButton class="flex-1" @click="applyTemplate('showcase')">Showcase</StudioButton>
        <StudioButton class="flex-1" @click="applyTemplate('reveal')">Reveal</StudioButton>
        <StudioButton class="flex-1" @click="applyTemplate('loop')">Loop</StudioButton>
      </div>
      <div>
        <label class="mb-1 block text-[11px] text-white/55">Camera</label>
        <StudioSelect :model-value="doc.camera.motion?.preset ?? 'none'" :options="CAMERA_OPTIONS"
          @update:model-value="v => doc.camera.motion = v === 'none' ? undefined : { preset: v, speed: 1, amount: 1 }" />
      </div>
    </template>
  </StudioSection>

  <StudioSection v-if="motionOn && selectedObj" title="Object motion">
    <div>
      <label class="mb-1 block text-[11px] text-white/55">Loop</label>
      <StudioSelect :model-value="selectedObj.motion?.loop?.kind ?? 'none'" :options="LOOP_OPTIONS"
        @update:model-value="v => setObjectLoop(selectedObj, v)" />
    </div>
    <div>
      <label class="mb-1 block text-[11px] text-white/55">In</label>
      <StudioSelect :model-value="selectedObj.motion?.in?.preset ?? 'none'" :options="IN_OPTIONS"
        @update:model-value="v => setObjectTransition(selectedObj, 'in', v)" />
    </div>
    <div>
      <label class="mb-1 block text-[11px] text-white/55">Out</label>
      <StudioSelect :model-value="selectedObj.motion?.out?.preset ?? 'none'" :options="OUT_OPTIONS"
        @update:model-value="v => setObjectTransition(selectedObj, 'out', v)" />
    </div>
  </StudioSection>
</template>
```

Ensure `StudioSelect` is imported (it is, at :40). If `StudioSelect`'s option shape differs from `{value,label}`, adapt the option arrays in `panel.ts` to match its contract (check `app/components/vue-canvas/studio/StudioSelect.vue` props before wiring).

- [ ] **Step 6: Typecheck + full suite**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` → all green.
Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'scene3d'` → no output.

- [ ] **Step 7: Manual runtime check** — Motion tab: toggling Animate stamps defaults (scene visibly gains motion when played in Task 6); template buttons change the feel; selecting an object shows its loop/in/out selects and changing them updates `scene_state`.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/motion/panel.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): minimal Motion panel (enable, duration/fps, templates, per-object presets)"
```

---

## Task 6: Transport + playback in the RAF loop

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `applyMotionToDoc` (`~/lib/scene3d/motion/apply`), `sceneHasMotion` (`render`).

- [ ] **Step 1: Add transport state**

```ts
import { applyMotionToDoc } from '~/lib/scene3d/motion/apply'
const playing = ref(false)
const playhead = ref(0)     // seconds
let playStart = 0           // performance.now anchor
function togglePlay() {
  if (!sceneHasMotion(doc)) return
  playing.value = !playing.value
  if (playing.value) playStart = performance.now() - playhead.value * 1000
}
```

- [ ] **Step 2: Thread playback into the existing RAF loop**

Replace the loop body (~:599–:603) with:

```ts
const loop = () => {
  if (playing.value && engine) {
    const dur = doc.motion.duration
    const elapsed = (performance.now() - playStart) / 1000
    playhead.value = doc.motion.loop ? elapsed % dur : Math.min(elapsed, dur)
    const t01 = dur > 0 ? playhead.value / dur : 0
    const { doc: sampled, opacities } = applyMotionToDoc(doc, t01)
    // lock orbit while the camera is animated so it can't fight the motion
    if (interaction) interaction.orbit.enabled = !(doc.camera.motion && doc.camera.motion.preset !== 'none')
    engine.syncFromDoc(sampled)
    engine.applyCameraFromDoc(sampled)
    engine.applyObjectOpacities(opacities)
    interaction?.orbit.update()
    engine.render()
    updateLightLabels()
  } else {
    if (interaction) interaction.orbit.enabled = true
    interaction?.orbit.update()
    engine?.render()
    updateLightLabels()
  }
  raf = requestAnimationFrame(loop)
}
```

(When playback stops, the existing deep `watch(doc, …)` re-syncs the un-animated doc on the next edit; add `watch(playing, v => { if (!v && engine) { engine.syncFromDoc(doc); engine.applyObjectOpacities({}) } })` so stopping snaps back to the Build pose.)

- [ ] **Step 3: Add the transport bar markup**

Above the tab bar (Task 4), inside the viewport/inspector column, add:

```html
<div v-if="activeTab === 'motion'" class="mb-2 flex items-center gap-2 text-[11px] text-white/60">
  <StudioButton @click="togglePlay">{{ playing ? 'Pause' : 'Play' }}</StudioButton>
  <span class="tabular-nums">{{ playhead.toFixed(2) }} / {{ doc.motion.duration.toFixed(1) }}s</span>
  <div class="flex-1"></div>
  <StudioButton @click="exportVideo">Export video</StudioButton>
</div>
```

(`exportVideo` is Task 7.)

- [ ] **Step 4: Typecheck gate**

Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'Scene3DStudioSurface'`
Expected: no output (note: `exportVideo` referenced here is added in Task 7 — if typechecking Task 6 alone, stub `function exportVideo() {}` and replace in Task 7).

- [ ] **Step 5: Manual runtime check** — Motion tab → Play animates the scene in the viewport; the playhead readout advances and loops; Pause snaps back to the Build pose; while a camera preset is active, orbit drag is disabled during playback and restored when paused.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): motion transport + playback in the studio RAF loop"
```

---

## Task 7: Direct "Export video" button (reuse bake → encode)

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `ensureSpaceTypeBake` (`~/lib/spacetype/bake`), `renderMotionFrame` (`render`), `recordAsset` (same import the Frame uses — locate it; likely `~/composables/useAssets` or similar — mirror `ArtifactFrameNode.vue`'s import). Reuses the same one render path as the frame source (`renderMotionFrame`) — **one render path, two triggers**.

- [ ] **Step 1: Implement `exportVideo`**

```ts
async function exportVideo() {
  if (!engine || !sceneHasMotion(doc)) return
  const wasPlaying = playing.value; playing.value = false
  try {
    const W = doc.output.width, H = doc.output.height
    const fps = doc.motion.fps, dur = doc.motion.duration
    const total = Math.max(1, Math.round(fps * dur))
    engine.setSize(W, H)
    const { ensureSpaceTypeBake } = await import('~/lib/spacetype/bake')
    const cfg = { fps, loopDuration: dur, W, H, seed: 'scene3d', sig: JSON.stringify({ id: props.nodeId, n: total, w: W, h: H, s: serializeDoc(doc) }) }
    const bake = await ensureSpaceTypeBake(cfg as any, undefined, {
      renderFrame: async (i) => {
        const cv = renderMotionFrame(engine!, doc, total > 1 ? i / total : 0)
        return await new Promise<Blob>((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'))
      },
    })
    const res = await fetch('/sailor/spacetype_encode', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames: bake.frames, fps, width: W, height: H }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.filename) { bakeError.value = 'Video encode failed'; return }
    const vres = await fetch(`/view?${new URLSearchParams({ filename: data.filename, type: 'input' })}`)
    const blob = await vres.blob()
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = obj; a.download = `scene3d-${props.nodeId}.mp4`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj)
  } catch (err) {
    bakeError.value = 'Video export failed'
    console.error('[Scene3D] video export failed:', err)
  } finally {
    // restore the viewport render size and Build pose
    engine?.setSize(canvasEl.value?.clientWidth ?? doc.output.width, canvasEl.value?.clientHeight ?? doc.output.height)
    engine?.syncFromDoc(doc); engine?.applyObjectOpacities({})
    playing.value = wasPlaying
  }
}
```

(Mirror `ArtifactFrameNode.vue:641` to also `recordAsset(activeTab.value?.projectUuid, 'video', data.filename)` before download if the surface has access to `activeTab`/`recordAsset` — add the import the Frame uses. If not readily available in the surface, ship without the Assets record in 2a and note it as a 2b follow-up.)

- [ ] **Step 2: Remove the Task-6 `exportVideo` stub** (if you added one) so this is the single definition.

- [ ] **Step 3: Typecheck gate**

Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'Scene3DStudioSurface'`
Expected: no output.

- [ ] **Step 4: Manual runtime check** — With ComfyUI running (`.venv/bin/python main.py --listen 127.0.0.1 --port 8188`) and the frontend up: Motion tab → Export video on an animated scene downloads an `.mp4` that plays the motion and **loops seamlessly** (last frame ≈ first for a pure-Loop template). Verify the exported clip matches the viewport playback (same render path).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): direct Export video reusing the bake→encode pipeline"
```

---

## Task 8: Full-suite + typecheck checkpoint

- [ ] **Step 1:** `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` → all green (Part 1 + Part 2a: sceneHasMotion, frame source factory, panel helpers).
- [ ] **Step 2:** `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts` → no regressions.
- [ ] **Step 3:** `cd frontend && npx vue-tsc --noEmit | grep -iE 'scene3d'` → empty.
- [ ] **Step 4:** End-to-end manual: 3D node → Animate → Play (viewport moves) → Export video (mp4 loops) → wire into a Frame (Frame preview animates the 3D scene) → Frame's own Save exports it too. Confirm a motion-less 3D node registers no frame source and stays a still.

---

## Self-Review

**Spec/design coverage (Part 2a scope):**
- §8 export — `StudioFrameSource` registration (Task 3), `renderFrameAt`-equivalent `renderMotionFrame` (Task 1), direct export + one-render-path-two-triggers (Tasks 1/7). ✅
- §5 Motion tab (mode-explicit Build/Motion), minimal panel, transport, orbit-lock (Tasks 4–6). ✅
- §4 templates + Animate one-click (Task 5, reusing Part 1 `defaults.ts`). ✅
- §2 `home ∘ motion(t)` render (Task 1 via Part 1 `applyMotionToDoc`). ✅
- Deferred (documented): band-timeline drag, `CurveEditor` custom bézier, direction/stagger UI, templates gallery → **Part 2b**. Frame local layers → **Phase 2**.

**Placeholder scan:** none. Two explicit "confirm before wiring" notes (StudioSelect option shape; `recordAsset` import in the surface) are pointers to verify an existing contract, not missing code — the fallback behavior is specified in-line.

**Type consistency:** `renderMotionFrame(engine, doc, t01): HTMLCanvasElement` defined Task 1, consumed Tasks 3/7. `makeScene3DFrameSource(deps)` signature Task 2 matches its call in Task 3. `sceneHasMotion` used in Tasks 1/3/5/6/7 with one definition. `setObjectLoop`/`setObjectTransition` signatures Task 5 match their template wiring. `applyObjectOpacities(map)` defined Task 1, called Tasks 1/6/7.

**Known verification limitation (stated honestly):** Tasks 3–7 touch Vue SFCs + live WebGL, which this repo has no unit-test harness for; they are gated by `vue-tsc` + explicit manual runtime checks (the same approach the existing scene3d/spacetype surface plans use). The motion math they call is fully unit-tested in Part 1 + Tasks 1/2/5.

---

## Part 2b (next plan — not built here)

`2026-07-21-3d-studio-motion-part2b-timeline.md`: the draggable **band-timeline** component (per-object In·Loop·Out rows + camera row, drag the In→Loop / Loop→Out dividers to set durations, drag the clip to set `offset`/stagger, snapping + live readout); wiring `CurveEditor.vue` for **custom bézier** easing (with the named smooth presets preloading it and Bounce/Spring as procedural, non-editable) via the Part 1 `EaseRef`; per-object **direction** + text **stagger** controls; and the **templates gallery**. Guardrail: band timeline is the ceiling — no per-property keyframes.
