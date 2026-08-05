# Studio control row foundation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the studios' two-line label-above-rail control layout with a single
28px row that *is* the control, and route every existing control kind through it.

**Architecture:** One `StudioRow.vue` owns the row shell (label, fill, value slot,
variable glyph, drag, typed entry, double-click reset). A `kind → component` registry
supplies only the value side. `StudioControlPanel` drives rows from a `ControlSpec[]`;
the existing prop-based `StudioSlider` / `StudioSelect` / `StudioSwitch` /
`StudioSegmented` become thin adapters that build a one-element `ControlSpec` and
render through the same row, so there is one render path rather than two.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>`, TypeScript, Tailwind, Vitest
(`environment: 'node'`), reka-ui for tooltips.

**Source spec:** [`docs/superpowers/specs/2026-08-04-studio-control-rebuild-design.md`](../specs/2026-08-04-studio-control-rebuild-design.md)

## Global constraints

- Run unit tests with `cd frontend && npx vitest run <file>`; the whole suite is
  `npm run test:unit`. Vitest counts are unreliable under load — check `uptime` and the
  collected-file total before quoting a before/after.
- Test environment is `node`. There is **no** `@vue/test-utils` in this repo and this
  plan does not add one. Pure logic is unit-tested; components are verified by driving
  the app in the Browser pane. Do not introduce a component-test framework.
- Test files live at `frontend/tests/unit/*.unit.spec.ts` and import app code by
  relative path (`../../app/lib/...`), matching every existing test.
- Aliases: `~` → `frontend/app`, `~~` → `frontend/`.
- Colours: action blue is the only accent; the variable glyph's pink
  (`--var-accent`) is the sole exception and is already established. Never purple.
- Row height is exactly `28px` (`h-7`). The colour swatch is already `h-7 w-7`.
- Commit directly to `main`. Stage only this plan's own files —
  `git add <explicit paths>`, never `git add -A`, never `git stash`. Other sessions
  have uncommitted work in this tree.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File structure

| File | Responsibility |
| --- | --- |
| `frontend/app/lib/studio/row.ts` (new) | Pure row maths: fill origin/fraction, value formatting, typed-input parsing, reset target. No DOM. |
| `frontend/tests/unit/studio-row.unit.spec.ts` (new) | Tests for the above. |
| `frontend/app/lib/studio/sections.ts` (modify) | Gains nested groups via `'Parent/Child'` paths. |
| `frontend/tests/unit/studio-sections.unit.spec.ts` (modify) | Nesting cases added to the existing suite. |
| `frontend/app/components/vue-canvas/studio/StudioRow.vue` (new) | The 28px shell. Kind-agnostic. |
| `frontend/app/components/vue-canvas/studio/rows/registry.ts` (new) | `kind → value-renderer component` map. |
| `frontend/app/components/vue-canvas/studio/rows/RowSlider.vue` (new) | Numeric value readout + typed entry target. |
| `frontend/app/components/vue-canvas/studio/rows/RowSelect.vue` (new) | Inline dropdown value. |
| `frontend/app/components/vue-canvas/studio/rows/RowSwitch.vue` (new) | Toggle value. |
| `frontend/app/components/vue-canvas/studio/rows/RowColor.vue` (new) | Hex text + existing `StudioColor` swatch. |
| `frontend/app/components/vue-canvas/studio/rows/RowText.vue` (new) | Inline text field value. |
| `frontend/app/components/vue-canvas/studio/StudioSlider.vue` (modify) | Becomes an adapter. Props unchanged. |
| `frontend/app/components/vue-canvas/studio/StudioSelect.vue` (modify) | Becomes an adapter. Props unchanged. |
| `frontend/app/components/vue-canvas/studio/StudioSwitch.vue` (modify) | Becomes an adapter. Props unchanged. |
| `frontend/app/components/vue-canvas/studio/StudioSectionTree.vue` (new) | Recursively renders one grouped `Section` and its children. |
| `frontend/app/components/vue-canvas/studio/StudioControlPanel.vue` (modify) | Groups once, hands the tree to `StudioSectionTree`. |

Out of scope for this plan (later plans): the four new kinds (`action`, `angle`,
`spring`, `xy`), the sweep across the 35 surface files, copy-values, and the colour
`alpha` flag.

---

### Task 1: Pure row logic

**Files:**
- Create: `frontend/app/lib/studio/row.ts`
- Test: `frontend/tests/unit/studio-row.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isBipolar(min, max): boolean`, `fillOrigin(min, max): number`,
  `fillFraction(value, min, max): number`, `stepDecimals(step): number`,
  `formatValue(value, step): string`,
  `parseTyped(input, min, max, step): number | null`,
  `resetValue({ default?, min, max }): number`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/studio-row.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isBipolar, fillOrigin, fillFraction, stepDecimals, formatValue, parseTyped, resetValue,
} from '../../app/lib/studio/row'

describe('isBipolar', () => {
  it('is true only when the range crosses zero', () => {
    expect(isBipolar(-0.5, 0.5)).toBe(true)
    expect(isBipolar(0, 100)).toBe(false)
    expect(isBipolar(-10, 0)).toBe(false)
  })
})

describe('fillOrigin', () => {
  it('starts at the left for a one-sided range', () => {
    expect(fillOrigin(0, 100)).toBe(0)
  })

  it('starts where zero sits for a bipolar range', () => {
    expect(fillOrigin(-0.5, 0.5)).toBeCloseTo(0.5)
    expect(fillOrigin(-1, 3)).toBeCloseTo(0.25)
  })
})

describe('fillFraction', () => {
  it('maps the value onto 0..1', () => {
    expect(fillFraction(50, 0, 100)).toBeCloseTo(0.5)
  })

  it('clamps outside the range rather than overflowing the row', () => {
    expect(fillFraction(150, 0, 100)).toBe(1)
    expect(fillFraction(-20, 0, 100)).toBe(0)
  })

  it('reads zero for a zero-width range instead of dividing by zero', () => {
    expect(fillFraction(5, 5, 5)).toBe(0)
  })
})

describe('stepDecimals', () => {
  it('derives the decimal places from the step', () => {
    expect(stepDecimals(1)).toBe(0)
    expect(stepDecimals(0.01)).toBe(2)
    expect(stepDecimals(0.5)).toBe(1)
  })

  it('falls back to whole numbers for a missing or bad step', () => {
    expect(stepDecimals(0)).toBe(0)
    expect(stepDecimals(NaN)).toBe(0)
  })
})

describe('formatValue', () => {
  it('shows exactly as many decimals as the step implies', () => {
    expect(formatValue(0.3333, 0.01)).toBe('0.33')
    expect(formatValue(12, 1)).toBe('12')
  })
})

describe('parseTyped', () => {
  it('accepts a plain number', () => {
    expect(parseTyped('42', 0, 100, 1)).toBe(42)
  })

  it('ignores stray units someone pasted in', () => {
    expect(parseTyped('42px', 0, 100, 1)).toBe(42)
  })

  it('snaps to the step', () => {
    expect(parseTyped('0.337', 0, 1, 0.01)).toBeCloseTo(0.34)
  })

  it('clamps to the range', () => {
    expect(parseTyped('900', 0, 100, 1)).toBe(100)
    expect(parseTyped('-900', 0, 100, 1)).toBe(0)
  })

  it('rejects non-numbers rather than writing NaN into the document', () => {
    expect(parseTyped('abc', 0, 100, 1)).toBeNull()
    expect(parseTyped('', 0, 100, 1)).toBeNull()
    expect(parseTyped('   ', 0, 100, 1)).toBeNull()
  })
})

describe('resetValue', () => {
  it('prefers the declared default', () => {
    expect(resetValue({ default: 7, min: 0, max: 100 })).toBe(7)
  })

  it('falls back to zero for a bipolar range', () => {
    expect(resetValue({ min: -0.5, max: 0.5 })).toBe(0)
  })

  it('falls back to the minimum otherwise', () => {
    expect(resetValue({ min: 20, max: 100 })).toBe(20)
  })

  it('treats a declared zero default as a real default, not as absent', () => {
    expect(resetValue({ default: 0, min: 20, max: 100 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd frontend && npx vitest run tests/unit/studio-row.unit.spec.ts
```

Expected: FAIL — `Failed to resolve import "../../app/lib/studio/row"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/studio/row.ts`:

```ts
/**
 * Pure geometry and value handling for a studio control row. Kept out of
 * StudioRow.vue so it is testable without a DOM — the row's visual behaviour and
 * its reset behaviour must agree, and the only way to prove that is here.
 */

