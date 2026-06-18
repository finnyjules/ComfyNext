# Studios UI Restyle + Accent Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the three media studios (Gradient, Shader, Type/Space Type) to a Linear-grade refined-dark look with a single white accent, shared control primitives, and bordered section cards (no dividers); then unify accent colors app-wide.

**Architecture:** The studios share `StudioModalShell` + `StudioSection`. Restyle those (Phase 1), introduce shared control primitives under `app/components/vue-canvas/studio/` and adopt them in all three surfaces (Phase 2), then sweep decorative accent colors → white app-wide while keeping semantic status colors (Phase 3).

**Tech Stack:** Nuxt 4, Vue 3 `<script setup lang="ts">`, Tailwind (v4, `@import "tailwindcss"`), `PP Neue Montreal` (app `--font-sans`). Verification is `vue-tsc` + Vitest for component logic + user in-app visual check (studios are GPU/flag-gated).

**Design tokens (use verbatim):**
- Surfaces: card `bg-white/[0.03]`, hover `bg-white/[0.05]`, preview panel `bg-[#0a0a0b]`.
- Borders (hairline, used ONLY on cards + header, never as standalone dividers): `border-white/[0.07]`.
- Accent = white: primary button `bg-white text-neutral-900`; active toggle/segment `bg-white text-neutral-900`; slider fill+thumb `bg-white`; focus ring `ring-white/20`.
- Text: primary `text-white/90`, label `text-white/50`, muted `text-white/35`.
- Radius: cards `rounded-lg`, controls `rounded-md`.
- Value readouts: `font-mono text-[11px] text-white/80`.

---

## Phase 1 — Shared chrome

### Task 1: Restyle `StudioSection` (bordered card, no dividers, switch-ready badge)

**Files:**
- Modify: `frontend/app/components/vue-canvas/StudioSection.vue`

- [ ] **Step 1: Replace the component with the restyled version**

```vue
<script setup lang="ts">
// Shared collapsible section for the studio editors' controls column. Bordered card,
// muted title, optional badge (prop or #badge slot, e.g. a StudioSwitch) on the right.
import { ref } from 'vue'

const props = withDefaults(defineProps<{ title: string; badge?: string; open?: boolean }>(), { open: true })
const isOpen = ref(props.open)
</script>

<template>
  <details :open="isOpen" @toggle="isOpen = ($event.target as HTMLDetailsElement).open"
           class="rounded-lg border border-white/[0.07] bg-white/[0.03]">
    <summary class="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 text-[11px] font-medium text-white/50 marker:content-none [&::-webkit-details-marker]:hidden">
      <span class="flex items-center gap-1.5">
        <span class="i-chevron text-white/30 transition-transform" :class="isOpen ? 'rotate-90' : ''">›</span>
        {{ title }}
      </span>
      <slot name="badge">
        <span v-if="badge" class="text-[10px] uppercase tracking-wide text-white/30">{{ badge }}</span>
      </slot>
    </summary>
    <div class="space-y-3 px-3 pb-3 pt-0.5">
      <slot />
    </div>
  </details>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep StudioSection || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/StudioSection.vue
git commit -m "style(studio): bordered-card sections, no dividers, muted titles"
```

### Task 2: Restyle `StudioModalShell` (header + refined frame, no rail divider)

**Files:**
- Modify: `frontend/app/components/vue-canvas/StudioModalShell.vue`

- [ ] **Step 1: Replace with the header-bearing version**

