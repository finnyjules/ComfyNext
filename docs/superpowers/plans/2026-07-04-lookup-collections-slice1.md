# Lookup Collections — Slice 1 (Data + Resolver Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure, headless data model + resolver that lets a driver collection resolve values from a keyed lookup collection (one join, non-recursive), with zero UI.

**Architecture:** A driver `CollectionData` carries `links: CollectionLink[]`. A new pure module `lib/collection/lookup.ts` derives read-only **linked columns** from those links + the foreign collection (supplied via a `LookupResolver` callback) and resolves a linked cell by matching the driver row's key against the foreign key column. `resolveBindings` gains an optional resolver arg so a binding to a linked column resolves through the join; absence of the arg is byte-identical to today.

**Tech Stack:** TypeScript, Vitest. Frontend at `frontend/`. Vitest alias `~/` → `frontend/app/`.

## Global Constraints

- Work on `main`; commit with explicit paths only, never `git add -A`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `~/` maps to `frontend/app/` in both source and tests. Run all commands from `frontend/`.
- Pure module only — NO Vue, NO canvas/node access, NO imports from components. Foreign collections arrive via the `LookupResolver` callback, never by reaching into the DOM/store.
- One join only, **non-recursive**: `resolveLinkedCell` reads a *real* foreign column (`row.values[...]`), never a foreign linked column. This is the cycle guarantee.
- Backward compatibility is a hard requirement: existing `resolveBindings(c, bindings, rowIndex)` callers (no 4th arg) must behave exactly as before.
- Baseline unit failures unrelated to this work (do NOT count as regressions): `spacetype-palette` ×2, `gradientfx-mesh`, `video-model-adapt`.

## File Structure

- `frontend/app/lib/collection/types.ts` — add `CollectionLink`, `CollectionData.links?`, `LOOKUP_TYPE`.
- `frontend/app/lib/collection/lookup.ts` (NEW) — `LookupResolver`, `LinkedColumn`, `linkedColumns`, `effectiveColumns`, `findLinkedColumn`, `resolveLinkedCell`.
- `frontend/app/lib/collection/resolve.ts` — `resolveBindings` optional 4th arg.
- `frontend/tests/unit/collection-lookup.unit.spec.ts` (NEW) — lookup module tests.
- `frontend/tests/unit/collection-resolve-lookup.unit.spec.ts` (NEW) — resolver integration tests.

---

### Task 1: Data model + linked-column derivation

**Files:**
- Modify: `frontend/app/lib/collection/types.ts`
- Create: `frontend/app/lib/collection/lookup.ts`
- Test: `frontend/tests/unit/collection-lookup.unit.spec.ts`

**Interfaces:**
- Consumes: `CollectionData`, `CollectionColumn`, `VariableType` from `./types`; `createCollection`, `addColumn`, `addRow`, `setCell` from `./model` (tests only).
- Produces:
  - `interface CollectionLink { collectionId: string; matchLocal: string; matchForeign: string }`
  - `CollectionData.links?: CollectionLink[]`
  - `const LOOKUP_TYPE = 'LOOKUP'`
  - `type LookupResolver = (collectionId: string) => CollectionData | undefined`
  - `interface LinkedColumn { key: string; label: string; type: VariableType; sourceCollectionId: string; sourceColumnKey: string; matchLocal: string; matchForeign: string }`
  - `function linkedColumns(local: CollectionData, resolve: LookupResolver): LinkedColumn[]`
  - `function effectiveColumns(local: CollectionData, resolve: LookupResolver): CollectionColumn[]`
  - `function findLinkedColumn(local: CollectionData, resolve: LookupResolver, key: string): LinkedColumn | null`

Key rule: a linked column's `key` is ALWAYS namespaced `${collectionId}::${foreignColumnKey}` (collision-free, stable). Its `label` is the foreign column's label, unless another effective column already uses that label → then `${foreignCollection.name} · ${label}`. Linked columns = every foreign column whose key ≠ `matchForeign`. A link whose foreign collection can't be resolved contributes nothing.

- [ ] **Step 1: Add the data-model types**

In `frontend/app/lib/collection/types.ts`, after the `VarBindings` type add:

```ts
/** One lookup link on a driver collection: match this collection's `matchLocal`
 *  column against the foreign collection's `matchForeign` key column. */
export interface CollectionLink {
  collectionId: string
  matchLocal: string
  matchForeign: string
}
```

Add `links?: CollectionLink[]` to the `CollectionData` interface (after `previewRow`). Add near the other edge-type consts:

```ts
export const LOOKUP_TYPE = 'LOOKUP'
```

- [ ] **Step 2: Write the failing test**

Create `frontend/tests/unit/collection-lookup.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { linkedColumns, effectiveColumns, findLinkedColumn } from '~/lib/collection/lookup'
import type { LookupResolver } from '~/lib/collection/lookup'

function players() {
  const c = createCollection('Players')
  addColumn(c, 'Name', 'text')
  addColumn(c, 'Country', 'text')
  const r = addRow(c); setCell(c, r.id, 'name', 'Mbappe'); setCell(c, r.id, 'country', 'France')
  return c
}
function themes() {
  const t = createCollection('Themes')
  addColumn(t, 'Country', 'text')
  addColumn(t, 'Fill1', 'color')
  addColumn(t, 'Text', 'color')
  const r = addRow(t); setCell(t, r.id, 'country', 'France'); setCell(t, r.id, 'fill1', '#0000ff'); setCell(t, r.id, 'text', '#ffffff')
  return t
}
function scene() {
  const local = players(); const foreign = themes()
  local.links = [{ collectionId: foreign.id, matchLocal: 'country', matchForeign: 'country' }]
  const resolve: LookupResolver = id => (id === foreign.id ? foreign : undefined)
  return { local, foreign, resolve }
}

describe('linkedColumns', () => {
  it('contributes foreign non-key columns as namespaced linked columns', () => {
    const { local, foreign, resolve } = scene()
    const cols = linkedColumns(local, resolve)
    expect(cols.map(c => c.sourceColumnKey)).toEqual(['fill1', 'text']) // 'country' (matchForeign) excluded
    expect(cols[0]!.key).toBe(`${foreign.id}::fill1`)
    expect(cols[0]!.label).toBe('Fill1')
    expect(cols[0]!.type).toBe('color')
    expect(cols[0]!.matchLocal).toBe('country')
  })
  it('is empty when the foreign collection cannot be resolved', () => {
    const { local } = scene()
    expect(linkedColumns(local, () => undefined)).toEqual([])
  })
  it('namespaces the label when it collides with an existing effective label', () => {
    const { local, foreign, resolve } = scene()
    addColumn(local, 'Fill1', 'text') // now local already has a 'Fill1' label
    const linked = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!
    expect(linked.label).toBe('Themes · Fill1')
  })
})

describe('effectiveColumns / findLinkedColumn', () => {
  it('appends linked columns after real ones', () => {
    const { local, resolve } = scene()
    const eff = effectiveColumns(local, resolve)
    expect(eff.map(c => c.label)).toEqual(['Name', 'Country', 'Fill1', 'Text'])
  })
  it('findLinkedColumn returns the linked column for its key, null otherwise', () => {
    const { local, foreign, resolve } = scene()
    expect(findLinkedColumn(local, resolve, `${foreign.id}::fill1`)?.sourceColumnKey).toBe('fill1')
    expect(findLinkedColumn(local, resolve, 'country')).toBe(null)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/collection-lookup.unit.spec.ts`
Expected: FAIL — `lookup.ts` does not exist (import error).

- [ ] **Step 4: Implement `lookup.ts` (columns half)**

Create `frontend/app/lib/collection/lookup.ts`:

```ts
// Pure lookup-collection resolution. A driver collection's `links` point at
// foreign (lookup) collections; each contributes its non-key columns as
// read-only "linked" columns, resolved per row by matching the driver's key
// column against the foreign key column. One join, non-recursive: a linked
// cell reads a REAL foreign column, never a foreign linked column.
//
// Foreign collections arrive via a `LookupResolver` callback so this module
// stays pure — no canvas/store access.

import type { CollectionColumn, CollectionData, VariableType } from './types'

export type LookupResolver = (collectionId: string) => CollectionData | undefined

export interface LinkedColumn {
  key: string              // namespaced, collision-free: `${collectionId}::${sourceColumnKey}`
  label: string
  type: VariableType
  sourceCollectionId: string
  sourceColumnKey: string
  matchLocal: string
  matchForeign: string
}

/** Every linked column contributed by the driver's links (foreign non-key columns).
 *  Keys are namespaced so they never collide; a label that duplicates an existing
 *  effective label is disambiguated as `${foreignName} · ${label}`. */
export function linkedColumns(local: CollectionData, resolve: LookupResolver): LinkedColumn[] {
  const out: LinkedColumn[] = []
  const usedLabels = new Set(local.columns.map(c => c.label))
  for (const link of local.links ?? []) {
    const foreign = resolve(link.collectionId)
    if (!foreign) continue
    for (const fc of foreign.columns) {
      if (fc.key === link.matchForeign) continue
      const label = usedLabels.has(fc.label) ? `${foreign.name} · ${fc.label}` : fc.label
      usedLabels.add(label)
      out.push({
        key: `${link.collectionId}::${fc.key}`,
        label,
        type: fc.type,
        sourceCollectionId: link.collectionId,
        sourceColumnKey: fc.key,
        matchLocal: link.matchLocal,
        matchForeign: link.matchForeign,
      })
    }
  }
  return out
}

/** Real columns followed by linked columns, as a flat CollectionColumn[] for bind menus. */
export function effectiveColumns(local: CollectionData, resolve: LookupResolver): CollectionColumn[] {
  const linked = linkedColumns(local, resolve).map(c => ({ key: c.key, label: c.label, type: c.type }))
  return [...local.columns, ...linked]
}

/** The LinkedColumn for a key, or null if it's a real/unknown column. */
export function findLinkedColumn(local: CollectionData, resolve: LookupResolver, key: string): LinkedColumn | null {
  return linkedColumns(local, resolve).find(c => c.key === key) ?? null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/collection-lookup.unit.spec.ts`
Expected: PASS (all cases in this file so far).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/collection/types.ts frontend/app/lib/collection/lookup.ts frontend/tests/unit/collection-lookup.unit.spec.ts
git commit -m "feat(variables): lookup collection data model + linked columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Resolve a linked cell by key match

**Files:**
- Modify: `frontend/app/lib/collection/lookup.ts`
- Test: `frontend/tests/unit/collection-lookup.unit.spec.ts` (append)

**Interfaces:**
- Consumes: `LinkedColumn`, `LookupResolver` from Task 1.
- Produces: `function resolveLinkedCell(local: CollectionData, rowIndex: number, col: LinkedColumn, resolve: LookupResolver): string | number | undefined`

