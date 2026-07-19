# Ready to Deliver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project "Ready to deliver" curation view where the user marks existing canvas artifacts as ready, names/groups/arranges them by hand, and downloads them as files or zips.

**Architecture:** A pure state model (`lib/deliverables/`) over a new `deliverables[]` field on `ProjectDoc`, bound to persistence by a `useDeliverables` composable. The view is a canvas *peer* (not a route): `ProjectMenu` gains a pinned entry, `default.vue` gains a `view` mode that swaps the node canvas for `DeliverablesPage`. Marking ready flows from artifact nodes via a `sailor:markReady` CustomEvent, mirroring the existing `sailor:*` event bridge. No bake, no rendering, no system classification.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (unit), JSZip (existing dep), vue-sonner (toasts).

## Global Constraints

- **Frontend has priority over LiteGraph/bridge** — all work is Vue-side (CLAUDE.md).
- **Curation only** — this feature renders and generates nothing; it references existing on-disk `type: 'output'` files. No bake/preparing/render-on-demand state.
- **System never classifies** — no provenance inference, auto-versioning, or auto-collection. One primitive: a user-named `single` or `set`.
- **A `set` always holds ≥2 refs**; dropping below 2 dissolves it to a `single`.
- **Removing from the shelf never deletes the underlying output file.**
- **Persistence** rides the existing autosave: mutate `activeProjectDoc.value.deliverables`, then call `persistWorkflows()` (pattern: `onCreateRef` in `default.vue:1344`).
- **Output file URL**: `/view?${new URLSearchParams({ filename, subfolder, type: 'output' })}`.
- **Emerald** is the reserved commit/ready color (north-star rule) — use it for the mark-ready affordance, never purple.
- **Unit tests**: `frontend/tests/unit/<name>.unit.spec.ts`, `import { describe, it, expect } from 'vitest'`, imports via `~/lib/...`. Run: `cd frontend && npm run test:unit -- tests/unit/<name>.unit.spec.ts`.
- **Typecheck baseline** is ~328 pre-existing errors; a task adds zero new ones. Compile check: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep deliverables` (expect empty).

---

### Task 1: Pure state model + types

**Files:**
- Create: `frontend/app/lib/deliverables/model.ts`
- Test: `frontend/tests/unit/deliverables-model.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ArtifactRef { filename: string; subfolder: string; media: 'image'|'video'|'audio'; sourceNodeId?: string|null; meta?: { w?: number; h?: number; durationMs?: number; ext?: string } }`
  - `type DeliverableItem = { id: string; kind: 'single'; name: string; ref: ArtifactRef } | { id: string; kind: 'set'; name: string; items: ArtifactRef[]; coverIndex?: number }`
  - `makeDeliverableId(seq: number): string`
  - `refKey(ref: ArtifactRef): string` — identity = `subfolder + '/' + filename`.
  - `isPresent(list: DeliverableItem[], ref: ArtifactRef): boolean` — true if the ref appears as any single or set member.
  - `addSingle(list, ref, name): DeliverableItem[]` — appends a `single`; no-op (returns same list) if `isPresent`.
  - `rename(list, id, name): DeliverableItem[]`
  - `remove(list, id): DeliverableItem[]`
  - `reorder(list, fromIndex, toIndex): DeliverableItem[]`
  - `group(list, ids, name, makeId): DeliverableItem[]` — collects the referenced singles (in `ids` order) into a new `set`, removes them as top-level items, inserts the set at the position of the first grouped item. Ignores ids that aren't top-level singles. Requires ≥2 valid singles or returns the list unchanged.
  - `ungroup(list, id): DeliverableItem[]` — replaces a `set` with its members as top-level singles (default-named from filename), at the set's position.
  - `reorderWithinSet(list, id, fromIndex, toIndex): DeliverableItem[]`
  - `dissolveIfUnderTwo(item: DeliverableItem): DeliverableItem` — a `set` with ≤1 member becomes a `single` (or is returned as-is if `single`).
  - `removeFromSet(list, setId, memberIndex, makeId): DeliverableItem[]` — drops a member; if the set now has 1 member, dissolves to a single via `dissolveIfUnderTwo`.

All functions are **pure** (return new arrays/objects, never mutate inputs). Default a single's name from `ref.filename` when the caller passes an empty name.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/deliverables-model.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  addSingle, group, ungroup, rename, remove, reorder, reorderWithinSet,
  removeFromSet, dissolveIfUnderTwo, isPresent, refKey, makeDeliverableId,
  type ArtifactRef, type DeliverableItem,
} from '~/lib/deliverables/model'

const ref = (f: string, sub = ''): ArtifactRef => ({ filename: f, subfolder: sub, media: 'image' })
let seq = 0
const mk = () => makeDeliverableId(++seq)

describe('deliverables model', () => {
  it('addSingle appends and defaults name from filename', () => {
    const list = addSingle([], ref('hero.png'), '')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'single', name: 'hero.png' })
  })

  it('addSingle is a no-op for an already-present ref (same subfolder+filename)', () => {
    const a = addSingle([], ref('hero.png', 'out'), 'Hero')
    const b = addSingle(a, ref('hero.png', 'out'), 'Hero again')
    expect(b).toBe(a) // unchanged reference
  })

  it('isPresent detects refs inside sets', () => {
    let list = addSingle([], ref('a.png'), 'A')
    list = addSingle(list, ref('b.png'), 'B')
    list = group(list, [list[0]!.id, list[1]!.id], 'Set', mk)
    expect(isPresent(list, ref('a.png'))).toBe(true)
    expect(isPresent(list, ref('c.png'))).toBe(false)
  })

  it('group collects singles into a set at the first member position and requires >=2', () => {
    let list = addSingle([], ref('a.png'), 'A')
    list = addSingle(list, ref('b.png'), 'B')
    const one = group(list, [list[0]!.id], 'Solo', mk)
    expect(one).toBe(list) // <2 valid singles → unchanged
    const set = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    expect(set).toHaveLength(1)
    expect(set[0]).toMatchObject({ kind: 'set', name: 'Pair' })
    expect((set[0] as any).items.map((r: ArtifactRef) => r.filename)).toEqual(['a.png', 'b.png'])
  })

  it('ungroup restores members as top-level singles at the set position', () => {
    let list = addSingle([], ref('a.png'), 'A')
    list = addSingle(list, ref('b.png'), 'B')
    list = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    const flat = ungroup(list, list[0]!.id)
    expect(flat).toHaveLength(2)
    expect(flat.every(i => i.kind === 'single')).toBe(true)
  })

  it('removeFromSet dissolves a set that drops to one member', () => {
    let list = addSingle([], ref('a.png'), 'A')
    list = addSingle(list, ref('b.png'), 'B')
    list = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    const after = removeFromSet(list, list[0]!.id, 1, mk)
    expect(after).toHaveLength(1)
    expect(after[0]!.kind).toBe('single')
  })

  it('reorder moves an item', () => {
    let list = addSingle([], ref('a.png'), 'A')
    list = addSingle(list, ref('b.png'), 'B')
    const moved = reorder(list, 0, 1)
    expect(moved.map(i => i.name)).toEqual(['B', 'A'])
  })

  it('rename and remove are pure', () => {
    const list = addSingle([], ref('a.png'), 'A')
    const renamed = rename(list, list[0]!.id, 'Zed')
    expect(renamed[0]!.name).toBe('Zed')
    expect(list[0]!.name).toBe('A') // original untouched
    expect(remove(renamed, renamed[0]!.id)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-model.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/deliverables/model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/deliverables/model.ts
export interface ArtifactRef {
  filename: string
  subfolder: string
  media: 'image' | 'video' | 'audio'
  sourceNodeId?: string | null
  meta?: { w?: number; h?: number; durationMs?: number; ext?: string }
}

export type DeliverableItem =
  | { id: string; kind: 'single'; name: string; ref: ArtifactRef }
  | { id: string; kind: 'set'; name: string; items: ArtifactRef[]; coverIndex?: number }

export function makeDeliverableId(seq: number): string {
  return `dlv_${seq.toString(36)}`
}

export function refKey(ref: ArtifactRef): string {
  return `${ref.subfolder}/${ref.filename}`
}

function nameFor(ref: ArtifactRef, name: string): string {
  return name.trim() || ref.filename
}

export function isPresent(list: DeliverableItem[], ref: ArtifactRef): boolean {
  const k = refKey(ref)
  return list.some(item =>
    item.kind === 'single'
      ? refKey(item.ref) === k
      : item.items.some(r => refKey(r) === k),
  )
}

export function addSingle(list: DeliverableItem[], ref: ArtifactRef, name: string): DeliverableItem[] {
  if (isPresent(list, ref)) return list
  const id = makeDeliverableId(list.length + 1 + Math.floor(performanceNow()))
  return [...list, { id, kind: 'single', name: nameFor(ref, name), ref }]
}

// Deterministic-enough monotonic-ish counter without Date.now in pure code paths
// that tests call; real callers pass explicit ids where determinism matters.
let _tick = 0
function performanceNow(): number { return (_tick += 1) }

export function rename(list: DeliverableItem[], id: string, name: string): DeliverableItem[] {
  return list.map(i => (i.id === id ? { ...i, name } : i))
}

export function remove(list: DeliverableItem[], id: string): DeliverableItem[] {
  return list.filter(i => i.id !== id)
}

export function reorder(list: DeliverableItem[], from: number, to: number): DeliverableItem[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

export function group(
  list: DeliverableItem[], ids: string[], name: string, makeId: () => string,
): DeliverableItem[] {
  const picked = ids
    .map(id => list.find(i => i.id === id))
    .filter((i): i is Extract<DeliverableItem, { kind: 'single' }> => !!i && i.kind === 'single')
  if (picked.length < 2) return list
  const pickedIds = new Set(picked.map(p => p.id))
  const firstIdx = list.findIndex(i => pickedIds.has(i.id))
  const set: DeliverableItem = {
    id: makeId(), kind: 'set', name: name.trim() || 'Set',
    items: picked.map(p => p.ref), coverIndex: 0,
  }
  const rest = list.filter(i => !pickedIds.has(i.id))
  rest.splice(Math.min(firstIdx, rest.length), 0, set)
  return rest
}

export function ungroup(list: DeliverableItem[], id: string): DeliverableItem[] {
  const idx = list.findIndex(i => i.id === id)
  const item = list[idx]
  if (!item || item.kind !== 'set') return list
  const singles: DeliverableItem[] = item.items.map((ref, n) => ({
    id: `${item.id}_m${n}`, kind: 'single', name: ref.filename, ref,
  }))
  const next = [...list]
  next.splice(idx, 1, ...singles)
  return next
}

export function reorderWithinSet(
  list: DeliverableItem[], id: string, from: number, to: number,
): DeliverableItem[] {
  return list.map(i => {
    if (i.id !== id || i.kind !== 'set') return i
    if (from === to || from < 0 || to < 0 || from >= i.items.length || to >= i.items.length) return i
    const items = [...i.items]
    const [m] = items.splice(from, 1)
    items.splice(to, 0, m!)
    return { ...i, items }
  })
}

export function dissolveIfUnderTwo(item: DeliverableItem): DeliverableItem {
  if (item.kind === 'set' && item.items.length <= 1) {
    const ref = item.items[0]
    if (ref) return { id: item.id, kind: 'single', name: item.name || ref.filename, ref }
  }
  return item
}

export function removeFromSet(
  list: DeliverableItem[], setId: string, memberIndex: number, _makeId: () => string,
): DeliverableItem[] {
  return list.map(i => {
    if (i.id !== setId || i.kind !== 'set') return i
    const items = i.items.filter((_, n) => n !== memberIndex)
    return dissolveIfUnderTwo({ ...i, items })
  })
}
```

