# Sketchbook Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft/Final render mode (cheap fast sketches), a Light Table compare view over a node's takes, and one-click Promote of a draft take to full quality — closing the loop *sketch → spread → pick → promote*.

**Architecture:** All changes are frontend-only. Draft mode and Promote are both **submit-time widget rewrites on the serialized workflow copy** (`plainWorkflow`) inside `runVueWorkflow` — the same seam as `injectLoraStyleIntoPrompt` — so live node state and save paths are never touched. Result metadata (draft flag, intended-final settings, promote linkage) flows to takes via a small per-node run-meta registry consumed at the existing `appendTake` call sites. The Light Table is a presentational modal over the existing takes array.

**Tech Stack:** Vue 3 + TS (Nuxt 4), vitest unit tests in `frontend/tests/unit/`, lucide-vue-next icons, vue-sonner toasts.

**Spec:** `docs/superpowers/specs/2026-07-07-sketchbook-loop-design.md`

## Global Constraints

- Work directly on `main`; NEVER create a branch. Stage files explicitly (`git add <paths>`); NEVER `git add -A`.
- All test commands run from `frontend/`: `npx vitest run tests/unit/<file> `.
- Draft badge styling: dashed/sketch treatment, neutral tones. NEVER pastel (pastel = AI-affordance token) and NEVER purple/violet.
- Draft overrides must NEVER swap the model on LoRA-bearing nodes (`FluxLoRARemoteNode`) — that silently drops the trained LoRA. LoRA nodes draft via `num_inference_steps`/`megapixels` only.
- The draft rewrite applies ONLY to the run-path copy (`plainWorkflow` in `runVueWorkflow`). Save/serialize paths (`snapshotActiveCanvasIntoDoc`, autosave) must never see rewritten widget values — only the `extra.draftMode` metadata stamp.
- Existing ProjectDocs must load unchanged: every new `Take`/workflow field is optional with "absent = final/unlinked" semantics.

---

### Task 1: Draft override rules + pure workflow rewrite

**Files:**
- Create: `frontend/app/lib/draft/overrides.ts`
- Test: `frontend/tests/unit/draft-overrides.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `DRAFT_RULES: Record<string, DraftRule>` — per-node-type draft behavior.
  - `applyDraftOverrides(plainWorkflow: any, vnodes: any[]): DraftApplication` where `DraftApplication = { overriddenIds: string[]; restoreById: Record<string, Record<string, any>> }` — mutates `plainWorkflow.nodes[*].widgets_values` in place; `restoreById` holds each overridden node's ORIGINAL values for the overridden widget names (what Promote restores).
  - `draftUsdExprFor(nodeType: string): string | null` — a `price_badge`-shaped JSON literal for the draft tier, feeding the cost estimate.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/draft-overrides.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyDraftOverrides, draftUsdExprFor, DRAFT_RULES } from '~/lib/draft/overrides'

function vnode(id: string, nodeType: string, defs: string[], values: any[]) {
  return { id, data: { nodeType, widgetDefs: defs.map(name => ({ name })), widgetsValues: values } }
}
function wfNode(id: number, type: string, widgets_values: any[]) {
  return { id, type, widgets_values }
}

describe('applyDraftOverrides', () => {
  it('swaps GenerateImageNode to flux-schnell and merges megapixels into model_options', () => {
    const wf = { nodes: [wfNode(1, 'GenerateImageNode', ['flux-pro', 'a cat', '1:1', 42, '{"guidance":3}'])] }
    const vnodes = [vnode('1', 'GenerateImageNode', ['model', 'prompt', 'aspect_ratio', 'seed', 'model_options'], ['flux-pro', 'a cat', '1:1', 42, '{"guidance":3}'])]
    const res = applyDraftOverrides(wf, vnodes)
    expect(res.overriddenIds).toEqual(['1'])
    expect(wf.nodes[0].widgets_values[0]).toBe('flux-schnell')
    // JSON widget merged, existing keys preserved
    expect(JSON.parse(wf.nodes[0].widgets_values[4])).toEqual({ guidance: 3, megapixels: '0.5' })
    // prompt / aspect / seed untouched
    expect(wf.nodes[0].widgets_values[1]).toBe('a cat')
    expect(wf.nodes[0].widgets_values[3]).toBe(42)
    // restore snapshot carries the originals
    expect(res.restoreById['1']).toEqual({ model: 'flux-pro', model_options: '{"guidance":3}' })
  })

  it('drafts FluxLoRARemoteNode by steps+megapixels and NEVER touches the model/lora widgets', () => {
    const defs = ['prompt', 'lora_name', 'num_inference_steps', 'megapixels', 'seed']
    const wf = { nodes: [wfNode(2, 'FluxLoRARemoteNode', ['hero shot', 'my-character', 28, '1', 7])] }
    const vnodes = [vnode('2', 'FluxLoRARemoteNode', defs, ['hero shot', 'my-character', 28, '1', 7])]
    const res = applyDraftOverrides(wf, vnodes)
    expect(wf.nodes[0].widgets_values[2]).toBe(8)
    expect(wf.nodes[0].widgets_values[3]).toBe('0.5')
    expect(wf.nodes[0].widgets_values[1]).toBe('my-character') // lora untouched
    expect(res.restoreById['2']).toEqual({ num_inference_steps: 28, megapixels: '1' })
  })

  it('leaves unmapped node types byte-identical', () => {
    const wf = { nodes: [wfNode(3, 'UpscaleImageNode', ['x2'])] }
    const before = JSON.stringify(wf)
    const res = applyDraftOverrides(wf, [vnode('3', 'UpscaleImageNode', ['factor'], ['x2'])])
    expect(res.overriddenIds).toEqual([])
    expect(JSON.stringify(wf)).toBe(before)
  })

  it('skips a mapped node whose widget defs are missing (no crash, no override)', () => {
    const wf = { nodes: [wfNode(4, 'GenerateImageNode', ['flux-pro'])] }
    const res = applyDraftOverrides(wf, [{ id: '4', data: { nodeType: 'GenerateImageNode' } }])
    expect(res.overriddenIds).toEqual([])
  })

  it('draftUsdExprFor returns a parseable price literal for mapped types, null otherwise', () => {
    expect(JSON.parse(draftUsdExprFor('GenerateImageNode')!)).toMatchObject({ type: 'usd', format: { approximate: true } })
    expect(draftUsdExprFor('UpscaleImageNode')).toBeNull()
    expect(Object.keys(DRAFT_RULES)).toEqual(['GenerateImageNode', 'FluxLoRARemoteNode'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/draft-overrides.unit.spec.ts`
Expected: FAIL — `Cannot find module '~/lib/draft/overrides'`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/draft/overrides.ts
/**
 * Draft-mode override rules — the submit-time rewrite that turns a full-quality
 * run into a cheap/fast sketch (spec: docs/superpowers/specs/2026-07-07-
 * sketchbook-loop-design.md). Applied ONLY to the run-path copy of the workflow
 * (plainWorkflow in runVueWorkflow), never to live node state or save paths.
 *
 * HARD RULE: LoRA-bearing nodes must never have their model swapped — that
 * silently drops the trained LoRA. They draft via steps/megapixels instead.
 */

export interface DraftRule {
  /** widget-name → substitute value */
  set?: Record<string, string | number>
  /** JSON-string widget name → keys to merge into its parsed object */
  mergeJson?: Record<string, Record<string, string | number>>
  /** pre-run USD estimate for the whole node in draft */
  usd: number
}

