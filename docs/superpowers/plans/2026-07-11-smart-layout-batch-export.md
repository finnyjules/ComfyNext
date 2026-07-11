# Smart Layout Batch Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartesian batch export for Smart Layout (formats × bound-variable value pools → N outputs), with results landing in a new frontend-only "BatchGrid" node (stacked-deck card + gallery modal + ZIP).

**Architecture:** A pure `matrix.ts` module plans the cartesian combos; the existing `runBatch` → `/api/render-template` → `uploadAndRegister` pipeline renders them; a new `BatchExportModal` sheet (opened from the node body and the editor modal via a `sailor:openBatchExport` window event) drives the run; VueNodeCanvas spawns a `BatchGrid` node via `createNodeData` with the results in `properties.sailor_batch`.

**Tech Stack:** Vue 3 SFC (Nuxt 4), TypeScript, vitest, JSZip (existing dep). Frontend only.

**Spec:** `docs/superpowers/specs/2026-07-11-smart-layout-batch-export-design.md`

## Global Constraints

- Working dir for all commands: `/Users/julien/Documents/GitHub/Sailor/frontend`
- No backend/ComfyUI changes; `BatchGrid` must never reach a run (frontend-only strip).
- `git add` ONLY the files listed in each task's commit step — other sessions have uncommitted work in this repo.
- The repo has ~328 pre-existing typecheck errors; only NEW errors in touched files matter.
- Confirm gate threshold: **100** combos. Render concurrency: **3** (reuse `runBatch` default semantics — pass explicitly).

---

### Task 1: Pure matrix module

**Files:**
- Create: `app/lib/collection/matrix.ts`
- Test: `tests/unit/collection-matrix.unit.spec.ts`

**Interfaces:**
- Consumes: `CollectionData` from `~/lib/collection/types`, `sanitize` from `~/lib/collection/generate`.
- Produces (used by Tasks 3–4):
  - `interface MatrixPoolValue { value: string; label: string }`
  - `interface MatrixPool { key: string; label: string; kind: 'format' | 'text' | 'image'; values: MatrixPoolValue[] }` — the format pool uses `key: 'format'`; variable pools use the binding path (`props.text_layer_1`) as `key`.
  - `interface MatrixCombo { format: string; values: Record<string, string>; labels: Record<string, string>; filename?: string }` — `values`/`labels` keyed by pool key (format excluded from `values`, included in `labels`).
  - `planMatrix(pools: MatrixPool[]): MatrixCombo[]`
  - `columnPool(c: CollectionData, columnKey: string): MatrixPoolValue[]`
  - `comboFilename(layoutName: string, combo: MatrixCombo, index: number): string`
  - `const BATCH_PROP = 'sailor_batch'`
  - `interface BatchGridItem { url: string; filename: string; format: string; formatLabel: string; vars: Record<string, string> }`
  - `interface BatchGridPayload { createdAt: string; sourceNodeId: string; layoutName: string; items: BatchGridItem[] }`
  - `buildBatchPayload(sourceNodeId: string, layoutName: string, pools: MatrixPool[], combos: MatrixCombo[], urls: (string | undefined)[], createdAt: string): BatchGridPayload` — pairs combos with their rendered URLs, DROPS entries whose url is undefined (failed renders), and maps `labels` → `vars` using each pool's `label`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/collection-matrix.unit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planMatrix, columnPool, comboFilename, buildBatchPayload, type MatrixPool } from '~/lib/collection/matrix'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

const P = (key: string, label: string, kind: 'format' | 'text' | 'image', vals: string[]): MatrixPool =>
  ({ key, label, kind, values: vals.map(v => ({ value: v, label: v })) })

describe('planMatrix', () => {
  it('produces the full cartesian product in pool order (3×3×3 = 27)', () => {
    const combos = planMatrix([
      P('format', 'Format', 'format', ['1x1', '9x16', '16x9']),
      P('props.text_layer_1', 'Tagline', 'text', ['a', 'b', 'c']),
      P('props.image_layer_1', 'Image', 'image', ['u1', 'u2', 'u3']),
    ])
    expect(combos).toHaveLength(27)
    expect(combos[0]).toMatchObject({ format: '1x1', values: { 'props.text_layer_1': 'a', 'props.image_layer_1': 'u1' } })
    // format varies slowest, last pool fastest
    expect(combos[1]!.values['props.image_layer_1']).toBe('u2')
    expect(combos[26]).toMatchObject({ format: '16x9', values: { 'props.text_layer_1': 'c', 'props.image_layer_1': 'u3' } })
  })

  it('single-value pools collapse (3×1×1 = 3) and labels carry through', () => {
    const combos = planMatrix([
      P('format', 'Format', 'format', ['1x1', '9x16', '16x9']),
      P('props.text_layer_1', 'Tagline', 'text', ['hello']),
    ])
    expect(combos).toHaveLength(3)
    expect(combos[0]!.labels).toEqual({ format: '1x1', 'props.text_layer_1': 'hello' })
  })

  it('defensively skips an empty pool instead of zeroing everything', () => {
    const combos = planMatrix([
      P('format', 'Format', 'format', ['1x1', '9x16']),
      P('props.text_layer_1', 'Tagline', 'text', []),
    ])
    expect(combos).toHaveLength(2)
  })

  it('formats-only batch works (no variable pools)', () => {
    expect(planMatrix([P('format', 'Format', 'format', ['1x1'])])).toHaveLength(1)
  })
})

