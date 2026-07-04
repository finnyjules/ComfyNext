# Input Affordances (Variable Glyph + Scrubbable Slider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A discoverable in-input hexagon that one-click-promotes a control to a variable, plus drag-to-scrub on studio sliders and Smart Layout numeric fields — a UX skin over the finished binding system, no new binding logic.

**Architecture:** One pure helper `scrubValue()` (px→value, snap, shift-fine, clamp); a presentational `VariableGlyph.vue` (outline=promotable, filled=bound) that replaces `BindableControlChip` and adds a `promote` emit; `StudioSlider` gains in-component scrub on its value readout plus the glyph in that row; a `v-scrub` directive (Nuxt plugin, mirrors the existing `v-studio-reset`) drives scrub on Smart Layout's boxed number fields via their label prefix. The glyph forwards clicks to each surface's existing `promote`/`openVarMenu`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Vitest. No new deps.

## Global Constraints

- Work on `main`, NO feature branches. `git add` ONLY exact paths — NEVER `git add -A` (parallel sessions have live WIP). Pre-flight `git status --short` every target file; return BLOCKED if a file you must edit is already dirty.
- Implementer dispatches FORBID sub-agents (delegation-spiral lesson).
- The glyph is **neutral white-opacity — never pastel, never purple** (pastel marks AI; a variable is not AI). Emerald = run only. Dark tokens (`text-white/…`, `bg-white/…`). Sentence case copy.
- Tests: `frontend/tests/unit/<name>.unit.spec.ts`; run `cd frontend && npm run test:unit -- tests/unit/<name>.unit.spec.ts`. Suite baseline = 4 known pre-existing failures (spacetype-palette ×2, video-model-adapt, gradientfx-mesh) — must not grow.
- Verified codebase facts (explorer, cite as of today):
  - `StudioSlider.vue`: `const model = defineModel<number>()`; props `{ label?, min, max, step?, default? }`; value readout is `<span class="font-mono text-[11px] text-white/80">{{ Number(model) }}</span>` inside `<div v-if="label" class="mb-1.5 flex items-center justify-between">`; native `<input type=range class="studio-range">` with `v-studio-reset`. No fill element (native track only).
  - `v-studio-reset` is a Nuxt plugin `frontend/app/plugins/studio-reset.client.ts` registering `nuxtApp.vueApp.directive('studio-reset', { mounted(el){…} })`. Mirror this exact shape for `v-scrub`.
  - `BindableControlChip.vue` props `{ columnKey: string | null }`, emits `menu`, renders only when `columnKey` truthy. Used in: `SpaceTypeSurface.vue` (slider dedicated-row + non-slider label), `TextureStudioSurface.vue` (slider row + select label + color label), `BindableRow.vue` (row above the slotted control).
  - `useStudioVarBindings` returns `{ bindings, boundColumnFor, onEdit, promote, unbind }`. Surface `openVarMenu(e, c)` builds the promote/bind/go-to/sweep/unbind menu; `promote(controlDesc(c), params[c.key])` promotes; `controlDesc(c)` + `params[c.key]` are the live desc + value in the loop.
  - `GridPropertyPanel.vue`: region number inputs (col/colSpan/row/rowSpan) at ~lines 435-456, each `<label class="flex items-center gap-1.5"><span class="text-[11px] text-white/40 w-8">Col</span><input type="number" … @change="setRegionField('col', e.target.value)"></label>`; `inputCls` at ~line 340. The overnight work added a Variable row + `boundColumnKey`/`boundSocket` computeds (~lines 40-62) for the bound text/image element content — region geometry is NOT variable-bound (leave it that way).

---

### Task 1: `scrubValue` pure helper

**Files:**
- Create: `frontend/app/lib/studio/scrub.ts`
- Test: `frontend/tests/unit/studio-scrub.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ScrubArgs { startValue: number; deltaPx: number; min: number; max: number; step: number; scrubPx?: number; fine?: boolean }` and `scrubValue(a: ScrubArgs): number` (default `scrubPx` 260; `fine` → ×0.15; snap to `step`; clamp `[min,max]`; strip float dust to 6dp).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/studio-scrub.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { scrubValue } from '~/lib/studio/scrub'

const base = { min: 0, max: 100, step: 1 }

