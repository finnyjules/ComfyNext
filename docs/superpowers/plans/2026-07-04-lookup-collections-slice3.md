# Lookup Collections — Slice 3 (Surfacing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Make lookups usable end to end — the driver drawer shows read-only linked columns, the studio "Bind to" menu lists them, and a bound linked column resolves through the join in BOTH live preview and batch runs.

**Architecture:** Thread a `LookupResolver` (built from canvas nodes via `makeLookupResolver`) into the three resolve sites — `pushVarPreview` (live preview), `buildStudioRenderItem` (batch run), and `useStudioVarBindings.unbind` (freeze-on-unbind). Studios' "Bind to" menu switches from `collection.columns` to `effectiveColumns`. The driver drawer renders `linkedColumns` read-only.

**Tech Stack:** Vue 3, TypeScript, Vitest. `~/` → `frontend/app/`.

## Global Constraints

- Work on `main`; explicit git paths only; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Depends on Slice 1 (`linkedColumns`, `effectiveColumns`, `resolveLinkedCell`, `resolveBindings(…, resolve?)`) and Slice 2 (`makeLookupResolver`, `CollectionData.links`, LOOKUP edges).
- `makeLookupResolver(nodes)` builds a `LookupResolver` from an array of canvas nodes (any[]).
- Backward compat: every threaded arg is OPTIONAL; omitting it = today's behavior.
- Baseline unrelated unit failures (NOT regressions): spacetype-palette ×2, gradientfx-mesh, video-model-adapt.
- You CANNOT browser-verify. Unit-test the pure/near-pure paths; give a MANUAL CHECKLIST for UI.

## File Structure

- `frontend/app/lib/collection/preview.ts` — `pushVarPreview` gains optional `allNodes`; builds resolver, passes to `resolveBindings`.
- `frontend/app/lib/collection/generate.ts` — `buildStudioRenderItem` gains optional `allNodes`; passes resolver to `resolveBindings`.
- `frontend/app/composables/useStudioVarBindings.ts` — `unbind` builds resolver from `nodes()` internally.
- `frontend/app/components/vue-canvas/CollectionDrawer.vue` — pass `props.nodes` to `pushVarPreview`/`buildStudioRenderItem`; render read-only linked columns.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, `templates/GridPropertyPanel.vue` — pass nodes to `pushVarPreview`.
- `frontend/app/components/vue-canvas/{SpaceType,Gradient,Shader,Texture}StudioSurface.vue` — `wiredColumns` → `effectiveColumns`.
- `frontend/tests/unit/collection-preview-lookup.unit.spec.ts` (NEW).

---

### Task 1: Thread the LookupResolver through preview / run / unbind

**Files:**
- Modify: `frontend/app/lib/collection/preview.ts`, `generate.ts`, `composables/useStudioVarBindings.ts`, and the 7 `pushVarPreview` + 1 `buildStudioRenderItem` call sites (`CollectionDrawer.vue`, `VueNodeCanvas.vue`, `templates/GridPropertyPanel.vue`).
- Test: `frontend/tests/unit/collection-preview-lookup.unit.spec.ts` (NEW)

**Interfaces:**
- `pushVarPreview(collectionNode, targets, allNodes?)` — when `allNodes` given, resolves linked columns via `makeLookupResolver(allNodes)`.
- `buildStudioRenderItem(targetNodeId, collection, bindings, runStamp, allNodes?)` — same.