/** A range that crosses zero. BOTH the fill origin and the double-click reset
 *  target key off this predicate, so a bipolar slider's fill can never grow from
 *  the left while its reset snaps to the middle. */
export function isBipolar(min: number, max: number): boolean {
  return min < 0 && max > 0
}

/** Where the fill starts, 0..1 across the row. Centre-ish for a bipolar range
 *  (wherever zero actually falls), hard left otherwise. */
export function fillOrigin(min: number, max: number): number {
  if (!isBipolar(min, max)) return 0
  const range = max - min
  return range > 0 ? (0 - min) / range : 0
}

/** The value's position, 0..1. Clamped — a value outside the range pins to an end
 *  rather than painting past the row. */
export function fillFraction(value: number, min: number, max: number): number {
  const range = max - min
  if (!(range > 0)) return 0
  return Math.min(1, Math.max(0, (value - min) / range))
}

/** Decimal places implied by a step: 0.01 → 2, 1 → 0. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const s = String(step)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

export function formatValue(value: number, step: number): string {
  return Number(value).toFixed(stepDecimals(step))
}

/** Parse a typed value. Returns null when it is not a number so the caller can
 *  revert the field instead of writing NaN through to the document. Stray units
 *  are stripped because people paste "42px" out of dev tools. */
export function parseTyped(input: string, min: number, max: number, step: number): number | null {
  const cleaned = String(input).trim().replace(/[^0-9eE+\-.]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  const snapped = step > 0 ? Math.round(n / step) * step : n
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(6))
}

/** Double-click target. A declared default always wins — including a default of 0,
 *  which is why this tests for null rather than falsiness. Without one, this is the
 *  legacy heuristic lifted from plugins/studio-reset.client.ts. */
