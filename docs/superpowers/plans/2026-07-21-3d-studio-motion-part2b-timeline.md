# 3D Studio Motion — Part 2b: Band-Timeline & Custom Easing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Part 2a Motion tab from preset dropdowns to the designed authoring surface — a draggable **band-timeline** (per-object In·Loop·Out rows + a camera row; drag dividers to resize In/Out, drag the clip to set offset/stagger, with snapping + live readout), a per-transition **easing picker with a custom cubic-bézier editor** (reusing the orphaned `CurveEditor.vue`), and per-object **direction** + a **templates gallery**.

**Architecture:** All new interaction logic is factored into **pure, unit-tested helpers** (`motion/timeline.ts` band math, `motion/easePresets.ts` preset registry + `CurveEditor` string bridge). The Vue components (`Scene3DMotionTimeline.vue` + Motion-panel edits in the surface) are thin views over those helpers and the reactive `doc`, verified by `vue-tsc` + manual runtime checks. Easing stays the Part 1 `EaseRef` (bézier tuple for the curve family; named for procedural Bounce/Spring/Elastic).

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Vitest 4. Reuses `CurveEditor.vue` (`v-model:modelValue` = JSON `"[x1,y1,x2,y2]"` string), Part 1 `EaseRef`/`ObjectMotion`, Part 2a `panel.ts` helpers + transport `playhead`.

## Global Constraints

- **Depends on Part 2a merged.** The Motion tab, transport (`playhead`/`playing`), `panel.ts`, and `applyMotionToDoc` playback all exist.
- **Test runner:** Vitest from `frontend/`; tests in `frontend/tests/unit/scene3d-motion.unit.spec.ts`; alias `~` → `frontend/app`.
- **Per-task gate:** `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` green + `npx vue-tsc --noEmit | grep -iE 'scene3d'` empty.
- **No component-test harness in this repo** — SFC tasks are `vue-tsc` + written manual checks; all logic they call is unit-tested.
- **Dev:** `127.0.0.1` (not `localhost`); `cd frontend && npm run dev`; `./dev.sh` launches+reaps 3000/8188.
- **`git add` only the named files.** Main-direct.
- **Guardrail (hard):** the band-timeline is the ceiling — drag/resize/offset only. **No per-property keyframes, ever.** Custom bézier is still one curve per transition, not keyframes.

---

## File Structure

New:
- `frontend/app/lib/scene3d/motion/timeline.ts` — `bandSegments`, `resizeTransition`, `setClipOffset`, `snapSeconds`.
- `frontend/app/lib/scene3d/motion/easePresets.ts` — `EASE_PRESETS`, `easeRefToCurveString`, `curveStringToEaseRef`, `presetKeyForEaseRef`, `easeRefForPresetKey`.
- `frontend/app/components/vue-canvas/Scene3DMotionTimeline.vue` — the band-timeline view.

Modified:
- `frontend/app/lib/scene3d/motion/panel.ts` — add `setObjectDirection`.
- `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` — mount the timeline in the Motion tab, add the ease picker + `CurveEditor` + direction + templates gallery to the object-motion panel.

Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts` (extend).

**Carved out (NOT in this plan):** **per-glyph text stagger.** 3D text here bakes to a single GLB mesh (text-to-3D), which is not glyph-addressable, so "letters reveal in sequence" isn't buildable without a glyph-level text model. Gate it behind a separate spike: *does the extrude-text primitive (`2026-07-18-3d-studio-extrude-text-design.md`) expose per-glyph sub-meshes?* If yes, a tiny follow-up spec adds `stagger`; if no, it stays Space-Type-via-Frame (design §6). Whole-object motion on a text/GLB object already works from Part 1.

---

## Task 1: Band math — `timeline.ts`

**Files:**
- Create: `frontend/app/lib/scene3d/motion/timeline.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `ObjectMotion` (`./types`).
- Produces:
  - `bandSegments(motion: ObjectMotion | undefined, duration: number): { offsetFrac: number; inFrac: number; loopFrac: number; outFrac: number }` — fractions of `duration` (0..1); `loopFrac` = remainder so `offset+in+loop+out === 1` (clamped ≥0).
  - `resizeTransition(motion, slot: 'in'|'out', newSec, duration): void` — set that transition's `duration`, clamped to `[0.05, duration - offset - otherSlotSec]`; no-op if the slot is unset.
  - `setClipOffset(motion, newSec, duration): void` — clamp offset to `[0, duration - inSec - outSec]`.
  - `snapSeconds(sec, targets: number[], epsSec = 0.08): number` — snap to the nearest target within eps.