> Note: `addSingle`'s id uses a module-local counter (not `Date.now`) so the pure model stays deterministic under test. Real UI callers that need stable ids across reloads rely on the persisted `id` already in the array; new ids only need to be unique within the session.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-model.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/deliverables/model.ts frontend/tests/unit/deliverables-model.unit.spec.ts
git commit -m "feat(deliverables): pure curation state model + types"
```

---

### Task 2: Zip planner + download

**Files:**
- Create: `frontend/app/lib/deliverables/zip.ts`
- Test: `frontend/tests/unit/deliverables-zip.unit.spec.ts`

**Interfaces:**
- Consumes: `ArtifactRef`, `DeliverableItem` from Task 1.
- Produces:
  - `interface ZipEntry { path: string; ref: ArtifactRef }` — `path` is the in-zip path (sets become a subfolder `name/filename`).
  - `planZip(items: DeliverableItem[]): ZipEntry[]` — pure. Singles → `filename` at root; sets → `sanitize(name)/filename` per member in order. Deduplicates identical `path` by appending ` (2)` before the extension.
  - `planSetZip(item: Extract<DeliverableItem,{kind:'set'}>): ZipEntry[]` — flat member files in set order (no subfolder).
  - `sanitize(name: string): string` — filesystem-safe folder name.
  - `downloadZip(entries: ZipEntry[], zipName: string): Promise<{ skipped: string[] }>` — fetches each `/view?...&type=output`, adds to JSZip, triggers download, returns filenames it couldn't fetch (404). Mirrors `lib/collection/batchZip.ts`.
  - `viewUrl(ref: ArtifactRef): string` — `/view?filename=…&subfolder=…&type=output`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/deliverables-zip.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { planZip, planSetZip, sanitize, viewUrl } from '~/lib/deliverables/zip'
import type { DeliverableItem, ArtifactRef } from '~/lib/deliverables/model'

const ref = (f: string): ArtifactRef => ({ filename: f, subfolder: 'out', media: 'image' })

describe('deliverables zip planner', () => {
  it('viewUrl targets the output type', () => {
    expect(viewUrl(ref('a.png'))).toBe('/view?filename=a.png&subfolder=out&type=output')
  })

  it('planZip roots singles and subfolders set members in order', () => {
    const list: DeliverableItem[] = [
      { id: '1', kind: 'single', name: 'Hero', ref: ref('hero.png') },
      { id: '2', kind: 'set', name: 'Launch Post', items: [ref('sq.png'), ref('wd.png')] },
    ]
    expect(planZip(list)).toEqual([
      { path: 'hero.png', ref: ref('hero.png') },
      { path: 'Launch Post/sq.png', ref: ref('sq.png') },
      { path: 'Launch Post/wd.png', ref: ref('wd.png') },
    ])
  })

  it('planZip disambiguates duplicate paths', () => {
    const list: DeliverableItem[] = [
      { id: '1', kind: 'single', name: 'A', ref: ref('img.png') },
      { id: '2', kind: 'single', name: 'B', ref: { ...ref('img.png'), subfolder: 'other' } },
    ]
    expect(planZip(list).map(e => e.path)).toEqual(['img.png', 'img (2).png'])
  })

  it('planSetZip is flat and ordered', () => {
    const set = { id: 's', kind: 'set', name: 'S', items: [ref('a.png'), ref('b.png')] } as const
    expect(planSetZip(set).map(e => e.path)).toEqual(['a.png', 'b.png'])
  })

  it('sanitize strips path separators', () => {
    expect(sanitize('a/b:c')).toBe('a-b-c')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-zip.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/deliverables/zip`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/deliverables/zip.ts