Rule: read the driver row's `matchLocal` value; find the FIRST foreign row whose `matchForeign` value equals it (string-compared); return that row's `sourceColumnKey` cell. Return `undefined` on any miss (no row, blank key, missing foreign collection, no match, blank foreign cell).

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/collection-lookup.unit.spec.ts`:

Note: `resolveLinkedCell` is a NEW named import — add it to the existing `~/lib/collection/lookup` import line at the top of the file (which already imports `linkedColumns, effectiveColumns, findLinkedColumn`). `createCollection, addColumn, addRow, setCell` are already imported from `~/lib/collection/model` in Task 1's header. Append:

```ts
describe('resolveLinkedCell', () => {
  it('resolves a driver row through the join', () => {
    const { local, resolve } = scene()
    const fill1 = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!
    expect(resolveLinkedCell(local, 0, fill1, resolve)).toBe('#0000ff') // Mbappe -> France -> blue
  })
  it('returns undefined when no foreign row matches the key', () => {
    const { local, resolve } = scene()
    const r = addRow(local); setCell(local, r.id, 'country', 'Brazil') // no Brazil in Themes
    const fill1 = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!
    expect(resolveLinkedCell(local, 1, fill1, resolve)).toBe(undefined)
  })
  it('returns undefined for a blank key or missing foreign collection', () => {
    const { local, resolve } = scene()
    const fill1 = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!
    addRow(local) // new row, no country set -> blank key
    expect(resolveLinkedCell(local, local.rows.length - 1, fill1, resolve)).toBe(undefined)
    expect(resolveLinkedCell(local, 0, fill1, () => undefined)).toBe(undefined) // missing foreign
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/collection-lookup.unit.spec.ts`
Expected: FAIL — `resolveLinkedCell` is not exported.

- [ ] **Step 3: Implement `resolveLinkedCell`**

Append to `frontend/app/lib/collection/lookup.ts`:

```ts
/** Resolve one linked cell for a driver row: match the row's `matchLocal` value
 *  against the foreign `matchForeign` column (first match), return the foreign
 *  `sourceColumnKey` cell. undefined on any miss (blank key, missing foreign
 *  collection, no match, blank foreign cell). One level only — never recurses. */
export function resolveLinkedCell(
  local: CollectionData, rowIndex: number, col: LinkedColumn, resolve: LookupResolver,
): string | number | undefined {
  const row = local.rows[rowIndex]
  if (!row) return undefined
  const keyVal = row.values[col.matchLocal]
  if (keyVal === undefined || String(keyVal).trim() === '') return undefined
  const foreign = resolve(col.sourceCollectionId)
  if (!foreign) return undefined
  const fRow = foreign.rows.find(r => String(r.values[col.matchForeign]) === String(keyVal))
  if (!fRow) return undefined
  const val = fRow.values[col.sourceColumnKey]
  return (val === undefined || String(val).trim() === '') ? undefined : val
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/collection-lookup.unit.spec.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/collection/lookup.ts frontend/tests/unit/collection-lookup.unit.spec.ts
git commit -m "feat(variables): resolveLinkedCell join resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Lookup-aware `resolveBindings`

**Files:**
- Modify: `frontend/app/lib/collection/resolve.ts`
- Test: `frontend/tests/unit/collection-resolve-lookup.unit.spec.ts` (NEW)

**Interfaces:**
- Consumes: `findLinkedColumn`, `resolveLinkedCell`, `LookupResolver` from Tasks 1–2; existing `resolveBindings`.
- Produces: `resolveBindings(c, bindings, rowIndex, resolve?: LookupResolver)` — the 4th arg is optional and default-off.

Rule: after the real-column cell lookup, if the cell is still `undefined` AND `resolve` was passed, try `findLinkedColumn(c, resolve, b.columnKey)` → `resolveLinkedCell`. The existing `lastLiteral` / `missing` fallback logic is unchanged, so a no-match linked cell degrades exactly like a blank real cell.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/collection-resolve-lookup.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { resolveBindings } from '~/lib/collection/resolve'
import { linkedColumns } from '~/lib/collection/lookup'
import type { LookupResolver } from '~/lib/collection/lookup'
import type { VarBindings } from '~/lib/collection/types'

function scene() {
  const local = createCollection('Players')
  addColumn(local, 'Name', 'text'); addColumn(local, 'Country', 'text')
  const r = addRow(local); setCell(local, r.id, 'name', 'Mbappe'); setCell(local, r.id, 'country', 'France')
  const foreign = createCollection('Themes')
  addColumn(foreign, 'Country', 'text'); addColumn(foreign, 'Fill1', 'color')
  const fr = addRow(foreign); setCell(foreign, fr.id, 'country', 'France'); setCell(foreign, fr.id, 'fill1', '#0000ff')
  local.links = [{ collectionId: foreign.id, matchLocal: 'country', matchForeign: 'country' }]
  const resolve: LookupResolver = id => (id === foreign.id ? foreign : undefined)
  const fill1Key = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!.key
  return { local, foreign, resolve, fill1Key }
}

describe('resolveBindings with a LookupResolver', () => {
  it('resolves a binding to a linked column through the join', () => {
    const { local, fill1Key, resolve } = scene()
    const bindings: VarBindings = { 'params.fills.0.a': { collectionId: local.id, columnKey: fill1Key } }
    const { values } = resolveBindings(local, bindings, 0, resolve)
    expect(values['params.fills.0.a']).toBe('#0000ff')
  })
  it('falls back to lastLiteral + missing when the linked cell has no match', () => {
    const { local, fill1Key, resolve } = scene()
    setCell(local, local.rows[0]!.id, 'country', 'Brazil') // no Brazil in Themes
    const bindings: VarBindings = { 'params.fills.0.a': { collectionId: local.id, columnKey: fill1Key, lastLiteral: '#123456' } }
    const { values, missing } = resolveBindings(local, bindings, 0, resolve)
    expect(values['params.fills.0.a']).toBe('#123456')
    expect(missing).toContain('params.fills.0.a')
  })
  it('is byte-identical to today when no resolver is passed', () => {
    const { local, fill1Key } = scene()
    const bindings: VarBindings = { 'params.fills.0.a': { collectionId: local.id, columnKey: fill1Key } }
    const { values, missing } = resolveBindings(local, bindings, 0) // no 4th arg
    expect(values['params.fills.0.a']).toBe(undefined) // linked column invisible without a resolver
    expect(missing).toContain('params.fills.0.a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/collection-resolve-lookup.unit.spec.ts`
Expected: FAIL — `resolveBindings` ignores the 4th arg, so the first case resolves to `undefined`.

- [ ] **Step 3: Implement the optional resolver arg**

In `frontend/app/lib/collection/resolve.ts`, add the import at the top:

```ts
import { findLinkedColumn, resolveLinkedCell, type LookupResolver } from './lookup'
```

Change the `resolveBindings` signature and cell lookup. The function currently is:

```ts
export function resolveBindings(
  c: CollectionData,
  bindings: VarBindings,
  rowIndex: number,
): { values: Record<string, string | number>; missing: string[] } {
  const values: Record<string, string | number> = {}
  const missing: string[] = []
  const row = c.rows[rowIndex]
  for (const [path, b] of Object.entries(bindings || {})) {
    if (!b || b.collectionId !== c.id) continue
    const col = c.columns.find(x => x.key === b.columnKey)
    const cell = col && row ? row.values[col.key] : undefined
    if (cell !== undefined && String(cell).trim() !== '') {
```

Replace those lines through the `const cell = …` line with:

```ts
export function resolveBindings(
  c: CollectionData,
  bindings: VarBindings,
  rowIndex: number,
  resolve?: LookupResolver,
): { values: Record<string, string | number>; missing: string[] } {
  const values: Record<string, string | number> = {}
  const missing: string[] = []
  const row = c.rows[rowIndex]
  for (const [path, b] of Object.entries(bindings || {})) {
    if (!b || b.collectionId !== c.id) continue
    const col = c.columns.find(x => x.key === b.columnKey)
    let cell = col && row ? row.values[col.key] : undefined
    // Linked (lookup) column: resolve through the join when a resolver is supplied.
    if ((cell === undefined || String(cell).trim() === '') && resolve) {
      const linked = findLinkedColumn(c, resolve, b.columnKey)
      if (linked) cell = resolveLinkedCell(c, rowIndex, linked, resolve)
    }
    if (cell !== undefined && String(cell).trim() !== '') {
```

Leave the rest of the loop (the `lastLiteral`/`missing` branches and the `return`) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/collection-resolve-lookup.unit.spec.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Run the collection suite to confirm no regressions**

Run: `cd frontend && npx vitest run tests/unit/collection-lookup.unit.spec.ts tests/unit/collection-resolve-lookup.unit.spec.ts tests/unit/studio-var-bindings.unit.spec.ts tests/unit/layout-binding.unit.spec.ts`
Expected: PASS — existing `resolveBindings` callers are unaffected (no 4th arg).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/collection/resolve.ts frontend/tests/unit/collection-resolve-lookup.unit.spec.ts
git commit -m "feat(variables): lookup-aware resolveBindings (optional resolver)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Out of scope (later slices)

- **Slice 2** — canvas wiring: `lookup-in` handle on Collection nodes, onConnect/disconnect link registration, `LookupMatchPicker.vue`, `wiredTargets` filtering `dataType === VARS_TYPE`, link persistence across save/reload.
- **Slice 3** — surfacing: driver drawer linked columns (read-only, "edit in foreign"), studio "Bind to" using `effectiveColumns`, threading a `LookupResolver` through `pushVarPreview` / `buildStudioRenderItem` / `useStudioVarBindings.unbind` / `GridPropertyPanel`, live preview + batch run.