- [ ] **Step 1: Write the failing test**

```ts
// append to scene3d-motion.unit.spec.ts
import { bandSegments, resizeTransition, setClipOffset, snapSeconds } from '~/lib/scene3d/motion/timeline'
import type { ObjectMotion } from '~/lib/scene3d/motion/types'

const E = { kind: 'bezier' as const, cps: [0, 0, 1, 1] as [number, number, number, number] }

describe('scene3d motion — band math', () => {
  it('loop fills the remainder', () => {
    const m: ObjectMotion = { in: { preset: 'fade', duration: 1, ease: E }, out: { preset: 'fade', duration: 1, ease: E } }
    const s = bandSegments(m, 4)
    expect(s.inFrac).toBeCloseTo(0.25, 6)
    expect(s.outFrac).toBeCloseTo(0.25, 6)
    expect(s.loopFrac).toBeCloseTo(0.5, 6)
    expect(s.offsetFrac).toBeCloseTo(0, 6)
  })
  it('offset eats into the loop', () => {
    const m: ObjectMotion = { in: { preset: 'fade', duration: 1, ease: E }, offset: 1 }
    const s = bandSegments(m, 4)
    expect(s.offsetFrac).toBeCloseTo(0.25, 6)
    expect(s.inFrac).toBeCloseTo(0.25, 6)
    expect(s.loopFrac).toBeCloseTo(0.5, 6)
  })
  it('resizeTransition clamps against the other slot + offset', () => {
    const m: ObjectMotion = { in: { preset: 'fade', duration: 1, ease: E }, out: { preset: 'fade', duration: 1, ease: E }, offset: 0.5 }
    resizeTransition(m, 'in', 100, 4) // absurd → clamp to 4 - 0.5 - 1 = 2.5
    expect(m.in!.duration).toBeCloseTo(2.5, 6)
  })
  it('setClipOffset clamps to leave room for in+out', () => {
    const m: ObjectMotion = { in: { preset: 'fade', duration: 1, ease: E }, out: { preset: 'fade', duration: 1, ease: E } }
    setClipOffset(m, 100, 4) // clamp to 4 - 2 = 2
    expect(m.offset).toBeCloseTo(2, 6)
  })
  it('snapSeconds snaps within eps only', () => {
    expect(snapSeconds(1.02, [0, 1, 2], 0.08)).toBe(1)
    expect(snapSeconds(1.4, [0, 1, 2], 0.08)).toBe(1.4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "band math"`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/timeline`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/timeline.ts
import type { ObjectMotion } from './types'

const MIN = 0.05
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export function bandSegments(motion: ObjectMotion | undefined, duration: number) {
  const d = duration > 0 ? duration : 1
  const offset = clamp((motion?.offset ?? 0) / d, 0, 1)
  const inFrac = clamp((motion?.in?.duration ?? 0) / d, 0, 1)
  const outFrac = clamp((motion?.out?.duration ?? 0) / d, 0, 1)
  const loopFrac = Math.max(0, 1 - offset - inFrac - outFrac)
  return { offsetFrac: offset, inFrac, loopFrac, outFrac }
}

export function resizeTransition(motion: ObjectMotion, slot: 'in' | 'out', newSec: number, duration: number): void {
  const t = motion[slot]; if (!t) return
  const offset = motion.offset ?? 0
  const other = slot === 'in' ? (motion.out?.duration ?? 0) : (motion.in?.duration ?? 0)
  t.duration = clamp(newSec, MIN, Math.max(MIN, duration - offset - other))
}

export function setClipOffset(motion: ObjectMotion, newSec: number, duration: number): void {
  const inSec = motion.in?.duration ?? 0
  const outSec = motion.out?.duration ?? 0
  motion.offset = clamp(newSec, 0, Math.max(0, duration - inSec - outSec))
}

export function snapSeconds(sec: number, targets: number[], epsSec = 0.08): number {
  let best = sec, bestD = epsSec
  for (const t of targets) { const dd = Math.abs(sec - t); if (dd <= bestD) { best = t; bestD = dd } }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "band math"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/timeline.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): band-timeline resize/offset/snap math"
```