export function resetValue(opts: { default?: number; min: number; max: number }): number {
  const d = opts.default
  if (d != null && Number.isFinite(d)) return d
  return isBipolar(opts.min, opts.max) ? 0 : opts.min
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd frontend && npx vitest run tests/unit/studio-row.unit.spec.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/studio/row.ts frontend/tests/unit/studio-row.unit.spec.ts
git commit -m "feat(studio): pure row logic for the control row rebuild

Fill origin, fill fraction, value formatting, typed-input parsing and the
double-click reset target. isBipolar is shared by the fill origin and the reset
target so they cannot disagree; that heuristic previously lived untested inside
plugins/studio-reset.client.ts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Nested sections

**Files:**
- Modify: `frontend/app/lib/studio/sections.ts`
- Test: `frontend/tests/unit/studio-sections.unit.spec.ts` (existing file, add cases)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Section<T> = { title: string; controls: T[]; sections: Section<T>[] }`,
  and `groupIntoSections` returning `Section<T>[]`. Existing callers read `.title`
  and `.controls` and keep working; `.sections` is additive.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/studio-sections.unit.spec.ts`, inside the existing
`describe('groupIntoSections', …)` block:

```ts
  it('treats a slashed group as a child section', () => {
    const out = groupIntoSections(
      [c('a', 'Alpha'), c('s', 'Alpha/Shadow')],
      ['Alpha', 'Alpha/Shadow'],
    )
    expect(out.map(s => s.title)).toEqual(['Alpha'])
    expect(out[0]!.controls.map(x => x.key)).toEqual(['a'])
    expect(out[0]!.sections.map(s => s.title)).toEqual(['Shadow'])
    expect(out[0]!.sections[0]!.controls.map(x => x.key)).toEqual(['s'])
  })

  it('creates the parent even when only the child path is listed', () => {
    const out = groupIntoSections([c('s', 'Alpha/Shadow')], ['Alpha/Shadow'])
    expect(out.map(s => s.title)).toEqual(['Alpha'])
    expect(out[0]!.controls).toEqual([])
    expect(out[0]!.sections.map(s => s.title)).toEqual(['Shadow'])
  })

  it('nests more than one level deep', () => {
    const out = groupIntoSections([c('d', 'A/B/C')], ['A/B/C'])
    expect(out[0]!.sections[0]!.sections[0]!.title).toBe('C')
    expect(out[0]!.sections[0]!.sections[0]!.controls.map(x => x.key)).toEqual(['d'])
  })

  it('prunes a branch whose every descendant is empty', () => {
    const out = groupIntoSections([c('a', 'Alpha')], ['Alpha', 'Beta/Deep'])
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('gives flat groups an empty children array, so callers can loop blindly', () => {
    const out = groupIntoSections([c('a', 'Alpha')], ORDER)
    expect(out[0]!.sections).toEqual([])
  })
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

```bash
cd frontend && npx vitest run tests/unit/studio-sections.unit.spec.ts
```

Expected: the 6 original tests PASS, the 5 new ones FAIL with
`Cannot read properties of undefined (reading 'map')` or `expected undefined to equal []`.

- [ ] **Step 3: Write the implementation**

Replace the body of `frontend/app/lib/studio/sections.ts` with:

```ts
/**
 * Group a studio's controls into ordered inspector sections.
 *
 * The `order` array is BOTH the ordering and the allow-list: a control whose group
 * is not listed is dropped, matching texturefx/sections.ts's documented contract
 * ("any control whose group is not listed here is silently dropped"). Sections that
 * end up empty are omitted, so a studio never renders a blank card.
 *
 * A group may be a PATH — 'Canvas/Shadow' puts Shadow inside Canvas. A parent named
 * only implicitly (its own path absent from `order`) is still created, holding no
 * controls of its own. Orders without slashes behave exactly as they did before
 * nesting existed.
 */
export interface Section<T> {
  title: string
  controls: T[]
  sections: Section<T>[]
}

export function groupIntoSections<T extends { group?: string }>(
  controls: T[],
  order: readonly string[],
  visible?: (c: T) => boolean,
): Section<T>[] {
  const byGroup = new Map<string, T[]>()
  for (const c of controls) {
    if (visible && !visible(c)) continue
    const g = String(c.group ?? '')
    if (!order.includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }

  // Build every listed path as a tree node first, in `order`, so declaration order
  // still decides sibling order at every depth.
  const roots: Section<T>[] = []
  const index = new Map<string, Section<T>>()
  for (const path of order) {
    let full = ''
    let siblings = roots
    for (const part of path.split('/')) {
      full = full ? `${full}/${part}` : part
      let node = index.get(full)
      if (!node) {
        node = { title: part, controls: [], sections: [] }
        index.set(full, node)
        siblings.push(node)
      }
      siblings = node.sections
    }
    index.get(path)!.controls = byGroup.get(path) ?? []
  }

  // Then prune bottom-up: a node survives if it holds controls or a surviving child.
  const prune = (nodes: Section<T>[]): Section<T>[] =>
    nodes
      .map((n) => ({ ...n, sections: prune(n.sections) }))
      .filter((n) => n.controls.length > 0 || n.sections.length > 0)
  return prune(roots)
}
```

- [ ] **Step 4: Run the tests and confirm all pass**

```bash
cd frontend && npx vitest run tests/unit/studio-sections.unit.spec.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Check no other caller broke**

```bash
cd frontend && npx vitest run tests/unit/spacetype-sections.unit.spec.ts tests/unit/catalog-sections.unit.spec.ts
```

Expected: PASS. If either fails on a deep equality against a section object, add
`sections: []` to that test's expectation — the field is additive and the failure is
the test pinning an old shape, not a regression.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/studio/sections.ts frontend/tests/unit/studio-sections.unit.spec.ts
git commit -m "feat(studio): nested inspector sections via slashed group paths

'Canvas/Shadow' nests Shadow inside Canvas; an implicit parent is created empty;
branches with no controls anywhere are pruned. Orders without slashes are
unchanged, and .sections is additive so existing callers keep working.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The row shell and the slider renderer

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioRow.vue`
- Create: `frontend/app/components/vue-canvas/studio/rows/RowSlider.vue`
- Create: `frontend/app/components/vue-canvas/studio/rows/registry.ts`

**Interfaces:**
- Consumes: everything exported from Task 1's `~/lib/studio/row`.
- Produces: `StudioRow` with props
  `{ spec: ControlSpec; modelValue: string | number | boolean; bound?: string | null; bindable?: boolean }`
  and emits `update:modelValue` (value), `promote` (), `menu` (MouseEvent).
  `rowRenderers: Record<string, Component>` from `rows/registry.ts`.

There is no component-test harness in this repo, so this task is verified by driving
the app, not by a unit test. That is a deliberate constraint from the spec, not an
omission — do not add `@vue/test-utils` to satisfy a TDD reflex.

- [ ] **Step 1: Write the registry**

Create `frontend/app/components/vue-canvas/studio/rows/registry.ts`:

```ts
import type { Component } from 'vue'
import RowSlider from './RowSlider.vue'

/**
 * kind → the component that draws the VALUE side of a row. The row shell
 * (StudioRow.vue) draws everything else, so a renderer never repeats the label,
 * the glyph or the fill. Adding a kind is one component plus one line here.
 */
export const rowRenderers: Record<string, Component> = {
  slider: RowSlider,
}

/** Kinds whose value is a number the row itself can drag and type into. */
export const NUMERIC_KINDS = new Set(['slider'])
```

- [ ] **Step 2: Write the slider value renderer**

Create `frontend/app/components/vue-canvas/studio/rows/RowSlider.vue`:

```vue
<script setup lang="ts">
// The value side of a numeric row: a mono readout that becomes an input when the row
// says it is being edited. The row shell owns dragging, the fill, and committing —
// this only renders, so the two never fight over the pointer.
import { ref, watch, nextTick } from 'vue'
import { formatValue } from '~/lib/studio/row'

import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{
  value: number
  spec: ControlSpec
  step: number
  editing: boolean
}>()
const emit = defineEmits<{ (e: 'commit', raw: string): void; (e: 'cancel'): void }>()

const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

watch(() => props.editing, async (on) => {
  if (!on) return
  draft.value = formatValue(props.value, props.step)
  await nextTick()
  input.value?.select()
})
</script>

<template>
  <input
    v-if="editing"
    ref="input"
    v-model="draft"
    spellcheck="false"
    class="w-16 rounded-[4px] bg-white/10 px-1 text-right font-mono text-[11px] text-white outline-none"
    @keydown.enter.prevent="emit('commit', draft)"
    @keydown.esc.prevent="emit('cancel')"
    @blur="emit('commit', draft)"
    @pointerdown.stop
  />
  <span v-else class="font-mono text-[11px] text-white/90">{{ formatValue(value, step) }}</span>
</template>
```

- [ ] **Step 3: Write the row shell**

Create `frontend/app/components/vue-canvas/studio/StudioRow.vue`:

```vue
<script setup lang="ts">
/**
 * One studio control, as one 28px row. The row IS the control: the fill behind it
 * shows the value, dragging anywhere on it scrubs, clicking the number types an
 * exact value, and double-clicking resets to the declared default.
 *
 * Kind-agnostic on purpose — the value side comes from rows/registry.ts, so this
 * file never grows a per-kind branch. Complex kinds (curve, path, gradientStops,
 * fillList) render this row as a header and expand a body beneath it via the
 * #body slot.
 */
import { computed, ref } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { fillFraction, fillOrigin, parseTyped, resetValue } from '~/lib/studio/row'
import { scrubValue } from '~/lib/studio/scrub'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { rowRenderers, NUMERIC_KINDS } from './rows/registry'
import VariableGlyph from './VariableGlyph.vue'
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from 'reka-ui'

const props = defineProps<{
  spec: ControlSpec
  modelValue: string | number | boolean
  bound?: string | null
  bindable?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number | boolean): void
  (e: 'promote'): void
  (e: 'menu', event: MouseEvent): void
  // Clicking a bound row's column name jumps to the wired Collection, replacing the
  // "Edit in table" button the old two-line bound row carried.
  (e: 'goToCollection'): void
}>()

const numeric = computed(() => NUMERIC_KINDS.has(props.spec.kind))
const renderer = computed(() => rowRenderers[props.spec.kind] ?? null)
const min = computed(() => Number((props.spec as { min?: number }).min ?? 0))
const max = computed(() => Number((props.spec as { max?: number }).max ?? 1))
const step = computed(() => Number((props.spec as { step?: number }).step ?? 1))
const num = computed(() => Number(props.modelValue))

// The painted band runs between the origin and the value, so a bipolar slider grows
// out of the middle in whichever direction the value went.
const band = computed(() => {
  if (!numeric.value) return null
  const o = fillOrigin(min.value, max.value)
  const f = fillFraction(num.value, min.value, max.value)
  return { left: `${Math.min(o, f) * 100}%`, width: `${Math.abs(f - o) * 100}%` }
})

const editing = ref(false)
const dragged = ref(false)

function onPointerDown(e: PointerEvent) {
  if (!numeric.value || props.bound || editing.value) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  dragged.value = false
  const startX = e.clientX
  const startValue = num.value
  function move(ev: PointerEvent) {
    if (Math.abs(ev.clientX - startX) > 2) dragged.value = true
    if (!dragged.value) return
    emit('update:modelValue', scrubValue({
      startValue, deltaPx: ev.clientX - startX,
      min: min.value, max: max.value, step: step.value, fine: ev.shiftKey,
    }))
  }
  function up(ev: PointerEvent) {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    // A press with no movement is a click: jump to where they clicked.
    if (!dragged.value) {
      const r = el.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const raw = min.value + f * (max.value - min.value)
      emit('update:modelValue', parseTyped(String(raw), min.value, max.value, step.value) ?? num.value)
    }
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function onReset() {
  if (props.bound) return
  if (!numeric.value) return
  emit('update:modelValue', resetValue({
    default: Number((props.spec as { default?: number }).default),
    min: min.value, max: max.value,
  }))
}

function onCommit(raw: string) {
  editing.value = false
  const v = parseTyped(raw, min.value, max.value, step.value)
  if (v !== null) emit('update:modelValue', v)
}

/** Clicking the value opens typed entry on numeric kinds. The wrapper span stops the
 *  event so the row's own drag never starts from the number — otherwise a click
 *  meant to type would scrub by a pixel or two first. */
function onValuePointerDown() {
  if (numeric.value && !props.bound) editing.value = true
}
</script>

<template>
  <div>
    <div
      class="group relative flex h-7 select-none items-center justify-between overflow-hidden rounded-md bg-white/[0.05] px-2.5"
      :class="numeric && !bound && !editing ? 'cursor-ew-resize' : ''"
      @pointerdown="onPointerDown"
      @dblclick="onReset"
      @contextmenu.prevent="emit('menu', $event)"
    >
      <div
        v-if="band"
        class="pointer-events-none absolute inset-y-0"
        :style="{ left: band.left, width: band.width, background: bound ? 'rgba(244,114,182,0.20)' : 'rgba(255,255,255,0.13)' }"
      ></div>

      <span class="relative flex min-w-0 items-center gap-1.5">
        <TooltipProvider v-if="spec.hint" :delay-duration="200">
          <TooltipRoot>
            <TooltipTrigger as-child>
              <span class="cursor-help truncate text-[11px] text-white/72 underline decoration-dotted decoration-white/20 underline-offset-2">{{ spec.label }}</span>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="top" :side-offset="6" :collision-padding="8"
                class="pointer-events-none z-[200] max-w-[220px] rounded-md border border-white/10 bg-[#1b1b1f] px-2 py-1 text-[11px] leading-snug text-white/85 shadow-lg shadow-black/40"
              >{{ spec.hint }}</TooltipContent>
            </TooltipPortal>
          </TooltipRoot>
        </TooltipProvider>
        <span v-else class="truncate text-[11px] text-white/72">{{ spec.label }}</span>
        <VariableGlyph
          v-if="bindable !== false && controlKindToVariableType(spec.kind)"
          :bound="bound ?? null"
          @promote="emit('promote')"
          @menu="(e: MouseEvent) => emit('menu', e)"
        />
      </span>

      <span class="relative flex shrink-0 items-center gap-2" @dblclick.stop>
        <button
          v-if="bound"
          type="button"
          class="max-w-[100px] truncate font-mono text-[11px] underline decoration-dotted underline-offset-2"
          style="color: var(--var-accent-text)"
          :title="`${bound} — edit in table`"
          @pointerdown.stop
          @click.stop="emit('goToCollection')"
        >{{ bound }}</button>
        <span v-else-if="renderer" @pointerdown.stop="onValuePointerDown">
          <component
            :is="renderer"
            :value="modelValue"
            :spec="spec"
            :step="step"
            :editing="editing"
            @commit="onCommit"
            @cancel="editing = false"
            @update:value="(v: string | number | boolean) => emit('update:modelValue', v)"
          />
        </span>
      </span>
    </div>
    <slot name="body" />
  </div>
</template>
```

- [ ] **Step 4: Verify it renders and drives a real parameter**

Start the dev server and open Shape Studio, which already renders through
`StudioControlPanel`:

```bash
./dev.sh
```

Then in the Browser pane: open a Shape Studio node, and confirm each of these by
observation, not by assumption —

1. Rows are one line each, roughly 28px, with a fill that tracks the value.
2. Dragging a row changes the preview.
3. Clicking the number opens a field; typing a value and pressing Enter changes the
   preview; Escape leaves the value untouched.
4. Double-clicking a row returns it to its declared default.
5. A bipolar slider (any control with a negative minimum) fills from the middle.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioRow.vue frontend/app/components/vue-canvas/studio/rows/
git commit -m "feat(studio): 28px control row that is itself the slider

Row shell owns label, fill, glyph, drag, click-to-position, typed entry and
double-click reset; rows/registry.ts supplies only the value side per kind, so
the shell never grows a per-kind branch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The remaining value renderers

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/rows/RowSelect.vue`
- Create: `frontend/app/components/vue-canvas/studio/rows/RowSwitch.vue`
- Create: `frontend/app/components/vue-canvas/studio/rows/RowColor.vue`
- Create: `frontend/app/components/vue-canvas/studio/rows/RowText.vue`
- Modify: `frontend/app/components/vue-canvas/studio/rows/registry.ts`

**Interfaces:**
- Consumes: `StudioRow` from Task 3; the existing `StudioColor.vue` unchanged.
- Produces: registry entries for `select`, `switch`, `color`, `text`.

**Every renderer declares the same four props** — `{ value, spec, step, editing }` —
and uses only what it needs. This is uniform on purpose: `StudioRow` binds all four
to whichever component the registry returns, and an undeclared prop in Vue falls
through onto the root element, so a `<span>` would silently render
`step="1" editing="false"` as DOM attributes. Renderers emit `update:value`, and the
numeric ones additionally emit `commit` / `cancel`.

- [ ] **Step 1: Write the select renderer**

Create `frontend/app/components/vue-canvas/studio/rows/RowSelect.vue`:

```vue
<script setup lang="ts">
// Value side of a select row: the current option, right-aligned, with the native
// select laid transparently over it so the OS menu still opens where expected.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
const options = (props.spec as { options?: string[] }).options ?? []
</script>

<template>
  <span class="relative flex items-center gap-1 text-[11px] text-white/90">
    <span class="capitalize">{{ value }}</span>
    <span class="text-white/35">⌄</span>
    <select
      :value="value"
      class="absolute inset-0 cursor-pointer opacity-0"
      @pointerdown.stop
      @change="emit('update:value', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="o in options" :key="o" :value="o" class="bg-neutral-900 capitalize">{{ o }}</option>
    </select>
  </span>
</template>
```

- [ ] **Step 2: Write the switch renderer**

Create `frontend/app/components/vue-canvas/studio/rows/RowSwitch.vue`:

```vue
<script setup lang="ts">
// Value side of a boolean row. Reuses the app's existing switch look rather than
// inventing a second one.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: boolean; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: boolean): void }>()
</script>

<template>
  <button
    type="button" role="switch" :aria-checked="value"
    class="relative h-[16px] w-[28px] rounded-full transition-colors"
    :class="value ? 'bg-white' : 'bg-white/15'"
    @pointerdown.stop
    @click.stop="emit('update:value', !props.value)"
  >
    <span
      class="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all"
      :class="value ? 'left-[14px] bg-neutral-900' : 'left-[2px] bg-white/70'"
    ></span>
  </button>
</template>
```

- [ ] **Step 3: Write the colour renderer**

Create `frontend/app/components/vue-canvas/studio/rows/RowColor.vue`:

```vue
<script setup lang="ts">
// Value side of a colour row: hex text then the existing StudioColor swatch, which
// keeps its own popover (saturation pad, hue, alpha, eyedropper, hex/RGB/OKLCH).
// The swatch is already 28px, so it fills the row height exactly.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioColor from '../StudioColor.vue'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()

const proxy = computed({
  get: () => props.value,
  set: (v: string) => emit('update:value', v),
})
</script>

<template>
  <span class="flex items-center gap-2" @pointerdown.stop>
    <span class="font-mono text-[11px] uppercase text-white/90">{{ value }}</span>
    <StudioColor v-model="proxy" />
  </span>
</template>
```

- [ ] **Step 4: Write the text renderer**

Create `frontend/app/components/vue-canvas/studio/rows/RowText.vue`:

```vue
<script setup lang="ts">
// Value side of a text row: an always-editable right-aligned field. Unlike numbers,
// there is no drag gesture to protect, so it needs no editing mode.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
</script>

<template>
  <input
    :value="value"
    spellcheck="false"
    class="w-32 rounded-[4px] bg-transparent px-1 text-right text-[11px] text-white/90 outline-none focus:bg-white/10"
    @pointerdown.stop
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
  />
</template>
```

- [ ] **Step 5: Register them**

Replace `frontend/app/components/vue-canvas/studio/rows/registry.ts` with:

```ts
import type { Component } from 'vue'
import RowSlider from './RowSlider.vue'
import RowSelect from './RowSelect.vue'
import RowSwitch from './RowSwitch.vue'
import RowColor from './RowColor.vue'
import RowText from './RowText.vue'

/**
 * kind → the component that draws the VALUE side of a row. The row shell
 * (StudioRow.vue) draws everything else, so a renderer never repeats the label,
 * the glyph or the fill. Adding a kind is one component plus one line here.
 */
export const rowRenderers: Record<string, Component> = {
  slider: RowSlider,
  select: RowSelect,
  switch: RowSwitch,
  color: RowColor,
  text: RowText,
}

/** Kinds whose value is a number the row itself can drag and type into. */
export const NUMERIC_KINDS = new Set(['slider'])
```

- [ ] **Step 6: Verify in the app**

With the dev server running, open Texture Studio (it renders selects, colours and
switches through `StudioControlPanel`) and confirm:

1. A select row shows its current option and opens a menu on click.
2. A colour row shows the hex and opens the full picker on the swatch.
3. A switch row toggles and the preview responds.
4. Dragging *across* a select or colour row does not change a value — those kinds
   have no drag gesture and must not inherit one.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/rows/
git commit -m "feat(studio): select, switch, colour and text row renderers

Each draws only the value side. RowColor reuses StudioColor unchanged, so the
saturation pad, alpha, eyedropper and OKLCH entry all survive the move into the
row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Adapters and the panel

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/StudioSlider.vue`
- Modify: `frontend/app/components/vue-canvas/studio/StudioSelect.vue`
- Modify: `frontend/app/components/vue-canvas/studio/StudioSwitch.vue`
- Create: `frontend/app/components/vue-canvas/studio/StudioSectionTree.vue`
- Modify: `frontend/app/components/vue-canvas/studio/StudioControlPanel.vue`

**Interfaces:**
- Consumes: `StudioRow` (Task 3), `rowRenderers` (Task 4), `Section<T>` (Task 2).
- Produces: no new exports. `StudioSlider`'s public props stay exactly
  `{ label?, min, max, step?, default?, bound?, bindable?, scrubPx?, hint? }` with
  `defineModel<number>`, so its 88 existing call sites are untouched.

- [ ] **Step 1: Turn StudioSlider into an adapter**

Replace `frontend/app/components/vue-canvas/studio/StudioSlider.vue` with:

```vue
<script setup lang="ts">
// Prop-driven entry point for a numeric row. Builds a one-element ControlSpec and
// renders StudioRow — so surfaces that have no ControlSpec still get exactly the
// row the schema-driven studios get, and there is one render path, not two.
//
// The public props are unchanged from the two-line version this replaces; every
// existing call site keeps working untouched.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioRow from './StudioRow.vue'

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
  hint?: string
}>()
const emit = defineEmits<{ (e: 'promote'): void; (e: 'menu', event: MouseEvent): void }>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'slider',
  min: props.min, max: props.max, step: props.step ?? 1,
  default: props.default ?? props.min, group: '',
  ...(props.hint ? { hint: props.hint } : {}),
} as ControlSpec))
</script>