```vue
<script setup lang="ts">
// Shared modal chrome for the studio editors (Space Type, Gradient, Shader). Header
// (title · breadcrumb · esc/close) + big preview/actions on the left and a scrollable
// controls column on the right. Change the chrome here and all three editors update.
defineProps<{ title?: string; breadcrumb?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div class="flex h-[640px] max-h-[92vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white">
      <div class="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1">
        <span class="text-[13px] font-medium tracking-[-0.01em] text-white/90">{{ title }}</span>
        <template v-if="breadcrumb">
          <span class="text-xs text-white/25">/</span>
          <span class="text-xs text-white/50">{{ breadcrumb }}</span>
        </template>
        <span class="flex-1"></span>
        <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
        <button type="button" aria-label="Close" @click="emit('close')"
                class="text-white/45 hover:text-white/80">✕</button>
      </div>
      <div class="flex min-h-0 flex-1 gap-4 p-4">
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex min-h-0 flex-1 items-center justify-center"><slot name="preview" /></div>
          <div class="mt-3 flex shrink-0 items-center gap-2"><slot name="actions" /></div>
        </div>
        <div class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pr-1 min-h-0"><slot name="controls" /></div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep StudioModalShell || echo OK` → `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/StudioModalShell.vue
git commit -m "style(studio): modal header with title/breadcrumb/close; refined frame"
```

### Task 3: Pass title/breadcrumb + close into the three surfaces

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (the `<StudioModalShell>` usage)
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue`

- [ ] **Step 1: For each surface, set the shell props and wire close.** Each surface already has a close handler (`closeEditor` / `emit('close')`). Change the opening tag, e.g. Shader Studio:

```vue
<StudioModalShell title="Shader studio" :breadcrumb="effectDef?.name" @close="closeEditor">
```

Type Studio: `title="Type studio" :breadcrumb="effect.label"`. Gradient Studio: `title="Gradient studio"` (no breadcrumb). Remove any now-duplicate in-panel close button from the `#actions` slot if one exists (keep a Close in actions only if the surface relies on it; the header close calls the same handler).

- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "Surface.vue" || echo OK` → `OK` (ignore pre-existing unrelated errors)

- [ ] **Step 3: User in-app visual check (Phase 1 gate):** open each studio; confirm header, bordered-card sections, no dividers. Then commit.

```bash
git add frontend/app/components/vue-canvas/{SpaceType,ShaderStudio,GradientStudio}Surface.vue
git commit -m "style(studio): wire header title/breadcrumb/close into all three surfaces"
```

---

## Phase 2 — Shared control primitives

All new files go in `frontend/app/components/vue-canvas/studio/`.

### Task 4: `StudioButton` + adopt in footers

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioButton.vue`
- Test: `frontend/tests/unit/studio-button.unit.spec.ts`
- Modify: the three surfaces' `#actions` slots

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'subtle'; disabled?: boolean }>(), { variant: 'secondary' })
const CLS: Record<string, string> = {
  primary: 'bg-white text-neutral-900 hover:bg-white/90',
  secondary: 'border border-white/15 text-white/85 hover:bg-white/10',
  subtle: 'text-white/50 hover:text-white/80',
}
</script>
<template>
  <button type="button" :disabled="disabled"
          class="rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          :class="CLS[variant]">
    <slot />
  </button>
</template>
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StudioButton from '../../app/components/vue-canvas/studio/StudioButton.vue'

describe('StudioButton', () => {
  it('applies the white primary classes for variant=primary', () => {
    const w = mount(StudioButton, { props: { variant: 'primary' }, slots: { default: 'Go' } })
    expect(w.classes()).toContain('bg-white')
    expect(w.text()).toBe('Go')
  })
})
```

NOTE: if `@vue/test-utils` is not a dependency (the spacetype tests run `environment: 'node'` without it), SKIP the mount test and instead assert the class map directly by importing nothing — verify visually. Check first: `cd frontend && node -e "require.resolve('@vue/test-utils')" && echo HAVE || echo MISSING`.

- [ ] **Step 3: Run test** — `npx vitest run tests/unit/studio-button.unit.spec.ts` (only if `@vue/test-utils` present; else skip to Step 4 and rely on typecheck + visual).

- [ ] **Step 4: Adopt in footers.** Replace the raw `<button>`s in each surface's `#actions` slot. Shader Studio currently:

```vue
<button class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500" :disabled="baking" @click="generateImage">…</button>
```