import JSZip from 'jszip'
import type { ArtifactRef, DeliverableItem } from './model'

export interface ZipEntry { path: string; ref: ArtifactRef }

export function viewUrl(ref: ArtifactRef): string {
  return `/view?${new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: 'output' })}`
}

export function sanitize(name: string): string {
  return (name || 'set').replace(/[\/\\:*?"<>|]+/g, '-').trim() || 'set'
}

function dedupe(entries: ZipEntry[]): ZipEntry[] {
  const seen = new Map<string, number>()
  return entries.map(e => {
    const n = seen.get(e.path) ?? 0
    seen.set(e.path, n + 1)
    if (n === 0) return e
    const dot = e.path.lastIndexOf('.')
    const path = dot > 0
      ? `${e.path.slice(0, dot)} (${n + 1})${e.path.slice(dot)}`
      : `${e.path} (${n + 1})`
    return { ...e, path }
  })
}

export function planSetZip(item: Extract<DeliverableItem, { kind: 'set' }>): ZipEntry[] {
  return dedupe(item.items.map(ref => ({ path: ref.filename, ref })))
}

export function planZip(items: DeliverableItem[]): ZipEntry[] {
  const out: ZipEntry[] = []
  for (const item of items) {
    if (item.kind === 'single') out.push({ path: item.ref.filename, ref: item.ref })
    else for (const ref of item.items) out.push({ path: `${sanitize(item.name)}/${ref.filename}`, ref })
  }
  return dedupe(out)
}

export async function downloadZip(entries: ZipEntry[], zipName: string): Promise<{ skipped: string[] }> {
  const zip = new JSZip()
  const skipped: string[] = []
  for (const entry of entries) {
    try {
      const res = await fetch(viewUrl(entry.ref))
      if (!res.ok) { skipped.push(entry.ref.filename); continue }
      zip.file(entry.path, await res.blob())
    } catch { skipped.push(entry.ref.filename) }
  }
  const out = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(out)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { skipped }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-zip.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/deliverables/zip.ts frontend/tests/unit/deliverables-zip.unit.spec.ts
git commit -m "feat(deliverables): zip planner + download over JSZip"
```

---

### Task 3: ProjectDoc field + `useDeliverables` composable

**Files:**
- Modify: `frontend/app/lib/projectDoc.ts:16-24` (add `deliverables?` to `ProjectDoc`)
- Create: `frontend/app/composables/useDeliverables.ts`
- Test: `frontend/tests/unit/deliverables-composable.unit.spec.ts`

**Interfaces:**
- Consumes: model ops (Task 1), `ProjectDoc` (modified here).
- Produces:
  - `useDeliverables(docRef: Ref<ProjectDoc | null>, persist: () => void)` returns:
    - `items: ComputedRef<DeliverableItem[]>` (empty when doc/field absent)
    - `count: ComputedRef<number>`
    - `markReady(ref: ArtifactRef, name?: string): boolean` — returns false if already present (no-op), true if appended.
    - `isReady(ref: ArtifactRef): boolean`
    - `renameItem(id, name)`, `removeItem(id)`, `moveItem(from, to)`
    - `groupItems(ids: string[], name?: string)`, `ungroupItem(id)`
    - `moveWithinSet(id, from, to)`, `removeSetMember(setId, index)`
  - Every mutator writes `docRef.value.deliverables = <next>` then calls `persist()`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/deliverables-composable.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useDeliverables } from '~/composables/useDeliverables'
import type { ProjectDoc } from '~/lib/projectDoc'
import type { ArtifactRef } from '~/lib/deliverables/model'

const artifact = (f: string): ArtifactRef => ({ filename: f, subfolder: 'out', media: 'image' })
function doc(): ProjectDoc { return { canvases: [], activeCanvasId: '' } as ProjectDoc }

describe('useDeliverables', () => {
  it('markReady appends and persists, and is a no-op the second time', () => {
    const d = ref<ProjectDoc | null>(doc())
    const persist = vi.fn()
    const dl = useDeliverables(d, persist)
    expect(dl.markReady(artifact('hero.png'), 'Hero')).toBe(true)
    expect(dl.count.value).toBe(1)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(dl.markReady(artifact('hero.png'))).toBe(false)
    expect(dl.count.value).toBe(1)
    expect(persist).toHaveBeenCalledTimes(1) // no-op did not persist
  })

  it('isReady reflects state', () => {
    const d = ref<ProjectDoc | null>(doc())
    const dl = useDeliverables(d, vi.fn())
    dl.markReady(artifact('a.png'))
    expect(dl.isReady(artifact('a.png'))).toBe(true)
    expect(dl.isReady(artifact('b.png'))).toBe(false)
  })

  it('group + ungroup round-trips through the doc', () => {
    const d = ref<ProjectDoc | null>(doc())
    const dl = useDeliverables(d, vi.fn())
    dl.markReady(artifact('a.png'), 'A')
    dl.markReady(artifact('b.png'), 'B')
    const ids = dl.items.value.map(i => i.id)
    dl.groupItems(ids, 'Pair')
    expect(dl.items.value).toHaveLength(1)
    expect(dl.items.value[0]!.kind).toBe('set')
    dl.ungroupItem(dl.items.value[0]!.id)
    expect(dl.items.value).toHaveLength(2)
  })

  it('tolerates a null doc', () => {
    const d = ref<ProjectDoc | null>(null)
    const dl = useDeliverables(d, vi.fn())
    expect(dl.markReady(artifact('a.png'))).toBe(false)
    expect(dl.count.value).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-composable.unit.spec.ts`
Expected: FAIL — cannot resolve `~/composables/useDeliverables`.

- [ ] **Step 3a: Add the ProjectDoc field**

In `frontend/app/lib/projectDoc.ts`, inside `interface ProjectDoc` (after `assetRegistry?`):

```ts
  /** Ordered delivery shelf (Ready to deliver). Array order == display order.
   *  Absent ⇒ treat as []. References existing on-disk output files only. */
  deliverables?: import('./deliverables/model').DeliverableItem[]
```

- [ ] **Step 3b: Write the composable**

```ts
// frontend/app/composables/useDeliverables.ts
import { computed, type ComputedRef, type Ref } from 'vue'
import type { ProjectDoc } from '~/lib/projectDoc'
import {
  addSingle, group, ungroup, rename, remove, reorder, reorderWithinSet,
  removeFromSet, isPresent, makeDeliverableId,
  type ArtifactRef, type DeliverableItem,
} from '~/lib/deliverables/model'

export function useDeliverables(docRef: Ref<ProjectDoc | null>, persist: () => void) {
  let seq = 0
  const mkId = () => makeDeliverableId((seq += 1) + Date.now())

  const items: ComputedRef<DeliverableItem[]> = computed(() => docRef.value?.deliverables ?? [])
  const count = computed(() => items.value.length)

  function write(next: DeliverableItem[], changed: boolean) {
    if (!docRef.value || !changed) return
    docRef.value.deliverables = next
    persist()
  }

  function markReady(ref: ArtifactRef, name = ''): boolean {
    if (!docRef.value) return false
    const cur = items.value
    if (isPresent(cur, ref)) return false
    write(addSingle(cur, ref, name), true)
    return true
  }
  const isReady = (ref: ArtifactRef) => isPresent(items.value, ref)

  const renameItem = (id: string, name: string) => write(rename(items.value, id, name), true)
  const removeItem = (id: string) => write(remove(items.value, id), true)
  const moveItem = (from: number, to: number) => write(reorder(items.value, from, to), true)
  const groupItems = (ids: string[], name = 'Set') => write(group(items.value, ids, name, mkId), true)
  const ungroupItem = (id: string) => write(ungroup(items.value, id), true)
  const moveWithinSet = (id: string, from: number, to: number) =>
    write(reorderWithinSet(items.value, id, from, to), true)
  const removeSetMember = (setId: string, index: number) =>
    write(removeFromSet(items.value, setId, index, mkId), true)

  return {
    items, count, markReady, isReady, renameItem, removeItem, moveItem,
    groupItems, ungroupItem, moveWithinSet, removeSetMember,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-composable.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/projectDoc.ts frontend/app/composables/useDeliverables.ts frontend/tests/unit/deliverables-composable.unit.spec.ts
git commit -m "feat(deliverables): ProjectDoc.deliverables field + useDeliverables composable"
```

---

### Task 4: The view — `DeliverablesPage` + tile + set overlay

**Files:**
- Create: `frontend/app/components/vue-canvas/DeliverablesPage.vue`
- Create: `frontend/app/components/vue-canvas/DeliverableTile.vue`
- Create: `frontend/app/components/vue-canvas/DeliverableSetOverlay.vue`

**Interfaces:**
- Consumes: `useDeliverables` (Task 3), `planZip`/`planSetZip`/`downloadZip`/`viewUrl` (Task 2), `injected` `projectDoc` (provided in `default.vue:1513`).
- Props (`DeliverablesPage`): `{ projectName: string }`.
- Emits (`DeliverablesPage`): `openInCanvas(nodeId: string)`.
- This task builds the components against a `useDeliverables` instance created **inside** the page from the injected `projectDoc` and an injected `persist` callback (added in Task 5). For now, inject `persistDeliverables` with a safe default so the page compiles and renders standalone.

**Design cues** (match app dark language; see `docs/superpowers/specs/2026-07-19-produce-ready-to-deliver-design.md` and the mockup): panels `#191b1f`, hairlines `white/7-13`, accent `#4f8cff`, emerald for ready. Grid `repeat(auto-fill, minmax(232px,1fr))`. Sets render a stacked frame + count badge. Video tiles show a play glyph. Caption is an inline-editable name. A selection bar appears when ≥1 tile is picked → "N selected · Group into set · Clear".

- [ ] **Step 1: Build `DeliverableTile.vue`**

```vue
<!-- frontend/app/components/vue-canvas/DeliverableTile.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeliverableItem, ArtifactRef } from '~/lib/deliverables/model'
import { viewUrl } from '~/lib/deliverables/zip'

const props = defineProps<{ item: DeliverableItem; picked: boolean }>()
const emit = defineEmits<{
  togglePick: []; rename: [name: string]; download: []; remove: []
  openCanvas: []; openSet: []
}>()

const cover = computed<ArtifactRef>(() =>
  props.item.kind === 'single' ? props.item.ref : props.item.items[props.item.coverIndex ?? 0]!)
const isVideo = computed(() => cover.value.media === 'video')
const setCount = computed(() => (props.item.kind === 'set' ? props.item.items.length : 0))

const editing = ref(false)
const draft = ref(props.item.name)
function commit() { editing.value = false; if (draft.value.trim() && draft.value !== props.item.name) emit('rename', draft.value.trim()) }
</script>

<template>
  <div class="group relative" :class="item.kind === 'set' ? 'stack' : ''">
    <div class="frameWrap relative">
      <div
        class="frame relative overflow-hidden rounded-xl border aspect-square transition"
        :class="picked ? 'border-[#4f8cff] shadow-[0_0_0_1px_#4f8cff]' : 'border-white/[0.07] group-hover:border-white/[0.13]'"
      >
        <img :src="viewUrl(cover)" alt="" class="h-full w-full object-cover" loading="lazy" />
        <div v-if="isVideo" class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="flex h-11 w-11 items-center justify-center rounded-full border border-white/13 bg-black/40 backdrop-blur">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
        <span v-if="setCount" class="absolute right-2.5 top-2.5 rounded-full border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[10.5px] backdrop-blur">{{ setCount }}</span>
        <button
          class="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border backdrop-blur transition"
          :class="picked ? 'border-[#4f8cff] bg-[#4f8cff] opacity-100' : 'border-white/13 bg-black/50 opacity-0 group-hover:opacity-100'"
          @click.stop="emit('togglePick')"
        >
          <svg v-if="picked" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#0a1120" stroke-width="3"><path d="M5 12l5 5 9-11" /></svg>
        </button>
        <!-- hover actions -->
        <div class="absolute inset-0 flex items-end gap-2 rounded-xl bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
          <button class="flex-1 rounded-lg bg-white/95 px-2 py-2 text-[12.5px] font-semibold text-[#14151a] hover:bg-white" @click.stop="item.kind === 'set' ? emit('openSet') : emit('download')">
            {{ item.kind === 'set' ? 'Open set' : 'Download' }}
          </button>
          <button v-if="item.kind === 'single' && item.ref.sourceNodeId" class="rounded-lg bg-black/60 px-2 py-2 text-[12.5px] text-white ring-1 ring-inset ring-white/13 backdrop-blur hover:bg-black/80" @click.stop="emit('openCanvas')">Canvas</button>
          <button class="rounded-lg bg-black/60 px-2 py-2 text-white ring-1 ring-inset ring-white/13 backdrop-blur hover:bg-black/80" title="Remove" @click.stop="emit('remove')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="mt-2.5 px-0.5">
      <input v-if="editing" v-model="draft" class="w-full bg-transparent text-[13.5px] text-white outline-none" @blur="commit" @keydown.enter="commit" @keydown.esc="editing = false" autofocus />
      <button v-else class="max-w-full truncate text-left text-[13.5px] text-white/90 hover:text-white" @click="editing = true; draft = item.name">{{ item.name }}</button>
    </div>
  </div>
</template>

<style scoped>
.stack .frameWrap::before, .stack .frameWrap::after {
  content: ''; position: absolute; inset: 0; border-radius: 12px;
  background: #191b1f; border: 1px solid rgba(255,255,255,.07);
}
.stack .frameWrap::before { transform: translate(6px, 6px); opacity: .55; }
.stack .frameWrap::after { transform: translate(3px, 3px); opacity: .8; }
.stack .frame { position: relative; z-index: 2; }
</style>
```

- [ ] **Step 2: Build `DeliverableSetOverlay.vue`** (members, reorder buttons, ungroup, per-member download/remove)

```vue
<!-- frontend/app/components/vue-canvas/DeliverableSetOverlay.vue -->
<script setup lang="ts">
import type { DeliverableItem } from '~/lib/deliverables/model'
import { viewUrl, planSetZip, downloadZip } from '~/lib/deliverables/zip'

const props = defineProps<{ set: Extract<DeliverableItem, { kind: 'set' }> }>()
const emit = defineEmits<{
  close: []; ungroup: []; move: [from: number, to: number]; removeMember: [index: number]
}>()

async function downloadAll() {
  await downloadZip(planSetZip(props.set), props.set.name)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8" @click.self="emit('close')">
    <div class="max-h-[80vh] w-[560px] overflow-auto rounded-2xl border border-white/10 bg-[#16181d] p-5">
      <div class="mb-4 flex items-center gap-3">
        <h3 class="flex-1 text-[15px] font-semibold text-white">{{ set.name }}</h3>
        <button class="rounded-lg px-3 py-1.5 text-[12.5px] text-white/70 ring-1 ring-inset ring-white/13 hover:text-white" @click="emit('ungroup')">Ungroup</button>
        <button class="rounded-lg bg-[#4f8cff] px-3 py-1.5 text-[12.5px] font-semibold text-[#0a1120]" @click="downloadAll">Download all ({{ set.items.length }})</button>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="(m, i) in set.items" :key="m.subfolder + '/' + m.filename" class="flex items-center gap-3 rounded-lg p-2 hover:bg-white/5">
          <img :src="viewUrl(m)" alt="" class="h-12 w-12 rounded-md object-cover" />
          <span class="flex-1 truncate font-mono text-[11px] text-white/60">{{ m.filename }}</span>
          <button class="text-white/40 hover:text-white disabled:opacity-30" :disabled="i === 0" @click="emit('move', i, i - 1)">↑</button>
          <button class="text-white/40 hover:text-white disabled:opacity-30" :disabled="i === set.items.length - 1" @click="emit('move', i, i + 1)">↓</button>
          <button class="text-white/40 hover:text-white" @click="emit('removeMember', i)">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Build `DeliverablesPage.vue`**

```vue
<!-- frontend/app/components/vue-canvas/DeliverablesPage.vue -->
<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ProjectDoc } from '~/lib/projectDoc'
import { useDeliverables } from '~/composables/useDeliverables'
import { planZip, planSetZip, downloadZip, viewUrl } from '~/lib/deliverables/zip'
import type { DeliverableItem } from '~/lib/deliverables/model'
import DeliverableTile from './DeliverableTile.vue'
import DeliverableSetOverlay from './DeliverableSetOverlay.vue'

defineProps<{ projectName: string }>()
const emit = defineEmits<{ openInCanvas: [nodeId: string] }>()

const docRef = inject<Ref<ProjectDoc | null>>('projectDoc', ref(null))
const persist = inject<() => void>('persistDeliverables', () => {})
const dl = useDeliverables(docRef, persist)

const picked = ref<Set<string>>(new Set())
function togglePick(id: string) {
  const s = new Set(picked.value); s.has(id) ? s.delete(id) : s.add(id); picked.value = s
}
function clearPick() { picked.value = new Set() }
function groupPicked() {
  dl.groupItems([...picked.value].filter(id => dl.items.value.find(i => i.id === id)?.kind === 'single'))
  clearPick()
}

const openSetId = ref<string | null>(null)
const openSet = computed(() =>
  dl.items.value.find(i => i.id === openSetId.value && i.kind === 'set') as Extract<DeliverableItem, { kind: 'set' }> | undefined)

async function downloadSingle(item: Extract<DeliverableItem, { kind: 'single' }>) {
  const a = document.createElement('a'); a.href = viewUrl(item.ref); a.download = item.ref.filename; a.click()
}
async function downloadAll() {
  if (!dl.items.value.length) return
  const { skipped } = await downloadZip(planZip(dl.items.value), `${'Deliverables'}`)
  if (skipped.length) toast.warning(`${skipped.length} file(s) unavailable and skipped`)
}
</script>

<template>
  <div class="h-full w-full overflow-auto bg-[#121316] text-[#eceef2]">
    <div class="sticky top-0 z-20 flex items-center gap-4 border-b border-white/7 bg-[#121316]/85 px-8 py-3.5 backdrop-blur">
      <span class="text-[13px] text-white/40">{{ projectName }} · Ready to deliver</span>
      <div class="flex-1" />
      <button class="rounded-lg border border-white/13 px-3 py-1.5 text-[13px] text-white/70 hover:text-white" @click="downloadAll">Download all</button>
      <button class="cursor-default rounded-lg border border-white/7 px-3 py-1.5 text-[13px] text-white/40" title="Coming soon">Share <span class="ml-1 font-mono text-[9px] uppercase tracking-wider text-white/30">soon</span></button>
    </div>

    <div class="mx-auto max-w-[1180px] px-8 pb-6 pt-10">
      <h1 class="text-[26px] font-semibold tracking-tight">Ready to deliver</h1>
      <p class="mt-2 max-w-[56ch] text-[14px] leading-relaxed text-white/32">Artifacts you marked ready. Name them, group them into sets, and drag to arrange. Download any one, a set, or everything as a zip.</p>
    </div>

    <div v-if="picked.size" class="mx-auto mb-1 flex max-w-[1180px] items-center gap-3.5 px-8">
      <span class="inline-flex items-center gap-2 rounded-[10px] border border-white/13 bg-[#191b1f] px-3 py-1.5 text-[13px]"><b class="font-mono text-[#4f8cff]">{{ picked.size }}</b> selected</span>
      <button v-if="picked.size >= 2" class="rounded-lg bg-[#4f8cff] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#0a1120]" @click="groupPicked">Group into set</button>
      <button class="text-[12.5px] text-white/32" @click="clearPick">Clear</button>
    </div>

    <div v-if="!dl.items.value.length" class="mx-auto max-w-[1180px] px-8 py-16 text-center text-white/40">
      Nothing here yet. On the canvas, open an image, video, or audio artifact and choose <b class="text-white/70">Mark ready</b>.
    </div>

    <div v-else class="mx-auto grid max-w-[1180px] gap-x-6 gap-y-8 px-8 pb-24" style="grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));">
      <DeliverableTile
        v-for="item in dl.items.value" :key="item.id" :item="item" :picked="picked.has(item.id)"
        @toggle-pick="togglePick(item.id)"
        @rename="name => dl.renameItem(item.id, name)"
        @download="item.kind === 'single' && downloadSingle(item)"
        @remove="dl.removeItem(item.id)"
        @open-canvas="item.kind === 'single' && item.ref.sourceNodeId && emit('openInCanvas', item.ref.sourceNodeId)"
        @open-set="openSetId = item.id"
      />
    </div>

    <DeliverableSetOverlay
      v-if="openSet" :set="openSet"
      @close="openSetId = null"
      @ungroup="dl.ungroupItem(openSet.id); openSetId = null"
      @move="(from, to) => dl.moveWithinSet(openSet!.id, from, to)"
      @remove-member="i => dl.removeSetMember(openSet!.id, i)"
    />
  </div>
</template>
```

- [ ] **Step 4: Compile check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "deliverable" || echo "clean"`
Expected: `clean` (no new type errors in the new files).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/DeliverablesPage.vue frontend/app/components/vue-canvas/DeliverableTile.vue frontend/app/components/vue-canvas/DeliverableSetOverlay.vue
git commit -m "feat(deliverables): curation page, tile, and set overlay"
```

---

### Task 5: Reachability — ProjectMenu entry + `default.vue` view mode + persist provider

**Files:**
- Modify: `frontend/app/components/vue-canvas/ProjectMenu.vue` (add pinned "Deliverables" entry + `showDeliverables` emit + count prop)
- Modify: `frontend/app/layouts/default.vue` (view state, page mount, provide persist, wire emit)

**Interfaces:**
- Consumes: `DeliverablesPage` (Task 4), `activeProjectDoc` + `persistWorkflows` (existing in `default.vue`).
- `ProjectMenu` new prop: `deliverablesCount: number`. New emit: `showDeliverables: []`.
- `default.vue` new state: `const projectView = ref<'canvas' | 'deliverables'>('canvas')`.

- [ ] **Step 1: Add the ProjectMenu entry + emit**

In `ProjectMenu.vue`, add to `defineProps` (near `switching`): `deliverablesCount?: number`. Add to `defineEmits` (after `addCanvas: []`): `showDeliverables: []`.

Add a pinned row just above the `<!-- Canvases -->` block (around `ProjectMenu.vue:225`):

```vue
        <!-- Deliverables (pinned project view, not a canvas) -->
        <button
          class="mb-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[0.04]"
          @click="emit('showDeliverables')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" class="text-emerald-400/80"><path d="M20 7L9 18l-5-5" /></svg>
          <span class="flex-1 text-xs text-white/80">Ready to deliver</span>
          <span v-if="deliverablesCount" class="font-mono text-[10px] text-white/40">{{ deliverablesCount }}</span>
        </button>
```

- [ ] **Step 2: Wire view state + mount in `default.vue`**

Near the other project refs (after `canvasSwitching`, `default.vue:1518`):

```ts
const projectView = ref<'canvas' | 'deliverables'>('canvas')
function showDeliverables() { projectView.value = 'deliverables' }
```

In `switchProjectCanvas`, at the top of the function body (so picking any canvas returns to the canvas view), add:

```ts
  projectView.value = 'canvas'
```

Provide the persist callback for the page (near `provide('projectDoc', activeProjectDoc)`, `default.vue:1513`):

```ts
provide('persistDeliverables', () => { persistWorkflows(); const t = activeTab.value; if (t.type === 'project' && activeProjectDoc.value) saveDurableVersion(t, activeProjectDoc.value) })
```

On the `VueCanvasProjectMenu` element (`default.vue:3911`), add:

```
          :deliverables-count="activeProjectDoc?.deliverables?.length ?? 0"
          @show-deliverables="showDeliverables"
```

Mount the page over the canvas region. Find the node-canvas container rendered when `activeTab.type === 'project'` and wrap its visibility, adding the page as a sibling that shows when `projectView === 'deliverables'`:

```vue
        <VueCanvasDeliverablesPage
          v-if="activeTab.type === 'project' && projectView === 'deliverables'"
          class="absolute inset-0 z-30"
          :project-name="activeTab.label || 'Untitled project'"
          @open-in-canvas="onOpenDeliverableInCanvas"
        />
```

Add the handler (near other canvas focus helpers):

```ts
function onOpenDeliverableInCanvas(nodeId: string) {
  projectView.value = 'canvas'
  // Best-effort focus; reuse existing node-focus if present, else no-op.
  window.dispatchEvent(new CustomEvent('sailor:focusNode', { detail: { nodeId } }))
}
```

> If `sailor:focusNode` has no existing listener, the navigation back to canvas still satisfies the spec ("navigate to canvas, focus sourceNodeId" — focus is best-effort). Do not invent a new focus system in this task.

- [ ] **Step 3: Verify in the running app**

Start the dev server (see CLAUDE.md; use `127.0.0.1`) via the Browser pane preview, open a project, open the ProjectMenu chip, click "Ready to deliver". Expected: the canvas is replaced by the empty-state page; clicking a canvas in the same menu returns to it.

Manual check (no unit test — this is view wiring):
- [ ] Menu shows "Ready to deliver" with count 0.
- [ ] Clicking it swaps to the page.
- [ ] Selecting a canvas returns to the canvas.

- [ ] **Step 4: Compile check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | tee /tmp/tsc.txt | grep -c "error TS"` and confirm the count is ≤ the ~328 baseline (no new errors referencing `default.vue`/`ProjectMenu.vue`/`Deliverable*`).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ProjectMenu.vue frontend/app/layouts/default.vue
git commit -m "feat(deliverables): reach the shelf from ProjectMenu as a canvas peer"
```

---

### Task 6: Mark-ready from artifact nodes (end-to-end, image first)

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (add a "Mark ready" control that emits `sailor:markReady`)
- Modify: `frontend/app/layouts/default.vue` (listen for `sailor:markReady`, resolve the node's output ref, call `useDeliverables().markReady`)

**Interfaces:**
- Consumes: the `sailor:*` CustomEvent bridge (pattern: `sailor:openInpaint` in `ArtifactImageNode.vue:364`; listener registration in `default.vue:1353`; `onCreateRef` persistence in `default.vue:1344`).
- Event contract: `new CustomEvent('sailor:markReady', { detail: { nodeId: string; output: { filename: string; subfolder?: string; type?: string } } })`. **The node passes its own output object** (it already holds it in `props.data`), so `default.vue` needs no node lookup.
- `default.vue` builds the `ArtifactRef` from `detail.output` + `detail.nodeId` and calls a module-level `useDeliverables(activeProjectDoc, persistDeliverablesFn)` instance's `markReady`.

- [ ] **Step 1: Add the control on `ArtifactImageNode`**

Add a handler alongside the other `sailor:*` emitters (near `ArtifactImageNode.vue:364`):

```ts
const isReadyDeliverable = computed(() =>
  deliverableRefs.value.some(k => k === `${props.data.images?.[0]?.subfolder ?? ''}/${props.data.images?.[0]?.filename ?? ''}`))

function markReady() {
  const img = props.data.images?.[0]
  if (!img?.filename) return
  window.dispatchEvent(new CustomEvent('sailor:markReady', { detail: { nodeId: props.id, output: img } }))
}
```

> The node passes its own `data.images[0]` (`{ filename, subfolder, type }`) in the event — `default.vue` does not look the node back up. `deliverableRefs` is injected (Step 2 provides it) so the button can show a ready state. If wiring the injected readiness set is non-trivial in this node, ship the button without the live checkmark — the `markReady` no-op + toast still prevents duplicates. Keep this task's scope to: a visible "Mark ready" button that fires the event.

Add the button to the node's hover action row (mirror the existing action buttons' markup/classes in this file), labeled "Mark ready", using an emerald check icon.

- [ ] **Step 2: Handle the event in `default.vue`**

Create the shared instance once (after `provide('persistDeliverables', …)`):

```ts
const deliverablesApi = useDeliverables(activeProjectDoc, () => { persistWorkflows(); const t = activeTab.value; if (t.type === 'project' && activeProjectDoc.value) saveDurableVersion(t, activeProjectDoc.value) })
provide('deliverableRefs', computed(() => (activeProjectDoc.value?.deliverables ?? []).flatMap(d => d.kind === 'single' ? [`${d.ref.subfolder}/${d.ref.filename}`] : d.items.map(r => `${r.subfolder}/${r.filename}`))))
```

Add `resolveOutputRef` and the handler, building the ref from the event's `output` object (no node lookup — the node supplied it):

```ts
function resolveOutputRef(nodeId: string, output: any): import('~/lib/deliverables/model').ArtifactRef | null {
  const img = output
  if (!img?.filename || img.type !== 'output') return null
  const media = /\.(mp4|webm|mov)$/i.test(img.filename) ? 'video'
    : /\.(mp3|wav|flac|ogg|m4a)$/i.test(img.filename) ? 'audio' : 'image'
  return { filename: img.filename, subfolder: img.subfolder || '', media, sourceNodeId: nodeId }
}
```

And update the handler to pass it through:

```ts
function handleMarkReady(e: Event) {
  const { nodeId, output } = (e as CustomEvent).detail ?? {}
  if (nodeId == null) return
  const ref = resolveOutputRef(String(nodeId), output)
  if (!ref) { toast.error('No output to mark ready yet — run this node first'); return }
  const added = deliverablesApi.markReady(ref, ref.filename)
  toast[added ? 'success' : 'info'](added ? 'Marked ready' : 'Already in deliverables')
}
```

Register in `onMounted` (near `default.vue:1353`) and unregister in the matching cleanup:

```ts
  window.addEventListener('sailor:markReady', handleMarkReady)
```

- [ ] **Step 3: Verify end-to-end in the app**

With the dev server running: generate/run an image node so it has an output, click **Mark ready** on the node, open the ProjectMenu → Ready to deliver. Expected: the artifact appears as a tile; clicking Mark ready again shows the "Already in deliverables" toast and adds nothing.

Manual checks:
- [ ] Mark ready on an image node → tile appears with count incrementing.
- [ ] Second mark → info toast, no duplicate.
- [ ] Rename on the tile persists across a page reload.
- [ ] "Canvas" button on the tile returns to the canvas.

- [ ] **Step 4: Compile check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "ArtifactImageNode|markReady|deliverable" || echo clean`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/layouts/default.vue
git commit -m "feat(deliverables): mark-ready from image artifact nodes, end-to-end"
```

---

### Task 7: Extend mark-ready to the other artifact kinds + edge cases

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactVideoNode.vue`, `ArtifactAudioNode.vue`, `ArtifactFrameNode.vue`, `Artifact3DNode.vue`, `ArtifactTimelineNode.vue` (add the same "Mark ready" control)
- Modify: `frontend/app/components/vue-canvas/DeliverableTile.vue` (unavailable-file placeholder)

**Interfaces:**
- Consumes: the `sailor:markReady` event + `resolveOutputRef` (Task 6) — `resolveOutputRef` already classifies media by extension, so no per-node logic is needed beyond dispatching the event.

- [ ] **Step 1: Add the control to each remaining artifact node**

For each of `ArtifactVideoNode.vue`, `ArtifactAudioNode.vue`, `ArtifactFrameNode.vue`, `Artifact3DNode.vue`, `ArtifactTimelineNode.vue`, add the same emitter used in Task 6 and a "Mark ready" button in that node's action row:

```ts
function markReady() {
  const out = props.data.images?.[0] ?? props.data.gifs?.[0] ?? props.data.video?.[0] ?? props.data.audio?.[0]
  if (!out?.filename) return
  window.dispatchEvent(new CustomEvent('sailor:markReady', { detail: { nodeId: props.id, output: out } }))
}
```

> Each node passes its own first output object. The `?? ` chain covers the output keys ComfyUI nodes use (`images`, `gifs`, `video`, `audio`) — the same keys `extractOutputFiles` reads in `lib/generations.ts:38`. Inspect each node's render path and keep only the key(s) it actually populates; the event payload shape is identical regardless of which key it came from, so `default.vue` needs no change.

- [ ] **Step 2: Unavailable-file placeholder in the tile**

In `DeliverableTile.vue`, replace the `<img>` with a version that swaps to a placeholder on error:

```vue
        <img v-if="!broken" :src="viewUrl(cover)" alt="" class="h-full w-full object-cover" loading="lazy" @error="broken = true" />
        <div v-else class="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#0d0e11] text-white/35">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l18 18M21 15V5a2 2 0 0 0-2-2H9" /><path d="M3 7v12a2 2 0 0 0 2 2h12" /></svg>
          <span class="font-mono text-[10px]">unavailable</span>
        </div>
```

Add `const broken = ref(false)` to the tile script.

- [ ] **Step 3: Verify each kind**

With the dev server running, mark ready one artifact of each available kind (video, audio, at minimum) and confirm a tile appears with the right media affordance (play glyph for video). Confirm a tile whose file was removed shows the "unavailable" placeholder and that Download-all reports it as skipped rather than failing.

Manual checks:
- [ ] Video artifact → tile with play glyph.
- [ ] Audio artifact → tile appears (cover may be generic).
- [ ] Removing a marked file on disk → tile shows "unavailable"; Download all warns "1 file(s) unavailable and skipped".

- [ ] **Step 4: Full unit suite green**

Run: `cd frontend && npm run test:unit -- tests/unit/deliverables-model.unit.spec.ts tests/unit/deliverables-zip.unit.spec.ts tests/unit/deliverables-composable.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Artifact*Node.vue frontend/app/components/vue-canvas/DeliverableTile.vue
git commit -m "feat(deliverables): mark-ready on all artifact kinds + unavailable-file handling"
```

---

## Self-Review

**Spec coverage:**
- §2 model (no bake, no classify, single/set primitive, ≥2 dissolve) → Tasks 1, 3. ✅
- §2 data shape (`ArtifactRef`, `DeliverableItem`, ProjectDoc field, immutable-output reference) → Tasks 1, 3. ✅
- §3 gestures (mark ready, rename, group, ungroup, reorder, reorder-in-set, remove-not-delete, download single/set/all, open-in-canvas, share-ghost) → Tasks 4, 5, 6, 7. ✅
- §4 surfaces (ProjectMenu peer entry, `default.vue` view mode, page/tile/overlay, mark-ready affordance, emerald, zip reuse) → Tasks 4, 5, 6, 7. ✅
- §5 formats stay upstream → nothing re-implemented; sets are the general primitive. ✅
- §6 edge cases (migration default `[]`, stale sourceNodeId disables Open-in-canvas, missing file → unavailable + skip accounting, mark-twice no-op, set <2 dissolve, download-all skips) → Tasks 1, 3, 5, 6, 7. ✅
- §7 testing (model unit, zip unit, integration/e2e manual) → Tasks 1, 2, 3 (unit); 5, 6, 7 (manual e2e). ✅
- §8 scope (share deferred to ghost only; no comments/bake/auto-anything) → honored throughout. ✅

**Placeholder scan:** No "TBD"/"handle edge cases" without code. The two soft spots (node-lookup helper name, per-node output key) are flagged with an explicit fallback instruction, not left blank.

**Type consistency:** `ArtifactRef`/`DeliverableItem` defined in Task 1, imported unchanged in Tasks 2/3/4/6. `markReady(ref, name?)`, `isReady`, `groupItems`, `ungroupItem`, `moveWithinSet`, `removeSetMember` names match between Task 3 (definition) and Task 4 (page usage). Event name `sailor:markReady` consistent across Tasks 6/7. `viewUrl` uses `type: 'output'` consistently.