<template>
  <StudioRow
    :spec="spec"
    :model-value="model"
    :bound="bound ?? null"
    :bindable="bindable"
    @update:model-value="(v) => (model = Number(v))"
    @promote="emit('promote')"
    @menu="(e) => emit('menu', e)"
  />
</template>
```

- [ ] **Step 2: Turn StudioSelect into an adapter**

Replace `frontend/app/components/vue-canvas/studio/StudioSelect.vue` with:

```vue
<script setup lang="ts">
// Prop-driven entry point for a select row. Same one-render-path reasoning as
// StudioSlider. Public props unchanged: v-model plus `options`.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioRow from './StudioRow.vue'

const model = defineModel<string>({ required: true })
const props = defineProps<{ options: string[]; label?: string; bound?: string | null }>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'select',
  options: props.options, default: props.options[0] ?? '', group: '',
} as ControlSpec))
</script>

<template>
  <StudioRow
    :spec="spec" :model-value="model" :bound="bound ?? null"
    @update:model-value="(v) => (model = String(v))"
  />
</template>
```

- [ ] **Step 3: Turn StudioSwitch into an adapter**

Replace `frontend/app/components/vue-canvas/studio/StudioSwitch.vue` with:

```vue
<script setup lang="ts">
// Prop-driven entry point for a boolean row. `label` is optional: the switch is
// still used bare as a StudioSection #badge, where there is no row to draw.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioRow from './StudioRow.vue'
import RowSwitch from './rows/RowSwitch.vue'