---

## Task 2: Easing preset registry + `CurveEditor` bridge — `easePresets.ts`

**Files:**
- Create: `frontend/app/lib/scene3d/motion/easePresets.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `EaseRef` (`./types`).
- Produces:
  - `EASE_PRESETS: { key: string; label: string; ease: EaseRef; editable: boolean }[]` — smooth (bézier, editable): Linear/Ease/Ease out/Ease in-out/Back; procedural (named, not editable): Bounce/Spring/Elastic. Plus a `'custom'` handled separately.
  - `presetKeyForEaseRef(ease): string` — matching preset key, or `'custom'` for an unmatched bézier.
  - `easeRefForPresetKey(key): EaseRef` — the preset's ease (throws on `'custom'`; caller keeps the current custom tuple).
  - `easeRefToCurveString(ease): string | null` — bézier → `"[x1,y1,x2,y2]"`; procedural → `null` (editor hidden).
  - `curveStringToEaseRef(str): EaseRef` — parse a `CurveEditor` string → `{ kind:'bezier', cps }` (falls back to `[0.42,0,0.58,1]`).

- [ ] **Step 1: Write the failing test**

```ts
// append
import {
  EASE_PRESETS, presetKeyForEaseRef, easeRefForPresetKey, easeRefToCurveString, curveStringToEaseRef,
} from '~/lib/scene3d/motion/easePresets'

