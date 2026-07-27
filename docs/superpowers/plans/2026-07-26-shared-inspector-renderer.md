# Shared Inspector Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared component that renders a studio's inspector from its `ControlSpec[]`, so declaring a control makes it **appear** — closing the fourth and last capability the factory promises.

**Architecture:** A new `StudioControlPanel.vue` groups controls into sections, filters by predicate, and renders each kind by composing the existing primitives. It is modelled on Space Type's loop (the most complete data-driven inspector in the repo, 9 kinds) but written as a new component — **Space Type itself is not modified**, because another session has an in-flight refactor there. Texture adopts it first as a pure no-regression proof (it is already data-driven), then Shape, which gains binding affordances on 9 controls that have none today. Gradient and Space Type are deliberately deferred.

**Why this and why now:** today one declaration buys agent vocabulary, motion targets and sweep bindings — but the inspector is still hand-written, so adding a control to a schema does *not* make it appear in the UI. Hand-written markup scales with control **count** (Gradient: 95 markup instances for 58 controls); a data-driven loop scales with **kind** count, which is bounded (Space Type: 13 blocks for hundreds of controls). Every technology absorbed in Act 2 pays the hand-written cost once per studio unless this exists.

**Tech Stack:** Vue 3 (Nuxt 4), TypeScript, Vitest.

## Global Constraints

- **Do NOT modify `SpaceTypeSurface.vue`.** Another session has uncommitted work there. Read it freely as the design reference; do not edit it. It migrates later.
- **Do NOT modify `GradientStudioSurface.vue`.** Gradient is deferred: it needs value formatters first (8 distinct formatters and 10 sentinel readouts like `'matte'`/`'thin'`/`'still'` that `StudioSlider` would flatten to a bare number), and its schema groups do not match its rendered sections — reconciling them reorders `visibleGradientControls()`, which **both** frozen snapshots pin.
- **Bespoke blocks stay hand-written, via named slots.** Space Type's `<template v-if="section.name === 'Camera'">` inside its own loop is the precedent. Do not contort the schema to express repeaters, palette pickers, motion editors or export panels.
- **Kinds in scope: `slider`, `select`, `color`.** Plus the select→segmented split by option count. Do NOT implement `text`/`textList`/`fillList`/`font`/`path`/`curve` — no adopter in this plan needs them, and speculative kinds are how this becomes a template language.
- `ControlSpec` lives at `app/lib/spacetype/effect.ts`. Do not add required fields (~30 effect files declare `ControlSpec[]`).
- ~100 files are modified by OTHER concurrent sessions. Stage only the paths each task names; run `git diff --cached` and read it before every commit. Never `git add -A` / `git add .` / `git stash`.
- Test: `pnpm test:unit` from `frontend/`. Known pre-existing failures: 16 tests across 8 files (gradientfx-frame-source, gradientfx-mesh, ticker-effect, spacetype-palette, agent-capability-routing, artifact-next-steps, critique-fix-chips, video-model-adapt). Anything beyond those is yours.

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `app/components/vue-canvas/studio/StudioControlPanel.vue` | Section grouping + per-kind rendering + binding affordances | Create |
| `app/lib/studio/sections.ts` | `groupIntoSections(controls, order, cfg)` — pure, testable | Create |
| `app/components/vue-canvas/TextureStudioSurface.vue` | Adopt the panel | Modify |
| `app/components/vue-canvas/ShapeStudioSurface.vue` | Adopt the panel | Modify |
| `tests/unit/studio-sections.unit.spec.ts` | Grouping/ordering/filtering | Create |

---

### Task 1: The pure grouping function

Extract the logic every data-driven surface reimplements, so it is testable without mounting a component.

**Files:**
- Create: `app/lib/studio/sections.ts`, `tests/unit/studio-sections.unit.spec.ts`

**Interfaces:**
- Produces: `groupIntoSections<T extends ControlSpec>(controls: T[], order: readonly string[], visible?: (c: T) => boolean): { title: string; controls: T[] }[]`

- [ ] **Step 1: Read the two existing implementations**