export const DRAFT_RULES: Record<string, DraftRule> = {
  GenerateImageNode: {
    set: { model: 'flux-schnell' },
    mergeJson: { model_options: { megapixels: '0.5' } },
    usd: 0.003,
  },
  FluxLoRARemoteNode: {
    set: { num_inference_steps: 8, megapixels: '0.5' },
    usd: 0.01,
  },
}

export interface DraftApplication {
  overriddenIds: string[]
  /** nodeId → original values of every widget the draft rule changed */
  restoreById: Record<string, Record<string, any>>
}

/** Rewrite widgets_values on the serialized workflow in place. `vnodes` supplies
 *  each node's widgetDefs (name → positional index). Returns what was changed. */
export function applyDraftOverrides(plainWorkflow: any, vnodes: any[]): DraftApplication {
  const res: DraftApplication = { overriddenIds: [], restoreById: {} }
  const vById = new Map((vnodes || []).map((n: any) => [String(n.id), n]))
  for (const wn of plainWorkflow?.nodes ?? []) {
    const rule = DRAFT_RULES[wn?.type as string]
    if (!rule) continue
    const vn = vById.get(String(wn.id))
    const defs = vn?.data?.widgetDefs as Array<{ name?: string }> | undefined
    if (!defs || !Array.isArray(wn.widgets_values)) continue
    const idx = (name: string) => defs.findIndex(d => d?.name === name)
    const restore: Record<string, any> = {}
    for (const [name, value] of Object.entries(rule.set ?? {})) {
      const i = idx(name)
      if (i < 0 || i >= wn.widgets_values.length) continue
      restore[name] = wn.widgets_values[i]
      wn.widgets_values[i] = value
    }
    for (const [name, patch] of Object.entries(rule.mergeJson ?? {})) {
      const i = idx(name)
      if (i < 0 || i >= wn.widgets_values.length) continue
      restore[name] = wn.widgets_values[i]
      let obj: Record<string, any> = {}
      try { obj = JSON.parse(String(wn.widgets_values[i] || '{}')) || {} } catch { obj = {} }
      wn.widgets_values[i] = JSON.stringify({ ...obj, ...patch })
    }
    if (Object.keys(restore).length) {
      res.overriddenIds.push(String(wn.id))
      res.restoreById[String(wn.id)] = restore
    }
  }
  return res
}