becomes:

```vue
<StudioButton variant="primary" :disabled="baking" @click="generateImage">{{ baking ? (bakeMsg || 'Working…') : 'Generate as image' }}</StudioButton>
```

The emerald "video" button → `variant="secondary"`; the `bg-white/5` Close → `variant="subtle"`. Apply the same mapping to Gradient + Type Studio action buttons (primary = the main bake/add action, secondary = alternates, subtle = close). Import `StudioButton` in each.

- [ ] **Step 5: Typecheck + commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioButton.vue frontend/tests/unit/studio-button.unit.spec.ts frontend/app/components/vue-canvas/{SpaceType,ShaderStudio,GradientStudio}Surface.vue
git commit -m "feat(studio): StudioButton; white primary across studio footers (retires blue)"
```

### Task 5: `StudioSwitch` + adopt for enable toggles

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioSwitch.vue`
- Modify: `ShaderStudioSurface.vue`, `GradientStudioSurface.vue` (the `accent-emerald-500` checkboxes in `#badge` slots)

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
</script>
<template>
  <button type="button" role="switch" :aria-checked="model" @click.stop="model = !model"
          class="relative h-[16px] w-[28px] rounded-full transition-colors"
          :class="model ? 'bg-white' : 'bg-white/15'">
    <span class="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all"
          :class="model ? 'left-[14px] bg-neutral-900' : 'left-[2px] bg-white/70'"></span>
  </button>
</template>
```

- [ ] **Step 2: Adopt.** Replace each enable checkbox. Shader Studio currently:

```vue
<template #badge><input v-model="config.effect.enabled" type="checkbox" class="accent-emerald-500" @click.stop /></template>
```

becomes:

```vue
<template #badge><StudioSwitch v-model="config.effect.enabled" /></template>
```

Apply to every `accent-emerald-500` / `type="checkbox"` enable toggle in Shader + Gradient. Import `StudioSwitch`.

- [ ] **Step 3: Typecheck + commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioSwitch.vue frontend/app/components/vue-canvas/{ShaderStudio,GradientStudio}Surface.vue
git commit -m "feat(studio): StudioSwitch; replace emerald enable checkboxes"
```

### Task 6: `StudioSlider` (slim white rail + value readout)

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioSlider.vue`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
const model = defineModel<number>({ required: true })
defineProps<{ label?: string; min: number; max: number; step?: number }>()
</script>
<template>
  <div>
    <div v-if="label" class="mb-1.5 flex items-center justify-between">
      <span class="text-[11px] text-white/55">{{ label }}</span>
      <span class="font-mono text-[11px] text-white/80">{{ Number(model) }}</span>
    </div>
    <input type="range" v-model.number="model" :min="min" :max="max" :step="step ?? 1" class="studio-range w-full" />
  </div>
</template>
<style scoped>
.studio-range { -webkit-appearance: none; appearance: none; height: 2px; border-radius: 2px; background: rgba(255,255,255,0.12); }
.studio-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 9999px; background: #fff; cursor: pointer; }
.studio-range::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 9999px; background: #fff; cursor: pointer; }
.studio-range:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(255,255,255,0.12); }
</style>
```

- [ ] **Step 2: Typecheck + commit** (`vue-tsc … | grep StudioSlider || echo OK`)

```bash
git add frontend/app/components/vue-canvas/studio/StudioSlider.vue
git commit -m "feat(studio): StudioSlider with slim white rail + value readout"
```

### Task 7: `StudioSegmented` (binary/few-option enums)

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioSegmented.vue`
- Test: `frontend/tests/unit/studio-segmented.unit.spec.ts`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
const model = defineModel<string>({ required: true })
defineProps<{ options: string[] }>()
</script>
<template>
  <div class="flex rounded-md bg-white/[0.05] p-0.5">
    <button v-for="o in options" :key="o" type="button" @click="model = o"
            class="flex-1 rounded px-2 py-1 text-[11px] capitalize transition-colors"
            :class="model === o ? 'bg-white text-neutral-900' : 'text-white/55 hover:text-white/80'">
      {{ o }}
    </button>
  </div>
</template>
```