const model = defineModel<boolean>({ required: true })
const props = defineProps<{ label?: string; bound?: string | null }>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'switch', default: false, group: '',
} as ControlSpec))
</script>

<template>
  <RowSwitch v-if="!label" :value="model" @update:value="(v) => (model = v)" />
  <StudioRow
    v-else
    :spec="spec" :model-value="model" :bound="bound ?? null"
    @update:model-value="(v) => (model = Boolean(v))"
  />
</template>
```

- [ ] **Step 4: Render rows and nested sections in the panel**

One behaviour change to expect here: `segmentedMax` and the segmented-pill treatment
for selects with ≤3 options go away. Every kind is a row now, so a three-option select
renders as an inline dropdown like every other select. That is the point of the
uniform row, not an oversight — but Space Type and Texture will look different because
of it.

The recursion lives in its own component so nothing has to be re-grouped on the way
down: `groupIntoSections` runs **once**, in the panel, and the tree component walks the
`Section` objects it produced.

Create `frontend/app/components/vue-canvas/studio/StudioSectionTree.vue`:

```vue
<script setup lang="ts">
/**
 * Renders one already-grouped Section and its children. Recursive, and takes a
 * Section rather than a control list + order so grouping happens exactly once, in
 * StudioControlPanel — a second pass would have to re-derive each child's group from
 * its path, which is how a nested control quietly vanishes.
 */