describe('scrubValue', () => {
  it('maps half the default scrub distance to half the range', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130 })).toBe(50)
  })
  it('clamps at both ends', () => {
    expect(scrubValue({ ...base, startValue: 90, deltaPx: 1000 })).toBe(100)
    expect(scrubValue({ ...base, startValue: 10, deltaPx: -1000 })).toBe(0)
  })
  it('snaps to step', () => {
    expect(scrubValue({ min: 0, max: 100, step: 5, startValue: 0, deltaPx: 130 })).toBe(50)
    expect(scrubValue({ min: 0, max: 100, step: 5, startValue: 0, deltaPx: 26 })).toBe(10)
  })
  it('shift-fine scales the delta down', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: true })).toBe(15)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: false })).toBe(100)
  })
  it('honours a per-control scrubPx override', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130, scrubPx: 130 })).toBe(100)
  })
  it('handles a negative-min (bipolar) range and negative delta', () => {
    expect(scrubValue({ min: -100, max: 100, step: 1, startValue: 0, deltaPx: -130 })).toBe(-130 / 260 * 200)
  })
  it('never emits float dust', () => {
    const v = scrubValue({ min: 0, max: 1, step: 0.01, startValue: 0.1, deltaPx: 5, scrubPx: 260 })
    expect(v).toBe(Number(v.toFixed(6)))
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npm run test:unit -- tests/unit/studio-scrub.unit.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// frontend/app/lib/studio/scrub.ts
export interface ScrubArgs {
  startValue: number
  deltaPx: number
  min: number
  max: number
  step: number
  scrubPx?: number
  fine?: boolean
}

export function scrubValue(a: ScrubArgs): number {
  const scrubPx = a.scrubPx && a.scrubPx > 0 ? a.scrubPx : 260
  const step = a.step > 0 ? a.step : 1
  const range = a.max - a.min
  const factor = a.fine ? 0.15 : 1
  const raw = a.startValue + (a.deltaPx / scrubPx) * range * factor
  const snapped = Math.round(raw / step) * step
  const clamped = Math.min(a.max, Math.max(a.min, snapped))
  return Number(clamped.toFixed(6))
}
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/studio/scrub.ts frontend/tests/unit/studio-scrub.unit.spec.ts
git commit -m "feat(studio): scrubValue helper — px-drag to value with snap, fine, clamp"
```

---

### Task 2: `VariableGlyph.vue` component

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/VariableGlyph.vue`

**Interfaces:**
- Consumes: nothing.
- Produces: a hexagon glyph. Props `{ bound: string | null }` (the bound column key, or null). Emits `promote` (left-click when `bound === null`) and `menu` with the `MouseEvent` (left-click when bound; right-click always). Outline hexagon when unbound + hover-reveal (`opacity-0 group-hover:opacity-100`); filled hexagon when bound (`opacity-100`), `title` = the column key. Requires the parent control row to carry the `group` class for hover-reveal.

- [ ] **Step 1: Create the component**

```vue
<!-- frontend/app/components/vue-canvas/studio/VariableGlyph.vue -->
<script setup lang="ts">
// Figma-style variable handle. Outline hexagon = "can become a variable" (one
// click promotes); filled = "is a variable" (click/right-click opens the manage
// menu). Neutral white-opacity — NOT pastel/purple (a variable is not AI). The
// parent control row must be `.group` so the unbound glyph hover-reveals.
const props = defineProps<{ bound: string | null }>()
const emit = defineEmits<{ (e: 'promote'): void; (e: 'menu', event: MouseEvent): void }>()

function onClick(e: MouseEvent) {
  if (props.bound) emit('menu', e)
  else emit('promote')
}
</script>

<template>
  <button
    type="button"
    class="inline-flex shrink-0 items-center justify-center transition-opacity"
    :class="bound ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'"
    :title="bound ?? 'Make variable'"
    :aria-label="bound ? `Variable ${bound}` : 'Make variable'"
    @click.stop="onClick"
    @contextmenu.prevent.stop="emit('menu', $event)"
  >
    <svg width="13" height="14" viewBox="0 0 20 22" fill="none" aria-hidden="true">
      <path
        d="M10 1.5 18 6v10l-8 4.5L2 16V6z"
        :fill="bound ? 'rgba(255,255,255,0.85)' : 'none'"
        :stroke="bound ? 'none' : 'rgba(255,255,255,0.85)'"
        stroke-width="1.6"
      />
    </svg>
  </button>
</template>
```

- [ ] **Step 2: Verify it compiles** — `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i variableglyph` → clean (no output).

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/studio/VariableGlyph.vue
git commit -m "feat(studio): VariableGlyph — outline/filled hexagon, promote or menu"
```

---

### Task 3: StudioSlider — scrub + glyph + bound-name display

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/StudioSlider.vue`
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue`

**Interfaces:**
- Consumes: `scrubValue` (Task 1), `VariableGlyph` (Task 2).
- Produces: StudioSlider gains props `{ bound?: string | null; bindable?: boolean; scrubPx?: number }` and emits `{ promote, menu(MouseEvent) }`. When `bound` is a string: the readout shows that name, scrub is disabled, glyph is filled. When null: readout shows the number and is drag-to-scrub (shift-fine), glyph is outline (hover-reveal). Root gains `class="group"`.

- [ ] **Step 1: Rewrite StudioSlider**

```vue
<!-- frontend/app/components/vue-canvas/studio/StudioSlider.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { scrubValue } from '~/lib/studio/scrub'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'

const model = defineModel<number>({ required: true })
const props = defineProps<{
  label?: string
  min: number
  max: number
  step?: number
  default?: number
  bound?: string | null
  bindable?: boolean
  scrubPx?: number
}>()
const emit = defineEmits<{ (e: 'promote'): void; (e: 'menu', event: MouseEvent): void }>()

function onScrubDown(e: PointerEvent) {
  if (props.bound) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const startX = e.clientX
  const startValue = Number(model.value)
  function move(ev: PointerEvent) {
    model.value = scrubValue({
      startValue, deltaPx: ev.clientX - startX,
      min: props.min, max: props.max, step: props.step ?? 1,
      scrubPx: props.scrubPx, fine: ev.shiftKey,
    })
  }
  function up() {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="group">
    <div v-if="label" class="mb-1.5 flex items-center justify-between">
      <span class="text-[11px] text-white/55">{{ label }}</span>
      <div class="flex items-center gap-1.5">
        <span
          v-if="bound"
          class="max-w-[90px] truncate font-mono text-[11px] text-white/70"
          :title="bound"
        >{{ bound }}</span>
        <span
          v-else
          class="font-mono text-[11px] text-white/80"
          style="cursor: ew-resize; border-bottom: 1px dotted rgba(255,255,255,0.22); padding-bottom: 1px"
          @pointerdown="onScrubDown"
        >{{ Number(model) }}</span>
        <VariableGlyph
          v-if="bindable"
          :bound="bound ?? null"
          @promote="emit('promote')"
          @menu="(e: MouseEvent) => emit('menu', e)"
        />
      </div>
    </div>
    <input
      v-studio-reset :data-default="default" type="range"
      v-model.number="model" :min="min" :max="max" :step="step ?? 1"
      class="studio-range w-full"
    />
  </div>
</template>
```

- [ ] **Step 2: Wire SpaceTypeSurface's slider** — in `SpaceTypeSurface.vue`, the slider branch. REMOVE the separate slider chip row `<div v-else class="mb-1.5 flex items-center gap-1.5"><BindableControlChip :column-key="boundColumnFor(c.key)" @menu="openVarMenu($event, c)" /></div>`. On the `<StudioSlider v-if="c.kind === 'slider'" …>` add:

```
:bindable="controlKindToVariableType(c.kind) !== null"
:bound="boundColumnFor(c.key)"
@promote="promote(controlDesc(c), Number(params[c.key]))"
@menu="(e: MouseEvent) => openVarMenu(e, c)"
```

(keep its existing `:label/:min/:max/:step/:default/:model-value/@update:model-value`.)

- [ ] **Step 3: Wire TextureStudioSurface's slider** — same treatment: delete the slider's `<div v-if="boundColumnFor(c.key)" class="mb-1 flex justify-end"><BindableControlChip …/></div>` row and add the same four bindings to its `<StudioSlider>`. Use whatever the surface's local promote/desc/value/menu names are (grep `openVarMenu`, `promote(`, `controlDesc`/`controlDescriptor`, the `params`/`config` accessor — mirror SpaceType).

- [ ] **Step 4: Verify** — `cd frontend && npm run test:unit` at baseline; `npx vue-tsc --noEmit 2>&1 | grep -iE "studioslider|spacetype|texturestudio"` no new errors (stash-compare). Note in the report which surfaces were wired.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/studio/StudioSlider.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/components/vue-canvas/TextureStudioSurface.vue
git commit -m "feat(studio): slider readout scrubs + carries the variable glyph"
```

---

### Task 4: Glyph on non-slider controls (retire the chip)

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue`
- Modify: `frontend/app/components/vue-canvas/studio/BindableRow.vue`
- Delete: `frontend/app/components/vue-canvas/studio/BindableControlChip.vue`

**Interfaces:**
- Consumes: `VariableGlyph` (Task 2).
- Produces: every remaining `BindableControlChip` usage replaced by `VariableGlyph`; the chip file deleted.

**The swap.** `BindableControlChip` renders only when bound and emits `menu`. `VariableGlyph` renders always (in a `.group`), one-click-promotes when unbound, emits `promote` + `menu`. So each replacement adds a `@promote` and ensures the enclosing label/row is a `group`.

- [ ] **Step 1: SpaceTypeSurface non-slider label** — replace:

```
<span>{{ c.label }}</span>
<BindableControlChip :column-key="boundColumnFor(c.key)" @menu="openVarMenu($event, c)" />
```

with (make the `<label>` a `group` and gate the glyph on bindability):

```
<span>{{ c.label }}</span>
<VariableGlyph
  v-if="controlKindToVariableType(c.kind) !== null"
  :bound="boundColumnFor(c.key)"
  @promote="promote(controlDesc(c), params[c.key] as string | number)"
  @menu="(e: MouseEvent) => openVarMenu(e, c)"
/>
```

Add `group` to that `<label class="mb-1 flex items-center gap-1.5 text-white/60">` → `… group`.

- [ ] **Step 2: TextureStudioSurface select + color labels** — same swap in its select and color label rows (each `<label class="… flex items-center gap-1.5 …">` gets `group`; chip → `VariableGlyph` with `@promote`/`@menu` using the surface's promote/desc/value/menu names).

- [ ] **Step 3: BindableRow (Gradient/Shader/Texture inline controls)** — replace its body:

```vue
<template>
  <div class="group" @contextmenu.prevent="onMenu">
    <div class="flex justify-end">
      <VariableGlyph :bound="bound" @promote="emit('promote', desc())" @menu="onMenu" />
    </div>
    <slot />
  </div>
</template>
```

Add to `<script setup>`: `import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'`, drop the `BindableControlChip` import, and add a `promote` emit: change `defineEmits` to `{ (e: 'menu', event: MouseEvent, control: StudioControlDesc): void; (e: 'promote', control: StudioControlDesc): void }`. (`onMenu` already emits `menu` with `desc()`.) Then in each surface that uses `<BindableRow …>` add `@promote="(control) => promote(control, <that surface's live value for control.key>)"` — grep the BindableRow call sites in GradientStudioSurface / ShaderStudioSurface / TextureStudioSurface and wire `@promote` beside the existing `@menu`. Document the per-surface value accessor used.

- [ ] **Step 4: Delete the chip** — `git rm frontend/app/components/vue-canvas/studio/BindableControlChip.vue`; grep to confirm zero remaining imports.

- [ ] **Step 5: Verify** — full suite baseline; `npx vue-tsc --noEmit 2>&1 | grep -iE "bindablerow|bindablecontrolchip|spacetype|gradient|shader|texture"` no new errors; confirm no dangling `BindableControlChip` import.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/app/components/vue-canvas/GradientStudioSurface.vue frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/app/components/vue-canvas/studio/BindableRow.vue frontend/app/components/vue-canvas/studio/BindableControlChip.vue
git commit -m "feat(studio): variable glyph replaces the bind chip across all studios"
```

---

### Task 5: `v-scrub` directive + Smart Layout numeric-field scrub

**Files:**
- Create: `frontend/app/plugins/scrub.client.ts`
- Modify: `frontend/app/components/templates/GridPropertyPanel.vue`

**Interfaces:**
- Consumes: `scrubValue` (Task 1).
- Produces: a `v-scrub` directive. Binding value: `{ get: () => number; set: (v: number) => void; min: number; max: number; step?: number; scrubPx?: number }`. Attach to a drag handle element (e.g. a field's label prefix); on pointer-drag it computes the new value via `scrubValue` and calls `set`. `ew-resize` cursor applied by the directive.

- [ ] **Step 1: Create the directive plugin** (mirror `studio-reset.client.ts`)

```typescript
// frontend/app/plugins/scrub.client.ts
import { scrubValue } from '~/lib/studio/scrub'

interface ScrubBinding {
  get: () => number
  set: (v: number) => void
  min: number
  max: number
  step?: number
  scrubPx?: number
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('scrub', {
    mounted(el: HTMLElement, node) {
      const state = { b: node.value as ScrubBinding }
      ;(el as any).__scrub = state
      el.style.cursor = 'ew-resize'
      el.addEventListener('pointerdown', (e: PointerEvent) => {
        const b = state.b
        if (!b) return
        e.preventDefault()
        el.setPointerCapture(e.pointerId)
        const startX = e.clientX
        const startValue = Number(b.get())
        const move = (ev: PointerEvent) => {
          b.set(scrubValue({
            startValue, deltaPx: ev.clientX - startX,
            min: b.min, max: b.max, step: b.step ?? 1,
            scrubPx: b.scrubPx, fine: ev.shiftKey,
          }))
        }
        const up = () => {
          el.releasePointerCapture(e.pointerId)
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      })
    },
    updated(el: HTMLElement, node) {
      const s = (el as any).__scrub
      if (s) s.b = node.value as ScrubBinding
    },
  })
})
```

- [ ] **Step 2: Scrub the Smart Layout region fields** — in `GridPropertyPanel.vue`, each region field's LEFT LABEL PREFIX span (`<span class="text-[11px] text-white/40 w-8">Col</span>`) becomes the scrub handle. For the `col` field:

```
<span class="text-[11px] text-white/40 w-8"
      v-scrub="{ get: () => region!.col, set: (v: number) => setRegionField('col', String(v)), min: 1, max: metrics.cols, step: 1 }">Col</span>
```

Apply the same to `colSpan` (max `metrics.cols`), `row`/`rowSpan` (max `metrics.rows`) — `setRegionField('colSpan'|'row'|'rowSpan', String(v))`, min 1. Keep the existing `<input type="number" @change=…>` untouched so click-to-type still works. (Scrub the label; type in the box — the Figma split.)

- [ ] **Step 3: Verify** — full suite baseline; `npx vue-tsc --noEmit 2>&1 | grep -i gridpropertypanel` no new errors. Browser check deferred to Task 6.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/plugins/scrub.client.ts frontend/app/components/templates/GridPropertyPanel.vue
git commit -m "feat(smart-layout): v-scrub directive; drag region-field labels to scrub"
```

---

### Task 6: Browser verification (controller, required gate)

- [ ] Full unit suite at baseline.
- [ ] In-app (a quiet environment — restart ComfyUI if the worker handshake is contended; set the Vue-nodes localStorage flag on the `127.0.0.1` origin, not `localhost`):
  - Open a studio (Type Studio). Hover a slider → outline hexagon fades in. **One click → it becomes a variable** (collection auto-created + wired, glyph fills, readout shows the column name, rail dims). Right-click the filled glyph → go to collection / unbind. Unbind → number + scrub return.
  - **Scrub:** drag a slider's number left/right → value changes; hold shift → fine; double-click still resets. Repeat on a color/select (glyph present, promote works).
  - Gradient/Shader/Texture: glyph on an inline control, one-click promote.
  - Smart Layout inspector: drag a region field's "Col"/"Row" label → the number scrubs; typing in the box still works.
  - Screenshots at each stage. Fix anything found, commit individually, re-verify.

---

### Task 7 (optional): bipolar center-fill

**Files:** Modify `frontend/app/components/vue-canvas/studio/StudioSlider.vue`; Create `frontend/app/lib/studio/fill.ts` + test.

The native range track has **no fill today** (flat rail + thumb). Adding a center-origin fill for signed params (`min<0<max`) means layering a fill element under the native thumb. Only build this if the user wants it — it is cosmetic and carries cross-browser range-styling risk. `fillGeometry({ value, min, max }): { leftPct: number; widthPct: number }` (pure, TDD: left-origin when `min>=0`, center-origin when `min<0<max`, negative values fill leftward) drives an absolutely-positioned overlay div sized to the track. Skipped unless requested.

## Self-Review Notes

- Spec coverage: §2 glyph → Tasks 2-5; §2.4 one-click-promote/retire-chip → Tasks 3-4; §3.1 scrub → Tasks 1,3,5; §3.5 boxed scrub → Task 5; §3.4 double-click reset → preserved (untouched `v-studio-reset`); §3.3 bipolar fill → Task 7 (optional, flagged); §4 bound-not-scrubbable + name display → Task 3. §2.3 placement (inside-edge for boxed, label-row for rails) → Task 3 (slider readout row) + Task 5 (region label handle). §8 open questions surfaced to the user separately.
- Type consistency: `scrubValue`/`ScrubArgs` identical across Tasks 1/3/5; `VariableGlyph` props `{ bound: string|null }` + emits `{ promote, menu }` identical across Tasks 2/3/4; StudioSlider new props `{ bound?, bindable?, scrubPx? }` used consistently.
- Deliberate cut: Smart Layout region geometry stays non-variable (only element content binds, per the overnight work) — the glyph on Smart Layout content lives in the existing inspector Variable row; this round adds scrub there, not new binding surface.
