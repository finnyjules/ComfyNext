# Lookup Collections — Slice 2 (Canvas Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Let the user draw a `Themes → Players` LOOKUP edge on the canvas, which registers a persisted `CollectionLink` on the driver (Players), with a match-column picker when the two tables don't share a key column.

**Architecture:** A Collection node gains a `lookup-in` target handle (type `VARS`). `onConnect` detects a collection→collection connection, stamps the edge `dataType: 'LOOKUP'`, and registers a link on the target's persisted `CollectionData.links`. A pure `reconcileLinks` prunes links whose LOOKUP edge was removed. Match columns auto-resolve when the tables share a same-named key, else a `LookupMatchPicker` popover collects them.

**Tech Stack:** Vue 3, Vue Flow, TypeScript, Vitest. `~/` → `frontend/app/`.

## Global Constraints

- Work on `main`; explicit git paths only; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Depends on Slice 1 (shipped): `CollectionLink`, `CollectionData.links?`, `LOOKUP_TYPE='LOOKUP'`, `linkedColumns`, `resolveBindings(…, resolve?)` in `lib/collection/lookup.ts` + `resolve.ts`.
- `VARS_TYPE='VARS'` and `LOOKUP_TYPE='LOOKUP'` from `~/lib/collection/types`. `COLLECTION_PROP` too.
- A collection node's `CollectionData` lives at `node.data.properties[COLLECTION_PROP]`; its stable id is `.id`.
- Pink (`#f472b6` / `--var-accent`) is the variables color — the lookup handle uses it.
- Baseline unrelated unit failures (NOT regressions): spacetype-palette ×2, gradientfx-mesh, video-model-adapt.
- You CANNOT browser-verify (dev port held). Each canvas/UI task ends with a MANUAL CHECKLIST for the human; unit-test everything that is pure.

## File Structure

- `frontend/app/lib/collection/lookup.ts` — add `autoMatchColumns`, `reconcileLinks`, `makeLookupResolver` (pure).
- `frontend/tests/unit/collection-lookup-match.unit.spec.ts` (NEW) — tests for the three.
- `frontend/app/components/vue-canvas/CollectionNode.vue` — add `lookup-in` target handle.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — declare Collection `lookup` input; LOOKUP detection in `onConnect`; edges→links reconcile watcher; open picker on ambiguous match; mount `LookupMatchPicker`.
- `frontend/app/components/vue-canvas/LookupMatchPicker.vue` (NEW) — match-column popover (mirror `studio/SweepPopover.vue`).
- `frontend/app/lib/collection/preview.ts` — `wiredTargets` filters `dataType === VARS_TYPE`.

---

### Task 1: Pure match + reconcile + resolver helpers

**Files:**
- Modify: `frontend/app/lib/collection/lookup.ts`
- Test: `frontend/tests/unit/collection-lookup-match.unit.spec.ts`

**Interfaces produced:**
- `autoMatchColumns(local: CollectionColumn[], foreign: CollectionColumn[]): { matchLocal: string; matchForeign: string } | null` — if the two share EXACTLY ONE column key, return it as both match keys; else null (0 or ambiguous → picker).
- `reconcileLinks(existing: CollectionLink[], sourceIds: string[], autoMatch: (sourceId: string) => { matchLocal: string; matchForeign: string } | null): CollectionLink[]` — keep existing links whose `collectionId ∈ sourceIds`; for each `sourceId` with no existing link, add `{collectionId: sourceId, ...autoMatch(sourceId)}` when autoMatch is non-null. Dedupe by collectionId, preserve order (existing first).
- `makeLookupResolver(collectionNodes: any[]): LookupResolver` — returns `(id) => the CollectionData among the nodes whose properties[COLLECTION_PROP].id === id, else undefined`.