import type { ControlSpec } from '~/lib/spacetype/effect'
import type { Section } from '~/lib/studio/sections'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioRow from '~/components/vue-canvas/studio/StudioRow.vue'

defineOptions({ name: 'StudioSectionTree' })

defineProps<{
  section: Section<ControlSpec>
  value: (key: string) => string | number | boolean
  boundFor?: (key: string) => string | null
  goToCollection?: () => void
}>()

const emit = defineEmits<{
  (e: 'set', key: string, value: string | number | boolean): void
  (e: 'promote', control: ControlSpec): void
  (e: 'menu', event: MouseEvent, control: ControlSpec): void
}>()
</script>

<template>
  <StudioSection :title="section.title">
    <template v-for="c in section.controls" :key="c.key">
      <slot :name="'control-' + c.key" :control="c">
        <StudioRow
          :spec="c"
          :model-value="value(c.key)"
          :bound="boundFor?.(c.key) ?? null"
          :bindable="controlKindToVariableType(c.kind) !== null"
          @update:model-value="(v) => emit('set', c.key, v)"
          @promote="emit('promote', c)"
          @menu="(e) => emit('menu', e, c)"
          @go-to-collection="goToCollection?.()"
        />
      </slot>
    </template>
    <StudioSectionTree
      v-for="child in section.sections"
      :key="child.title"
      :section="child"
      :value="value"
      :bound-for="boundFor"
      :go-to-collection="goToCollection"
      @set="(k, v) => emit('set', k, v)"
      @promote="(c) => emit('promote', c)"
      @menu="(e, c) => emit('menu', e, c)"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps ?? {}" />
      </template>
    </StudioSectionTree>
    <slot :name="'section-' + section.title" />
  </StudioSection>
