# Variables & Collections — Slice 2a (Promote + Chips + Sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click any studio control (Type/Gradient/Shader/Texture) → "Turn into variable" binds it to a Collection column; bound controls show a chip, stay editable (write-through to the cell), follow the preview-row scrub live, and offer "Sweep…" which appends marked rows and batch-bakes them via the studio's own renderer into the drawer results grid.

**Architecture:** Studio bindings reuse Slice 1's spine wholesale: bindings live on the target node (`sailor_varBindings`) with paths namespaced `params.<controlKey>`; `pushVarPreview` grows a `params` split; a new `useStudioVarBindings` composable applies resolved params to each surface's live state (via the existing `makeConfigParams` proxy for Gradient/Shader, direct `params[key]` for Type, texture adapter for Texture) and routes bound-control edits back into the collection cell (write-through). Studio batch/sweep rendering registers a `bakeWithOverrides(overrides): Promise<Blob>` alongside the existing `StudioBaker` registry (`lib/studio/cascade.ts`); the drawer's existing runner consumes it as a second render path beside Smart Layout.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / vue-flow / Vitest. No new deps.

## Global Constraints

- Work directly on `main` — NO feature branches. `git add` ONLY exact file paths — NEVER `git add -A` (a parallel session's WIP may sit in shared files like `layouts/default.vue`; if a file you must edit contains unrelated uncommitted changes, commit ONLY your hunks via `git add -p`-equivalent care: stage a clean checkout + apply your change, or flag BLOCKED).
- No purple accents; pastel gradients only for AI affordances; emerald only for run actions; dark tokens `bg-[#141414]` / `border-white/10` / `text-white/40`; sentence case copy.
- Tests: `frontend/tests/unit/<name>.unit.spec.ts`; run `cd frontend && npm run test:unit -- tests/unit/<name>.unit.spec.ts`. Suite baseline: 4 pre-existing failures (spacetype-palette ×2, video-model-adapt, gradientfx-mesh) — must not grow.
- Slice 1 exports you build on (all under `~/lib/collection/`): `types.ts` (`COLLECTION_PROP`, `BINDINGS_PROP`, `VAR_PREVIEW_PROP`, `VARS_TYPE`, `HEX_RE`, `CollectionData`, `CollectionColumn`, `CollectionRow`, `VarBinding`, `VarBindings`, `VariableType`), `model.ts` (`addColumn`, `addRow`, `setCell`, `keyFromLabel`, `rowLabel`, `clampPreviewRow`), `resolve.ts` (`resolveBindings`, `splitRenderOverrides`, `validateRun`), `bindables.ts` (`Bindable`, `typeCompatible`, `autoAlign`, `listSmartLayoutBindables`), `preview.ts` (`wiredTargets`, `pushVarPreview`), `batch.ts` (`planBatch`, `runBatch`, `BatchItem`), `generate.ts` (`buildRenderItem`, `estimateBatch`, `sanitize`), `varsInput.ts` (`ensureVarsInput`).
- Studio context (from research): control specs = `ControlSpec` in `~/lib/spacetype/effect.ts` (Type) and per-studio agent controls; Gradient/Shader param addressing via `makeConfigParams(config, activeLayer)` proxy (`~/lib/agent/configParams.ts`) with dotted keys (`flow.intensity`); Type Studio params are flat and reactive; persistence keys `sailor_gradientStudio` / `sailor_shaderStudio` / `sailor_spaceType` (params under `.params`) / texture per its surface; shared context menu `~/components/vue-canvas/CanvasContextMenu.vue` (`MenuItem[]`, teleported); studio baker registry `~/lib/studio/cascade.ts` (`registerStudioBaker(id, fn)`); tuner adapters in `~/lib/agent/studioTune.ts`.

---

### Task 1: `params.*` namespace in resolution + preview

**Files:**
- Modify: `frontend/app/lib/collection/resolve.ts`
- Modify: `frontend/app/lib/collection/preview.ts`
- Test: `frontend/tests/unit/collection-resolve-params.unit.spec.ts`

**Interfaces:**
- Consumes: existing `resolveBindings`, `splitRenderOverrides`.
- Produces: `splitResolvedValues(values: Record<string, string | number>): { props: Record<string, string>; brand: Record<string, string>; params: Record<string, string | number> }` — like `splitRenderOverrides` but with a third `params.` namespace that PRESERVES value types (numbers stay numbers). `splitRenderOverrides` stays (Smart Layout path unchanged). `pushVarPreview` writes `{ props, brand, params, ts }` (params only when non-empty, to avoid re-triggering Smart Layout watchers with a new empty object — build the object identically when params is empty: always include `params` as `{}` is FINE for SmartLayoutNodeBody since its watcher fires on the whole object anyway; include it unconditionally for simplicity).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-resolve-params.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { splitResolvedValues } from '~/lib/collection/resolve'
import { pushVarPreview, wiredTargets } from '~/lib/collection/preview'
import { COLLECTION_PROP, BINDINGS_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

describe('splitResolvedValues', () => {
  it('splits props, brand, and params namespaces; params keep number types', () => {
    const out = splitResolvedValues({
      'props.text_layer_1': 'France',
      'brand.primary': '#0C447C',
      'params.flow.intensity': 42,
      'params.scale': 1.5,
    })
    expect(out.props).toEqual({ text_layer_1: 'France' })
    expect(out.brand).toEqual({ primary: '#0C447C' })
    expect(out.params).toEqual({ 'flow.intensity': 42, 'scale': 1.5 })
  })
  it('dotted control keys survive (only the first segment is the namespace)', () => {
    const out = splitResolvedValues({ 'params.layer.color.stops.0.color': '#fff' })
    expect(out.params).toEqual({ 'layer.color.stops.0.color': '#fff' })
  })
})

describe('pushVarPreview with params bindings', () => {
  it('writes params into sailor_varPreview on a studio target', () => {
    const c = createCollection('Sweeps')
    addColumn(c, 'intensity', 'number')
    const r = addRow(c)
    setCell(c, r.id, 'intensity', 42)
    const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
    const studio = { id: '2', data: { nodeType: 'GradientStudio', properties: {
      [BINDINGS_PROP]: { 'params.flow.intensity': { collectionId: c.id, columnKey: 'intensity' } },
    } } }
    const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-3', data: { dataType: 'VARS' } }]
    pushVarPreview(colNode, wiredTargets('1', [colNode, studio], edges))
    const p = (studio.data.properties as any)[VAR_PREVIEW_PROP]
    expect(p.params).toEqual({ 'flow.intensity': 42 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-resolve-params.unit.spec.ts`
Expected: FAIL — `splitResolvedValues` is not exported

- [ ] **Step 3: Implement**

In `resolve.ts` add (keep `splitRenderOverrides` untouched):

```typescript
export function splitResolvedValues(
  values: Record<string, string | number>,
): { props: Record<string, string>; brand: Record<string, string>; params: Record<string, string | number> } {
  const props: Record<string, string> = {}
  const brand: Record<string, string> = {}
  const params: Record<string, string | number> = {}
  for (const [path, v] of Object.entries(values)) {
    if (path.startsWith('props.')) props[path.slice(6)] = String(v)
    else if (path.startsWith('brand.')) brand[path.slice(6)] = String(v)
    else if (path.startsWith('params.')) params[path.slice(7)] = v
  }
  return { props, brand, params }
}
```

In `preview.ts`, switch `pushVarPreview` to `splitResolvedValues` and write `{ props, brand, params, ts: Date.now() }`.

- [ ] **Step 4: Run the new test + the existing preview/resolve suites**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-resolve-params.unit.spec.ts tests/unit/collection-resolve.unit.spec.ts tests/unit/collection-preview.unit.spec.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/resolve.ts frontend/app/lib/collection/preview.ts frontend/tests/unit/collection-resolve-params.unit.spec.ts
git commit -m "feat(collections): params.* namespace in binding resolution + var preview"
```

---

### Task 2: Studio bindables adapter

**Files:**
- Create: `frontend/app/lib/collection/studioBindables.ts`
- Test: `frontend/tests/unit/collection-studio-bindables.unit.spec.ts`

**Interfaces:**
- Consumes: `Bindable`, `typeCompatible` from `./bindables`; `VariableType` from `./types`.
- Produces:
  - `interface StudioControlDesc { key: string; label: string; kind: string; min?: number; max?: number; step?: number; options?: string[] }` — the minimal shape shared by Type Studio `ControlSpec` and the tuner adapters' described controls.
  - `controlKindToVariableType(kind: string): VariableType | null` — `slider→number`, `color→color`, `select|segmented→select`, `text|textList→text`, `font→font`; `fillList|path|curve→null` (not bindable in 2a).
  - `studioBindableFor(control: StudioControlDesc): Bindable | null` — path `params.<key>`, label from control, mapped type; null for unbindable kinds.
  - `listStudioBindables(controls: StudioControlDesc[]): Bindable[]` — map + filter nulls, dedupe by path.
  - `clampForControl(control: StudioControlDesc, value: string | number): string | number` — sliders clamp to min/max and coerce numeric strings; selects snap to options (fallback first option); colors pass through if `HEX_RE` matches else return current-default (`''` → caller keeps prior); text passes through.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-studio-bindables.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  controlKindToVariableType, studioBindableFor, listStudioBindables, clampForControl,
} from '~/lib/collection/studioBindables'

describe('controlKindToVariableType', () => {
  it('maps studio control kinds to variable types', () => {
    expect(controlKindToVariableType('slider')).toBe('number')
    expect(controlKindToVariableType('color')).toBe('color')
    expect(controlKindToVariableType('select')).toBe('select')
    expect(controlKindToVariableType('font')).toBe('font')
    expect(controlKindToVariableType('fillList')).toBeNull()
    expect(controlKindToVariableType('curve')).toBeNull()
  })
})

describe('studioBindableFor / listStudioBindables', () => {
  const controls = [
    { key: 'flow.intensity', label: 'Intensity', kind: 'slider', min: 0, max: 100, step: 1 },
    { key: 'canvas.background', label: 'Background', kind: 'color' },
    { key: 'fills', label: 'Fills', kind: 'fillList' },
  ]
  it('creates params.-prefixed bindables and drops unbindable kinds', () => {
    const b = listStudioBindables(controls)
    expect(b.map(x => x.path)).toEqual(['params.flow.intensity', 'params.canvas.background'])
    expect(b[0]!.type).toBe('number')
    expect(b[1]!.type).toBe('color')
  })
  it('dedupes repeated keys', () => {
    const b = listStudioBindables([controls[0]!, controls[0]!])
    expect(b).toHaveLength(1)
  })
})

describe('clampForControl', () => {
  it('clamps sliders to bounds and coerces numeric strings', () => {
    const c = { key: 'x', label: 'x', kind: 'slider', min: 0, max: 10, step: 1 }
    expect(clampForControl(c, 25)).toBe(10)
    expect(clampForControl(c, '-3')).toBe(0)
    expect(clampForControl(c, '7')).toBe(7)
  })
  it('snaps selects to a valid option', () => {
    const c = { key: 's', label: 's', kind: 'select', options: ['a', 'b'] }
    expect(clampForControl(c, 'b')).toBe('b')
    expect(clampForControl(c, 'zzz')).toBe('a')
  })
  it('passes valid hex through for colors, empty for invalid', () => {
    const c = { key: 'c', label: 'c', kind: 'color' }
    expect(clampForControl(c, '#0C447C')).toBe('#0C447C')
    expect(clampForControl(c, 'purpleish')).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

```typescript
// frontend/app/lib/collection/studioBindables.ts
import type { Bindable } from './bindables'
import type { VariableType } from './types'
import { HEX_RE } from './types'

export interface StudioControlDesc {
  key: string
  label: string
  kind: string
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export function controlKindToVariableType(kind: string): VariableType | null {
  switch (kind) {
    case 'slider': return 'number'
    case 'color': return 'color'
    case 'select':
    case 'segmented': return 'select'
    case 'text':
    case 'textList': return 'text'
    case 'font': return 'font'
    default: return null
  }
}

export function studioBindableFor(control: StudioControlDesc): Bindable | null {
  const type = controlKindToVariableType(control.kind)
  if (!type) return null
  return { path: `params.${control.key}`, label: control.label, type }
}

export function listStudioBindables(controls: StudioControlDesc[]): Bindable[] {
  const out = new Map<string, Bindable>()
  for (const c of controls) {
    const b = studioBindableFor(c)
    if (b && !out.has(b.path)) out.set(b.path, b)
  }
  return [...out.values()]
}

export function clampForControl(control: StudioControlDesc, value: string | number): string | number {
  if (control.kind === 'slider') {
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(n)) return control.min ?? 0
    return Math.min(control.max ?? n, Math.max(control.min ?? n, n))
  }
  if (control.kind === 'select' || control.kind === 'segmented') {
    const opts = control.options ?? []
    return opts.includes(String(value)) ? String(value) : (opts[0] ?? '')
  }
  if (control.kind === 'color') {
    return HEX_RE.test(String(value)) ? String(value) : ''
  }
  return value
}
```

- [ ] **Step 3: Run test to verify it passes** — `npm run test:unit -- tests/unit/collection-studio-bindables.unit.spec.ts`

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/studioBindables.ts frontend/tests/unit/collection-studio-bindables.unit.spec.ts
git commit -m "feat(collections): studio control → bindable adapter with clamping"
```

---

### Task 3: `useStudioVarBindings` composable (apply + write-through)

**Files:**
- Create: `frontend/app/composables/useStudioVarBindings.ts`
- Test: `frontend/tests/unit/studio-var-bindings.unit.spec.ts` (pure core factored into the same file as exported functions)

**Interfaces:**
- Consumes: Tasks 1-2; `BINDINGS_PROP`, `VAR_PREVIEW_PROP`, `COLLECTION_PROP` from `~/lib/collection/types`; `setCell`, `keyFromLabel`, `addColumn` from `~/lib/collection/model`.
- Produces (exported PURE functions, plus the composable):
  - `applyParamsPreview(preview: { params?: Record<string, string | number> } | undefined, controls: StudioControlDesc[], apply: (key: string, value: string | number) => void): string[]` — for each params entry with a matching control, clamp via `clampForControl` (skip empty-string color results) and call `apply`; returns applied keys.
  - `writeThroughEdit(nodesAccessor: () => any[], edgesAccessor: () => any[], studioNodeId: string, path: string, value: string | number): boolean` — find the studio node's binding for `path`; find the wired Collection node (edge with `data.dataType === 'VARS'` targeting this studio, source = collection); `setCell` on the collection's preview row for the bound column; returns true if written. (This makes editing a bound control update the table cell — spec §5.2 write-through.)
  - `promoteControl(nodesAccessor, edgesAccessor, studioNodeId: string, control: StudioControlDesc, currentValue: string | number, createCollectionNode: () => any): { columnKey: string } | null` — find wired collection (or call `createCollectionNode()` which the canvas provides: creates node + VARS edge, returns the node); `addColumn` named from `control.label` typed via `controlKindToVariableType`; `setCell` preview row = currentValue; write `BINDINGS_PROP[params.<key>] = { collectionId, columnKey, lastLiteral: currentValue }` on the studio node.
  - `const { bindings, boundColumnFor, onEdit, promote, unbind } = useStudioVarBindings(nodeId: string, controls: () => StudioControlDesc[], applyParam: (key, value) => void)` — the composable used by surfaces: watches the node's `VAR_PREVIEW_PROP` deep (400ms debounce NOT needed — studio re-render is client-side cheap; apply immediately), exposes `boundColumnFor(controlKey): string | null` for chip rendering, `onEdit(controlKey, value)` to be called from control update handlers (does write-through when bound), `promote(control, currentValue)`, `unbind(controlKey)` (freezes `lastLiteral` = current resolved value then deletes the binding). Node/edges access: inject the canvas nodes/edges — surfaces receive `nodes`/`edges` props already (verify: studio surfaces get `nodeId`; nodes/edges access must come via a window event to VueNodeCanvas OR by passing props — RESEARCH in-task: check how GradientStudioSurface locates its node (`props.nodes`? a `findNode` helper?) and use the same channel; if surfaces only get `nodeId`, add `sailor:collectionPromote`-style CustomEvents handled by VueNodeCanvas instead of direct access, keeping the composable's pure functions testable).

- [ ] **Step 1: Failing tests for the three pure functions** (fixtures: studio node with bindings + collection node + VARS edge, mirroring the Task 1 test's scene; assert applyParamsPreview clamps and applies; writeThroughEdit sets the right cell at previewRow; promoteControl creates column with deduped key, sets cell, writes binding).

```typescript
// frontend/tests/unit/studio-var-bindings.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyParamsPreview, writeThroughEdit, promoteControl } from '~/composables/useStudioVarBindings'
import { COLLECTION_PROP, BINDINGS_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

function scene() {
  const c = createCollection('Vars')
  addColumn(c, 'intensity', 'number')
  const r = addRow(c); setCell(c, r.id, 'intensity', 42)
  const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
  const studio = { id: '2', data: { nodeType: 'GradientStudio', properties: {
    [BINDINGS_PROP]: { 'params.flow.intensity': { collectionId: c.id, columnKey: 'intensity' } },
  } } }
  const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-3', data: { dataType: 'VARS' } }]
  return { c, colNode, studio, edges, nodes: [colNode, studio] }
}

describe('applyParamsPreview', () => {
  it('applies clamped values for known controls only', () => {
    const applied: Record<string, unknown> = {}
    const keys = applyParamsPreview(
      { params: { 'flow.intensity': 250, 'unknown.key': 1 } },
      [{ key: 'flow.intensity', label: 'I', kind: 'slider', min: 0, max: 100 }],
      (k, v) => { applied[k] = v },
    )
    expect(applied).toEqual({ 'flow.intensity': 100 })
    expect(keys).toEqual(['flow.intensity'])
  })
  it('skips invalid color values', () => {
    const applied: Record<string, unknown> = {}
    applyParamsPreview(
      { params: { 'bg': 'not-a-hex' } },
      [{ key: 'bg', label: 'B', kind: 'color' }],
      (k, v) => { applied[k] = v },
    )
    expect(applied).toEqual({})
  })
})

describe('writeThroughEdit', () => {
  it('writes a bound control edit into the collection preview-row cell', () => {
    const { c, nodes, edges } = scene()
    const ok = writeThroughEdit(() => nodes, () => edges, '2', 'params.flow.intensity', 77)
    expect(ok).toBe(true)
    expect(c.rows[0]!.values.intensity).toBe(77)
  })
  it('returns false for unbound paths', () => {
    const { nodes, edges } = scene()
    expect(writeThroughEdit(() => nodes, () => edges, '2', 'params.nope', 1)).toBe(false)
  })
})

describe('promoteControl', () => {
  it('adds a typed column seeded with the current value and writes the binding', () => {
    const { c, nodes, edges, studio } = scene()
    const res = promoteControl(() => nodes, () => edges, '2',
      { key: 'canvas.background', label: 'Background', kind: 'color' }, '#112233', () => { throw new Error('should reuse wired collection') })
    expect(res?.columnKey).toBe('background')
    expect(c.columns.find(x => x.key === 'background')?.type).toBe('color')
    expect(c.rows[0]!.values.background).toBe('#112233')
    expect((studio.data.properties as any)[BINDINGS_PROP]['params.canvas.background']).toMatchObject({ columnKey: 'background', lastLiteral: '#112233' })
  })
})
```

- [ ] **Step 2: Run to fail, implement the pure functions + composable per the interface, run to pass** (composable body: thin reactive shell over the pure functions; the watch applies `applyParamsPreview` on `VAR_PREVIEW_PROP` changes).

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useStudioVarBindings.ts frontend/tests/unit/studio-var-bindings.unit.spec.ts
git commit -m "feat(collections): useStudioVarBindings — apply, write-through, promote"
```

---

### Task 4: Canvas plumbing — promote events, studio VARS inputs, drawer strip for studios

**Files:**
- Modify: `frontend/app/lib/collection/varsInput.ts` (+ its test)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`
- Modify: `frontend/app/components/vue-canvas/CollectionDrawer.vue`

**Interfaces:**
- `ensureVarsInput` generalizes: accepts SmartLayout AND the studio node types. Export `VARS_TARGET_NODE_TYPES = new Set(['SmartLayout', 'SpaceType', 'GradientStudio', 'ShaderStudio', 'TextureStudio'])`; `ensureVarsInput` uses it. Update the unit test to cover a studio type + a negative case.
- VueNodeCanvas gains a `sailor:promoteControl` listener: detail `{ nodeId, control: StudioControlDesc, currentValue }`. Handler: if the studio node has a wired collection → `promoteControl(...)` with accessors over `nodes.value`/`edges.value`; else create a Collection node beside the studio (reuse `createNodeData('Collection', ...)`), push a VARS edge (`ensureVarsInput` first so the input exists; targetHandle = `input-<index of vars input>`), then `promoteControl`. After promote: `pushVarPreview` for immediate visual confirmation, and dispatch `sailor:openCollection` so the drawer shows the new column.
- CollectionDrawer: the targets computed currently filters `nodeType === 'SmartLayout'` — generalize to `VARS_TARGET_NODE_TYPES`. Bindables for a studio target come from `listStudioBindables(controlsForStudio(target))` where `controlsForStudio` is a new small adapter in `~/lib/collection/studioBindables.ts`: for `SpaceType` read the active effect's ControlSpec list (research in-task: the effect registry in `~/lib/spacetype/` — effect id lives in `sailor_spaceType`), for Gradient/Shader/Texture reuse the tuner adapters' control lists from `~/lib/agent/studioTune.ts` (they already produce DescribedControl[] with path/kind/min/max/options — adapt shape). Auto-align works unchanged (`autoAlign` is bindable-generic).

**Steps:** update varsInput test (fail→pass), wire the listener + creation flow, generalize the drawer, verify the full collection suite + varsInput + a `vue-tsc` scoped grep, commit:

```bash
git add frontend/app/lib/collection/varsInput.ts frontend/tests/unit/collection-vars-input.unit.spec.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/CollectionDrawer.vue frontend/app/lib/collection/studioBindables.ts
git commit -m "feat(collections): promote event plumbing, studio VARS inputs, drawer strip for studios"
```

---

### Task 5: BindableControl chip + Type Studio integration

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/BindableControlChip.vue`
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`

**Interfaces:**
- `BindableControlChip` props: `{ columnKey: string | null }`, emits `menu(event: MouseEvent)`. Renders nothing when `columnKey` is null; else a small pill (`bg-white/10 text-white/70 text-[10px] px-1.5 rounded-full`) with the column key; click emits `menu` (surface opens the context menu at cursor).
- SpaceTypeSurface integration (the data-driven loop, ~lines 828-1028): the per-control wrapper `<div :data-control-key="c.key" ...>` gains `@contextmenu.prevent="openVarMenu($event, c)"` and the chip after the control's label region. Surface instantiates `useStudioVarBindings(props.nodeId, () => activeControls, (key, value) => { params[key] = value })` — where `activeControls` maps the effect's ControlSpec[] to `StudioControlDesc` (key/label/kind/min/max/step/options). Control update handlers route through `onEdit(c.key, v)` AFTER their existing `params[c.key] = v` assignment (write-through only fires when bound; unbound edits behave exactly as today). `openVarMenu` builds `MenuItem[]` for `CanvasContextMenu`: unbound → `Turn into variable` (dispatch `sailor:promoteControl`) + `Bind to → <column>` children (type-compatible columns of the wired collection, via the same accessors the drawer uses — simplest: dispatch `sailor:bindControl` events handled next to promote in VueNodeCanvas); bound → `Sweep…` (Task 8; show disabled with hint until then), `Go to collection` (dispatch `sailor:openCollection` with the wired collection id), `Unbind`.
- Persistence note: `bindings` live on the STUDIO NODE properties; SpaceTypeSurface has node access via its existing save path — reuse how it reads/writes `sailor_spaceType` to reach `data.properties` for `BINDINGS_PROP` (research in-task; likely a `node` computed or `getValue/setValue` helpers).

**Steps:** build chip component; integrate; verify by `vue-tsc` grep + existing suites; manual check deferred to controller; commit:

```bash
git add frontend/app/components/vue-canvas/studio/BindableControlChip.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(collections): promote/bind chips in Type Studio controls"
```

---

### Task 6: Gradient Studio integration

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/BindableRow.vue`
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue`

**Interfaces:**
- Gradient's controls are inline hardcoded markup — wrapping every one is the cost center. `BindableRow.vue` makes it one line per control: props `{ controlKey: string; label: string; kind: string; min?: number; max?: number; step?: number; options?: string[]; bound: string | null }`, emits `menu(e: MouseEvent, control: StudioControlDesc)`; template: `<div class="contents" @contextmenu.prevent="emit('menu', $event, control)"><slot /><BindableControlChip :column-key="bound" @menu="emit('menu', $event, control)" /></div>` — wrap each existing control element, passing its addressing key (the SAME dotted keys `makeConfigParams` uses: `canvas.margin`, `flow.intensity`, `layer.color.stops.0.color`...).
- Scope: wrap the PRIMARY tunable controls (every slider/color/select in the main sections — canvas, flow/warp, active layer color stops, grain). Skip buttons/toggles-with-side-effects. List the wrapped keys in the report.
- Apply path: `useStudioVarBindings(nodeId, controls, (key, value) => { paramsProxy[key] = value })` with `paramsProxy = makeConfigParams(config, activeLayer)` (import from `~/lib/agent/configParams.ts` — same proxy the agent tuner uses; config deep watcher re-renders automatically). Write-through: control `@update`/`v-model` handlers add `onEdit(key, value)` — for `v-model`-bound inputs add an `@change`/`@input` alongside (do NOT restructure v-model; a parallel `@input="onEdit('canvas.margin', config.canvas.margin)"` after the mutation is enough since v-model fires first).
- Persist bindings/config: reuse the surface's existing `saveConfig` timing (bindings are written to node properties directly — immediate).

**Steps:** implement, run gradient-related suites (`tests/unit/gradientfx-*` minus the known mesh failure) + `vue-tsc` grep, commit:

```bash
git add frontend/app/components/vue-canvas/studio/BindableRow.vue frontend/app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "feat(collections): promote/bind chips in Gradient Studio"
```

---

### Task 7: Shader + Texture Studio integration

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue`

Same recipe as Task 6 (BindableRow + useStudioVarBindings + the studio's params addressing: Shader uses `makeConfigParams(config, ...)` like Gradient; Texture per its tuner adapter in `~/lib/agent/studioTune.ts` / `~/lib/texturefx/controls.ts` — research the exact proxy in-task). Wrap the primary tunables; list wrapped keys in the report.

```bash
git add frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/app/components/vue-canvas/TextureStudioSurface.vue
git commit -m "feat(collections): promote/bind chips in Shader + Texture studios"
```

---

### Task 8: Sweep — rows, popover, studio bake path

**Files:**
- Modify: `frontend/app/lib/collection/model.ts` (+ test additions in `frontend/tests/unit/collection-model.unit.spec.ts`)
- Modify: `frontend/app/lib/studio/cascade.ts`
- Create: `frontend/app/components/vue-canvas/studio/SweepPopover.vue`
- Modify: `frontend/app/lib/collection/generate.ts`
- Modify: `frontend/app/components/vue-canvas/CollectionDrawer.vue`
- Modify: the four studio surfaces (register param baker + chip menu Sweep item)

**Interfaces:**
- `model.ts`: `addSweepRows(c: CollectionData, columnKey: string, values: (string | number)[]): CollectionRow[]` — each new row = copy of the preview row's values with `columnKey` overridden, `sweep: true`; `keepRow(c, rowId): void` — copy that row's values onto row 0 (create row 0 if none), then remove ALL `sweep: true` rows, clamp preview to 0. TDD both.
- `cascade.ts`: alongside `registerStudioBaker`, add `registerStudioParamBaker(id: string, fn: (overrides: Record<string, string | number>) => Promise<Blob | null>)` + getter + unregister. Studios register in the same mount/unmount spots as their existing baker: implementation = apply overrides to live params via the SAME apply path as useStudioVarBindings, await one render, capture blob via the surface's existing render-to-blob (each surface has a `generateImage`-style path — factor its blob capture into a reusable local function), then restore prior values (snapshot before, restore after, in a try/finally).
- `generate.ts`: `buildStudioRenderItem(targetNodeId: string, collection, bindings, runStamp)` — per item: resolve row → `splitResolvedValues` → `getStudioParamBaker(targetNodeId)` → bake with `params` overrides → upload + asset_import exactly like `buildRenderItem` (share the upload helper — factor it out). Throws if no param baker registered (drawer shows "open the studio to generate" validation warning instead of running — check registration before planBatch).
- `SweepPopover.vue`: props `{ control: StudioControlDesc; anchor: { x: number; y: number } }`, emits `apply(values: (string|number)[])`, `close`. Number controls: min/max/steps inputs (defaults: control.min/control.max/5) → evenly spaced values (round to control.step). Color/select/text: a textarea, one value per line (selects pre-filled with all options). Dark tokens, teleported, Escape/backdrop close.
- Chip menu "Sweep…": opens SweepPopover; on apply → `addSweepRows` on the wired collection → open drawer → auto-run batch on ONLY the new rows (drawer gets an exported `runRowsById(rowIds: string[])` — refactor `confirmGenerate`'s run body to accept a row subset; sweep runs skip the confirm modal when free/studio-baked but still respect `validateRun`).
- Results view: sweep-row thumbnails get a "Keep" button → `keepRow` + `pushVarPreview` (design snaps to the kept values).

**Steps:** TDD model helpers → cascade registry + one surface's param baker (Gradient first) → SweepPopover + chip menu wiring → generate/drawer integration → remaining surfaces' bakers → suites + vue-tsc → commit in two commits (model+cascade+generate; then UI):

```bash
git add frontend/app/lib/collection/model.ts frontend/tests/unit/collection-model.unit.spec.ts frontend/app/lib/studio/cascade.ts frontend/app/lib/collection/generate.ts
git commit -m "feat(collections): sweep rows, keepRow, studio param-baker registry + render path"
git add frontend/app/components/vue-canvas/studio/SweepPopover.vue frontend/app/components/vue-canvas/CollectionDrawer.vue frontend/app/components/vue-canvas/GradientStudioSurface.vue frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(collections): sweep popover + chip menu + drawer sweep runs with keep"
```

---

### Task 9: End-to-end visual verification (controller, required gate)

- [ ] Full unit suite at baseline.
- [ ] In-app: Gradient Studio → right-click intensity slider → "Turn into variable" (collection auto-created + wired + drawer opens showing the column) → edit the bound slider (cell updates = write-through) → add 2 more rows with different values → scrub (gradient re-renders per row) → chip menu → Sweep 5 steps → results grid fills with 5 bakes → Keep one (design snaps) → screenshots at each stage.
- [ ] Type Studio: promote a color control; verify chip + scrub.
- [ ] Regression: unwired studios behave identically; Smart Layout flow from Slice 1 still works (bind + generate 2).
- [ ] Fix-and-re-verify loop for anything found; commit fixes individually.

---

## Self-Review Notes

- Spec coverage (Slice 2 items in this sub-slice): §5.1 promote (Tasks 3-7), §5.2 chips + write-through + unbind-freezes-literal (Tasks 3, 5-7), §5.4 sweep incl. marked rows + keep (Task 8). Deferred to 2b/2c by design: link columns, named picker, AI-fill, inspector form, results artifact node.
- Type consistency: `StudioControlDesc` defined once (Task 2) and consumed by Tasks 3, 5-8; `params.` prefix defined in Task 1's `splitResolvedValues` and used by Tasks 2-3, 8.
- Known risk, called out for reviewers: Gradient/Shader wrap-every-control diffs are large but mechanical; the `layer.`-prefixed keys resolve against the ACTIVE layer (`makeConfigParams(config, activeLayer)`) — a binding to `layer.color.stops.0.color` follows the active layer, which is the same behavior the agent tuner has today; acceptable and documented.
- Sweeps require the studio surface to be OPEN (param baker registered at mount). The drawer surfaces a clear warning otherwise. Documented v1 constraint.