describe('scene3d motion — ease presets + CurveEditor bridge', () => {
  it('smooth presets are editable, procedural are not', () => {
    const back = EASE_PRESETS.find(p => p.key === 'back')!
    const bounce = EASE_PRESETS.find(p => p.key === 'bounce')!
    expect(back.editable).toBe(true); expect(back.ease.kind).toBe('bezier')
    expect(bounce.editable).toBe(false); expect(bounce.ease.kind).toBe('named')
  })
  it('presetKeyForEaseRef matches a known tuple and falls back to custom', () => {
    const easeOut = easeRefForPresetKey('ease-out')
    expect(presetKeyForEaseRef(easeOut)).toBe('ease-out')
    expect(presetKeyForEaseRef({ kind: 'bezier', cps: [0.11, 0.22, 0.33, 0.44] })).toBe('custom')
    expect(presetKeyForEaseRef({ kind: 'named', name: 'spring' })).toBe('spring')
  })
  it('bridge round-trips a bezier and nulls a procedural', () => {
    const s = easeRefToCurveString({ kind: 'bezier', cps: [0.1, 0.2, 0.3, 0.4] })
    expect(s).toBe('[0.1,0.2,0.3,0.4]')
    expect(curveStringToEaseRef(s!)).toEqual({ kind: 'bezier', cps: [0.1, 0.2, 0.3, 0.4] })
    expect(easeRefToCurveString({ kind: 'named', name: 'bounce' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "ease presets"`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/easePresets`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/easePresets.ts
import type { EaseRef } from './types'

type Cps = [number, number, number, number]
function bez(cps: Cps): EaseRef { return { kind: 'bezier', cps } }

export const EASE_PRESETS: { key: string; label: string; ease: EaseRef; editable: boolean }[] = [
  { key: 'linear', label: 'Linear', ease: bez([0, 0, 1, 1]), editable: true },
  { key: 'ease', label: 'Ease', ease: bez([0.25, 0.1, 0.25, 1]), editable: true },
  { key: 'ease-out', label: 'Ease out', ease: bez([0, 0, 0.58, 1]), editable: true },
  { key: 'ease-in-out', label: 'Ease in-out', ease: bez([0.42, 0, 0.58, 1]), editable: true },
  { key: 'back', label: 'Back', ease: bez([0.34, 1.56, 0.64, 1]), editable: true },
  { key: 'bounce', label: 'Bounce', ease: { kind: 'named', name: 'bounce' }, editable: false },
  { key: 'spring', label: 'Spring', ease: { kind: 'named', name: 'spring' }, editable: false },
  { key: 'elastic', label: 'Elastic', ease: { kind: 'named', name: 'elastic' }, editable: false },
]

const EPS = 1e-4
export function presetKeyForEaseRef(ease: EaseRef): string {
  for (const p of EASE_PRESETS) {
    if (p.ease.kind !== ease.kind) continue
    if (ease.kind === 'named' && p.ease.kind === 'named' && ease.name === p.ease.name) return p.key
    if (ease.kind === 'bezier' && p.ease.kind === 'bezier' && ease.cps.every((v, i) => Math.abs(v - p.ease.cps[i]!) < EPS)) return p.key
  }
  return 'custom'
}

export function easeRefForPresetKey(key: string): EaseRef {
  const p = EASE_PRESETS.find(x => x.key === key)
  if (!p) throw new Error(`no ease preset '${key}'`)
  return p.ease.kind === 'bezier' ? bez([...p.ease.cps] as Cps) : { ...p.ease }
}

export function easeRefToCurveString(ease: EaseRef): string | null {
  return ease.kind === 'bezier' ? `[${ease.cps.join(',')}]` : null
}

export function curveStringToEaseRef(str: string): EaseRef {
  try {
    const a = JSON.parse(str)
    if (Array.isArray(a) && a.length === 4 && a.every((n: unknown) => typeof n === 'number')) {
      return bez([a[0], a[1], a[2], a[3]])
    }
  } catch { /* fall through */ }
  return bez([0.42, 0, 0.58, 1])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "ease presets"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/easePresets.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): ease preset registry + CurveEditor string bridge"
```

---

## Task 3: `setObjectDirection` helper

**Files:**
- Modify: `frontend/app/lib/scene3d/motion/panel.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Produces: `setObjectDirection(obj, slot: 'in'|'out', dir: Direction): void` — sets `motion[slot].direction`; no-op if the slot is unset.

- [ ] **Step 1: Write the failing test**

```ts
// append
import { setObjectDirection, setObjectTransition as setTrans2 } from '~/lib/scene3d/motion/panel'

describe('scene3d motion — direction helper', () => {
  it('sets direction on an existing transition', () => {
    const o = createPrimitive('box')
    setTrans2(o, 'in', 'move')
    setObjectDirection(o, 'in', 'right')
    expect(o.motion?.in?.direction).toBe('right')
  })
  it('no-ops when the slot is unset', () => {
    const o = createPrimitive('box')
    setObjectDirection(o, 'in', 'left')
    expect(o.motion).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "direction helper"`
Expected: FAIL — `setObjectDirection` is not exported.

- [ ] **Step 3: Implement** — append to `panel.ts`:

```ts
import type { Direction } from './types'

export function setObjectDirection(obj: SceneObject, slot: 'in' | 'out', dir: Direction) {
  const t = obj.motion?.[slot]; if (!t) return
  t.direction = dir
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "direction helper"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/panel.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): setObjectDirection panel helper"
```

---

## Task 4: `Scene3DMotionTimeline.vue` — the band-timeline view

**Files:**
- Create: `frontend/app/components/vue-canvas/Scene3DMotionTimeline.vue`

**Interfaces:**
- Props: `{ doc: SceneDoc; selectedId: string | null; playhead: number }`.
- Emits: `{ (e: 'select', id: string): void }`. Mutates `doc` in place through the Part 1/2b helpers (Vue reactive doc, so the surface's deep watch picks it up).

- [ ] **Step 1: Implement the component**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { SceneObject } from '~/lib/scene3d/config'
import type { SceneDoc } from '~/lib/scene3d/config'
import { bandSegments, resizeTransition, setClipOffset, snapSeconds } from '~/lib/scene3d/motion/timeline'

const props = defineProps<{ doc: SceneDoc; selectedId: string | null; playhead: number }>()
const emit = defineEmits<{ (e: 'select', id: string): void }>()

const duration = computed(() => props.doc.motion.duration)
const rows = computed(() => props.doc.objects.filter(o => o.kind !== 'light'))
const pct = (f: number) => `${(f * 100).toFixed(3)}%`

function seg(o: SceneObject) { return bandSegments(o.motion, duration.value) }

// Drag a divider ('in' | 'out') or the whole clip ('offset'); dx in px over a `trackW`px track.
function startDrag(e: PointerEvent, o: SceneObject, mode: 'in' | 'out' | 'offset') {
  if (!o.motion) return
  const track = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement | null
  if (!track) return
  const trackW = track.clientWidth
  const startX = e.clientX
  const base = o.motion
  const startInner = mode === 'in' ? (base.in?.duration ?? 0) : mode === 'out' ? (base.out?.duration ?? 0) : (base.offset ?? 0)
  const snapTargets = [0, duration.value, duration.value / 2]
  const move = (ev: PointerEvent) => {
    const ds = ((ev.clientX - startX) / trackW) * duration.value
    let next = startInner + (mode === 'out' ? -ds : ds) // out grows leftward
    next = snapSeconds(next, snapTargets)
    if (mode === 'offset') setClipOffset(base, next, duration.value)
    else resizeTransition(base, mode, next, duration.value)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="relative flex flex-col gap-1" data-track>
      <div v-for="o in rows" :key="o.id"
           class="grid grid-cols-[80px_1fr] items-center gap-2"
           @click="emit('select', o.id)">
        <span class="truncate text-[11px]" :class="o.id === selectedId ? 'text-white' : 'text-white/50'">{{ o.name }}</span>
        <div class="relative h-5 overflow-hidden rounded border border-white/10 bg-white/[0.03]">
          <template v-if="o.motion">
            <div class="absolute inset-y-0" :style="{ left: '0', width: pct(seg(o).offsetFrac) }"></div>
            <div v-if="o.motion.in" class="absolute inset-y-0 cursor-ew-resize bg-amber-400/70"
                 :style="{ left: pct(seg(o).offsetFrac), width: pct(seg(o).inFrac) }"></div>
            <div class="absolute inset-y-0 bg-emerald-400/60"
                 :style="{ left: pct(seg(o).offsetFrac + seg(o).inFrac), right: pct(seg(o).outFrac) }"></div>
            <div v-if="o.motion.out" class="absolute inset-y-0 cursor-ew-resize bg-amber-400/70"
                 :style="{ right: '0', width: pct(seg(o).outFrac) }"></div>
            <!-- divider handles -->
            <div v-if="o.motion.in" class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize"
                 :style="{ left: pct(seg(o).offsetFrac + seg(o).inFrac) }"
                 @pointerdown.stop.prevent="e => startDrag(e, o, 'in')"></div>
            <div v-if="o.motion.out" class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize"
                 :style="{ left: pct(1 - seg(o).outFrac) }"
                 @pointerdown.stop.prevent="e => startDrag(e, o, 'out')"></div>
            <div class="absolute inset-y-0 w-2 cursor-grab"
                 :style="{ left: pct(seg(o).offsetFrac) }"
                 @pointerdown.stop.prevent="e => startDrag(e, o, 'offset')"></div>
          </template>
        </div>
      </div>
      <!-- playhead -->
      <div class="pointer-events-none absolute inset-y-0 w-px bg-white"
           :style="{ left: `calc(80px + 8px + ${duration ? props.playhead / duration : 0} * (100% - 88px))` }"></div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Typecheck gate**

Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'Scene3DMotionTimeline'`
Expected: no output.

- [ ] **Step 3: Commit** (component compiles standalone; wired in Task 5)

```bash
git add frontend/app/components/vue-canvas/Scene3DMotionTimeline.vue
git commit -m "feat(scene3d): band-timeline component (draggable in/out dividers + clip offset)"
```

---

## Task 5: Wire the timeline + ease picker + direction + templates gallery into the Motion tab

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

- [ ] **Step 1: Imports + ease proxy**

```ts
import Scene3DMotionTimeline from '~/components/vue-canvas/Scene3DMotionTimeline.vue'
import CurveEditor from '~/components/vue-canvas/CurveEditor.vue'
import { EASE_PRESETS, presetKeyForEaseRef, easeRefForPresetKey, easeRefToCurveString, curveStringToEaseRef } from '~/lib/scene3d/motion/easePresets'
import { setObjectDirection } from '~/lib/scene3d/motion/panel'
import { SCENE_TEMPLATES } from '~/lib/scene3d/motion/defaults'

const DIRECTION_OPTIONS = [
  { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' },
] as const

// Ease picker proxy for a transition slot on the selected object.
function easeKey(slot: 'in' | 'out') {
  const t = selectedObj.value?.motion?.[slot]; return t ? presetKeyForEaseRef(t.ease) : 'ease-out'
}
function setEaseKey(slot: 'in' | 'out', key: string) {
  const t = selectedObj.value?.motion?.[slot]; if (!t || key === 'custom') return
  t.ease = easeRefForPresetKey(key)
}
function curveProxy(slot: 'in' | 'out') {
  const t = selectedObj.value?.motion?.[slot]
  return easeRefToCurveString(t?.ease ?? { kind: 'bezier', cps: [0.42, 0, 0.58, 1] })
}
function setCurve(slot: 'in' | 'out', v: string) {
  const t = selectedObj.value?.motion?.[slot]; if (t) t.ease = curveStringToEaseRef(v)
}
const EASE_KEY_OPTIONS = [...EASE_PRESETS.map(p => ({ value: p.key, label: p.label })), { value: 'custom', label: 'Custom…' }]
```

- [ ] **Step 2: Replace the templates buttons (from Part 2a) with a gallery** — in the Motion `<StudioSection title="Motion">`, swap the three `<StudioButton>`s for:

```html
<div class="grid grid-cols-3 gap-1">
  <button v-for="key in (['showcase','reveal','loop'] as const)" :key="key" type="button"
          class="nodrag rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-[11px] text-white/70 hover:bg-white/10"
          :class="{ 'border-sky-400/60 text-white': doc.motion.template === key }"
          @click="SCENE_TEMPLATES[key](doc)">
    {{ key === 'showcase' ? 'Showcase' : key === 'reveal' ? 'Reveal' : 'Loop' }}
  </button>
</div>
```

- [ ] **Step 3: Mount the band-timeline** — after the object-motion section, when `motionOn`:

```html
<div v-if="motionOn" class="mt-2">
  <Scene3DMotionTimeline :doc="doc" :selected-id="selectedId" :playhead="playhead" @select="id => (selectedId = id)" />
</div>
```

(Use the surface's real selected-id ref name — confirm it's `selectedId` at ~:1096; adapt if different.)

- [ ] **Step 4: Add direction + ease picker + CurveEditor** to the "Object motion" `StudioSection` (after the In/Out selects):

```html
<template v-if="selectedObj?.motion?.in">
  <div v-if="['move','rise'].includes(selectedObj.motion.in.preset)">
    <label class="mb-1 block text-[11px] text-white/55">In direction</label>
    <StudioSelect :model-value="selectedObj.motion.in.direction ?? 'left'" :options="DIRECTION_OPTIONS"
      @update:model-value="v => setObjectDirection(selectedObj, 'in', v)" />
  </div>
  <div>
    <label class="mb-1 block text-[11px] text-white/55">In ease</label>
    <StudioSelect :model-value="easeKey('in')" :options="EASE_KEY_OPTIONS" @update:model-value="v => setEaseKey('in', v)" />
    <CurveEditor v-if="curveProxy('in') !== null" class="mt-1"
      :model-value="curveProxy('in')!" @update:model-value="v => setCurve('in', v)" />
  </div>
</template>
```

(Repeat the ease block for `'out'`. Direction only shows for `move`/`rise`. `CurveEditor` hides automatically when the ease is procedural — `curveProxy` returns `null`.)

- [ ] **Step 5: Typecheck + full suite**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` → all green.
Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'scene3d'` → no output.

- [ ] **Step 6: Manual runtime check**
1. `cd frontend && npm run dev` → `http://127.0.0.1:3000`, add a 3D node, add 2–3 primitives, Motion tab → Animate.
2. Timeline shows a row per object with In·Loop·Out bands + a camera row; drag the In→Loop divider → In lengthens, Loop shrinks; drag a clip → it staggers; Play (Part 2a transport) shows the playhead riding across.
3. Select an object → In/Out ease pickers; pick "Back" → `CurveEditor` shows the overshoot curve; drag its handles → the entrance feel changes on Play; pick "Bounce" → `CurveEditor` disappears (procedural).
4. Template gallery highlights the active template and re-stamps on click.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): wire band-timeline, ease picker + custom bezier, direction, templates gallery"
```

---

## Task 6: Full-suite + typecheck checkpoint

- [ ] **Step 1:** `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` → all green (Part 1 + 2a + 2b: band math, ease presets, direction helper).
- [ ] **Step 2:** `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts` → no regressions.
- [ ] **Step 3:** `cd frontend && npx vue-tsc --noEmit | grep -iE 'scene3d'` → empty.
- [ ] **Step 4:** End-to-end manual: author a scene on the timeline (drag durations + stagger, custom bézier on one entrance), Play, Export video — the exported mp4 matches the timeline authoring and (for a pure-Loop template) loops seamlessly.

---

## Self-Review

**Spec/design coverage (Part 2b scope):**
- §5 draggable band-timeline (resize In/Out, drag offset/stagger, snap, playhead) → Tasks 1, 4, 5. ✅
- §7 easing: named presets preload the editor; **custom cubic-bézier via `CurveEditor`**; procedural Bounce/Spring/Elastic not editable → Tasks 2, 5. ✅
- §3 per-object `direction` → Tasks 3, 5. ✅
- §4 templates gallery (over Part 1 `SCENE_TEMPLATES`) → Task 5. ✅
- §6 kinetic `stagger` (per-glyph) → **carved out** with the extrude-text glyph dependency documented (whole-object text motion already works).

**Placeholder scan:** none — every step has full code or exact markup + commands. The "confirm `selectedId` ref name" notes point at an existing binding to verify, not missing code.

**Type consistency:** `bandSegments`/`resizeTransition`/`setClipOffset`/`snapSeconds` (Task 1) consumed by `Scene3DMotionTimeline.vue` (Task 4) with matching signatures. `EaseRef` bridge fns (Task 2) consumed by the surface ease proxy (Task 5). `setObjectDirection(obj, slot, dir)` (Task 3) matches its call in Task 5. `CurveEditor` bound as `:model-value`/`@update:model-value` with a `string` — matches its `defineProps<{ modelValue: string }>()` contract.

**Known verification limitation:** `Scene3DMotionTimeline.vue` + the surface edits are `vue-tsc` + manual (no component harness); all their math (band layout, drag→duration, snapping, ease bridge) is unit-tested in Tasks 1–3.

---

## After Part 2b

The feature is complete against the design: 3D Studio scenes author motion on a draggable band-timeline with preset + custom-bézier easing, play live, register as a `StudioFrameSource`, and export video — all reusing existing infrastructure, with the no-keyframes guardrail intact. Remaining design items are explicitly separate features: **per-glyph text stagger** (pending the extrude-text glyph spike) and **Frame node local-layer motion** (Phase 2, `lib/motion` model already exists).