</template>
```

The two slot passes are both load-bearing and neither is optional: `#control-<key>`
has five call sites (`VectorTypeSurface.vue:1548`, and `ShapeStudioSurface.vue` at
543, 591, 601, 632) and `#section-<Title>` has seven. The `v-for="(_, name) in $slots"`
block is what carries them through each level of recursion — without it a bespoke
control inside a nested section renders as a plain row and the surface's custom
markup silently disappears.

Then replace `frontend/app/components/vue-canvas/studio/StudioControlPanel.vue`
entirely with:

```vue
<script setup lang="ts">
/**
 * Renders a studio's inspector from its ControlSpec[].
 *
 * Every kind goes through StudioRow — this file has no per-kind branch. Bespoke
 * blocks (repeaters, palette pickers, motion editors, export panels) belong in
 * `#section-<Title>` or `#control-<key>`, not in the schema.
 *
 * Grouping happens here and only here; StudioSectionTree walks the result.
 */
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { groupIntoSections } from '~/lib/studio/sections'
import StudioSectionTree from '~/components/vue-canvas/studio/StudioSectionTree.vue'

const props = defineProps<{
  controls: ControlSpec[]
  order: readonly string[]
  /** Current value for a control key. A reader function, not a params object —
   *  Texture's params is a flat record while Gradient/Shape use a dotted proxy. */
  value: (key: string) => string | number | boolean
  visible?: (c: ControlSpec) => boolean
  /** Bound collection column label for a key, or null if unbound. */
  boundFor?: (key: string) => string | null
  /** Parameterless — dispatches the "open the wired collection" event. */
  goToCollection?: () => void
}>()