/** price_badge-shaped literal for the draft tier — feeds parseBadgeUsd. */
export function draftUsdExprFor(nodeType: string): string | null {
  const rule = DRAFT_RULES[nodeType]
  if (!rule) return null
  return JSON.stringify({ type: 'usd', usd: rule.usd, format: { approximate: true } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/draft-overrides.unit.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/draft/overrides.ts frontend/tests/unit/draft-overrides.unit.spec.ts
git commit -m "feat(draft): pure draft-override rules + workflow rewrite"
```

---

### Task 2: Run-meta registry (draft tags + one-shot promote, keyed by node)

**Files:**
- Create: `frontend/app/lib/draft/runMeta.ts`
- Test: `frontend/tests/unit/draft-run-meta.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module state).
- Produces:
  - `markDraftRun(nodeIds: string[], restoreById: Record<string, Record<string, any>>): void` — standing "last submit for these nodes was a draft" marks.
  - `clearDraftRun(nodeIds: string[]): void` — called when a final (non-draft) submit includes these nodes.
  - `draftMetaFor(nodeId: string): { restore: Record<string, any> } | null`
  - `setPendingPromote(nodeId: string, meta: { fromTakeId: string; overrides: Record<string, any> }): void`
  - `consumePendingPromote(nodeId: string): { fromTakeId: string; overrides: Record<string, any> } | null` — one-shot (returns then clears).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/draft-run-meta.unit.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { markDraftRun, clearDraftRun, draftMetaFor, setPendingPromote, consumePendingPromote } from '~/lib/draft/runMeta'

describe('draft run meta', () => {
  beforeEach(() => { clearDraftRun(['1', '2', '9']); consumePendingPromote('1') })

  it('marks and reads draft meta per node; final submit clears it', () => {
    markDraftRun(['1', '2'], { '1': { model: 'flux-pro' }, '2': { num_inference_steps: 28 } })
    expect(draftMetaFor('1')).toEqual({ restore: { model: 'flux-pro' } })
    expect(draftMetaFor('2')).toEqual({ restore: { num_inference_steps: 28 } })
    expect(draftMetaFor('9')).toBeNull()
    clearDraftRun(['1'])
    expect(draftMetaFor('1')).toBeNull()
    expect(draftMetaFor('2')).not.toBeNull()
  })

  it('pending promote is one-shot', () => {
    setPendingPromote('1', { fromTakeId: 'take_a', overrides: { seed: 7, model: 'flux-pro' } })
    expect(consumePendingPromote('1')).toEqual({ fromTakeId: 'take_a', overrides: { seed: 7, model: 'flux-pro' } })
    expect(consumePendingPromote('1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/draft-run-meta.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/draft/runMeta.ts
/**
 * Per-node run metadata bridging submit time (runVueWorkflow, layouts/default.vue)
 * and result time (appendTake sites, VueNodeCanvas.vue). Keyed by node id, not
 * promptId — the submit path doesn't learn the promptId synchronously.
 *
 * Known accepted race (spec §edge cases): toggling Draft→Final and resubmitting
 * while a draft result is still streaming can mislabel that late result. Cosmetic.
 */
const draftByNode = new Map<string, { restore: Record<string, any> }>()
const promoteByNode = new Map<string, { fromTakeId: string; overrides: Record<string, any> }>()

export function markDraftRun(nodeIds: string[], restoreById: Record<string, Record<string, any>>): void {
  for (const id of nodeIds) draftByNode.set(String(id), { restore: restoreById[String(id)] ?? {} })
}

export function clearDraftRun(nodeIds: string[]): void {
  for (const id of nodeIds) draftByNode.delete(String(id))
}

export function draftMetaFor(nodeId: string): { restore: Record<string, any> } | null {
  return draftByNode.get(String(nodeId)) ?? null
}

export function setPendingPromote(nodeId: string, meta: { fromTakeId: string; overrides: Record<string, any> }): void {
  promoteByNode.set(String(nodeId), meta)
}

export function consumePendingPromote(nodeId: string): { fromTakeId: string; overrides: Record<string, any> } | null {
  const m = promoteByNode.get(String(nodeId)) ?? null
  promoteByNode.delete(String(nodeId))
  return m
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/draft-run-meta.unit.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/draft/runMeta.ts frontend/tests/unit/draft-run-meta.unit.spec.ts
git commit -m "feat(draft): per-node run-meta registry (draft marks + one-shot promote)"
```

---

### Task 3: Draft mode state, header toggle, and run-path wiring

**Files:**
- Create: `frontend/app/composables/useDraftMode.ts`
- Modify: `frontend/app/layouts/default.vue` — header chip row (`<!-- Right side: credits + run + running count -->`, ~line 2858), `runVueWorkflow` (~line 499–575), `snapshotActiveCanvasIntoDoc` (~line 1099)
- Test: `frontend/tests/unit/use-draft-mode.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 `applyDraftOverrides`, `draftUsdExprFor`; Task 2 `markDraftRun`, `clearDraftRun`.
- Produces: `useDraftMode()` returning `{ isDraft(tabId: string): boolean; setDraft(tabId: string, v: boolean): void; toggle(tabId: string): void }` (module-singleton state).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/use-draft-mode.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { useDraftMode } from '~/composables/useDraftMode'

describe('useDraftMode', () => {
  it('defaults to Final, toggles per tab, isolated between tabs', () => {
    const dm = useDraftMode()
    expect(dm.isDraft('tab-a')).toBe(false)
    dm.toggle('tab-a')
    expect(dm.isDraft('tab-a')).toBe(true)
    expect(dm.isDraft('tab-b')).toBe(false)
    dm.setDraft('tab-a', false)
    expect(dm.isDraft('tab-a')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/use-draft-mode.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the composable**

```ts
// frontend/app/composables/useDraftMode.ts
/** Draft/Final render mode, per project tab. Module singleton so the header
 *  chip, run path and restore path all see the same state. Default: Final. */
import { ref } from 'vue'

const draftByTab = ref<Record<string, boolean>>({})

export function useDraftMode() {
  function isDraft(tabId: string): boolean {
    return !!draftByTab.value[tabId]
  }
  function setDraft(tabId: string, v: boolean): void {
    draftByTab.value = { ...draftByTab.value, [tabId]: v }
  }
  function toggle(tabId: string): void {
    setDraft(tabId, !isDraft(tabId))
  }
  return { isDraft, setDraft, toggle }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/use-draft-mode.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the header chip (default.vue)**

In `frontend/app/layouts/default.vue` script setup, near the other composable setups: add

```ts
import { useDraftMode } from '~/composables/useDraftMode'
import { applyDraftOverrides, draftUsdExprFor } from '~/lib/draft/overrides'
import { markDraftRun, clearDraftRun, consumePendingPromote } from '~/lib/draft/runMeta'
import { PencilLine } from 'lucide-vue-next' // add to the existing lucide import list

const draftMode = useDraftMode()
const activeTabIsProject = computed(() => activeTab.value?.type === 'project')
const activeDraft = computed(() => activeTabIsProject.value && draftMode.isDraft(activeTab.value.id))
```

In the template, inside `<!-- Right side: credits + run + running count -->` (~line 2859), insert **before** the credits button:

```html
<button
  v-if="activeTabIsProject"
  class="flex items-center gap-1.5 rounded-full px-3 py-1.5 border cursor-pointer transition-colors"
  :class="activeDraft
    ? 'bg-[#2a2313] border-amber-500/40 hover:bg-[#332b17]'
    : 'bg-[#1a1a1a] border-[#2a2a2a] hover:bg-[#222]'"
  :title="activeDraft
    ? 'Draft mode: image generators run fast & cheap (~10×). Edit/video nodes run at full quality. Likeness softens in drafts — Promote for the real thing.'
    : 'Final mode: everything renders at full quality.'"
  @click="draftMode.toggle(activeTab.id)"
>
  <PencilLine class="size-3" :class="activeDraft ? 'text-amber-300' : 'text-white/70'" />
  <span class="text-xs font-medium" :class="activeDraft ? 'text-amber-300' : 'text-white/70'">
    {{ activeDraft ? 'Draft' : 'Final' }}
  </span>
</button>
```

- [ ] **Step 6: Wire draft into runVueWorkflow**

In `runVueWorkflow` (default.vue ~line 542), immediately **after** the `plainWorkflow` deep copy and projectUuid stamp, and **before** the cost guard:

```ts
// Draft mode: rewrite mapped generators on this run-only copy to the cheap/fast
// tier. Save paths never see this — they serialize the live canvas elsewhere.
let draftApp: { overriddenIds: string[]; restoreById: Record<string, Record<string, any>> } | null = null
if (draftMode.isDraft(activeTab.value?.id || '')) {
  const vnodesForDraft = vueCanvasRef.value.getNodes?.() || []
  draftApp = applyDraftOverrides(plainWorkflow, vnodesForDraft)
  if (draftApp.overriddenIds.length) {
    markDraftRun(draftApp.overriddenIds, draftApp.restoreById)
    plainWorkflow.extra = { ...(plainWorkflow.extra || {}), draft: true }
  }
} else {
  // A final submit supersedes any earlier draft marks for the nodes it runs.
  clearDraftRun((plainWorkflow.nodes as any[]).map((n: any) => String(n.id)))
}
```

Then, inside the cost-guard block (~line 552), make the estimate draft-aware: in the `estInput` mapping, replace the `badgeExpr` line:

```ts
badgeExpr: draftApp?.overriddenIds.includes(String(wn.id))
  ? draftUsdExprFor(String(wn.type || vn?.data?.nodeType || ''))
  : (vn?.data?.priceBadge?.expr ?? null),
```

- [ ] **Step 7: Persist the toggle in the ProjectDoc**

In `snapshotActiveCanvasIntoDoc` (default.vue ~line 1099), after `const snapshot = …`:

```ts
if (snapshot) snapshot.extra = { ...(snapshot.extra || {}), draftMode: draftMode.isDraft(tabId) }
```

And restore it when a tab's doc is (re)loaded — add near the other tab-activation logic in default.vue:

```ts
// Restore the Draft/Final toggle from the doc when switching tabs.
watch(() => activeTab.value?.id, (tabId) => {
  if (!tabId) return
  const doc = savedWorkflows[tabId]
  const wf = doc && isProjectDoc(doc) ? activeCanvasOf(doc)?.workflow : (doc as any)
  if (wf?.extra?.draftMode !== undefined) draftMode.setDraft(tabId, !!wf.extra.draftMode)
}, { immediate: true })
```

- [ ] **Step 8: Run the full unit suite (no regressions)**

Run: `cd frontend && npx vitest run`
Expected: same pass/fail counts as before this task (8 known pre-existing failures; nothing new).

- [ ] **Step 9: Commit**

```bash
git add frontend/app/composables/useDraftMode.ts frontend/tests/unit/use-draft-mode.unit.spec.ts frontend/app/layouts/default.vue
git commit -m "feat(draft): Draft/Final header toggle + run-path override wiring + doc persistence"
```

---

### Task 4: Draft/promote tagging on takes + strip badge

**Files:**
- Modify: `frontend/app/composables/useTakes.ts` (`Take` interface, ~line 22)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — both `appendTake` call sites (~lines 160–166 and ~2465–2473)
- Modify: `frontend/app/components/vue-canvas/TakesStrip.vue`
- Test: `frontend/tests/unit/take-draft-tagging.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 `draftMetaFor`, `consumePendingPromote`.
- Produces:
  - `Take` gains `draft?: boolean` and `promotedFrom?: string` (optional; absent = final/unlinked).
  - New pure helper in `useTakes.ts`: `tagTakeFromRunMeta(take: Take, nodeId: string, deps: { draftMetaFor: (id: string) => { restore: Record<string, any> } | null; consumePendingPromote: (id: string) => { fromTakeId: string; overrides: Record<string, any> } | null }): Take` — returns the (possibly) tagged take. Injected deps keep it unit-testable.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/take-draft-tagging.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { tagTakeFromRunMeta, type Take } from '~/composables/useTakes'

const baseTake = (): Take => ({ id: 't1', createdAt: 1, promptId: 'p1', params: { seed: 5, model: 'flux-schnell' } })

describe('tagTakeFromRunMeta', () => {
  it('tags a draft take with draft:true and the restore snapshot', () => {
    const t = tagTakeFromRunMeta(baseTake(), '7', {
      draftMetaFor: () => ({ restore: { model: 'flux-pro' } }),
      consumePendingPromote: () => null,
    })
    expect(t.draft).toBe(true)
    expect(t.params?.draftRestore).toEqual({ model: 'flux-pro' })
  })

  it('tags a promoted take with promotedFrom and overrides params with what actually ran', () => {
    const t = tagTakeFromRunMeta(baseTake(), '7', {
      draftMetaFor: () => null,
      consumePendingPromote: () => ({ fromTakeId: 'take_d', overrides: { seed: 42, model: 'flux-pro' } }),
    })
    expect(t.promotedFrom).toBe('take_d')
    expect(t.draft).toBeUndefined()
    expect(t.params?.seed).toBe(42)      // the promoted run's real seed, not the live widget's
    expect(t.params?.model).toBe('flux-pro')
  })

  it('leaves a plain final take untouched', () => {
    const t = tagTakeFromRunMeta(baseTake(), '7', { draftMetaFor: () => null, consumePendingPromote: () => null })
    expect(t.draft).toBeUndefined()
    expect(t.promotedFrom).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/take-draft-tagging.unit.spec.ts`
Expected: FAIL — `tagTakeFromRunMeta` not exported

- [ ] **Step 3: Implement**

In `frontend/app/composables/useTakes.ts`, extend the `Take` interface (after `sig?`):

```ts
  /** True when this result was rendered by draft mode's cheap tier. */
  draft?: boolean
  /** Id of the draft take this final result was promoted from. */
  promotedFrom?: string
```

Add at the end of the file:

```ts
/**
 * Tag a freshly-built take from the per-node run-meta registries: draft marks
 * (standing) and pending promote (one-shot). Deps injected for testability —
 * the canvas passes lib/draft/runMeta's real functions.
 */
export function tagTakeFromRunMeta(
  take: Take,
  nodeId: string,
  deps: {
    draftMetaFor: (id: string) => { restore: Record<string, any> } | null
    consumePendingPromote: (id: string) => { fromTakeId: string; overrides: Record<string, any> } | null
  },
): Take {
  const promote = deps.consumePendingPromote(nodeId)
  if (promote) {
    // Promoted run: provenance must record what actually ran (the take-snapshot
    // overrides), not the live widgets — 'self' reroll randomized the live seed.
    return {
      ...take,
      promotedFrom: promote.fromTakeId,
      params: { ...(take.params ?? {}), ...promote.overrides },
    }
  }
  const draft = deps.draftMetaFor(nodeId)
  if (draft) {
    return { ...take, draft: true, params: { ...(take.params ?? {}), draftRestore: draft.restore } }
  }
  return take
}
```

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`: add to the imports (line ~43 area):

```ts
import { buildTake, appendTake, takeHasContent, tagTakeFromRunMeta } from '~/composables/useTakes'
import { draftMetaFor, consumePendingPromote } from '~/lib/draft/runMeta'
```

At **both** appendTake call sites (~line 165 and ~line 2472), between the provenance spread and `appendTake`, insert the tagging (the variable names below match the existing code at each site — `take` and `target`):

```ts
take.params = { ...(take.params ?? {}), ...nodeGenParams(target) }
const tagged = tagTakeFromRunMeta(take, String(target.id), { draftMetaFor, consumePendingPromote })
target.data = appendTake({ ...target.data }, tagged)
```

(Replace the existing `target.data = appendTake({ ...target.data }, take)` line at each site.)

- [ ] **Step 4: Add the draft badge to TakesStrip.vue**

In `frontend/app/components/vue-canvas/TakesStrip.vue`, add `PencilLine` to the lucide import, then insert after the pinned-marker `<Star …/>` block:

```html
<!-- draft marker: dashed sketch chip (NOT pastel — pastel means AI) -->
<span
  v-if="t.draft"
  class="absolute top-0.5 right-0.5 flex items-center justify-center size-3.5 rounded-[3px] border border-dashed border-white/60 bg-black/50"
  title="Draft render — promote for full quality"
>
  <PencilLine class="size-2 text-white/80" />
</span>
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run tests/unit/take-draft-tagging.unit.spec.ts tests/unit/vars-edge-persistence.unit.spec.ts`
Expected: PASS (the vars spec guards against accidental useTakes regressions in canvas plumbing)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useTakes.ts frontend/tests/unit/take-draft-tagging.unit.spec.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/TakesStrip.vue
git commit -m "feat(draft): tag takes with draft/promotedFrom + strip badge"
```

---

### Task 5: Take diff + Light Table keymap (pure libs)

**Files:**
- Create: `frontend/app/lib/artifact/takeDiff.ts`
- Create: `frontend/app/lib/artifact/lightTableKeymap.ts`
- Test: `frontend/tests/unit/take-diff.unit.spec.ts`
- Test: `frontend/tests/unit/light-table-keymap.unit.spec.ts`

**Interfaces:**
- Consumes: `Take` from `useTakes.ts`.
- Produces:
  - `diffTakeParams(a: Take, b: Take): Array<{ key: string; a: any; b: any }>` — union of param keys where values differ; internal keys (`draftRestore`, `nodeType`) excluded.
  - `keyToLightTableAction(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): LtAction | null` where `LtAction = { type: 'move'; dx: number; dy: number } | { type: 'setActive' } | { type: 'pin' } | { type: 'discard' } | { type: 'promote' } | { type: 'lightbox' } | { type: 'close' }`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/unit/take-diff.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { diffTakeParams } from '~/lib/artifact/takeDiff'
import type { Take } from '~/composables/useTakes'

const take = (params: Record<string, any>): Take => ({ id: 'x', createdAt: 0, promptId: null, params })

describe('diffTakeParams', () => {
  it('lists only differing keys, covering keys present on either side', () => {
    const rows = diffTakeParams(
      take({ seed: 1, prompt: 'a cat', model: 'flux-pro' }),
      take({ seed: 2, prompt: 'a cat', aspect_ratio: '1:1' }),
    )
    expect(rows).toEqual([
      { key: 'seed', a: 1, b: 2 },
      { key: 'model', a: 'flux-pro', b: undefined },
      { key: 'aspect_ratio', a: undefined, b: '1:1' },
    ])
  })
  it('excludes internal bookkeeping keys and returns [] for identical params', () => {
    expect(diffTakeParams(take({ seed: 1, draftRestore: { x: 1 }, nodeType: 'G' }), take({ seed: 1 }))).toEqual([])
  })
})
```

```ts
// frontend/tests/unit/light-table-keymap.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { keyToLightTableAction } from '~/lib/artifact/lightTableKeymap'

describe('keyToLightTableAction', () => {
  it('maps the spec keys', () => {
    expect(keyToLightTableAction({ key: 'ArrowRight' })).toEqual({ type: 'move', dx: 1, dy: 0 })
    expect(keyToLightTableAction({ key: 'ArrowDown' })).toEqual({ type: 'move', dx: 0, dy: 1 })
    expect(keyToLightTableAction({ key: 'Enter' })).toEqual({ type: 'setActive' })
    expect(keyToLightTableAction({ key: 'Enter', metaKey: true })).toEqual({ type: 'promote' })
    expect(keyToLightTableAction({ key: 'p' })).toEqual({ type: 'pin' })
    expect(keyToLightTableAction({ key: 'x' })).toEqual({ type: 'discard' })
    expect(keyToLightTableAction({ key: ' ' })).toEqual({ type: 'lightbox' })
    expect(keyToLightTableAction({ key: 'Escape' })).toEqual({ type: 'close' })
    expect(keyToLightTableAction({ key: 'q' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/take-diff.unit.spec.ts tests/unit/light-table-keymap.unit.spec.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement both libs**

```ts
// frontend/app/lib/artifact/takeDiff.ts
/** Param diff between two takes — powers the Light Table's diff row. */
import type { Take } from '~/composables/useTakes'

const EXCLUDED = new Set(['draftRestore', 'nodeType'])

export function diffTakeParams(a: Take, b: Take): Array<{ key: string; a: any; b: any }> {
  const pa = a.params ?? {}
  const pb = b.params ?? {}
  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(k => !EXCLUDED.has(k))
  const rows: Array<{ key: string; a: any; b: any }> = []
  for (const key of keys) {
    if (JSON.stringify(pa[key]) !== JSON.stringify(pb[key])) rows.push({ key, a: pa[key], b: pb[key] })
  }
  return rows
}
```

```ts
// frontend/app/lib/artifact/lightTableKeymap.ts
/** Pure keyboard map for the Light Table (spec §Light Table · Keyboard). */
export type LtAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'setActive' }
  | { type: 'pin' }
  | { type: 'discard' }
  | { type: 'promote' }
  | { type: 'lightbox' }
  | { type: 'close' }

export function keyToLightTableAction(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
): LtAction | null {
  const mod = !!e.metaKey || !!e.ctrlKey
  switch (e.key) {
    case 'ArrowLeft': return { type: 'move', dx: -1, dy: 0 }
    case 'ArrowRight': return { type: 'move', dx: 1, dy: 0 }
    case 'ArrowUp': return { type: 'move', dx: 0, dy: -1 }
    case 'ArrowDown': return { type: 'move', dx: 0, dy: 1 }
    case 'Enter': return mod ? { type: 'promote' } : { type: 'setActive' }
    case 'p': case 'P': return { type: 'pin' }
    case 'x': case 'X': return { type: 'discard' }
    case ' ': return { type: 'lightbox' }
    case 'Escape': return { type: 'close' }
    default: return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/take-diff.unit.spec.ts tests/unit/light-table-keymap.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/artifact/takeDiff.ts frontend/app/lib/artifact/lightTableKeymap.ts frontend/tests/unit/take-diff.unit.spec.ts frontend/tests/unit/light-table-keymap.unit.spec.ts
git commit -m "feat(light-table): take param diff + keyboard map (pure libs)"
```

---

### Task 6: LightTableModal component + entry points

**Files:**
- Create: `frontend/app/components/vue-canvas/LightTableModal.vue`
- Modify: `frontend/app/components/vue-canvas/TakesStrip.vue` (expand button + `expand` emit)
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (host the modal; find the existing `<TakesStrip …>` usage ~line 813–821 and reuse its select/pin/discard handlers)

**Interfaces:**
- Consumes: `Take`, `diffTakeParams`, `keyToLightTableAction`.
- Produces: `LightTableModal.vue` with props `{ takes: Take[]; activeTakeId: string | null | undefined; title?: string; promoteUsdLabel?: string | null }` and emits `select(id)`, `pin(id)`, `discard(id)`, `promote(id)`, `discardOthers(keepId)`, `branch(id)`, `close`.

- [ ] **Step 1: Create the component**

```vue
<!-- frontend/app/components/vue-canvas/LightTableModal.vue -->
<script setup lang="ts">
/**
 * Light Table — spread a node's takes on a grid and compare (spec:
 * 2026-07-07-sketchbook-loop-design.md §Light Table). Presentational like
 * TakesStrip: the parent owns the takes array and applies every change.
 * Keyboard-first: arrows / Enter / Cmd+Enter / P / X / Space / Esc.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Star, X, ArrowUpToLine, GitBranch, PencilLine, Trash2 } from 'lucide-vue-next'
import type { Take } from '~/composables/useTakes'
import { diffTakeParams } from '~/lib/artifact/takeDiff'
import { keyToLightTableAction } from '~/lib/artifact/lightTableKeymap'

const props = defineProps<{
  takes: Take[]
  activeTakeId: string | null | undefined
  title?: string
  /** e.g. "~$0.03" — shown on Promote buttons; null hides the price. */
  promoteUsdLabel?: string | null
}>()

const emit = defineEmits<{
  (e: 'select' | 'pin' | 'discard' | 'promote' | 'branch', id: string): void
  (e: 'discardOthers', keepId: string): void
  (e: 'close'): void
}>()

const focusedId = ref<string | null>(props.takes.at(-1)?.id ?? null)
const compareId = ref<string | null>(null)   // shift-click second selection
const lightboxId = ref<string | null>(null)

const focusedIdx = computed(() => props.takes.findIndex(t => t.id === focusedId.value))
const focused = computed(() => props.takes[focusedIdx.value] ?? null)
const compare = computed(() => props.takes.find(t => t.id === compareId.value) ?? null)
const diffRows = computed(() =>
  focused.value && compare.value && focused.value.id !== compare.value.id
    ? diffTakeParams(focused.value, compare.value)
    : [],
)

// Grid geometry for arrow navigation: measured columns-per-row.
const gridEl = ref<HTMLElement | null>(null)
function columns(): number {
  const el = gridEl.value
  if (!el) return 4
  return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length)
}

function move(dx: number, dy: number) {
  const idx = focusedIdx.value < 0 ? props.takes.length - 1 : focusedIdx.value
  const next = Math.min(props.takes.length - 1, Math.max(0, idx + dx + dy * columns()))
  focusedId.value = props.takes[next]?.id ?? focusedId.value
}

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  const action = keyToLightTableAction(e)
  if (!action) return
  e.preventDefault()
  e.stopPropagation()
  const id = lightboxId.value ?? focusedId.value
  switch (action.type) {
    case 'move':
      if (lightboxId.value) {
        // In the lightbox, arrows flip between takes at identical framing (v1 A/B).
        const i = props.takes.findIndex(x => x.id === lightboxId.value)
        const n = Math.min(props.takes.length - 1, Math.max(0, i + action.dx + action.dy))
        lightboxId.value = props.takes[n]?.id ?? lightboxId.value
        focusedId.value = lightboxId.value
      } else {
        move(action.dx, action.dy)
      }
      break
    case 'setActive': if (id) emit('select', id); break
    case 'pin': if (id) emit('pin', id); break
    case 'discard': if (id) emit('discard', id); break
    case 'promote': {
      const take = props.takes.find(x => x.id === id)
      if (take?.draft) emit('promote', take.id)
      break
    }
    case 'lightbox': lightboxId.value = lightboxId.value ? null : focusedId.value; break
    case 'close':
      if (lightboxId.value) lightboxId.value = null
      else emit('close')
      break
  }
}

function onCellClick(t: Take, e: MouseEvent) {
  if (e.shiftKey && focusedId.value && focusedId.value !== t.id) compareId.value = t.id
  else { focusedId.value = t.id; compareId.value = null }
}

function fmt(v: any): string {
  if (v === undefined) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[90] flex flex-col bg-black/80 backdrop-blur-sm" @click.self="emit('close')">
      <!-- header -->
      <div class="flex items-center justify-between px-5 py-3 shrink-0">
        <div class="text-sm font-medium text-white/80">
          {{ title || 'Takes' }}
          <span class="text-white/40 ml-2">{{ takes.length }} take{{ takes.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="focused"
            class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer"
            title="Keep the focused + pinned takes, discard the rest"
            @click="emit('discardOthers', focused.id)"
          >
            <Trash2 class="size-3" /> Keep this, discard others
          </button>
          <button class="text-white/50 hover:text-white cursor-pointer" @click="emit('close')">
            <X class="size-4" />
          </button>
        </div>
      </div>

      <!-- grid -->
      <div ref="gridEl" class="grid gap-3 px-5 pb-3 overflow-y-auto grow" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); align-content: start">
        <div
          v-for="t in takes"
          :key="t.id"
          class="group relative rounded-lg overflow-hidden bg-white/[0.03] ring-1 cursor-pointer transition-shadow"
          :class="[
            t.id === focusedId ? 'ring-2 ring-[#96b4ff]' : t.id === compareId ? 'ring-2 ring-amber-300/70' : 'ring-white/10 hover:ring-white/25',
            t.id === activeTakeId ? 'outline outline-1 outline-offset-2 outline-emerald-400/50' : '',
          ]"
          @click="onCellClick(t, $event)"
          @dblclick="lightboxId = t.id"
        >
          <img v-if="t.images?.[0]" :src="t.images[0]" class="w-full aspect-square object-contain bg-black/40" loading="lazy" />
          <div v-else class="w-full aspect-square flex items-center justify-center text-xs text-white/40">{{ t.text ? 'text' : t.audios?.length ? 'audio' : '—' }}</div>

          <!-- chips -->
          <div class="absolute inset-x-0 top-0 flex items-center gap-1 p-1.5 text-[10px]">
            <span v-if="t.draft" class="flex items-center gap-1 rounded border border-dashed border-white/50 bg-black/60 px-1 py-0.5 text-white/80"><PencilLine class="size-2.5" /> draft</span>
            <span v-if="t.promotedFrom" class="rounded bg-black/60 px-1 py-0.5 text-emerald-300/90 border border-emerald-400/30">promoted</span>
            <span v-if="t.params?.seed !== undefined" class="rounded bg-black/60 px-1 py-0.5 text-white/60">seed {{ t.params.seed }}</span>
            <Star v-if="t.pinned" class="size-3 text-amber-300 fill-amber-300 ml-auto" />
          </div>

          <!-- hover actions -->
          <div class="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 p-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <button v-if="t.draft" class="flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-1.5 py-0.5 text-[10px] text-white cursor-pointer" :title="'Re-render at full quality' + (promoteUsdLabel ? ` · ${promoteUsdLabel}` : '')" @click.stop="emit('promote', t.id)">
              <ArrowUpToLine class="size-3" /> Promote<span v-if="promoteUsdLabel" class="text-white/50">{{ promoteUsdLabel }}</span>
            </button>
            <button class="rounded bg-white/10 hover:bg-white/20 p-1 text-white/80 cursor-pointer" title="Continue from this take on a new Image node" @click.stop="emit('branch', t.id)"><GitBranch class="size-3" /></button>
            <button class="rounded bg-white/10 hover:bg-white/20 p-1 text-white/80 cursor-pointer" :title="t.pinned ? 'Unpin' : 'Pin'" @click.stop="emit('pin', t.id)"><Star class="size-3" :class="{ 'fill-amber-300 text-amber-300': t.pinned }" /></button>
            <button class="rounded bg-white/10 hover:bg-red-500/30 p-1 text-white/80 cursor-pointer" title="Discard take" @click.stop="emit('discard', t.id)"><X class="size-3" /></button>
          </div>
        </div>
      </div>

      <!-- diff row (two selected takes) -->
      <div v-if="diffRows.length" class="shrink-0 border-t border-white/10 bg-black/60 px-5 py-2 flex flex-wrap gap-x-6 gap-y-1">
        <span class="text-[11px] text-white/40 w-full">Differences (focused vs shift-selected)</span>
        <span v-for="row in diffRows" :key="row.key" class="text-[11px] text-white/70">
          <span class="text-white/40">{{ row.key }}:</span> {{ fmt(row.a) }} <span class="text-white/30">→</span> {{ fmt(row.b) }}
        </span>
      </div>

      <!-- lightbox -->
      <div v-if="lightboxId" class="absolute inset-0 z-10 bg-black/95 flex items-center justify-center" @click="lightboxId = null">
        <img v-if="takes.find(t => t.id === lightboxId)?.images?.[0]" :src="takes.find(t => t.id === lightboxId)!.images![0]" class="max-w-[92vw] max-h-[92vh] object-contain" />
        <div class="absolute bottom-4 inset-x-0 text-center text-[11px] text-white/40">← → to flip · Space or Esc to close</div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Add the expand entry to TakesStrip.vue**

Add `Maximize2` to the lucide import, `(e: 'expand'): void` to the emits, and append inside the strip's flex row (after the `v-for` block):

```html
<button
  v-if="takes.length"
  class="shrink-0 size-12 rounded-md flex items-center justify-center ring-1 ring-white/10 text-white/50 hover:text-white hover:ring-white/30 cursor-pointer"
  title="Open Light Table (compare takes)"
  @click.stop="emit('expand')"
>
  <Maximize2 class="size-4" />
</button>
```

- [ ] **Step 3: Host the modal in ArtifactImageNode.vue**

Locate the existing `<TakesStrip …>` usage (~line 813–821) and note the handler names it binds (`@select`, `@pin`, `@discard` — reuse those exact handlers). Add:

```ts
const lightTableOpen = ref(false)
```

Extend the strip binding with `@expand="lightTableOpen = true"`, and next to it render:

```html
<LightTableModal
  v-if="lightTableOpen"
  :takes="data.takes ?? []"
  :active-take-id="data.activeTakeId"
  :title="data.title || 'Takes'"
  :promote-usd-label="null"
  @select="onTakeSelect"
  @pin="onTakePin"
  @discard="onTakeDiscard"
  @promote="() => {}"
  @branch="() => {}"
  @discard-others="() => {}"
  @close="lightTableOpen = false"
/>
```

(Substitute `onTakeSelect/onTakePin/onTakeDiscard` with the actual handler names found on the strip. `promote`, `branch`, `discardOthers` are wired in Tasks 7–8 — no-op stubs here keep this task shippable.)

- [ ] **Step 4: Type-check and run the suite**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LightTable\|TakesStrip\|ArtifactImage" ; npx vitest run`
Expected: no new type errors in the touched files; unchanged suite results.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/LightTableModal.vue frontend/app/components/vue-canvas/TakesStrip.vue frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(light-table): compare-grid modal + strip expand entry"
```

---

### Task 7: Promote

**Files:**
- Create: `frontend/app/lib/draft/promote.ts`
- Modify: `frontend/app/layouts/default.vue` (`runVueWorkflow` — consume pending promotes after the draft rewrite)
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (promote handler + wire modal/strip buttons)
- Modify: `frontend/app/components/vue-canvas/TakesStrip.vue` (Promote hover button on draft takes)
- Test: `frontend/tests/unit/draft-promote.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 `setPendingPromote`, `consumePendingPromote`; Task 1 restore snapshots (via `take.params.draftRestore`).
- Produces:
  - `promoteOverridesFor(take: Take): Record<string, any> | null` — the widget map a promote run substitutes: the draft-restore snapshot (original model/steps/megapixels) + the take's `seed` and `prompt`/`aspect_ratio` when present. Null for non-draft takes or takes with no restore data and no seed.
  - `applyPendingPromotes(plainWorkflow: any, vnodes: any[], consume: (nodeId: string) => { fromTakeId: string; overrides: Record<string, any> } | null): string[]` — same in-place substitution mechanics as Task 1, but per pending node; returns promoted node ids.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/draft-promote.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { promoteOverridesFor, applyPendingPromotes } from '~/lib/draft/promote'
import type { Take } from '~/composables/useTakes'

const draftTake = (params: Record<string, any>): Take =>
  ({ id: 'td', createdAt: 0, promptId: 'p', draft: true, params })

describe('promoteOverridesFor', () => {
  it('builds overrides from draftRestore + snapshot seed/prompt/aspect', () => {
    expect(promoteOverridesFor(draftTake({
      draftRestore: { model: 'flux-pro', model_options: '{"guidance":3}' },
      seed: 42, prompt: 'a cat', aspect_ratio: '1:1',
    }))).toEqual({ model: 'flux-pro', model_options: '{"guidance":3}', seed: 42, prompt: 'a cat', aspect_ratio: '1:1' })
  })
  it('returns null for a non-draft take', () => {
    expect(promoteOverridesFor({ id: 't', createdAt: 0, promptId: null, params: { seed: 1 } })).toBeNull()
  })
})

describe('applyPendingPromotes', () => {
  it('substitutes widgets for a pending node and reports it', () => {
    const wf = { nodes: [{ id: 5, type: 'GenerateImageNode', widgets_values: ['flux-schnell', 'a cat', '1:1', 999, '{}'] }] }
    const vnodes = [{ id: '5', data: { nodeType: 'GenerateImageNode', widgetDefs: [{ name: 'model' }, { name: 'prompt' }, { name: 'aspect_ratio' }, { name: 'seed' }, { name: 'model_options' }] } }]
    const consume = (id: string) => id === '5' ? { fromTakeId: 'td', overrides: { model: 'flux-pro', seed: 42 } } : null
    const ids = applyPendingPromotes(wf, vnodes, consume)
    expect(ids).toEqual(['5'])
    expect(wf.nodes[0].widgets_values[0]).toBe('flux-pro')
    expect(wf.nodes[0].widgets_values[3]).toBe(42)
    expect(wf.nodes[0].widgets_values[1]).toBe('a cat')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/draft-promote.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/draft/promote.ts
/** Promote — re-run a draft take's exact snapshot at full quality (spec §Promote).
 *  The overrides substitute into the run-path workflow copy AFTER the draft
 *  rewrite, so a promote wins over draft mode for its node. */
import type { Take } from '~/composables/useTakes'

export function promoteOverridesFor(take: Take): Record<string, any> | null {
  if (!take?.draft) return null
  const p = take.params ?? {}
  const o: Record<string, any> = { ...(p.draftRestore ?? {}) }
  if (p.seed !== undefined) o.seed = p.seed
  if (typeof p.prompt === 'string' && p.prompt) o.prompt = p.prompt
  if (p.aspect_ratio !== undefined) o.aspect_ratio = p.aspect_ratio
  return Object.keys(o).length ? o : null
}

export function applyPendingPromotes(
  plainWorkflow: any,
  vnodes: any[],
  consume: (nodeId: string) => { fromTakeId: string; overrides: Record<string, any> } | null,
): string[] {
  const promoted: string[] = []
  const vById = new Map((vnodes || []).map((n: any) => [String(n.id), n]))
  for (const wn of plainWorkflow?.nodes ?? []) {
    const meta = consume(String(wn.id))
    if (!meta) continue
    const defs = vById.get(String(wn.id))?.data?.widgetDefs as Array<{ name?: string }> | undefined
    if (!defs || !Array.isArray(wn.widgets_values)) continue
    for (const [name, value] of Object.entries(meta.overrides)) {
      const i = defs.findIndex(d => d?.name === name)
      if (i >= 0 && i < wn.widgets_values.length) wn.widgets_values[i] = value
    }
    promoted.push(String(wn.id))
  }
  return promoted
}
```

**Consume in `runVueWorkflow`** (default.vue), directly AFTER the Task-3 draft block (promote wins over draft):

```ts
import { applyPendingPromotes } from '~/lib/draft/promote' // top of file, with the other draft imports

// One-shot promotes: substitute the take snapshot for any node with a pending
// promote. Registered by ArtifactImageNode.promoteTake just before it fires
// runFiltered. NOTE: consumption here is peek-free — a promote submitted in
// draft mode still renders final for that node.
const vnodesForPromote = vueCanvasRef.value.getNodes?.() || []
applyPendingPromotes(plainWorkflow, vnodesForPromote, (nodeId) => {
  const m = peekPendingPromote(nodeId) // see below
  return m
})
```

Registry subtlety: `consumePendingPromote` must survive until the *result* lands (Task 4's tagging consumes it). Add a non-destructive reader to `lib/draft/runMeta.ts`:

```ts
export function peekPendingPromote(nodeId: string): { fromTakeId: string; overrides: Record<string, any> } | null {
  return promoteByNode.get(String(nodeId)) ?? null
}
```

(Export it and add one assertion to the Task-2 spec file: `peek` returns without clearing, `consume` clears.)

- [ ] **Step 4: Promote handler in ArtifactImageNode.vue**

Next to `runThisNode()` (~line 266), mirroring its dispatch shape exactly:

```ts
import { setPendingPromote } from '~/lib/draft/runMeta'
import { promoteOverridesFor } from '~/lib/draft/promote'

function promoteTake(takeId: string) {
  const take = (props.data.takes ?? []).find((t: any) => t.id === takeId)
  const overrides = take ? promoteOverridesFor(take) : null
  if (!take || !overrides) return
  setPendingPromote(String(props.id), { fromTakeId: take.id, overrides })
  // Same event runThisNode dispatches — self scope reruns just this node;
  // the pending promote then rewrites its widgets at submit time.
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', {
    detail: { nodeIds: [String(props.id)], rerollScope: 'self' },
  }))
}
```

(**Match the actual `detail` payload of the existing `runThisNode` dispatch** — copy its exact keys; the snippet above assumes `nodeIds` + `rerollScope`.)

Wire it: `@promote="promoteTake"` on `LightTableModal`; compute the price label once:

```ts
import { parseBadgeUsd } from '~/lib/costEstimate'
const promoteUsdLabel = computed(() => {
  const cost = parseBadgeUsd(props.data?.priceBadge?.expr)
  return cost ? ` ~$${cost.usd.toFixed(2)}` : null
})
```

and pass `:promote-usd-label="promoteUsdLabel"`.

- [ ] **Step 5: Promote button on TakesStrip.vue**

Add `ArrowUpToLine` to the lucide import, `(e: 'promote', id: string): void` to emits, and insert as the FIRST hover action (before the pin button), shown only for draft takes:

```html
<button
  v-if="t.draft"
  class="size-4 rounded-sm flex items-center justify-center text-white/70 hover:text-emerald-300"
  title="Promote to full quality"
  @click.stop="emit('promote', t.id)"
>
  <ArrowUpToLine class="size-3" />
</button>
```

In ArtifactImageNode's `<TakesStrip …>` binding add `@promote="promoteTake"`.

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run tests/unit/draft-promote.unit.spec.ts tests/unit/draft-run-meta.unit.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/draft/promote.ts frontend/app/lib/draft/runMeta.ts frontend/tests/unit/draft-promote.unit.spec.ts frontend/tests/unit/draft-run-meta.unit.spec.ts frontend/app/layouts/default.vue frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/components/vue-canvas/TakesStrip.vue
git commit -m "feat(draft): promote — one-shot take-snapshot rerun at full quality"
```

---

### Task 8: Light Table exit gestures — discard-others (with undo) + branch winner

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (extend the `comfynext:addNode` listener with `dataOverrides`)
- Test: extend `frontend/tests/unit/take-draft-tagging.unit.spec.ts` with a pure discard-others helper test

**Interfaces:**
- Consumes: Task 6 modal emits.
- Produces: `discardOthers(takes: Take[], keepId: string): Take[]` exported from `useTakes.ts` (keeps `keepId` + pinned takes); `comfynext:addNode` event detail gains optional `dataOverrides: Record<string, any>` merged onto the new node's `data` after creation.

- [ ] **Step 1: Write the failing test (pure helper)**

Append to `frontend/tests/unit/take-draft-tagging.unit.spec.ts`:

```ts
import { discardOthers } from '~/composables/useTakes'

describe('discardOthers', () => {
  const t = (id: string, pinned = false): Take => ({ id, createdAt: 0, promptId: null, pinned })
  it('keeps the chosen take and every pinned take', () => {
    const out = discardOthers([t('a'), t('b', true), t('c')], 'c')
    expect(out.map(x => x.id)).toEqual(['b', 'c'])
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement in useTakes.ts**

```ts
/** Keep the chosen take + all pinned takes; drop the rest. Pure. */
export function discardOthers(takes: Take[], keepId: string): Take[] {
  return (takes ?? []).filter(t => t.id === keepId || t.pinned)
}
```

Run: `cd frontend && npx vitest run tests/unit/take-draft-tagging.unit.spec.ts` → PASS

- [ ] **Step 3: Wire discard-others with undo toast (ArtifactImageNode.vue)**

```ts
import { toast } from 'vue-sonner'
import { discardOthers, resolveActiveTake, projectTake } from '~/composables/useTakes'

function onDiscardOthers(keepId: string) {
  const before = [...(props.data.takes ?? [])]
  const kept = discardOthers(before, keepId)
  if (kept.length === before.length) return
  updateTakes(kept, keepId) // ← use this node's existing takes-mutation path (same one the strip's discard handler uses)
  toast(`Discarded ${before.length - kept.length} take${before.length - kept.length === 1 ? '' : 's'}`, {
    action: { label: 'Undo', onClick: () => updateTakes(before, keepId) },
  })
}
```

(**`updateTakes` stands for whatever this component's existing discard handler does to write `data.takes` + re-project the active take — reuse that exact mechanism**, keeping active id = `keepId` and projecting via `projectTake`.) Bind `@discard-others="onDiscardOthers"`.

- [ ] **Step 4: Branch winner**

In `VueNodeCanvas.vue`, find the `comfynext:addNode` event listener (handler for the event dispatched by `useNodeSearch.addNode`, accepting `widgetOverrides`/`propertyOverrides`). Extend its detail handling: after the node is created and its `data` initialized, merge `detail.dataOverrides` if present:

```ts
if (detail.dataOverrides && typeof detail.dataOverrides === 'object') {
  created.data = { ...created.data, ...detail.dataOverrides }
}
```

In `ArtifactImageNode.vue`:

```ts
function branchFromTake(takeId: string) {
  const take = (props.data.takes ?? []).find((t: any) => t.id === takeId)
  const url = take?.images?.[0]
  if (!take || !url) return
  window.dispatchEvent(new CustomEvent('comfynext:addNode', {
    detail: {
      nodeType: 'Image',
      dataOverrides: { images: [url], takes: [{ ...take, pinned: true }], activeTakeId: take.id },
    },
  }))
  lightTableOpen.value = false
}
```

Bind `@branch="branchFromTake"`.

- [ ] **Step 5: Run the full suite**

Run: `cd frontend && npx vitest run`
Expected: unchanged failures (the 8 known pre-existing) + all new specs passing.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useTakes.ts frontend/tests/unit/take-draft-tagging.unit.spec.ts frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(light-table): discard-others with undo + branch winner to new Image node"
```

---

### Task 9: Browser verification (house rule: visuals verified by screenshot before ship)

**Files:** none (verification only; fix-forward anything found, committing fixes individually).

- [ ] **Step 1: Start the dev preview** (use the session's own server via preview tools; `localhost` may 426 — use `127.0.0.1`).

- [ ] **Step 2: Verify draft loop end-to-end**
1. Open a project tab → confirm the Draft/Final chip renders next to the credits chip; toggle to Draft (amber state).
2. Place a Generate Image node, prompt it, Run. Confirm: cost preview shows the draft price (~$0.003), result lands as a take with the dashed draft badge.
3. Run **Variations ×4** in draft. Confirm four draft takes stream into the strip.
4. Toggle to Final, run once — confirm no draft badge on the new take and full price in the preview.
5. Reload the page — confirm the toggle state survives (doc persistence).

- [ ] **Step 3: Verify the Light Table**
1. Open via the strip's expand button. Arrow keys move focus; Enter sets active (emerald outline moves); P pins; X discards; Space opens the lightbox and ←/→ flips at identical framing; Esc closes in two stages.
2. Shift-click a second take → diff row lists seed (and model when comparing draft vs final).
3. "Keep this, discard others" → toast with working Undo.
4. Branch → a new Image node appears holding the take's image.

- [ ] **Step 4: Verify Promote**
1. On a draft take (strip hover + Light Table cell + Cmd+Enter): Promote fires a self-scope run; the final take lands with the "promoted" chip, `seed` matching the draft (check the seed chips side by side in the Light Table).
2. With a **LoRA node** (`FluxLoRARemoteNode`): draft-run it, confirm the character/style still applies (LoRA not dropped), then promote and confirm steps/megapixels restored (diff row shows the change).

- [ ] **Step 5: Screenshot the key states** (draft badge on strip, Light Table grid with diff row, promoted pair) and present for look sign-off.

- [ ] **Step 6: Commit any verification fixes individually**, then final:

```bash
git add <specific files touched by fixes>
git commit -m "fix(sketchbook): browser-verification fixes"
```

---

## Self-review notes (done at planning time)

- **Spec coverage:** D1 = Tasks 1–3, take badging = Task 4, Light Table = Tasks 5–6, D2 = Task 7, exit gestures = Task 8, house-rule browser pass = Task 9. Spec's `extra_data.draft` analytics stamp: covered by `plainWorkflow.extra.draft` in Task 3 (rides the existing extra stamping through the meter route). Deferred items (batch auto-open, Wake, video drafts, synced zoom) are explicitly out of scope per spec.
- **Known line-drift risk:** default.vue/ArtifactImageNode line numbers WILL have drifted (parallel sessions ship daily). Every Modify step is anchored to function names and existing code snippets, not just line numbers — search for the anchor first.
- **Type consistency check:** `DraftApplication.restoreById` (T1) → `markDraftRun(restoreById)` (T2) → `take.params.draftRestore` (T4) → `promoteOverridesFor` reads `p.draftRestore` (T7). `peekPendingPromote` (T7) added to runMeta alongside `consumePendingPromote` (T2) — submit path peeks, result path consumes.