```bash
sed -n '298,315p' app/components/vue-canvas/TextureStudioSurface.vue     # sections computed
grep -n "const sections = computed" -A8 app/components/vue-canvas/SpaceTypeSurface.vue
```

They differ in one meaningful way: Texture **drops** sections with no visible controls; Space Type keeps them and filters at render. Match Texture's behaviour (drop empties) — it is the one that avoids rendering an empty card, which Gradient's "Layer" section does today as a visible bug.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/studio-sections.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupIntoSections } from '../../app/lib/studio/sections'

type C = { key: string; group: string; kind: string }
const c = (key: string, group: string): C => ({ key, group, kind: 'slider' })

describe('groupIntoSections', () => {
  const ORDER = ['Alpha', 'Beta', 'Gamma'] as const

  it('emits sections in the declared order, not the controls order', () => {
    const out = groupIntoSections([c('c', 'Gamma'), c('a', 'Alpha')], ORDER)
    expect(out.map(s => s.title)).toEqual(['Alpha', 'Gamma'])
  })

  it('keeps control order within a section', () => {
    const out = groupIntoSections([c('a1', 'Alpha'), c('a2', 'Alpha')], ORDER)
    expect(out[0]!.controls.map(x => x.key)).toEqual(['a1', 'a2'])
  })

  it('drops sections with no visible controls, so no empty card renders', () => {
    const out = groupIntoSections([c('a', 'Alpha')], ORDER)
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('silently drops a control whose group is not in the order list', () => {
    // Matches texturefx/sections.ts's documented contract: the order constant is the
    // allow-list, so a typo'd group is dropped rather than rendered in a stray section.
    const out = groupIntoSections([c('x', 'Nope'), c('a', 'Alpha')], ORDER)
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('applies the visibility predicate before grouping', () => {
    const out = groupIntoSections(
      [c('a', 'Alpha'), c('b', 'Beta')], ORDER, (x) => x.key !== 'b')
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('returns an empty array when nothing is visible', () => {
    expect(groupIntoSections([c('a', 'Alpha')], ORDER, () => false)).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test:unit tests/unit/studio-sections.unit.spec.ts`
Expected: FAIL — cannot resolve `.../studio/sections`.

- [ ] **Step 4: Implement**

Create `app/lib/studio/sections.ts`:

```ts
/**
 * Group a studio's controls into ordered inspector sections.
 *
 * The `order` array is BOTH the ordering and the allow-list: a control whose group
 * is not listed is dropped, matching texturefx/sections.ts's documented contract
 * ("any control whose group is not listed here is silently dropped"). Sections that
 * end up empty are omitted, so a studio never renders a blank card.
 */
export function groupIntoSections<T extends { group?: string }>(
  controls: T[],
  order: readonly string[],
  visible?: (c: T) => boolean,
): { title: string; controls: T[] }[] {
  const byGroup = new Map<string, T[]>()
  for (const c of controls) {
    if (visible && !visible(c)) continue
    const g = String(c.group ?? '')
    if (!order.includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }
  return order
    .filter((g) => (byGroup.get(g)?.length ?? 0) > 0)
    .map((g) => ({ title: g, controls: byGroup.get(g)! }))
}
```

- [ ] **Step 5: Run and commit**

Run: `pnpm test:unit tests/unit/studio-sections.unit.spec.ts` → PASS (6 tests).

```bash
git add frontend/app/lib/studio/sections.ts frontend/tests/unit/studio-sections.unit.spec.ts
git commit -m "feat(studio): shared section grouping for data-driven inspectors"
```

---

### Task 2: The panel component, proved on Texture

Texture is already data-driven, so adopting the shared panel there is a **pure no-regression change** — the strongest possible first proof.

**Files:**
- Create: `app/components/vue-canvas/studio/StudioControlPanel.vue`
- Modify: `app/components/vue-canvas/TextureStudioSurface.vue`

**Interfaces:**
- Consumes: `groupIntoSections` (Task 1); the existing primitives `StudioSection`, `StudioSlider`, `StudioSelect`, `StudioSegmented`, `StudioColor`, `VariableGlyph`.
- Produces: a component with props `{ controls, order, value(key), visible?, boundFor(key), segmentedMax? }` and emits/callbacks for `set(key, value)`, `promote(control)`, `menu(event, control)`.

- [ ] **Step 1: Read the reference implementations**

```bash
sed -n '655,730p' app/components/vue-canvas/TextureStudioSurface.vue     # its render loop
grep -n "c.kind === 'select'" -B4 -A16 app/components/vue-canvas/SpaceTypeSurface.vue | head -60
sed -n '1,40p' app/components/vue-canvas/studio/StudioSlider.vue         # what it owns
```

Two things to carry across:
- **Space Type picks `StudioSegmented` over `StudioSelect` when a select has ≤3 options.** Texture does not, and renders 2-option enums as full dropdowns. Adopt Space Type's rule — but make the threshold a prop (`segmentedMax`, default 3) so Texture can pass `0` in this task and keep its exact current appearance. That is what makes this a genuine no-regression proof.
- **`StudioSlider` owns its own label row and glyph**; `select` and `color` need the caller to supply a label row and a `VariableGlyph`. Reproduce Texture's markup for those two exactly, including the "bound" read-only pink row branch.

- [ ] **Step 2: Build the component**

Create `app/components/vue-canvas/studio/StudioControlPanel.vue`. Shape:

```vue
<script setup lang="ts">
/**
 * Renders a studio's inspector from its ControlSpec[].
 *
 * Handles the three kinds every studio shares — slider, select, color — and hands
 * everything else to a named slot. Bespoke blocks (repeaters, palette pickers,
 * motion editors, export panels) belong in `#section-<Name>`, not in the schema;
 * Space Type's `<template v-if="section.name === 'Camera'">` is the precedent.
 */
import type { ControlSpec } from '~/lib/spacetype/effect'
import { groupIntoSections } from '~/lib/studio/sections'

const props = withDefaults(defineProps<{
  controls: ControlSpec[]
  order: readonly string[]
  /** Current value for a control key. A reader function, not a params object —
   *  Texture's params is a flat record while Gradient/Shape use a dotted proxy. */
  value: (key: string) => string | number
  visible?: (c: ControlSpec) => boolean
  boundFor?: (key: string) => string | null
  /** Selects with at most this many options render as segmented pills. 0 disables. */
  segmentedMax?: number
}>(), { segmentedMax: 3 })

const emit = defineEmits<{
  (e: 'set', key: string, value: string | number): void
  (e: 'promote', control: ControlSpec): void
  (e: 'menu', event: MouseEvent, control: ControlSpec): void
}>()

const sections = computed(() => groupIntoSections(props.controls, props.order, props.visible))
</script>
```

Template: `StudioSection` per section, then per control a `<slot :name="'control-' + c.key" :control="c">` fallback wrapping the kind branches, and a `<slot :name="'section-' + s.title">` after each section's controls so a surface can append bespoke markup inside the right card.

- [ ] **Step 3: Adopt it in Texture**

Replace Texture's `sections` computed with the shared one and its render loop with `<StudioControlPanel>`. Pass `segmentedMax="0"` to preserve today's all-dropdown appearance, `value` reading its flat `params` record, and wire `set`/`promote`/`menu` to the existing handlers.

**Texture's Fills panel is NOT part of this** — it is a separate hand-written `StudioSection` after the loop (its three `Fills` controls carry `when: () => false` precisely so the loop skips them). Leave it exactly where it is.

- [ ] **Step 4: Verify no visual regression**

Run: `pnpm test:unit` — no new failures.
Run: `npx vue-tsc --noEmit 2>&1 | grep -E "StudioControlPanel|TextureStudioSurface"` — report exactly what it prints.

Then in the browser (reuse a running server on `127.0.0.1:3000`; do NOT run `./dev.sh`, it would kill another session's server): open a Texture Studio node and compare against the pre-change appearance. Every section, every control, in the same order, with bind chips still working. **This is the whole point of doing Texture first — if it looks different, the component is wrong.** Report what you observed, or say plainly you could not drive the browser.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioControlPanel.vue frontend/app/components/vue-canvas/TextureStudioSurface.vue
git commit -m "feat(studio): shared StudioControlPanel, proved on Texture"
```

---

### Task 3: Adopt in Shape — and gain the controls that had no UI

Shape is the payoff: 9 of its 24 controls (8 selects + `style.background`) are declared, agent-drivable and sweepable, but have **no binding affordance at all** because nobody hand-wrote the wrapper. Adopting the panel gives them one for free.

**Files:**
- Modify: `app/components/vue-canvas/ShapeStudioSurface.vue`

- [ ] **Step 1: Identify what stays hand-written**

Before editing, list the Shape inspector blocks that must NOT go through the panel, and keep them as slots or as-is:
- the **harmony picker** — a bespoke 2-column button grid with `HARMONY_LABELS` display text, not a plain select. `ControlSpec` has no label-map, and rendering it as a dropdown would be a visual regression.
- the **palette preview strip** (read-only ramp + swatches)
- the **base-colour swatch** (a derived 3-way setter over hue/sat/light)
- the **transparent-background switch** (`style.background` is a hex-or-`'transparent'` union)
- the **seed row, re-roll and import buttons**, and the **canvas W/H/aspect** block (all outside `ShapeConfig`)

- [ ] **Step 2: Adopt the panel for the rest**

Pass `SHAPE_CONTROLS` and `SHAPE_SECTIONS`, `value: (k) => paramsProxy[k]`, `visible: (c) => !c.when || c.when(config)`, and `boundFor: boundColumnFor`. Wire `set` to write through `paramsProxy` **and** call `onEdit(key, value)`, matching what the hand-written controls do today.

Use `segmentedMax` at its default of 3 so two-option enums (`fillMode`, `shape.mode`, `shape.projection`) keep rendering as segmented pills as they do now.

Put the bespoke blocks from Step 1 into `#section-<Name>` slots so they land inside the right cards.

- [ ] **Step 3: Delete the now-redundant inline schema**

Shape currently re-types `{ key, label, kind, min, max, step }` inline in ~15 `promote()`/`openVarMenu()` calls — data `SHAPE_CONTROLS` already holds, and which `SweepPopover` reads for its sweep range. The panel passes the real `ControlSpec`, so delete every one of those literals.

- [ ] **Step 4: Verify the payoff**

Run: `pnpm test:unit` — no new failures. `npx vue-tsc --noEmit 2>&1 | grep ShapeStudioSurface` — report exactly.

In the browser, on a Shape Studio node:
1. Every section renders, in `SHAPE_SECTIONS` order.
2. The gem/primitive switch still swaps which controls appear (the `when` predicates still gate).
3. **The 8 selects and the background colour now show a variable glyph on hover** — they had none before. Right-click one, "Turn into variable", and confirm it promotes.
4. The harmony picker still renders as its 2-column labelled grid, not a dropdown.

Report what you observed, or say plainly you could not drive the browser.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ShapeStudioSurface.vue
git commit -m "feat(shapefx): render the inspector from the schema"
```

---

## Deferred, deliberately

**Gradient** needs two things first: a `format` field on `ControlSpec` (it has 8 distinct value formatters and 10 sentinel readouts — `'off'`, `'matte'`, `'smooth'`, `'thin'`, `'still'` — that `StudioSlider`'s bare `{{ Number(model) }}` would destroy), and a reconciliation of `GRADIENT_SECTIONS` against its rendered sections, which reorders `visibleGradientControls()` and therefore touches both frozen snapshots. Its repeaters (colour stops, mesh points) and motion/export panels stay slots regardless.

**Space Type** is the design source but is not migrated here, because another session has uncommitted work in it. It also renders six kinds this panel deliberately omits (`text`, `textList`, `fillList`, `font`, `path`, `curve`) plus variable-font axis sub-sliders and vibe-diff highlighting — extend the panel when it adopts, not before.

**Dynamic labels and ranges** (`count` reading "Ring count" on stack with max 40 instead of 64; `jitter` reading "Randomness" on bands) are a Gradient concern and are not needed by Texture or Shape.