const emit = defineEmits<{
  (e: 'set', key: string, value: string | number | boolean): void
  (e: 'promote', control: ControlSpec): void
  (e: 'menu', event: MouseEvent, control: ControlSpec): void
}>()

const sections = computed(() => groupIntoSections(props.controls, props.order, props.visible))
</script>

<template>
  <StudioSectionTree
    v-for="s in sections"
    :key="s.title"
    :section="s"
    :value="value"
    :bound-for="boundFor"
    :go-to-collection="goToCollection"
    @set="(k, v) => emit('set', k, v)"
    @promote="(c) => emit('promote', c)"
    @menu="(e, c) => emit('menu', e, c)"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </StudioSectionTree>
</template>
```

- [ ] **Step 5: Verify all four schema-driven surfaces**

With the dev server running, open each of Texture Studio, Shape Studio, Vector Type
Studio, and a shader fill editor. For each, confirm the controls still drive the
render — change one value per surface and watch the preview change. A surface that
renders correctly but no longer writes through is the exact failure this task risks.

Then check the bespoke slots specifically, since they are the parts most likely to
vanish quietly:

1. Shape Studio's Palette section — the `#control-palette.harmony` block
   (`ShapeStudioSurface.vue:543`) must still render its custom picker, not a plain row.
2. Shape Studio's Fill section — `#control-fill.a` and `#control-fill.b` (591, 601).
3. Shape Studio's Style section — `#control-style.background` (632).
4. Vector Type's `#control-text` (`VectorTypeSurface.vue:1548`).
5. Every `#section-<Title>` block still appears at the bottom of its card: Shape's
   Shape / Palette / Fill / Style, Vector Type's Axes / Paint / Motion.

- [ ] **Step 6: Verify a bound row still reaches the collection**

Bind a control to a Collection column (right-click → promote), then confirm the row
turns pink, shows the column name, and clicking that name opens the collection table.
That click replaces the old "Edit in table" button, which is deleted by this task —
if it does nothing, the `goToCollection` chain is broken.

- [ ] **Step 7: Check the type baseline did not move**

```bash
cd frontend && npx nuxt typecheck 2>&1 | tail -5
```

Expected: the count is at or below the recorded baseline (~328). If a new error names
`StudioRow`, `Section`, or a row renderer, it is yours — it is not pre-existing.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioSlider.vue frontend/app/components/vue-canvas/studio/StudioSelect.vue frontend/app/components/vue-canvas/studio/StudioSwitch.vue frontend/app/components/vue-canvas/studio/StudioSectionTree.vue frontend/app/components/vue-canvas/studio/StudioControlPanel.vue
git commit -m "refactor(studio): route every control through StudioRow

StudioSlider/Select/Switch keep their props but become adapters that build a
one-element ControlSpec, so the 88 existing call sites are untouched and the
prop-driven and schema-driven paths render through the same component.
StudioControlPanel loses its per-kind branches and gains nested sections.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Retire the two-line remnants

**Files:**
- Modify: `frontend/app/assets/css/main.css`
- Modify: `frontend/app/components/vue-canvas/studio/StudioControlPanel.vue`
- Delete: `frontend/app/components/vue-canvas/studio/StudioSegmented.vue` (if unused
  after Task 5 — check first)

**Interfaces:**
- Consumes: Task 5's panel.
- Produces: nothing new.

- [ ] **Step 1: Check whether StudioSegmented still has callers**

```bash
cd frontend && grep -rn "StudioSegmented" --include="*.vue" app | grep -v "StudioSegmented.vue:"
```

If the only hit is its own definition, delete the file. If other surfaces still use
it, leave it — it comes out during the sweep instead.

- [ ] **Step 2: Mark the legacy rail styles as sweep-scoped**

The global `input[type="range"]` block in `frontend/app/assets/css/main.css` still
serves the 167 hand-written inputs across the surfaces, so it stays. Update its
comment so the next reader knows it is now legacy rather than the house style:

```css
/* ── Legacy app slider (being swept out) ────────────────────────────────────
   Every remaining hand-written <input type="range"> gets the slim white look.
   The studios' own controls no longer use this — they render through
   StudioRow.vue, where the row itself is the track. This block exists only for
   the surfaces not yet swept; delete it once the last one is converted.
   See docs/superpowers/specs/2026-08-04-studio-control-rebuild-design.md */
```

- [ ] **Step 3: Verify nothing visually regressed in an unswept surface**

Open Gradient Studio, which is entirely hand-written and therefore untouched by this
plan. Confirm it looks and behaves exactly as before — same two-line rows, same
`BindableRow` glyph placement. This plan must not have changed it.

- [ ] **Step 4: Run the whole unit suite**

```bash
cd frontend && uptime && npm run test:unit 2>&1 | tail -20
```

Expected: the collected-file total and pass count are at or above the pre-task run.
Re-run once before believing any new failure — counts on this repo drift under load.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/assets/css/main.css frontend/app/components/vue-canvas/studio/
git commit -m "chore(studio): mark the legacy rail styles as sweep-scoped

The global input[type=range] block now serves only the surfaces not yet
converted to StudioRow; comment says so, and names the spec that retires it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## What this plan deliberately leaves

Three follow-on plans, in order:

1. **New control kinds** — `action`, `angle`, `spring`, and `xy` (built, unapplied).
   Each is one renderer plus one registry line plus a `ControlSpec` variant, which is
   exactly why they wait until the registry exists.
2. **The sweep** — 167 range inputs and 30 native colour inputs across 35 files,
   surface by surface, largest first, retiring `BindableRow` as Gradient converts.
   The colour `alpha`-off-by-default flag belongs here, with its per-site checks.
3. **Panel header extras** — copy-values-as-JSON.