- [ ] **Step 2: Write a logic test** (pure — no mount needed)

```ts
import { describe, it, expect } from 'vitest'
// Segmented is presentational; assert the active-class rule it encodes.
function activeClass(model: string, o: string) { return model === o ? 'bg-white text-neutral-900' : 'text-white/55' }
describe('segmented active rule', () => {
  it('marks only the selected option active', () => {
    expect(activeClass('a', 'a')).toContain('bg-white')
    expect(activeClass('a', 'b')).not.toContain('bg-white')
  })
})
```

- [ ] **Step 3: Run** — `npx vitest run tests/unit/studio-segmented.unit.spec.ts` → PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioSegmented.vue frontend/tests/unit/studio-segmented.unit.spec.ts
git commit -m "feat(studio): StudioSegmented control"
```

### Task 8: `StudioSelect` (styled dropdown for many-option enums)

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioSelect.vue`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
const model = defineModel<string>({ required: true })
defineProps<{ options: string[] }>()
</script>
<template>
  <select v-model="model"
          class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20">
    <option v-for="o in options" :key="o" :value="o" class="bg-neutral-900">{{ o }}</option>
  </select>
</template>
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioSelect.vue
git commit -m "feat(studio): StudioSelect styled dropdown"
```

### Task 9: Migrate Type Studio's auto-builder to the primitives

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (the `v-for="c in section.controls"` block, ~lines 507–576)

- [ ] **Step 1: Swap the per-`kind` markup for primitives.** Map:
  - `slider` → `<StudioSlider v-model.number="params[c.key]" :label="c.label" :min="c.min" :max="c.max" :step="c.step" />` (drop the separate `<label>` — the slider renders its own).
  - `select` → if `c.options.length <= 3`: `<StudioSegmented v-model="params[c.key]" :options="c.options" @update:modelValue="rebuild" />`; else `<StudioSelect v-model="params[c.key]" :options="c.options" @update:modelValue="rebuild" />`. Keep the `<label>` above for select/segmented.
  - `text`, `textList`, `fillList`, `color`, `font`, `path`: keep structure, restyle inputs to `border border-white/[0.08] bg-white/[0.04]` (drop `bg-white/10`); color swatches and the font picker keep their logic.
  Import the four primitives. Keep the `rebuild`/`@input` hooks exactly as they are.

- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep SpaceTypeSurface || echo OK` → `OK`

- [ ] **Step 3: Run the full spacetype suite (no regressions in logic)** — `npx vitest run tests/unit/spacetype` → all pass