- [ ] **Step 1: Write the failing test** — `frontend/tests/unit/collection-preview-lookup.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { pushVarPreview } from '~/lib/collection/preview'
import { linkedColumns, makeLookupResolver } from '~/lib/collection/lookup'
import { BINDINGS_PROP, COLLECTION_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'

function scene() {
  const players = createCollection('Players')
  addColumn(players, 'Name', 'text'); addColumn(players, 'Country', 'text')
  const r = addRow(players); setCell(players, r.id, 'name', 'Mbappe'); setCell(players, r.id, 'country', 'France')
  const themes = createCollection('Themes')
  addColumn(themes, 'Country', 'text'); addColumn(themes, 'Fill1', 'color')
  const tr = addRow(themes); setCell(themes, tr.id, 'country', 'France'); setCell(themes, tr.id, 'fill1', '#0000ff')
  players.links = [{ collectionId: themes.id, matchLocal: 'country', matchForeign: 'country' }]

  const playersNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: players } } }
  const themesNode = { id: '2', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: themes } } }
  const fill1Key = linkedColumns(players, makeLookupResolver([playersNode, themesNode])).find(c => c.sourceColumnKey === 'fill1')!.key
  const studio = { id: '3', data: { nodeType: 'SpaceType', properties: {
    [BINDINGS_PROP]: { 'params.fills.0.a': { collectionId: players.id, columnKey: fill1Key } },
  } } }
  return { playersNode, themesNode, studio }
}

describe('pushVarPreview with lookups', () => {
  it('resolves a bound linked column into the target preview payload', () => {
    const { playersNode, themesNode, studio } = scene()
    pushVarPreview(playersNode, [studio], [playersNode, themesNode, studio])
    const preview = (studio.data.properties as any)[VAR_PREVIEW_PROP]
    expect(preview.params['fills.0.a']).toBe('#0000ff') // Mbappe -> France -> blue, through the link
  })
  it('without allNodes, the linked column is unresolved (backward-compatible)', () => {
    const { playersNode, studio } = scene()
    pushVarPreview(playersNode, [studio]) // no allNodes
    const preview = (studio.data.properties as any)[VAR_PREVIEW_PROP]
    expect(preview.params['fills.0.a']).toBe(undefined)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run tests/unit/collection-preview-lookup.unit.spec.ts` → FAIL (linked column unresolved even with allNodes).

- [ ] **Step 3: Implement `preview.ts`.** Add import `import { makeLookupResolver } from './lookup'`. Change signature + resolve call:
```ts
export function pushVarPreview(collectionNode: any, targets: any[], allNodes?: any[]): void {
  const c = collectionNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
  if (!c) return
  const resolve = allNodes ? makeLookupResolver(allNodes) : undefined
  for (const target of targets) {
    const bindings = target?.data?.properties?.[BINDINGS_PROP] as VarBindings | undefined
    if (!bindings || !Object.keys(bindings).length) continue
    const { values } = resolveBindings(c, bindings, c.previewRow, resolve)
    // …unchanged…
```

- [ ] **Step 4: Implement `generate.ts`.** `buildStudioRenderItem(targetNodeId, collection, bindings, runStamp, allNodes?)`; inside, `const resolve = allNodes ? makeLookupResolver(allNodes) : undefined` and `resolveBindings(collection, bindings, item.rowIndex, resolve)`. Add `import { makeLookupResolver } from './lookup'`.

- [ ] **Step 5: Implement `unbind` in the composable.** In `useStudioVarBindings.ts`, add `import { makeLookupResolver } from '~/lib/collection/lookup'`; in `unbind`, change the resolve call to `resolveBindings(c, { [path]: binding }, c.previewRow, makeLookupResolver(nodes()))`.

- [ ] **Step 6: Update the call sites to pass nodes.**
  - `CollectionDrawer.vue:59` → `pushVarPreview(node.value, targets.value, props.nodes)`
  - `CollectionDrawer.vue:134` → `pushVarPreview(node.value, targets.value, props.nodes)`
  - `CollectionDrawer.vue:193` → `buildStudioRenderItem(String(targetNode.id), collection.value, targetBindings(), runStamp, props.nodes)`
  - `VueNodeCanvas.vue:3224` → `pushVarPreview(colNode, wiredTargets(nodeId, allNodes, edges.value as any[]), allNodes)`
  - `VueNodeCanvas.vue:3271` → `pushVarPreview(collectionNode, wiredTargets(String(collectionId), allNodes, allEdges), allNodes)`
  - `GridPropertyPanel.vue:101,167,194` → append `, binding!.nodesAccessor()` (or `binding.nodesAccessor()` where non-null) as the 3rd arg.

- [ ] **Step 7: Run tests** — `npx vitest run tests/unit/collection-preview-lookup.unit.spec.ts tests/unit/collection-resolve-lookup.unit.spec.ts tests/unit/studio-var-bindings.unit.spec.ts` → PASS. Typecheck stash-compare on the touched files, zero new.

- [ ] **Step 8: Commit** — `git add` preview.ts generate.ts useStudioVarBindings.ts CollectionDrawer.vue VueNodeCanvas.vue GridPropertyPanel.vue + the new test; `git commit -m "feat(variables): resolve linked columns in preview + run + unbind"` (+ trailer).

---