describe('columnPool', () => {
  it('returns distinct, non-empty values in row order', () => {
    const c = createCollection('T')
    addColumn(c, 'tag', 'text')
    const r1 = addRow(c); const r2 = addRow(c); const r3 = addRow(c); const r4 = addRow(c)
    setCell(c, r1.id, 'tag', 'b')
    setCell(c, r2.id, 'tag', 'a')
    setCell(c, r3.id, 'tag', 'b')     // duplicate
    setCell(c, r4.id, 'tag', '  ')    // blank
    expect(columnPool(c, 'tag')).toEqual([
      { value: 'b', label: 'b' },
      { value: 'a', label: 'a' },
    ])
  })
  it('unknown column → empty pool', () => {
    expect(columnPool(createCollection('T'), 'nope')).toEqual([])
  })
})

describe('comboFilename', () => {
  const combo = { format: '9x16', values: {}, labels: { 'format': '9x16', 'props.text_layer_1': 'Fresh Skin!', 'props.image_layer_1': 'Bottle 2' } }
  it('sanitizes and joins label parts with the index suffix', () => {
    expect(comboFilename('Summer Launch', combo as any, 4)).toBe('summer-launch_9x16_fresh-skin_bottle-2_5.png')
  })
})

describe('buildBatchPayload', () => {
  const pools = [
    P('format', 'Format', 'format', ['1x1', '9x16']),
    P('props.text_layer_1', 'Tagline', 'text', ['a', 'b']),
  ]
  it('keeps only combos with a rendered url and maps labels → vars', () => {
    const combos = planMatrix(pools)
    const urls = [undefined, '/view?a', '/view?b', undefined]
    const p = buildBatchPayload('123', 'My Layout', pools, combos, urls, '2026-07-11T00:00:00Z')
    expect(p.items).toHaveLength(2)
    expect(p.items[0]).toMatchObject({
      url: '/view?a', format: '1x1', formatLabel: '1x1',
      vars: { Tagline: 'b' },
    })
    expect(p.sourceNodeId).toBe('123')
    expect(p.createdAt).toBe('2026-07-11T00:00:00Z')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/collection-matrix.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/lib/collection/matrix.ts`**

```ts
// Cartesian batch planning for Smart Layout batch export.
// Pure module — no Vue imports. See the design spec:
// docs/superpowers/specs/2026-07-11-smart-layout-batch-export-design.md

import type { CollectionData } from './types'
import { sanitize } from './generate'

export interface MatrixPoolValue { value: string; label: string }

/** One crossable axis. `key: 'format'` is the format pool; variable pools use
 *  the binding path (`props.text_layer_1`) as key. */
export interface MatrixPool {
  key: string
  label: string
  kind: 'format' | 'text' | 'image'
  values: MatrixPoolValue[]
}

export interface MatrixCombo {
  format: string
  /** Binding path → cell value (format pool excluded). */
  values: Record<string, string>
  /** Pool key → chosen value's display label (format pool included). */
  labels: Record<string, string>
  /** Stamped by the sheet via comboFilename before rendering. */
  filename?: string
}

/** Cartesian product in pool order: first pool varies slowest, last fastest.
 *  Empty pools contribute no axis (defensive — the sheet requires ≥1 each). */
export function planMatrix(pools: MatrixPool[]): MatrixCombo[] {
  const active = pools.filter(p => p.values.length > 0)
  let combos: MatrixCombo[] = [{ format: '', values: {}, labels: {} }]
  for (const pool of active) {
    const next: MatrixCombo[] = []
    for (const combo of combos) {
      for (const v of pool.values) {
        next.push({
          format: pool.key === 'format' ? v.value : combo.format,
          values: pool.key === 'format' ? combo.values : { ...combo.values, [pool.key]: v.value },
          labels: { ...combo.labels, [pool.key]: v.label },
        })
      }
    }
    combos = next
  }
  return combos
}

/** Distinct, non-empty cell values of a column, in row order. */
export function columnPool(c: CollectionData, columnKey: string): MatrixPoolValue[] {
  const seen = new Set<string>()
  const out: MatrixPoolValue[] = []
  for (const row of c.rows) {
    const v = String(row.values[columnKey] ?? '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push({ value: v, label: v })
  }
  return out
}

/** `summer-launch_9x16_fresh-skin_bottle-2_5.png` — sanitized label parts,
 *  1-based index suffix to disambiguate collisions. */
export function comboFilename(layoutName: string, combo: MatrixCombo, index: number): string {
  const parts = [layoutName, ...Object.values(combo.labels)].map(sanitize).filter(Boolean)
  return `${parts.join('_')}_${index + 1}.png`
}

// -- BatchGrid node payload ---------------------------------------------------

export const BATCH_PROP = 'sailor_batch'

export interface BatchGridItem {
  url: string
  filename: string
  format: string
  formatLabel: string
  /** Pool display label → chosen value's display label. */
  vars: Record<string, string>
}

export interface BatchGridPayload {
  createdAt: string
  sourceNodeId: string
  layoutName: string
  items: BatchGridItem[]
}

/** Pair combos with rendered urls (index-aligned), dropping failures. */
export function buildBatchPayload(
  sourceNodeId: string,
  layoutName: string,
  pools: MatrixPool[],
  combos: MatrixCombo[],
  urls: (string | undefined)[],
  createdAt: string,
): BatchGridPayload {
  const poolLabel = new Map(pools.map(p => [p.key, p.label]))
  const items: BatchGridItem[] = []
  combos.forEach((combo, i) => {
    const url = urls[i]
    if (!url) return
    const vars: Record<string, string> = {}
    for (const [key, label] of Object.entries(combo.labels)) {
      if (key === 'format') continue
      vars[poolLabel.get(key) ?? key] = label
    }
    items.push({
      url,
      filename: combo.filename ?? comboFilename(layoutName, combo, i),
      format: combo.format,
      formatLabel: combo.labels['format'] ?? combo.format,
      vars,
    })
  })
  return { createdAt, sourceNodeId, layoutName, items }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/collection-matrix.unit.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/collection/matrix.ts tests/unit/collection-matrix.unit.spec.ts
git commit -m "feat(smart-layout): cartesian matrix planner for batch export"
```

---

### Task 2: Matrix render item (payload builder + pipeline fn)

**Files:**
- Modify: `app/lib/collection/generate.ts` (append; also export the existing `outputFormatFor` logic via the new helper)
- Test: `tests/unit/collection-matrix-render.unit.spec.ts`

**Interfaces:**
- Consumes: `MatrixCombo` (Task 1); `resolveBindings`, `splitRenderOverrides` from `./resolve`; `readTemplateFromNode` from `./bindables`; existing private `uploadAndRegister` + `outputFormatFor` in this file.
- Produces:
  - `matrixRenderPayload(template: unknown, collection: CollectionData | undefined, bindings: VarBindings, combo: MatrixCombo): { outputId: string; aspect: string; props: Record<string, string>; brand: Record<string, string> }` — PURE (exported for tests): preview-row resolution as the base, combo values merged OVER it.
  - `buildMatrixRenderItem(target, collection: CollectionData | undefined, bindings: VarBindings, combos: MatrixCombo[], runStamp: string): (item: BatchItem) => Promise<void>` — `item.rowIndex` indexes into `combos`; renders, uploads, sets `item.url`/`item.assetName`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/collection-matrix-render.unit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matrixRenderPayload } from '~/lib/collection/generate'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import type { VarBindings } from '~/lib/collection/types'

const TEMPLATE = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 }, '9x16': { w: 1080, h: 1920 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#000' },
  elements: [],
}

function fixture() {
  const c = createCollection('T')
  addColumn(c, 'tag', 'text')
  addColumn(c, 'accent', 'color')
  const r = addRow(c)
  setCell(c, r.id, 'tag', 'preview tagline')
  setCell(c, r.id, 'accent', '#ff0000')
  const bindings: VarBindings = {
    'props.text_layer_1': { collectionId: c.id, columnKey: 'tag' },
    'brand.primary': { collectionId: c.id, columnKey: 'accent' },
  }
  return { c, bindings }
}

describe('matrixRenderPayload', () => {
  it('merges combo values OVER the preview-row base; brand stays from preview row', () => {
    const { c, bindings } = fixture()
    const p = matrixRenderPayload(TEMPLATE, c, bindings, {
      format: '9x16', values: { 'props.text_layer_1': 'crossed tagline' }, labels: {},
    })
    expect(p.outputId).toBe('9x16')
    expect(p.aspect).toBe('9x16')
    expect(p.props.text_layer_1).toBe('crossed tagline')   // combo wins
    expect(p.brand.primary).toBe('#ff0000')                // preview row survives
  })

  it('non-crossed bound props keep their preview-row value', () => {
    const { c, bindings } = fixture()
    const p = matrixRenderPayload(TEMPLATE, c, bindings, { format: '1x1', values: {}, labels: {} })
    expect(p.props.text_layer_1).toBe('preview tagline')
  })

  it('works with no collection at all (formats-only batch)', () => {
    const p = matrixRenderPayload(TEMPLATE, undefined, {}, { format: '1x1', values: {}, labels: {} })
    expect(p.props).toEqual({})
    expect(p.brand).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/collection-matrix-render.unit.spec.ts`
Expected: FAIL — `matrixRenderPayload` not exported.

- [ ] **Step 3: Implement in `generate.ts`** (append after `buildRenderItem`; add `import type { MatrixCombo } from './matrix'` to the imports)

```ts
/** PURE payload builder for one matrix combo: preview-row resolution is the
 *  base (non-crossed bindings keep their current values), combo values merge
 *  OVER it. Exported separately from the fetch/upload wrapper for testing. */
export function matrixRenderPayload(
  template: unknown,
  collection: CollectionData | undefined,
  bindings: VarBindings,
  combo: MatrixCombo,
): { outputId: string; aspect: string; props: Record<string, string>; brand: Record<string, string> } {
  let props: Record<string, string> = {}
  let brand: Record<string, string> = {}
  if (collection) {
    const { values } = resolveBindings(collection, bindings, collection.previewRow)
    ;({ props, brand } = splitRenderOverrides(values))
  }
  for (const [path, v] of Object.entries(combo.values)) {
    if (path.startsWith('props.')) props[path.slice(6)] = v
    else if (path.startsWith('brand.')) brand[path.slice(6)] = v
  }
  return { outputId: combo.format, aspect: outputFormatFor(template, combo.format), props, brand }
}

/** Per-item render fn for a matrix batch: `item.rowIndex` indexes `combos`.
 *  Mirrors buildRenderItem's render → upload → register flow. */
export function buildMatrixRenderItem(
  target: { data?: { widgetDefs?: { name: string }[]; widgetsValues?: unknown[] } },
  collection: CollectionData | undefined,
  bindings: VarBindings,
  combos: MatrixCombo[],
  runStamp: string,
): (item: BatchItem) => Promise<void> {
  return async (item: BatchItem) => {
    const template = readTemplateFromNode(target)
    if (!template) throw new Error('render failed: no template')
    const combo = combos[item.rowIndex]
    if (!combo) throw new Error('render failed: no combo for item')

    const { outputId, aspect, props, brand } = matrixRenderPayload(template, collection, bindings, combo)
    const res = await fetch('/api/render-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, outputId, aspect, props, brand }),
    })
    if (!res.ok) throw new Error('render failed: ' + res.status)
    const blob = await res.blob()

    const fname = combo.filename ?? `batch_${runStamp}_${item.rowIndex + 1}.png`
    const { viewUrl } = await uploadAndRegister(blob, fname)
    item.url = viewUrl
    item.assetName = fname
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/collection-matrix-render.unit.spec.ts tests/unit/collection-generate.unit.spec.ts`
Expected: PASS (new tests + no regression in existing generate tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/collection/generate.ts tests/unit/collection-matrix-render.unit.spec.ts
git commit -m "feat(smart-layout): matrix render item for cartesian batch runs"
```

---

### Task 3: BatchGrid node type + gallery modal

**Files:**
- Create: `app/components/vue-canvas/BatchGridNode.vue`
- Create: `app/components/vue-canvas/BatchGridModal.vue`
- Modify: `app/composables/useVueNodes.ts` (ARTIFACT_NODE_COMPONENTS, ~line 204)
- Modify: `app/lib/agent/capabilities.ts` (FRONTEND_ONLY_NODE_TYPES, ~line 329)
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (node component registry, ~line 237)

**Interfaces:**
- Consumes: `BATCH_PROP`, `BatchGridPayload`, `BatchGridItem` from Task 1; JSZip.
- Produces: node type `'BatchGrid'` renderable on the canvas; reads its data from `props.data.properties[BATCH_PROP]`.

- [ ] **Step 1: Register the type**

`app/composables/useVueNodes.ts` — in `ARTIFACT_NODE_COMPONENTS`, after the `Reference` entry:

```ts
  // BatchGrid: frontend-only results deck from Smart Layout batch export —
  // no backend class_type; holds rendered output URLs in properties.
  BatchGrid: 'batch-grid',
```

`app/lib/agent/capabilities.ts` — extend the explicit list:

```ts
export const FRONTEND_ONLY_NODE_TYPES: Set<string> = new Set([
  ...studioNodeTypes().map(n => n.name),
  'LipSyncStudio',
  'Reference',
  'BatchGrid',
])
```

`app/components/vue-canvas/VueNodeCanvas.vue` — next to `'collection': markRaw(CollectionNode)` add the import and entry:

```ts
import BatchGridNode from '~/components/vue-canvas/BatchGridNode.vue'
// in the nodeTypes map:
  'batch-grid': markRaw(BatchGridNode),
```

- [ ] **Step 2: Create `BatchGridNode.vue`** (stacked-deck card)

```vue
<script setup lang="ts">
// Frontend-only results deck from a Smart Layout batch export. Shows the
// first output as a stacked deck + count badge; click opens the gallery
// modal (owned here, teleported to body). Data lives in
// properties.sailor_batch and rehydrates with the workflow.
import { Images } from 'lucide-vue-next'
import { BATCH_PROP, type BatchGridPayload } from '~/lib/collection/matrix'

const props = defineProps<{ id: string; data: any }>()

const payload = computed<BatchGridPayload | null>(
  () => props.data?.properties?.[BATCH_PROP] ?? null)
const cover = computed(() => payload.value?.items?.[0]?.url ?? '')
const count = computed(() => payload.value?.items?.length ?? 0)

const galleryOpen = ref(false)
</script>

<template>
  <div class="w-[240px] rounded-xl bg-[#141419] border border-white/10 shadow-lg select-none">
    <div class="flex items-center gap-1.5 px-3 h-9 border-b border-white/[0.06]">
      <Images class="size-3.5 text-white/60" />
      <span class="text-xs text-white/85 truncate">{{ payload?.layoutName || 'Batch' }}</span>
      <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{{ count }}</span>
    </div>
    <div class="p-3 nopan nodrag">
      <button
        class="relative block w-full cursor-pointer group"
        title="Open gallery"
        @click="galleryOpen = true"
      >
        <!-- deck shadows -->
        <div class="absolute inset-0 translate-x-2 translate-y-2 rounded-md bg-white/[0.04] border border-white/10" />
        <div class="absolute inset-0 translate-x-1 translate-y-1 rounded-md bg-white/[0.07] border border-white/10" />
        <img
          v-if="cover"
          :src="cover"
          class="relative w-full rounded-md border border-white/15 group-hover:border-white/30 transition-colors"
          draggable="false"
        >
        <div v-else class="relative w-full aspect-square rounded-md bg-white/[0.05] flex items-center justify-center text-white/30 text-xs">
          no outputs
        </div>
      </button>
      <p class="mt-2 text-[10px] text-white/40 text-center">Click to browse {{ count }} outputs</p>
    </div>

    <Teleport to="body">
      <VueCanvasBatchGridModal v-if="galleryOpen && payload" :payload="payload" @close="galleryOpen = false" />
    </Teleport>
  </div>
</template>
```

(Nuxt auto-imports components under `app/components/vue-canvas/` with the `VueCanvas` prefix — same convention as `VueCanvasSmartLayoutNodeBody`.)

- [ ] **Step 3: Create `BatchGridModal.vue`** (gallery grouped by format, downloads, ZIP)

```vue
<script setup lang="ts">
// Gallery for a BatchGrid node: contact-sheet grid grouped by format,
// per-image download + Download-all ZIP (same JSZip pattern as
// CollectionDrawer.exportZip).
import JSZip from 'jszip'
import { Download, X, Loader2 } from 'lucide-vue-next'
import type { BatchGridItem, BatchGridPayload } from '~/lib/collection/matrix'

const props = defineProps<{ payload: BatchGridPayload }>()
const emit = defineEmits<{ close: [] }>()

const byFormat = computed<{ label: string; items: BatchGridItem[] }[]>(() => {
  const groups = new Map<string, BatchGridItem[]>()
  for (const item of props.payload.items) {
    const list = groups.get(item.formatLabel) ?? []
    list.push(item)
    groups.set(item.formatLabel, list)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
})

function varsLine(item: BatchGridItem): string {
  return Object.entries(item.vars).map(([k, v]) => `${k}: ${v}`).join(' · ')
}

function downloadOne(item: BatchGridItem) {
  const a = document.createElement('a')
  a.href = item.url
  a.download = item.filename
  a.click()
}

const zipping = ref(false)
async function downloadZip() {
  if (zipping.value) return
  zipping.value = true
  try {
    const zip = new JSZip()
    for (const item of props.payload.items) {
      const blob = await fetch(item.url).then(r => r.blob())
      zip.file(item.filename, blob)
    }
    const out = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(out)
    const a = document.createElement('a')
    a.href = url
    a.download = `${props.payload.layoutName || 'batch'}_export.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } finally {
    zipping.value = false
  }
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-6" @click.self="emit('close')">
    <div class="w-full max-w-5xl max-h-[85vh] rounded-xl bg-[#141419] border border-white/10 flex flex-col overflow-hidden">
      <div class="flex items-center gap-2 px-4 h-12 border-b border-white/[0.08] shrink-0">
        <p class="text-sm text-white/90">{{ payload.layoutName || 'Batch export' }}</p>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{{ payload.items.length }} outputs</span>
        <button
          class="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/85 cursor-pointer disabled:opacity-50"
          :disabled="zipping"
          @click="downloadZip"
        >
          <Loader2 v-if="zipping" class="size-3.5 animate-spin" />
          <Download v-else class="size-3.5" />
          Download all (ZIP)
        </button>
        <button class="size-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>
      <div class="overflow-y-auto p-4 flex flex-col gap-5">
        <section v-for="group in byFormat" :key="group.label">
          <p class="text-[11px] uppercase tracking-wide text-white/40 mb-2">{{ group.label }} · {{ group.items.length }}</p>
          <div class="grid grid-cols-3 md:grid-cols-4 gap-3">
            <figure v-for="item in group.items" :key="item.filename" class="group relative">
              <img :src="item.url" class="w-full rounded-md border border-white/10" loading="lazy" draggable="false">
              <button
                class="absolute top-1.5 right-1.5 size-6 rounded bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                title="Download"
                @click="downloadOne(item)"
              >
                <Download class="size-3.5" />
              </button>
              <figcaption class="mt-1 text-[10px] text-white/45 truncate" :title="varsLine(item)">{{ varsLine(item) || item.formatLabel }}</figcaption>
            </figure>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Verify (compile-level)**

Run: `npx nuxt typecheck 2>&1 | grep -E "BatchGrid" ; true`
Expected: no errors mentioning BatchGrid files.

- [ ] **Step 5: Commit**

```bash
git add app/components/vue-canvas/BatchGridNode.vue app/components/vue-canvas/BatchGridModal.vue app/composables/useVueNodes.ts app/lib/agent/capabilities.ts app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(smart-layout): BatchGrid results node (deck card + gallery modal)"
```

**NOTE for the committer:** `VueNodeCanvas.vue` and `useVueNodes.ts` may carry OTHER sessions' uncommitted hunks. Before `git add`, check `git diff` on each and, if foreign hunks exist, stage only your hunks via a filtered patch + `git apply --cached` (same technique as the GridPropertyPanel commit earlier in this session).

---

### Task 4: Batch export sheet + entry points + spawn wiring

**Files:**
- Create: `app/components/vue-canvas/BatchExportModal.vue`
- Modify: `app/components/vue-canvas/SmartLayoutNodeBody.vue` (emit + button)
- Modify: `app/components/vue-canvas/ComfyNode.vue` (~line 1637: forward the event)
- Modify: `app/components/vue-canvas/SmartLayoutEditorModal.vue` (header button)
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (open-state ref, event listener, Teleport instance, spawn handler)

**Interfaces:**
- Consumes: `planMatrix`, `columnPool`, `comboFilename`, `buildBatchPayload`, `BATCH_PROP`, `MatrixPool` (Task 1); `buildMatrixRenderItem` (Task 2); `runBatch`, `BatchItem` from `~/lib/collection/batch`; `readTemplateFromNode` from `~/lib/collection/bindables`; `deriveOutputs` from `~~/shared/template-grid/resolve`; `findWiredCollectionNode` from `~/composables/useStudioVarBindings`; `BINDINGS_PROP`, `COLLECTION_PROP` from `~/lib/collection/types`; `createNodeData` (canvas-internal).
- Produces: window event contract `sailor:openBatchExport { detail: { nodeId } }`; `BatchExportModal` emits `spawn(payload: BatchGridPayload)` and `close`.

- [ ] **Step 1: Create `BatchExportModal.vue`**

```vue
<script setup lang="ts">
// Batch export sheet for a Smart Layout node: pick formats + bound-variable
// values, render the cartesian product through the existing runBatch
// pipeline, then emit `spawn` with the successful items so the canvas can
// drop a BatchGrid node. Spec: docs/superpowers/specs/
// 2026-07-11-smart-layout-batch-export-design.md
import { Grid3X3, Loader2, X } from 'lucide-vue-next'
import { planMatrix, columnPool, comboFilename, buildBatchPayload, type MatrixPool, type MatrixCombo, type BatchGridPayload } from '~/lib/collection/matrix'
import { buildMatrixRenderItem } from '~/lib/collection/generate'
import { runBatch, type BatchItem } from '~/lib/collection/batch'
import { readTemplateFromNode } from '~/lib/collection/bindables'
import { resolveBindings } from '~/lib/collection/resolve'
import { deriveOutputs } from '~~/shared/template-grid/resolve'
import { findWiredCollectionNode } from '~/composables/useStudioVarBindings'
import { BINDINGS_PROP, COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionData, VarBindings } from '~/lib/collection/types'

const props = defineProps<{ nodeId: string; nodes: any[]; edges: any[] }>()
const emit = defineEmits<{ close: []; spawn: [payload: BatchGridPayload] }>()

const node = computed(() => props.nodes.find((n: any) => String(n.id) === String(props.nodeId)))
const template = computed(() => readTemplateFromNode(node.value))
const layoutName = computed(() => (template.value as any)?.name || 'Layout')

const collection = computed<CollectionData | undefined>(() => {
  const colNode = findWiredCollectionNode(props.nodes, props.edges, String(props.nodeId))
  return colNode?.data?.properties?.[COLLECTION_PROP]
})
const bindings = computed<VarBindings>(() =>
  (node.value?.data?.properties?.[BINDINGS_PROP] ?? {}) as VarBindings)

/** All crossable pools with their FULL value lists (selection is separate). */
const pools = computed<MatrixPool[]>(() => {
  const out: MatrixPool[] = []
  const outputs = template.value ? deriveOutputs(template.value as any) : []
  out.push({
    key: 'format', label: 'Formats', kind: 'format',
    values: outputs.map((o: any) => ({ value: o.id, label: o.label ?? o.format ?? o.id })),
  })
  const c = collection.value
  if (c) {
    for (const [path, b] of Object.entries(bindings.value)) {
      if (!path.startsWith('props.') || !b || b.collectionId !== c.id) continue
      const col = c.columns.find(x => x.key === b.columnKey)
      if (!col) continue
      out.push({
        key: path,
        label: col.label || col.key,
        kind: col.type === 'image' ? 'image' : 'text',
        values: columnPool(c, col.key),
      })
    }
  }
  return out.filter(p => p.values.length > 0)
})

/** pool key → Set of selected values. Defaults: formats all; variables just
 *  the preview-row value (so the count starts at N formats). */
const selected = ref<Record<string, Set<string>>>({})
watch(pools, (ps) => {
  const next: Record<string, Set<string>> = {}
  const c = collection.value
  const previewValues = c ? resolveBindings(c, bindings.value, c.previewRow).values : {}
  for (const p of ps) {
    if (selected.value[p.key]) { next[p.key] = selected.value[p.key]; continue }
    if (p.key === 'format') next[p.key] = new Set(p.values.map(v => v.value))
    else {
      const pv = String(previewValues[p.key] ?? '')
      next[p.key] = new Set(pv && p.values.some(v => v.value === pv) ? [pv] : [p.values[0]!.value])
    }
  }
  selected.value = next
}, { immediate: true })

function toggle(poolKey: string, value: string) {
  const set = new Set(selected.value[poolKey] ?? [])
  if (set.has(value)) set.delete(value)
  else set.add(value)
  selected.value = { ...selected.value, [poolKey]: set }
}

const selectedPools = computed<MatrixPool[]>(() => pools.value.map(p => ({
  ...p, values: p.values.filter(v => selected.value[p.key]?.has(v.value)),
})))
const total = computed(() => selectedPools.value.reduce((acc, p) => acc * Math.max(1, p.values.length), 1))
const countLine = computed(() =>
  selectedPools.value.map(p => `${p.values.length} ${p.label.toLowerCase()}`).join(' × ') + ` = ${total.value} outputs`)
const canGenerate = computed(() =>
  !running.value && selectedPools.value.every(p => p.values.length >= 1) && total.value >= 1)

// -- Run ----------------------------------------------------------------------
const running = ref(false)
const confirmBig = ref(false)
const items = ref<BatchItem[]>([])
let combos: MatrixCombo[] = []
const runSignal = ref<{ cancelled: boolean } | null>(null)
const doneCount = computed(() => items.value.filter(i => i.status === 'done').length)
const failedItems = computed(() => items.value.filter(i => i.status === 'failed'))

async function generate() {
  if (!canGenerate.value || !node.value) return
  if (total.value > 100 && !confirmBig.value) { confirmBig.value = true; return }
  confirmBig.value = false
  running.value = true
  const signal = { cancelled: false }
  runSignal.value = signal
  try {
    const runStamp = Date.now().toString(36)
    combos = planMatrix(selectedPools.value)
      .map((c, i) => ({ ...c, filename: comboFilename(layoutName.value, c, i) }))
    items.value = combos.map((c, i) => ({
      id: `m-${runStamp}-${i}`, rowIndex: i, rowId: '', outputId: c.format, status: 'queued' as const,
    }))
    const renderItem = buildMatrixRenderItem(node.value, collection.value, bindings.value, combos, runStamp)
    await runBatch(items.value, renderItem, {
      concurrency: 3, signal,
      onUpdate: () => { items.value = [...items.value] },
    })
    if (signal.cancelled) return
    const urls = items.value.map(i => (i.status === 'done' ? i.url : undefined))
    const payload = buildBatchPayload(
      String(props.nodeId), layoutName.value, selectedPools.value, combos, urls, new Date().toISOString())
    if (payload.items.length) {
      emit('spawn', payload)
      if (!failedItems.value.length) emit('close')
    }
  } finally {
    running.value = false
    runSignal.value = null
  }
}

async function retryFailed() {
  const failed = items.value.filter(i => i.status === 'failed')
  if (!failed.length || !node.value) return
  for (const f of failed) { f.status = 'queued'; f.error = undefined }
  running.value = true
  const signal = { cancelled: false }
  runSignal.value = signal
  try {
    const renderItem = buildMatrixRenderItem(node.value, collection.value, bindings.value, combos, 'retry')
    await runBatch(failed, renderItem, { concurrency: 3, signal, onUpdate: () => { items.value = [...items.value] } })
  } finally {
    running.value = false
    runSignal.value = null
  }
}

function cancel() { if (runSignal.value) runSignal.value.cancelled = true }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !running.value) emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-6" @click.self="!running && emit('close')">
    <div class="w-full max-w-2xl max-h-[85vh] rounded-xl bg-[#141419] border border-white/10 flex flex-col overflow-hidden">
      <div class="flex items-center gap-2 px-4 h-12 border-b border-white/[0.08] shrink-0">
        <Grid3X3 class="size-4 text-white/60" />
        <p class="text-sm text-white/90">Batch export · {{ layoutName }}</p>
        <button class="ml-auto size-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer" :disabled="running" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>

      <div class="overflow-y-auto p-4 flex flex-col gap-4">
        <section v-for="pool in pools" :key="pool.key">
          <p class="text-[11px] uppercase tracking-wide text-white/40 mb-1.5">{{ pool.label }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="v in pool.values" :key="v.value"
              class="cursor-pointer rounded-md border transition-colors"
              :class="[
                pool.kind === 'image' ? 'p-0.5' : 'px-2 py-1 text-xs',
                selected[pool.key]?.has(v.value)
                  ? 'border-[#96b4ff]/70 bg-[#96b4ff]/15 text-white'
                  : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/25',
              ]"
              @click="toggle(pool.key, v.value)"
            >
              <img v-if="pool.kind === 'image'" :src="v.value" class="size-12 rounded object-cover" draggable="false">
              <template v-else>{{ v.label }}</template>
            </button>
          </div>
        </section>

        <!-- Progress -->
        <section v-if="items.length">
          <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div class="h-full bg-[#96b4ff] transition-all" :style="{ width: `${(doneCount / items.length) * 100}%` }" />
          </div>
          <p class="mt-1.5 text-[11px] text-white/50">
            {{ doneCount }}/{{ items.length }} rendered
            <template v-if="failedItems.length"> · <span class="text-red-400">{{ failedItems.length }} failed</span></template>
          </p>
          <button v-if="failedItems.length && !running" class="mt-1 text-[11px] text-[#96b4ff] cursor-pointer hover:underline" @click="retryFailed">
            Retry failed
          </button>
        </section>
      </div>

      <div class="px-4 h-14 border-t border-white/[0.08] flex items-center gap-3 shrink-0">
        <p class="text-xs text-white/60">{{ countLine }}</p>
        <div class="ml-auto flex items-center gap-2">
          <button v-if="running" class="h-8 px-3 rounded-md bg-white/10 text-xs text-white/80 cursor-pointer" @click="cancel">Cancel</button>
          <button
            class="h-8 px-4 rounded-md bg-[#96b4ff] text-neutral-900 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default flex items-center gap-1.5"
            :disabled="!canGenerate"
            @click="generate"
          >
            <Loader2 v-if="running" class="size-3.5 animate-spin" />
            {{ confirmBig ? `Really render ${total} images?` : 'Generate' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Entry point — node body**

`SmartLayoutNodeBody.vue`: extend the emits and add a button below the Edit-layout button:

```ts
const emit = defineEmits<{ edit: []; batch: [] }>()
```

```vue
    <!-- Batch export — cartesian render across formats × bound variables -->
    <button
      class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white text-[11px] transition-colors cursor-pointer border border-white/10"
      @click="emit('batch')"
    >
      Batch export
    </button>
```

(No disabled state needed: every Smart Layout template carries format presets
— even the backend starter layout ships 10 — so the sheet always has at least
a Formats section, and its own `canGenerate` guard covers degenerate cases.)

- [ ] **Step 3: Entry point — ComfyNode forward + editor modal button**

`ComfyNode.vue` — next to `openSmartLayoutEditor` (~line 837):

```ts
function openBatchExport() {
  window.dispatchEvent(new CustomEvent('sailor:openBatchExport', { detail: { nodeId: props.id } }))
}
```

and on the `<VueCanvasSmartLayoutNodeBody>` usage (~line 1637): add `@batch="openBatchExport"`.

`SmartLayoutEditorModal.vue` — add a "Batch export" button in the header toolbar (next to the existing header buttons around line 573), dispatching the same event with `props.nodeId`:

```ts
function openBatchExport() {
  window.dispatchEvent(new CustomEvent('sailor:openBatchExport', { detail: { nodeId: props.nodeId } }))
}
```

```vue
    <button
      class="h-7 px-2.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/85 cursor-pointer"
      @click="openBatchExport"
    >
      Batch export
    </button>
```

- [ ] **Step 4: Canvas wiring — listener, modal instance, spawn handler**

`VueNodeCanvas.vue`, next to the `smartLayoutOpenForId` block (~line 3739):

```ts
const batchExportOpenForId = ref<string | null>(null)
function handleOpenBatchExport(e: Event) {
  const detail = (e as CustomEvent<{ nodeId: string }>).detail
  if (detail?.nodeId) batchExportOpenForId.value = String(detail.nodeId)
}

/** Spawn a BatchGrid node beside the source Smart Layout with the results. */
function handleBatchSpawn(payload: import('~/lib/collection/matrix').BatchGridPayload) {
  const src = (nodes.value as any[]).find(n => String(n.id) === payload.sourceNodeId)
  const pos = src
    ? { x: (src.position?.x ?? 0) + ((src.data?.size?.[0] ?? 260) as number) + 80, y: (src.position?.y ?? 0) + 40 }
    : { x: 200, y: 200 }
  const gridNode = createNodeData('BatchGrid', pos)
  if (!gridNode.data.properties) gridNode.data.properties = {}
  gridNode.data.properties[BATCH_PROP] = payload
  gridNode.data.title = `Batch · ${payload.layoutName}`
  nodes.value.push(gridNode)
}
```

Register/unregister `sailor:openBatchExport` → `handleOpenBatchExport` exactly where the `sailor:openSmartLayout` listener is added/removed (find the `addEventListener('sailor:openSmartLayout'...)` pair and mirror it). Import `BATCH_PROP` from `~/lib/collection/matrix`.

Template — next to the SmartLayoutEditorModal Teleport (~line 6836):

```vue
    <!-- Smart Layout batch export sheet -->
    <Teleport to="body">
      <VueCanvasBatchExportModal
        v-if="batchExportOpenForId"
        :node-id="batchExportOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="batchExportOpenForId = null"
        @spawn="handleBatchSpawn"
      />
    </Teleport>
```

Also add `batchExportOpenForId` to the modal-open guard expression at ~line 3766 (the `smartLayoutOpenForId.value || modelGalleryOpenForId.value || ...` chain) so canvas shortcuts stay suppressed while the sheet is open.

- [ ] **Step 5: Automated verification**

Run: `npx vitest run tests/unit/collection-matrix.unit.spec.ts tests/unit/collection-matrix-render.unit.spec.ts tests/unit/collection-batch.unit.spec.ts && npx nuxt typecheck 2>&1 | grep -E "BatchExport|BatchGrid|SmartLayoutNodeBody" ; true`
Expected: tests PASS; no typecheck errors in the new/touched components.

- [ ] **Step 6: Manual verification (dev app)**

1. Open the app, load a project with a Smart Layout node bound to a Collection (≥2 values in a bound column, ≥2 formats in the layout).
2. Node body shows "Batch export"; click → sheet lists Formats (all checked) + variable sections (preview value checked). Footer math updates as you toggle.
3. Generate a small batch (e.g. 2×2) → progress fills → sheet closes → a BatchGrid deck node appears beside the Smart Layout node with count badge "4".
4. Click the deck → gallery grid grouped by format, labels correct, single download works, ZIP downloads 4 files.
5. Reload the page → the BatchGrid node rehydrates with its images.
6. Run the graph (Generate) → run succeeds; the BatchGrid node is absent from the executed prompt (check `/history`: no BatchGrid class).
7. From the editor modal header, "Batch export" opens the same sheet.

- [ ] **Step 7: Commit**

```bash
git add app/components/vue-canvas/BatchExportModal.vue app/components/vue-canvas/SmartLayoutNodeBody.vue app/components/vue-canvas/ComfyNode.vue app/components/vue-canvas/SmartLayoutEditorModal.vue app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(smart-layout): batch export sheet + BatchGrid spawn wiring"
```

**NOTE for the committer:** same foreign-hunk caution as Task 3 for `VueNodeCanvas.vue` and `ComfyNode.vue`.