- [ ] **Step 1: Write the failing test** — create `frontend/tests/unit/collection-lookup-match.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { autoMatchColumns, reconcileLinks, makeLookupResolver } from '~/lib/collection/lookup'
import { createCollection, addColumn } from '~/lib/collection/model'
import { COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionLink } from '~/lib/collection/types'

describe('autoMatchColumns', () => {
  const local = [{ key: 'name', label: 'Name', type: 'text' as const }, { key: 'country', label: 'Country', type: 'text' as const }]
  it('matches a single shared key', () => {
    const foreign = [{ key: 'country', label: 'Country', type: 'text' as const }, { key: 'fill1', label: 'Fill1', type: 'color' as const }]
    expect(autoMatchColumns(local, foreign)).toEqual({ matchLocal: 'country', matchForeign: 'country' })
  })
  it('returns null when no shared key', () => {
    expect(autoMatchColumns(local, [{ key: 'fill1', label: 'Fill1', type: 'color' as const }])).toBe(null)
  })
  it('returns null when ambiguous (two shared keys)', () => {
    const foreign = [{ key: 'name', label: 'Name', type: 'text' as const }, { key: 'country', label: 'Country', type: 'text' as const }]
    expect(autoMatchColumns(local, foreign)).toBe(null)
  })
})

describe('reconcileLinks', () => {
  const am = (id: string) => (id === 'T' ? { matchLocal: 'country', matchForeign: 'country' } : null)
  it('keeps links whose source still has an edge, drops the rest', () => {
    const existing: CollectionLink[] = [{ collectionId: 'T', matchLocal: 'country', matchForeign: 'country' }, { collectionId: 'GONE', matchLocal: 'x', matchForeign: 'x' }]
    expect(reconcileLinks(existing, ['T'], am)).toEqual([{ collectionId: 'T', matchLocal: 'country', matchForeign: 'country' }])
  })
  it('adds a new link via autoMatch, skips when autoMatch returns null', () => {
    expect(reconcileLinks([], ['T'], am)).toEqual([{ collectionId: 'T', matchLocal: 'country', matchForeign: 'country' }])
    expect(reconcileLinks([], ['U'], am)).toEqual([]) // autoMatch null → not added (picker will add later)
  })
})

describe('makeLookupResolver', () => {
  it('resolves a collection by its data id', () => {
    const c = createCollection('Themes'); addColumn(c, 'Country', 'text')
    const nodes = [{ id: '9', data: { properties: { [COLLECTION_PROP]: c } } }, { id: '3', data: {} }]
    const resolve = makeLookupResolver(nodes)
    expect(resolve(c.id)?.name).toBe('Themes')
    expect(resolve('missing')).toBe(undefined)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run tests/unit/collection-lookup-match.unit.spec.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement** — append to `frontend/app/lib/collection/lookup.ts`:

```ts
import { COLLECTION_PROP } from './types'

/** Auto-match two column sets by shared key. Exactly one shared key → use it for
 *  both sides; 0 or >1 → null (ambiguous, defer to the match picker). */
export function autoMatchColumns(
  local: CollectionColumn[], foreign: CollectionColumn[],
): { matchLocal: string; matchForeign: string } | null {
  const foreignKeys = new Set(foreign.map(c => c.key))
  const shared = local.map(c => c.key).filter(k => foreignKeys.has(k))
  return shared.length === 1 ? { matchLocal: shared[0]!, matchForeign: shared[0]! } : null
}

/** Reconcile a driver's links against the set of source collection ids that
 *  currently have a LOOKUP edge into it. Keeps existing links (preserving their
 *  match columns) whose source still has an edge; adds a link for any new source
 *  when autoMatch yields one; drops links whose edge is gone. */
export function reconcileLinks(
  existing: CollectionLink[],
  sourceIds: string[],
  autoMatch: (sourceId: string) => { matchLocal: string; matchForeign: string } | null,
): CollectionLink[] {
  const wanted = new Set(sourceIds)
  const kept = existing.filter(l => wanted.has(l.collectionId))
  const have = new Set(kept.map(l => l.collectionId))
  const added: CollectionLink[] = []
  for (const id of sourceIds) {
    if (have.has(id)) continue
    const m = autoMatch(id)
    if (m) { added.push({ collectionId: id, ...m }); have.add(id) }
  }
  return [...kept, ...added]
}