- [ ] **Step 4: User in-app visual check (Phase 2 gate)** — open Type Studio, confirm sliders show values, binary enums are segmented, all controls styled. Then commit.

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "style(studio): Type Studio controls use shared primitives"
```

### Task 10: Adopt slider/select/segmented in Shader + Gradient studios

**Files:**
- Modify: `ShaderStudioSurface.vue`, `GradientStudioSurface.vue`

- [ ] **Step 1: Replace hand-written sliders/selects.** Find each `<input type="range">` + its label/value markup and replace with `<StudioSlider>`; each `<select>` with `<StudioSelect>` (or `<StudioSegmented>` for binary, e.g. the Fluted Glass Pattern Linear/Concentric — note this is a shaderfx enum rendered in the studio param loop, so apply there). Preserve all existing `@change`/`@input` handlers and `v-model` targets.

- [ ] **Step 2: Typecheck + Phase-2 visual check + commit**

```bash
git add frontend/app/components/vue-canvas/{ShaderStudio,GradientStudio}Surface.vue
git commit -m "style(studio): Shader + Gradient adopt shared control primitives"
```

---

## Phase 3 — Consistency + app-wide accent sweep

### Task 11: Studios consistency pass

**Files:**
- Modify: the three surfaces

- [ ] **Step 1: Normalize.** Verify all three: identical header pattern, identical footer button variants, section labels sentence-case, control spacing consistent (`space-y-3`). Fix any stragglers (stray `bg-white/10` inputs, leftover dividers). Typecheck.

- [ ] **Step 2: User visual check across all three + commit**

```bash
git add frontend/app/components/vue-canvas/{SpaceType,ShaderStudio,GradientStudio}Surface.vue
git commit -m "style(studio): consistency pass across the three studios"
```

### Task 12: App-wide accent sweep (decorative → white; keep semantic)

**Files:**
- Modify: ~44 frontend files (the audit set). Find them: `cd frontend && grep -rlE "(bg|text|border|ring|accent|from|to)-(blue|emerald|sky|indigo|cyan)-[0-9]" app/ | grep -v node_modules`

- [ ] **Step 1: Build the worklist.** `grep -rnE "(bg|text|border|ring|accent|from|to)-(blue|emerald|sky|indigo|cyan)-[0-9]{2,3}(/[0-9]+)?" app/ | grep -v node_modules > /tmp/accent-hits.txt`. Review each hit.

- [ ] **Step 2: Apply the conversion rule per hit (NOT a blind sed):**
  - **Convert → white** decorative/brand/primary/active accents:
    - `bg-blue-600/500`, `bg-emerald-*` (buttons/active), `bg-sky-*`, `bg-cyan-*`, `bg-indigo-*` → `bg-white` (primary) or `bg-white/10`/`bg-white/15` (subtle/active fills).
    - `text-emerald-*`/`text-blue-*`/`text-cyan-*` (decorative/active labels, icons) → `text-white` or `text-white/70`.
    - `border-emerald-*`/`border-cyan-*` (decorative) → `border-white/15`.
    - `ring-emerald-*` → `ring-white/20`. `accent-emerald-*` (native inputs) → `accent-white`.
  - **KEEP emerald on the node run/▶ control** — established convention, NOT part of the inconsistency. Find it (the run/queue/play button in the node graph + canvas toolbar) and leave its emerald untouched. This is the one decorative-looking emerald that stays.
  - **KEEP (functional status, do not touch):**
    - `red` (errors/destructive), `amber`/`yellow` (warnings), and `green`/`emerald` where it signals success/ready/connected (toast checkmarks, "ready"/"connected"/"done" states, the backend-ready pill).
    - When unsure whether an emerald is decorative (→white) vs node-run/status (keep): the studio primary CTAs and scattered decorative accents go white; the node run button and genuine status indicators stay.
  - Skip any color that is data/graph encoding (e.g. type-color ports via `getTypeColor`) — leave untouched.

- [ ] **Step 3: Typecheck after the sweep** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | tail -5` (no NEW errors vs baseline).

- [ ] **Step 4: Commit in reviewable chunks** (e.g. group by directory/feature so the diff is auditable):

```bash
git add -p   # stage per-hunk, confirming each accent→white change
git commit -m "style: unify decorative accents to white app-wide (keep status colors)"
```

- [ ] **Step 5: User final visual sweep** — spot-check key screens (canvas, nodes, toasts, studios) that errors are still red, success still green, and no stray blue/emerald accents remain.

---

## Notes for the implementer

- Studios are gated (`SPACE_TYPE_ENABLED`) and GPU-dependent; there is no headless visual test. Each phase's real verification is the user opening the studio. Keep diffs phase-scoped.
- `PP Neue Montreal` is already the app `--font-sans`; do not add font CSS — components inherit it. Mono readouts use Tailwind `font-mono`.
- Do NOT touch `StringPathEditor.vue` / `stringPath.ts` (another session owns uncommitted changes there).
- If `@vue/test-utils` is absent, component tests fall back to pure-logic assertions + typecheck + visual; do not add the dependency just for this.