### Task 2: Studio "Bind to" menu lists linked columns

**Files:** `SpaceTypeSurface.vue`, `GradientStudioSurface.vue`, `ShaderStudioSurface.vue`, `TextureStudioSurface.vue`

Each has `const wiredColumns = computed<CollectionColumn[]>(() => { … return c?.columns ?? [] })`. Change the return to include linked columns.

- [ ] **Step 1:** In each of the 4 surfaces, add imports: `import { effectiveColumns, makeLookupResolver } from '~/lib/collection/lookup'` (keep existing `CollectionColumn` type import).
- [ ] **Step 2:** In each `wiredColumns` computed, replace `return c?.columns ?? []` with:
```ts
    if (!c) return []
    return effectiveColumns(c, makeLookupResolver(props.nodes))
```
(`props.nodes` exists on every surface — it's already used by `useStudioVarBindings`.)
- [ ] **Step 3:** Typecheck stash-compare on the 4 files, zero new. Run `npx vitest run tests/unit/collection-lookup.unit.spec.ts` (effectiveColumns already covered).
- [ ] **Step 4: Commit** — `git add` the 4 surfaces; `git commit -m "feat(variables): studio Bind-to menu lists linked columns"` (+ trailer).

**MANUAL CHECKLIST:** With Themes linked into Players (Slice 2) and Players wired to a Type Studio, right-click a color swatch's hexagon → "Bind to" now lists Fill1/Text (Themes' columns). Bind fill1 → Fill1; scrub Players' preview row across players → the ribbon color changes per country. Run → each row bakes its country's color.

---

### Task 3: Driver drawer read-only linked columns

**Files:** `frontend/app/components/vue-canvas/CollectionDrawer.vue`

- [ ] **Step 1:** Add imports: `import { linkedColumns, resolveLinkedCell, makeLookupResolver } from '~/lib/collection/lookup'`.
- [ ] **Step 2:** Add computeds:
```ts
const lookupResolve = computed(() => makeLookupResolver(props.nodes))
const linkedCols = computed(() => (collection.value ? linkedColumns(collection.value, lookupResolve.value) : []))
function linkedCellText(rowIndex: number, colIndex: number): string {
  const c = collection.value; const col = linkedCols.value[colIndex]
  if (!c || !col) return ''
  const v = resolveLinkedCell(c, rowIndex, col, lookupResolve.value)
  return v === undefined ? '—' : String(v)
}
function openForeign(sourceCollectionId: string) {
  const n = props.nodes.find((x: any) => x?.data?.properties?.[COLLECTION_PROP]?.id === sourceCollectionId)
  if (n) window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: String(n.id) } }))
}
```
- [ ] **Step 3:** In the table header row, after the real column headers, render one read-only header per linked column: a pink link glyph + `{{ col.label }}` + a small "edit in table" button calling `openForeign(col.sourceCollectionId)`. Style the linked header cell with a faint pink tint (`background: rgba(244,114,182,0.06)`) and `title="Linked from another collection — read-only"`.
- [ ] **Step 4:** In each table body row (index `ri`), after the real cells, render one read-only cell per linked column: `<td>{{ linkedCellText(ri, ci) }}</td>` (non-editable, muted text; show `—` for no-match). Match the existing row cell markup/classes minus the input.
- [ ] **Step 5:** Typecheck stash-compare, zero new. `npx vitest run tests/unit/collection-lookup.unit.spec.ts` PASS.
- [ ] **Step 6: Commit** — `git add frontend/app/components/vue-canvas/CollectionDrawer.vue && git commit -m "feat(variables): read-only linked columns in the collection drawer"` (+ trailer).

**MANUAL CHECKLIST:** Open Players' drawer after linking Themes → the Fill1/Text columns appear after Country, read-only, pink-tinted, auto-filled per row (Mbappe→blue/white); a player with an unmatched country shows "—"; the linked-header "edit in table" opens the Themes drawer.

---

## Final integration verification (after all tasks)

1. `npx vitest run` — only the 4 known baseline failures; all new lookup tests green.
2. `npx vue-tsc --noEmit` — no NEW errors vs. a pre-Slice-2 baseline.
3. Write the combined MANUAL CHECKLIST (Slices 2+3) into the morning report: draw lookup edge → (picker if needed) → linked columns in drawer → bind studio color to a linked column → scrub rows → Run → per-row colors → reload persists.