/** Build a LookupResolver over a set of canvas nodes, keyed by each collection's data id. */
export function makeLookupResolver(collectionNodes: any[]): LookupResolver {
  return (id: string) => {
    for (const n of collectionNodes) {
      const c = n?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
      if (c && c.id === id) return c
    }
    return undefined
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/collection-lookup-match.unit.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git add frontend/app/lib/collection/lookup.ts frontend/tests/unit/collection-lookup-match.unit.spec.ts && git commit -m "feat(variables): lookup auto-match + reconcile + resolver helpers` (+ trailer).

---

### Task 2: Canvas wiring — lookup handle, edge detection, link reconcile

**Files:**
- Modify: `frontend/app/components/vue-canvas/CollectionNode.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`
- Modify: `frontend/app/lib/collection/preview.ts`

**Interfaces consumed:** `autoMatchColumns`, `reconcileLinks` (Task 1); `LOOKUP_TYPE`, `VARS_TYPE`, `COLLECTION_PROP` from types.

- [ ] **Step 1: CollectionNode lookup-in handle.** In `CollectionNode.vue` template, immediately before `<Handle id="output-0" ... />`, add:
```html
    <!-- Lookup input: another Collection's VARS output wires here to become a lookup table. Pink = variables. -->
    <Handle id="input-0" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !border-[#f472b6]/60 !bg-[#1a1a1a]" />
```

- [ ] **Step 2: Declare the Collection `lookup` input at spawn.** In `VueNodeCanvas.vue` near the Collection spawn block (search `nodeType === 'Collection'` ~line 1466, where `data.data.outputs = [{ name: 'vars', type: VARS_TYPE, links: null }]`), add right after the outputs line:
```ts
    if (!data.data.inputs || data.data.inputs.length === 0) {
      data.data.inputs = [{ name: 'lookup', type: VARS_TYPE, link: null, optional: true }]
    }
```

- [ ] **Step 3: LOOKUP detection in `onConnect`.** In the `onConnect((params) => {...})` handler, replace the final `addEdges([...])` line. Currently:
```ts
  const outputIndex = parseInt(sourceHandle?.replace('output-', '') || '0')
  const dataType = sourceNode?.data?.outputs?.[outputIndex]?.type || '*'
  addEdges([{ ...params, sourceHandle, targetHandle, type: 'comfy', data: { dataType } }])
```
with:
```ts
  const outputIndex = parseInt(sourceHandle?.replace('output-', '') || '0')
  let dataType = sourceNode?.data?.outputs?.[outputIndex]?.type || '*'
  // Collection → Collection lookup-in ⇒ a LOOKUP edge (not a VARS binding wire).
  const isLookup = sourceNode?.data?.nodeType === 'Collection'
    && targetNode?.data?.nodeType === 'Collection'
    && String(sourceNode.id) !== String(targetNode.id)
  if (isLookup) dataType = LOOKUP_TYPE
  addEdges([{ ...params, sourceHandle, targetHandle, type: 'comfy', data: { dataType } }])
  if (isLookup) registerLookupLink(String(sourceNode.id), String(targetNode.id), { x: connectStartInfo?.x ?? 0, y: connectStartInfo?.y ?? 0 })
```
Guard self-link: if source===target collection, do NOT create the edge (return before addEdges). Import `LOOKUP_TYPE` from `~/lib/collection/types`.

- [ ] **Step 4: `registerLookupLink` + reconcile watcher.** Add these to `VueNodeCanvas.vue` (near the other collection helpers; import `autoMatchColumns, reconcileLinks` from `~/lib/collection/lookup`, `COLLECTION_PROP`, `LOOKUP_TYPE` from types):

```ts
// Collection ids of the collections a driver has LOOKUP edges from.
function lookupSourceIds(driverId: string): string[] {
  return (edges.value as any[])
    .filter(e => String(e.target) === String(driverId) && e?.data?.dataType === LOOKUP_TYPE)
    .map(e => String(e.source))
}
function collectionDataOf(nodeId: string): any | undefined {
  const n = (nodes.value as any[]).find(x => String(x.id) === String(nodeId))
  return n?.data?.properties?.[COLLECTION_PROP]
}
// After a LOOKUP edge is drawn: auto-match on a shared key, else open the picker.
function registerLookupLink(sourceId: string, driverId: string, anchor: { x: number; y: number }) {
  const driver = collectionDataOf(driverId); const foreign = collectionDataOf(sourceId)
  if (!driver || !foreign) return
  if (!Array.isArray(driver.links)) driver.links = []
  const match = autoMatchColumns(driver.columns, foreign.columns)
  if (match) {
    driver.links = reconcileLinks(driver.links, lookupSourceIds(driverId), sid =>
      sid === sourceId ? match : (driver.links.find((l: any) => l.collectionId === sid) ?? null))
  } else {
    lookupPicker.value = { sourceId, driverId, foreign: foreign.columns, local: driver.columns, anchor }
  }
}
// Prune links whose LOOKUP edge no longer exists (covers disconnect + delete).
watch(edges, () => {
  for (const n of nodes.value as any[]) {
    if (n?.data?.nodeType !== 'Collection') continue
    const c = n.data.properties?.[COLLECTION_PROP]
    if (!c || !Array.isArray(c.links) || !c.links.length) continue
    const ids = lookupSourceIds(String(n.id))
    const next = reconcileLinks(c.links, ids, () => null) // prune-only; never auto-add here
    if (next.length !== c.links.length) c.links = next
  }
}, { deep: true })
```
NOTE the reconcile-in-`registerLookupLink` passes an autoMatch that returns the already-known match for the new source and preserves existing links' match cols for others — so it never drops a manually-picked link.

- [ ] **Step 5: `wiredTargets` VARS filter.** In `frontend/app/lib/collection/preview.ts` `wiredTargets`, change the filter to also require the edge be a VARS edge, so a LOOKUP edge never makes a collection a preview target:
```ts
  const ids = new Set(
    edges
      .filter(e => String(e.source) === String(collectionNodeId) && e.sourceHandle === 'output-0' && e?.data?.dataType === 'VARS')
      .map(e => String(e.target)),
  )
```

- [ ] **Step 6: Typecheck + existing suites.** `npx vue-tsc --noEmit 2>&1 | grep -E "VueNodeCanvas|CollectionNode|preview.ts"` (stash-compare, zero new). `npx vitest run tests/unit/collection-lookup.unit.spec.ts tests/unit/collection-resolve-lookup.unit.spec.ts tests/unit/collection-lookup-match.unit.spec.ts` → PASS.

- [ ] **Step 7: Commit** — `git add` the three files + `git commit -m "feat(variables): LOOKUP canvas edge + link reconcile"` (+ trailer).

**MANUAL CHECKLIST (human, browser):** (1) A Collection node now shows a pink input handle on its left. (2) Drag Themes.output → Players lookup-in when both have a same-named key column (e.g. rename each key column "Country") → a LOOKUP edge appears; `Players` collection gains `links` (verify via drawer in Slice 3). (3) Delete the edge → link removed. (4) Reload → edge + link persist (relies on the Slice-1.5 handle-render fix). (5) A normal Collection→Studio VARS wire still works and its live preview still updates.

---

### Task 3: LookupMatchPicker popover

**Files:**
- Create: `frontend/app/components/vue-canvas/LookupMatchPicker.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`

- [ ] **Step 1: Create `LookupMatchPicker.vue`** (mirror `studio/SweepPopover.vue`'s teleport + anchor-clamp + Escape/backdrop-close):

```vue
<script setup lang="ts">
// Match-column picker: shown when a LOOKUP edge is drawn between two collections
// that don't share a same-named key. Pick which column on each side is the key.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CollectionColumn } from '~/lib/collection/types'

const props = defineProps<{
  foreign: CollectionColumn[]   // lookup table (Themes) columns
  local: CollectionColumn[]     // driver (Players) columns
  anchor: { x: number; y: number }
}>()
const emit = defineEmits<{ (e: 'apply', v: { matchLocal: string; matchForeign: string }): void; (e: 'close'): void }>()

const matchForeign = ref(props.foreign[0]?.key ?? '')
const matchLocal = ref(props.local[0]?.key ?? '')

function apply() {
  if (!matchForeign.value || !matchLocal.value) return
  emit('apply', { matchLocal: matchLocal.value, matchForeign: matchForeign.value })
  emit('close')
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <teleport to="body">
    <div class="fixed inset-0 z-[200]" @click="emit('close')">
      <div class="absolute w-[280px] rounded-lg border border-white/15 bg-[#1a1a1a] p-3 text-white/90 shadow-xl"
           :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }" @click.stop>
        <p class="mb-2 text-[12px] font-medium">Match on which column?</p>
        <label class="mb-1 block text-[11px] text-white/50">Lookup table key</label>
        <select v-model="matchForeign" class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-[12px]">
          <option v-for="c in foreign" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <label class="mb-1 block text-[11px] text-white/50">This table key</label>
        <select v-model="matchLocal" class="mb-3 w-full rounded bg-white/10 px-2 py-1 text-[12px]">
          <option v-for="c in local" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <div class="flex justify-end gap-2">
          <button class="rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10" @click="emit('close')">Cancel</button>
          <button class="rounded bg-[#f472b6]/20 px-2 py-1 text-[11px] text-[#f9a8d4] hover:bg-[#f472b6]/30" @click="apply">Link</button>
        </div>
      </div>
    </div>
  </teleport>
</template>
```

- [ ] **Step 2: Wire into VueNodeCanvas.** Add state + handlers + import + render:
```ts
import LookupMatchPicker from '~/components/vue-canvas/LookupMatchPicker.vue'
const lookupPicker = ref<{ sourceId: string; driverId: string; foreign: any[]; local: any[]; anchor: { x: number; y: number } } | null>(null)
function applyLookupMatch(v: { matchLocal: string; matchForeign: string }) {
  const p = lookupPicker.value; lookupPicker.value = null
  if (!p) return
  const driver = collectionDataOf(p.driverId); if (!driver) return
  if (!Array.isArray(driver.links)) driver.links = []
  driver.links = reconcileLinks(
    driver.links.filter((l: any) => l.collectionId !== p.sourceId).concat([{ collectionId: p.sourceId, ...v }]),
    lookupSourceIds(p.driverId),
    () => null,
  )
}
function cancelLookupMatch() {
  const p = lookupPicker.value; lookupPicker.value = null
  if (!p) return
  // Remove the just-drawn edge — the user backed out of matching.
  const drop = (edges.value as any[]).filter(e => String(e.source) === p.sourceId && String(e.target) === p.driverId && e?.data?.dataType === LOOKUP_TYPE)
  if (drop.length) removeEdges(drop.map(e => e.id))
}
```
Render near the `<PortIntentPopover>` in the template:
```html
    <LookupMatchPicker v-if="lookupPicker" :foreign="lookupPicker.foreign" :local="lookupPicker.local"
      :anchor="lookupPicker.anchor" @apply="applyLookupMatch" @close="cancelLookupMatch" />
```

- [ ] **Step 3: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -E "LookupMatchPicker|VueNodeCanvas"` (stash-compare, zero new).
- [ ] **Step 4: Commit** — `git add frontend/app/components/vue-canvas/LookupMatchPicker.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue && git commit -m "feat(variables): lookup match-column picker"` (+ trailer).

**MANUAL CHECKLIST (human):** Draw a LOOKUP edge between two collections with NO shared key column → the picker appears; pick the two key columns → link registered. Cancel → edge removed, no link.

---

## Out of scope (Slice 3)

Driver drawer linked columns, studio "Bind to" `effectiveColumns`, threading the `LookupResolver` through preview/run/unbind/GridPropertyPanel, live preview + batch run.
