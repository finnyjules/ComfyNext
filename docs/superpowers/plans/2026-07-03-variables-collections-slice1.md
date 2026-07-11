# Variables & Collections — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collection node (data table) on the canvas that binds to a Smart Layout node via one `VARS` wire and drives it: live preview-row scrub, drawer table editor with CSV import, and a batch generate that renders every row via `/api/render-template`, saves results to Assets, and shows a results grid.

**Architecture:** Pure logic lives in `frontend/app/lib/collection/` (types, CSV parse, binding resolution, batch runner) — all unit-tested. The Collection node is a frontend-only vue-flow node (`sailor_collection` in `node.data.properties`, like `sailor_localGroups`); bindings live on the *target* node (`sailor_varBindings`). The drawer is a bottom panel teleported from `VueNodeCanvas.vue`. Live preview uses a resolve-on-write pattern: whenever the collection's preview row / cells / bindings change, resolved `{props, brand}` are written to the target node's `properties.sailor_varPreview`; `SmartLayoutNodeBody` watches that and renders a debounced on-node preview.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / vue-flow / Tailwind / Vitest / JSZip (already installed).

## Global Constraints

- Work directly on `main` — NO feature branches (user rule).
- `git add` ONLY the exact files you created/modified — NEVER `git add -A` (user rule).
- No purple/violet accents anywhere. Neutral white-opacity + emerald only for run actions. Pastel gradients are reserved for AI-powered affordances.
- Dark UI tokens: `bg-[#141414]` panels, `bg-[#0a0a0a]` canvases, `border-[#2a2a2a]` / `border-white/10` hairlines, `text-white/90` primary, `text-white/40` muted.
- UI copy: sentence case, no Title Case.
- Unit tests: `frontend/tests/unit/<name>.unit.spec.ts`, run with `cd frontend && npm run test:unit -- tests/unit/<name>.unit.spec.ts`. Imports use `~/` for `frontend/app/`.
- Frontend only — no ComfyUI restart needed. Dev server: `cd frontend && npm run dev`.
- The gotcha: `node.data.nodeType` is the backend class name ('Collection', 'SmartLayout'); `node.type` is the vue-flow component key ('collection', 'comfy'). Never confuse them.

---

### Task 1: Collection types + model helpers

**Files:**
- Create: `frontend/app/lib/collection/types.ts`
- Create: `frontend/app/lib/collection/model.ts`
- Test: `frontend/tests/unit/collection-model.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CollectionData`, `CollectionColumn`, `CollectionRow`, `VariableType`, `VarBinding`, `VarBindings`, constants `COLLECTION_PROP = 'sailor_collection'`, `BINDINGS_PROP = 'sailor_varBindings'`, `VAR_PREVIEW_PROP = 'sailor_varPreview'`, `VARS_TYPE = 'VARS'`; functions `createCollection(name?)`, `keyFromLabel(label, existing)`, `addColumn(col, label, type)`, `addRow(col)`, `removeRow(col, rowId)`, `removeColumn(col, key)`, `setCell(col, rowId, key, value)`, `clampPreviewRow(col)`, `rowLabel(col, index)`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-model.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  createCollection, keyFromLabel, addColumn, addRow, setCell,
  removeColumn, removeRow, clampPreviewRow, rowLabel,
} from '~/lib/collection/model'

describe('createCollection', () => {
  it('creates an empty named collection with previewRow 0', () => {
    const c = createCollection('Teams')
    expect(c.name).toBe('Teams')
    expect(c.columns).toEqual([])
    expect(c.rows).toEqual([])
    expect(c.previewRow).toBe(0)
    expect(c.id).toMatch(/^col_/)
  })
})

describe('keyFromLabel', () => {
  it('snake_cases labels', () => {
    expect(keyFromLabel('Fill color', [])).toBe('fill_color')
  })
  it('dedupes against existing keys with _2 suffix', () => {
    expect(keyFromLabel('Team', ['team'])).toBe('team_2')
    expect(keyFromLabel('Team', ['team', 'team_2'])).toBe('team_3')
  })
  it('falls back to "column" for empty labels', () => {
    expect(keyFromLabel('  ', [])).toBe('column')
  })
})

describe('rows and cells', () => {
  it('addColumn + addRow + setCell round-trips', () => {
    const c = createCollection('t')
    const col = addColumn(c, 'Team name', 'text')
    expect(col.key).toBe('team_name')
    const row = addRow(c)
    setCell(c, row.id, 'team_name', 'France')
    expect(c.rows[0].values.team_name).toBe('France')
  })
  it('removeColumn drops values from rows', () => {
    const c = createCollection('t')
    addColumn(c, 'a', 'text')
    const r = addRow(c)
    setCell(c, r.id, 'a', 'x')
    removeColumn(c, 'a')
    expect(c.columns).toEqual([])
    expect(c.rows[0].values.a).toBeUndefined()
  })
  it('removeRow + clampPreviewRow keeps previewRow in range', () => {
    const c = createCollection('t')
    addRow(c); addRow(c)
    c.previewRow = 1
    removeRow(c, c.rows[1].id)
    clampPreviewRow(c)
    expect(c.previewRow).toBe(0)
  })
})

describe('rowLabel', () => {
  it('uses first text column value, falls back to row number', () => {
    const c = createCollection('t')
    addColumn(c, 'team', 'text')
    const r = addRow(c)
    expect(rowLabel(c, 0)).toBe('Row 1')
    setCell(c, r.id, 'team', 'France')
    expect(rowLabel(c, 0)).toBe('France')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-model.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/collection/model`

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/collection/types.ts
export type VariableType = 'text' | 'color' | 'number' | 'select' | 'image' | 'font'

export interface CollectionColumn {
  key: string
  label: string
  type: VariableType
  options?: string[]
}

export interface CollectionRow {
  id: string
  sweep?: boolean
  values: Record<string, string | number>
}

export interface CollectionData {
  id: string
  name: string
  columns: CollectionColumn[]
  rows: CollectionRow[]
  previewRow: number
}

/** One control binding on a target node: which collection column feeds it. */
export interface VarBinding {
  collectionId: string
  columnKey: string
  /** Last literal value, used when the binding dangles (deleted column/collection). */
  lastLiteral?: string | number
}

/** Keyed by bindable path, e.g. 'props.text_layer_1' or 'brand.primary'. */
export type VarBindings = Record<string, VarBinding>

export const COLLECTION_PROP = 'sailor_collection'
export const BINDINGS_PROP = 'sailor_varBindings'
export const VAR_PREVIEW_PROP = 'sailor_varPreview'
export const VARS_TYPE = 'VARS'
```

```typescript
// frontend/app/lib/collection/model.ts
import type { CollectionColumn, CollectionData, CollectionRow, VariableType } from './types'

let seq = 0
function uid(prefix: string): string {
  seq = (seq + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
}

export function createCollection(name = 'Collection'): CollectionData {
  return { id: uid('col'), name, columns: [], rows: [], previewRow: 0 }
}

export function keyFromLabel(label: string, existing: string[]): string {
  let base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) base = 'column'
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export function addColumn(c: CollectionData, label: string, type: VariableType): CollectionColumn {
  const col: CollectionColumn = {
    key: keyFromLabel(label, c.columns.map(x => x.key)),
    label: label.trim() || 'Column',
    type,
  }
  c.columns.push(col)
  return col
}

export function removeColumn(c: CollectionData, key: string): void {
  c.columns = c.columns.filter(x => x.key !== key)
  for (const r of c.rows) delete r.values[key]
}

export function addRow(c: CollectionData): CollectionRow {
  const row: CollectionRow = { id: uid('row'), values: {} }
  c.rows.push(row)
  return row
}

export function removeRow(c: CollectionData, rowId: string): void {
  c.rows = c.rows.filter(r => r.id !== rowId)
}

export function setCell(c: CollectionData, rowId: string, key: string, value: string | number): void {
  const row = c.rows.find(r => r.id === rowId)
  if (row) row.values[key] = value
}

export function clampPreviewRow(c: CollectionData): void {
  c.previewRow = Math.min(Math.max(0, c.previewRow), Math.max(0, c.rows.length - 1))
}

export function rowLabel(c: CollectionData, index: number): string {
  const row = c.rows[index]
  if (row) {
    const textCol = c.columns.find(col => col.type === 'text')
    const v = textCol ? row.values[textCol.key] : undefined
    if (v !== undefined && String(v).trim()) return String(v)
  }
  return `Row ${index + 1}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-model.unit.spec.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/types.ts frontend/app/lib/collection/model.ts frontend/tests/unit/collection-model.unit.spec.ts
git commit -m "feat(collections): core types + model helpers"
```

---

### Task 2: CSV / paste parsing + type inference

**Files:**
- Create: `frontend/app/lib/collection/parse.ts`
- Test: `frontend/tests/unit/collection-parse.unit.spec.ts`

**Interfaces:**
- Consumes: `VariableType`, `CollectionData` from `~/lib/collection/types`; `createCollection`, `addColumn`, `addRow`, `setCell` from `~/lib/collection/model`.
- Produces: `inferType(values: string[]): VariableType`, `parseDelimited(text: string): string[][]`, `importTable(c: CollectionData, text: string): void` (replaces columns+rows of `c` from pasted CSV/TSV with a header row).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-parse.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { inferType, parseDelimited, importTable } from '~/lib/collection/parse'
import { createCollection } from '~/lib/collection/model'

describe('inferType', () => {
  it('detects hex colors', () => {
    expect(inferType(['#fff', '#0C447C'])).toBe('color')
  })
  it('detects numbers', () => {
    expect(inferType(['1', '2.5', '-3'])).toBe('number')
  })
  it('detects image urls', () => {
    expect(inferType(['https://x.com/a.png', '/view?filename=b.jpg'])).toBe('image')
  })
  it('falls back to text; ignores empties', () => {
    expect(inferType(['France', ''])).toBe('text')
    expect(inferType([])).toBe('text')
  })
})

describe('parseDelimited', () => {
  it('parses comma CSV with quoted cells', () => {
    expect(parseDelimited('a,"b, c",d\n1,2,3')).toEqual([['a', 'b, c', 'd'], ['1', '2', '3']])
  })
  it('prefers tabs when present (spreadsheet paste)', () => {
    expect(parseDelimited('a\tb,c\n1\t2')).toEqual([['a', 'b,c'], ['1', '2']])
  })
  it('handles escaped quotes and CRLF', () => {
    expect(parseDelimited('"say ""hi""",x\r\n1,2')).toEqual([['say "hi"', 'x'], ['1', '2']])
  })
})

describe('importTable', () => {
  it('builds columns from header with inferred types and fills rows', () => {
    const c = createCollection('t')
    importTable(c, 'team,primary\nFrance,#0C447C\nBrazil,#639922')
    expect(c.columns.map(x => x.key)).toEqual(['team', 'primary'])
    expect(c.columns[1].type).toBe('color')
    expect(c.rows).toHaveLength(2)
    expect(c.rows[0].values.team).toBe('France')
    expect(c.rows[1].values.primary).toBe('#639922')
  })
  it('coerces number cells to numbers', () => {
    const c = createCollection('t')
    importTable(c, 'n\n1\n2.5')
    expect(c.rows[1].values.n).toBe(2.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-parse.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/collection/parse`

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/collection/parse.ts
import type { CollectionData, VariableType } from './types'
import { addColumn, addRow, clampPreviewRow, setCell } from './model'

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const IMG_RE = /(\.(png|jpe?g|webp|gif|svg)(\?|#|$))|(^\/view\?)/i
const NUM_RE = /^-?\d+(\.\d+)?$/

export function inferType(values: string[]): VariableType {
  const vs = values.map(v => v.trim()).filter(Boolean)
  if (!vs.length) return 'text'
  if (vs.every(v => HEX_RE.test(v))) return 'color'
  if (vs.every(v => NUM_RE.test(v))) return 'number'
  if (vs.every(v => IMG_RE.test(v) || (/^https?:\/\//i.test(v) && IMG_RE.test(v)))) return 'image'
  return 'text'
}

/** Parse CSV/TSV text into rows of cells. Tabs win when the first line has any. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const delim = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let cell = '', row: string[] = [], inQuotes = false
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

/** Replace the collection's columns+rows from pasted tabular text (first row = headers). */
export function importTable(c: CollectionData, text: string): void {
  const grid = parseDelimited(text)
  if (grid.length < 1) return
  const headers = grid[0]
  const body = grid.slice(1)
  c.columns = []
  c.rows = []
  const cols = headers.map((h, i) => {
    const values = body.map(r => String(r[i] ?? ''))
    return addColumn(c, h || `Column ${i + 1}`, inferType(values))
  })
  for (const src of body) {
    const row = addRow(c)
    cols.forEach((col, i) => {
      const raw = String(src[i] ?? '').trim()
      if (!raw) return
      setCell(c, row.id, col.key, col.type === 'number' && NUM_RE.test(raw) ? Number(raw) : raw)
    })
  }
  clampPreviewRow(c)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-parse.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/parse.ts frontend/tests/unit/collection-parse.unit.spec.ts
git commit -m "feat(collections): CSV/paste parsing with type inference"
```

---

### Task 3: Binding resolution + validation

**Files:**
- Create: `frontend/app/lib/collection/resolve.ts`
- Test: `frontend/tests/unit/collection-resolve.unit.spec.ts`

**Interfaces:**
- Consumes: `CollectionData`, `VarBindings`, `VariableType` from `~/lib/collection/types`.
- Produces:
  - `resolveBindings(c: CollectionData, bindings: VarBindings, rowIndex: number): { values: Record<string, string | number>; missing: string[] }` — values keyed by bindable path; `missing` lists paths that fell back to `lastLiteral` (or nothing).
  - `splitRenderOverrides(values: Record<string, string | number>): { props: Record<string, string>; brand: Record<string, string> }`.
  - `validateRun(c: CollectionData, bindings: VarBindings): { rowIndex: number; path: string; message: string }[]` — bad hex in color bindings, empty required image cells.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-resolve.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { resolveBindings, splitRenderOverrides, validateRun } from '~/lib/collection/resolve'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import type { VarBindings } from '~/lib/collection/types'

function fixture() {
  const c = createCollection('Teams')
  addColumn(c, 'team', 'text')
  addColumn(c, 'primary', 'color')
  const r1 = addRow(c); const r2 = addRow(c)
  setCell(c, r1.id, 'team', 'France'); setCell(c, r1.id, 'primary', '#0C447C')
  setCell(c, r2.id, 'team', 'Brazil'); setCell(c, r2.id, 'primary', '#639922')
  const bindings: VarBindings = {
    'props.text_layer_1': { collectionId: c.id, columnKey: 'team', lastLiteral: 'Fallback' },
    'brand.primary': { collectionId: c.id, columnKey: 'primary', lastLiteral: '#ffffff' },
  }
  return { c, bindings }
}

describe('resolveBindings', () => {
  it('resolves row values by path', () => {
    const { c, bindings } = fixture()
    const out = resolveBindings(c, bindings, 1)
    expect(out.values['props.text_layer_1']).toBe('Brazil')
    expect(out.values['brand.primary']).toBe('#639922')
    expect(out.missing).toEqual([])
  })
  it('falls back to lastLiteral when the column is gone', () => {
    const { c, bindings } = fixture()
    c.columns = c.columns.filter(x => x.key !== 'team')
    const out = resolveBindings(c, bindings, 0)
    expect(out.values['props.text_layer_1']).toBe('Fallback')
    expect(out.missing).toEqual(['props.text_layer_1'])
  })
  it('skips bindings for other collections', () => {
    const { c, bindings } = fixture()
    bindings['props.text_layer_1']!.collectionId = 'someone_else'
    const out = resolveBindings(c, bindings, 0)
    expect(out.values['props.text_layer_1']).toBeUndefined()
  })
  it('empty cell falls back to lastLiteral', () => {
    const { c, bindings } = fixture()
    delete c.rows[0].values.team
    const out = resolveBindings(c, bindings, 0)
    expect(out.values['props.text_layer_1']).toBe('Fallback')
  })
})

describe('splitRenderOverrides', () => {
  it('splits props.* and brand.* namespaces', () => {
    const { props, brand } = splitRenderOverrides({
      'props.text_layer_1': 'France', 'brand.primary': '#0C447C',
    })
    expect(props).toEqual({ text_layer_1: 'France' })
    expect(brand).toEqual({ primary: '#0C447C' })
  })
})

describe('validateRun', () => {
  it('flags invalid hex in color-typed bound cells', () => {
    const { c, bindings } = fixture()
    setCell(c, c.rows[0].id, 'primary', 'not-a-color')
    const issues = validateRun(c, bindings)
    expect(issues).toHaveLength(1)
    expect(issues[0].rowIndex).toBe(0)
    expect(issues[0].path).toBe('brand.primary')
  })
  it('passes a clean table', () => {
    const { c, bindings } = fixture()
    expect(validateRun(c, bindings)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-resolve.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/collection/resolve`

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/collection/resolve.ts
import type { CollectionData, VarBindings } from './types'

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

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
      values[path] = cell
    } else if (b.lastLiteral !== undefined) {
      values[path] = b.lastLiteral
      missing.push(path)
    } else {
      missing.push(path)
    }
  }
  return { values, missing }
}

export function splitRenderOverrides(
  values: Record<string, string | number>,
): { props: Record<string, string>; brand: Record<string, string> } {
  const props: Record<string, string> = {}
  const brand: Record<string, string> = {}
  for (const [path, v] of Object.entries(values)) {
    if (path.startsWith('props.')) props[path.slice(6)] = String(v)
    else if (path.startsWith('brand.')) brand[path.slice(6)] = String(v)
  }
  return { props, brand }
}

export function validateRun(
  c: CollectionData,
  bindings: VarBindings,
): { rowIndex: number; path: string; message: string }[] {
  const issues: { rowIndex: number; path: string; message: string }[] = []
  for (const [path, b] of Object.entries(bindings || {})) {
    if (!b || b.collectionId !== c.id) continue
    const col = c.columns.find(x => x.key === b.columnKey)
    if (!col || col.type !== 'color') continue
    c.rows.forEach((row, rowIndex) => {
      const v = row.values[col.key]
      if (v !== undefined && String(v).trim() !== '' && !HEX_RE.test(String(v))) {
        issues.push({ rowIndex, path, message: `"${v}" isn't a hex color` })
      }
    })
  }
  return issues
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-resolve.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/resolve.ts frontend/tests/unit/collection-resolve.unit.spec.ts
git commit -m "feat(collections): binding resolution with literal fallback + pre-run validation"
```

---

### Task 4: Smart Layout bindables + auto-align

**Files:**
- Create: `frontend/app/lib/collection/bindables.ts`
- Test: `frontend/tests/unit/collection-bindables.unit.spec.ts`

**Interfaces:**
- Consumes: `CollectionColumn`, `VarBindings`, `VariableType` from `~/lib/collection/types`.
- Produces:
  - `interface Bindable { path: string; label: string; type: VariableType }`
  - `listSmartLayoutBindables(template: unknown): Bindable[]` — scans the template JSON for `{{ props.<name> }}` tokens (text sockets → `text`, `image_layer_*` → `image`) and always offers the brand keys (`brand.primary|secondary|accent|accent2|foreground|background` as `color`, `brand.fontDisplay|fontBody` as `font`, `brand.logo` as `image`).
  - `readTemplateFromNode(node: { data?: { widgetDefs?: { name: string }[]; widgetsValues?: unknown[] } }): unknown | null` — parses the `layout` widget JSON (SmartLayoutEditorModal pattern).
  - `autoAlign(bindables: Bindable[], columns: CollectionColumn[], collectionId: string): VarBindings` — exact/normalized key match, type-compatible only.
  - `typeCompatible(variable: VariableType, column: VariableType): boolean`

Type compatibility rules: `text` accepts `text|number|select`; `color` accepts `color`; `image` accepts `image|text`; `number` accepts `number`; `font` accepts `font|text`; `select` accepts `select|text`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-bindables.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  listSmartLayoutBindables, readTemplateFromNode, autoAlign, typeCompatible,
} from '~/lib/collection/bindables'
import type { CollectionColumn } from '~/lib/collection/types'

const TEMPLATE = {
  version: 3,
  sections: [{
    id: 's1', name: 'main', region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 },
    children: [
      { id: 'e1', type: 'text', content: 'Hello {{ props.text_layer_1 }}' },
      { id: 'e2', type: 'image', content: '{{ props.image_layer_1 }}' },
      { id: 'e3', type: 'text', content: 'static' },
    ],
  }],
}

describe('listSmartLayoutBindables', () => {
  it('finds props sockets with types and includes brand keys', () => {
    const b = listSmartLayoutBindables(TEMPLATE)
    const paths = b.map(x => x.path)
    expect(paths).toContain('props.text_layer_1')
    expect(paths).toContain('props.image_layer_1')
    expect(paths).toContain('brand.primary')
    expect(b.find(x => x.path === 'props.image_layer_1')?.type).toBe('image')
    expect(b.find(x => x.path === 'brand.primary')?.type).toBe('color')
    expect(b.find(x => x.path === 'brand.fontDisplay')?.type).toBe('font')
  })
  it('dedupes repeated sockets', () => {
    const t = { sections: [{ children: [
      { type: 'text', content: '{{ props.text_layer_1 }} and {{ props.text_layer_1 }}' },
    ] }] }
    const b = listSmartLayoutBindables(t)
    expect(b.filter(x => x.path === 'props.text_layer_1')).toHaveLength(1)
  })
})

describe('readTemplateFromNode', () => {
  it('parses the layout widget JSON', () => {
    const node = { data: {
      widgetDefs: [{ name: 'other' }, { name: 'layout' }],
      widgetsValues: ['x', JSON.stringify(TEMPLATE)],
    } }
    expect((readTemplateFromNode(node) as any)?.version).toBe(3)
  })
  it('returns null on missing/invalid layout', () => {
    expect(readTemplateFromNode({ data: { widgetDefs: [], widgetsValues: [] } })).toBeNull()
  })
})

describe('autoAlign', () => {
  const cols: CollectionColumn[] = [
    { key: 'text_layer_1', label: 'Headline', type: 'text' },
    { key: 'primary', label: 'Primary', type: 'color' },
    { key: 'crest', label: 'Crest', type: 'image' },
  ]
  it('binds exact key matches when types are compatible', () => {
    const b = autoAlign(listSmartLayoutBindables(TEMPLATE), cols, 'col_1')
    expect(b['props.text_layer_1']?.columnKey).toBe('text_layer_1')
    expect(b['brand.primary']?.columnKey).toBe('primary')
    expect(b['props.image_layer_1']).toBeUndefined()
  })
  it('rejects type-incompatible matches', () => {
    const b = autoAlign(
      [{ path: 'brand.primary', label: 'primary', type: 'color' }],
      [{ key: 'primary', label: 'p', type: 'text' }],
      'col_1',
    )
    expect(b['brand.primary']).toBeUndefined()
  })
})

describe('typeCompatible', () => {
  it('text accepts numbers, color needs color, image accepts text urls', () => {
    expect(typeCompatible('text', 'number')).toBe(true)
    expect(typeCompatible('color', 'text')).toBe(false)
    expect(typeCompatible('image', 'text')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-bindables.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/collection/bindables`

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/collection/bindables.ts
import type { CollectionColumn, VarBindings, VariableType } from './types'

export interface Bindable {
  path: string
  label: string
  type: VariableType
}

const BRAND_BINDABLES: Bindable[] = [
  { path: 'brand.primary', label: 'Brand primary', type: 'color' },
  { path: 'brand.secondary', label: 'Brand secondary', type: 'color' },
  { path: 'brand.accent', label: 'Brand accent', type: 'color' },
  { path: 'brand.accent2', label: 'Brand accent 2', type: 'color' },
  { path: 'brand.foreground', label: 'Brand foreground', type: 'color' },
  { path: 'brand.background', label: 'Brand background', type: 'color' },
  { path: 'brand.fontDisplay', label: 'Display font', type: 'font' },
  { path: 'brand.fontBody', label: 'Body font', type: 'font' },
  { path: 'brand.logo', label: 'Logo', type: 'image' },
]

const PROP_RE = /\{\{\s*props\.([a-z0-9_]+)\s*\}\}/gi

export function listSmartLayoutBindables(template: unknown): Bindable[] {
  const found = new Map<string, Bindable>()
  const json = (() => { try { return JSON.stringify(template ?? {}) } catch { return '' } })()
  let m: RegExpExecArray | null
  PROP_RE.lastIndex = 0
  while ((m = PROP_RE.exec(json))) {
    const name = m[1]!
    const type: VariableType = /^image_layer_/.test(name) ? 'image' : 'text'
    const path = `props.${name}`
    if (!found.has(path)) found.set(path, { path, label: name.replace(/_/g, ' '), type })
  }
  return [...found.values(), ...BRAND_BINDABLES]
}

export function readTemplateFromNode(
  node: { data?: { widgetDefs?: { name: string }[]; widgetsValues?: unknown[] } },
): unknown | null {
  const defs = node?.data?.widgetDefs ?? []
  const i = defs.findIndex(d => d?.name === 'layout')
  if (i < 0) return null
  const raw = String(node?.data?.widgetsValues?.[i] ?? '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function typeCompatible(variable: VariableType, column: VariableType): boolean {
  switch (variable) {
    case 'text': return column === 'text' || column === 'number' || column === 'select'
    case 'color': return column === 'color'
    case 'image': return column === 'image' || column === 'text'
    case 'number': return column === 'number'
    case 'font': return column === 'font' || column === 'text'
    case 'select': return column === 'select' || column === 'text'
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function autoAlign(
  bindables: Bindable[],
  columns: CollectionColumn[],
  collectionId: string,
): VarBindings {
  const out: VarBindings = {}
  for (const b of bindables) {
    const shortKey = b.path.split('.').pop()!
    const col = columns.find(c => c.key === shortKey && typeCompatible(b.type, c.type))
      ?? columns.find(c => norm(c.label) === norm(shortKey) && typeCompatible(b.type, c.type))
    if (col) out[b.path] = { collectionId, columnKey: col.key }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-bindables.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/bindables.ts frontend/tests/unit/collection-bindables.unit.spec.ts
git commit -m "feat(collections): Smart Layout bindables scan + type-safe auto-align"
```

---

### Task 5: Batch runner (pure orchestration)

**Files:**
- Create: `frontend/app/lib/collection/batch.ts`
- Test: `frontend/tests/unit/collection-batch.unit.spec.ts`

**Interfaces:**
- Consumes: `CollectionRow` from `~/lib/collection/types`.
- Produces:
  - `type BatchStatus = 'queued' | 'rendering' | 'done' | 'failed'`
  - `interface BatchItem { id: string; rowIndex: number; rowId: string; outputId: string; status: BatchStatus; url?: string; assetName?: string; error?: string }`
  - `planBatch(rows: CollectionRow[], outputs: { id: string }[]): BatchItem[]` (row-major order)
  - `runBatch(items: BatchItem[], renderItem: (item: BatchItem) => Promise<void>, opts?: { concurrency?: number; signal?: { cancelled: boolean }; onUpdate?: (item: BatchItem) => void }): Promise<void>` — worker pool (default concurrency 3); `renderItem` mutates the item (sets `url`/`assetName`) on success; a throw marks the item `failed` with `error` and NEVER aborts the batch; when `signal.cancelled` is true, remaining `queued` items stay queued and the pool drains.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-batch.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { planBatch, runBatch, type BatchItem } from '~/lib/collection/batch'

const rows = [
  { id: 'r1', values: {} }, { id: 'r2', values: {} }, { id: 'r3', values: {} },
]

describe('planBatch', () => {
  it('crosses rows with outputs, row-major', () => {
    const items = planBatch(rows, [{ id: '1x1' }, { id: '9x16' }])
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({ rowIndex: 0, outputId: '1x1', status: 'queued' })
    expect(items[1]).toMatchObject({ rowIndex: 0, outputId: '9x16' })
    expect(items[2]).toMatchObject({ rowIndex: 1, outputId: '1x1' })
  })
})

describe('runBatch', () => {
  it('runs all items and reports updates', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    const seen: string[] = []
    await runBatch(items, async (it) => { it.url = `u${it.rowIndex}` }, {
      onUpdate: it => seen.push(`${it.rowId}:${it.status}`),
    })
    expect(items.every(i => i.status === 'done')).toBe(true)
    expect(seen).toContain('r1:rendering')
    expect(seen).toContain('r1:done')
  })
  it('isolates failures — one throw never aborts the rest', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    await runBatch(items, async (it) => {
      if (it.rowId === 'r2') throw new Error('boom')
    })
    expect(items.map(i => i.status)).toEqual(['done', 'failed', 'done'])
    expect(items[1].error).toBe('boom')
  })
  it('cancellation leaves remaining items queued', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    const signal = { cancelled: false }
    await runBatch(items, async (it) => {
      if (it.rowId === 'r1') signal.cancelled = true
    }, { concurrency: 1, signal })
    expect(items[0].status).toBe('done')
    expect(items[1].status).toBe('queued')
    expect(items[2].status).toBe('queued')
  })
  it('respects the concurrency cap', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    let live = 0, peak = 0
    await runBatch(items, async () => {
      live++; peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
    }, { concurrency: 2 })
    expect(peak).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-batch.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/collection/batch`

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/collection/batch.ts
import type { CollectionRow } from './types'

export type BatchStatus = 'queued' | 'rendering' | 'done' | 'failed'

export interface BatchItem {
  id: string
  rowIndex: number
  rowId: string
  outputId: string
  status: BatchStatus
  url?: string
  assetName?: string
  error?: string
}

export function planBatch(rows: CollectionRow[], outputs: { id: string }[]): BatchItem[] {
  const items: BatchItem[] = []
  rows.forEach((row, rowIndex) => {
    for (const o of outputs) {
      items.push({
        id: `${row.id}:${o.id}`,
        rowIndex, rowId: row.id, outputId: o.id, status: 'queued',
      })
    }
  })
  return items
}

export async function runBatch(
  items: BatchItem[],
  renderItem: (item: BatchItem) => Promise<void>,
  opts?: {
    concurrency?: number
    signal?: { cancelled: boolean }
    onUpdate?: (item: BatchItem) => void
  },
): Promise<void> {
  const concurrency = Math.max(1, opts?.concurrency ?? 3)
  const queue = [...items]
  async function worker(): Promise<void> {
    while (queue.length) {
      if (opts?.signal?.cancelled) return
      const item = queue.shift()
      if (!item || item.status !== 'queued') continue
      item.status = 'rendering'
      opts?.onUpdate?.(item)
      try {
        await renderItem(item)
        item.status = 'done'
      } catch (e) {
        item.status = 'failed'
        item.error = e instanceof Error ? e.message : String(e)
      }
      opts?.onUpdate?.(item)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/collection-batch.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/batch.ts frontend/tests/unit/collection-batch.unit.spec.ts
git commit -m "feat(collections): batch runner — worker pool, row isolation, cancel"
```

---

### Task 6: Collection node component + registration

**Files:**
- Create: `frontend/app/components/vue-canvas/CollectionNode.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (nodeTypes map, ~line 179)
- Modify: `frontend/app/composables/useVueNodes.ts` (`ARTIFACT_NODE_COMPONENTS`, ~line 153)
- Modify: `frontend/app/lib/agent/capabilities.ts` (frontend-only registry entry)

**Interfaces:**
- Consumes: `COLLECTION_PROP`, `CollectionData`, `VARS_TYPE` from `~/lib/collection/types`; `createCollection`, `rowLabel`, `clampPreviewRow` from `~/lib/collection/model`.
- Produces: vue-flow node type `'collection'` (backend name `'Collection'`), with a single source handle `output-0` of dataType `VARS`. Dispatches `sailor:openCollection` `{ nodeId }` on "Open table". Later tasks rely on `node.data.properties.sailor_collection` and the node's `outputs: [{ name: 'vars', type: 'VARS' }]`.

**Before coding:** grep how `SpaceType` appears in `NodeSearchDialog.vue` / `useNodeSearch.ts` (frontend-only nodes appear in the add-node search; mirror whatever list feeds them — likely the capabilities registry). Follow SpaceTypeNode.vue as the closest structural template.

- [ ] **Step 1: Create the component**

```vue
<!-- frontend/app/components/vue-canvas/CollectionNode.vue -->
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Table2, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { COLLECTION_PROP, type CollectionData } from '~/lib/collection/types'
import { createCollection, rowLabel, clampPreviewRow } from '~/lib/collection/model'

const props = defineProps<{ id: string; data: Record<string, any>; selected?: boolean }>()

const collection = computed<CollectionData>(() => {
  const c = props.data.properties?.[COLLECTION_PROP] as CollectionData | undefined
  return c ?? createCollection('Collection')
})

onMounted(() => {
  if (!props.data.properties) props.data.properties = {}
  if (!props.data.properties[COLLECTION_PROP]) {
    props.data.properties[COLLECTION_PROP] = createCollection('Collection')
  }
})

const summary = computed(() =>
  `${collection.value.rows.length} rows · ${collection.value.columns.length} columns`)

const previewLabel = computed(() => {
  const c = collection.value
  if (!c.rows.length) return 'No rows'
  return `${c.previewRow + 1}/${c.rows.length} · ${rowLabel(c, c.previewRow)}`
})

function step(delta: number) {
  const c = props.data.properties[COLLECTION_PROP] as CollectionData
  if (!c.rows.length) return
  c.previewRow = (c.previewRow + delta + c.rows.length) % c.rows.length
  clampPreviewRow(c)
}

function openTable() {
  window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="min-w-[190px] rounded-xl border bg-[#141414] text-white/90"
    :class="selected ? 'border-white/40' : 'border-[#2a2a2a]'"
  >
    <div class="flex items-center gap-2 px-3 h-9 border-b border-white/10">
      <Table2 class="size-3.5 text-white/60" />
      <span class="text-[12px] font-medium truncate flex-1">{{ collection.name }}</span>
    </div>
    <div class="px-3 py-2 text-[11px] text-white/40">{{ summary }}</div>
    <div class="flex items-center gap-1 px-2 pb-1" v-if="collection.rows.length">
      <button class="p-1 rounded hover:bg-white/10" @click.stop="step(-1)">
        <ChevronLeft class="size-3.5" />
      </button>
      <span class="flex-1 text-center text-[11px] text-white/70 truncate tabular-nums">
        {{ previewLabel }}
      </span>
      <button class="p-1 rounded hover:bg-white/10" @click.stop="step(1)">
        <ChevronRight class="size-3.5" />
      </button>
    </div>
    <div class="px-2 pb-2">
      <button
        class="w-full h-7 rounded-md text-[11px] bg-white/5 hover:bg-white/10 border border-white/10"
        @click.stop="openTable"
      >Open table</button>
    </div>
    <Handle id="output-0" type="source" :position="Position.Right" />
  </div>
</template>
```

- [ ] **Step 2: Register everywhere**

In `VueNodeCanvas.vue` nodeTypes object (~line 179): add import `import CollectionNode from './CollectionNode.vue'` (match the sibling import style) and `'collection': markRaw(CollectionNode),`.

In `useVueNodes.ts` `ARTIFACT_NODE_COMPONENTS` (~line 153): add `Collection: 'collection',`.

In `capabilities.ts`: copy the SpaceType frontend-only entry shape:

```typescript
{
  nodeType: 'Collection',
  kind: 'studio',
  frontendOnly: true,
  title: 'Collection',
  summary: 'A data table of named variables. Wire it to a Smart Layout to drive text, images, and brand colors per row — scrub rows to preview, or generate the whole set as a batch.',
  inputs: [],
  outputs: [{ name: 'vars', type: 'VARS' }],
  intents: ['variables', 'dataset', 'data table', 'batch generate', 'data merge', 'spreadsheet'],
},
```

Also ensure the created node's `data.outputs` is `[{ name: 'vars', type: 'VARS' }]` — check how `createNodeData` sources outputs for frontend-only nodes (SpaceType path); if it derives from the capability entry, the entry above suffices; if not, special-case `'Collection'` the same way SpaceType is handled.

- [ ] **Step 3: Verify in the app**

Start dev server (preview_start). Add a Collection node via the node search ("collection"). Confirm: node renders, "Open table" button present (event fires — listener comes in Task 8; console-log is fine for now), output handle visible, node persists after reload (properties round-trip).

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CollectionNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/composables/useVueNodes.ts frontend/app/lib/agent/capabilities.ts
git commit -m "feat(collections): Collection node — frontend-only vue-flow node with VARS output"
```

---

### Task 7: VARS wiring safety (Smart Layout input + prompt-build guard)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (node normalize on create/load)
- Modify: `frontend/app/composables/useFilteredPrompt.ts` (skip VARS links in prompt build)
- Test: `frontend/tests/unit/collection-vars-input.unit.spec.ts` (pure helper)

**Interfaces:**
- Consumes: `VARS_TYPE` from `~/lib/collection/types`.
- Produces: `ensureVarsInput(node)` exported from `frontend/app/lib/collection/varsInput.ts` — pushes `{ name: 'vars', type: 'VARS', link: null, optional: true }` onto `node.data.inputs` for `data.nodeType === 'SmartLayout'` if absent (idempotent). Prompt builder never emits inputs fed by VARS edges.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/collection-vars-input.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { ensureVarsInput } from '~/lib/collection/varsInput'

describe('ensureVarsInput', () => {
  it('adds a vars input to SmartLayout nodes once', () => {
    const node = { data: { nodeType: 'SmartLayout', inputs: [{ name: 'brand', type: 'STRING' }] } }
    ensureVarsInput(node as any)
    ensureVarsInput(node as any)
    const vars = node.data.inputs.filter((i: any) => i.name === 'vars')
    expect(vars).toHaveLength(1)
    expect(vars[0]).toMatchObject({ type: 'VARS', optional: true })
  })
  it('ignores other node types', () => {
    const node = { data: { nodeType: 'Image', inputs: [] } }
    ensureVarsInput(node as any)
    expect(node.data.inputs).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

```typescript
// frontend/app/lib/collection/varsInput.ts
import { VARS_TYPE } from './types'

export function ensureVarsInput(
  node: { data?: { nodeType?: string; inputs?: { name: string; type: string; link?: unknown; optional?: boolean }[] } },
): void {
  if (node?.data?.nodeType !== 'SmartLayout') return
  if (!Array.isArray(node.data.inputs)) node.data.inputs = []
  if (node.data.inputs.some(i => i.name === 'vars')) return
  node.data.inputs.push({ name: 'vars', type: VARS_TYPE, link: null, optional: true })
}
```

Run: `cd frontend && npm run test:unit -- tests/unit/collection-vars-input.unit.spec.ts` → PASS.

- [ ] **Step 3: Call it from the canvas**

In `VueNodeCanvas.vue`: import `ensureVarsInput` and call it (a) at the end of `createNodeData` (~line 1369-1450) on the built node object before return, and (b) wherever saved workflows hydrate into `nodes.value` on load (find the load path that builds node objects from LiteGraph JSON — likely in `useVueNodes.ts` `convertFromLiteGraph` or the canvas `loadWorkflow`; call `ensureVarsInput` per node there).

- [ ] **Step 4: Guard the prompt builder**

In `useFilteredPrompt.ts` `buildFilteredWorkflow()` (~line 357-382): find where each node's inputs/links are serialized into the prompt. Add a skip so an input never serializes when its `type === 'VARS'` (and/or the edge `data.dataType === 'VARS'`):

```typescript
if (String(input?.type) === 'VARS') continue
```

Read the surrounding code first; place the guard so a wired Collection → SmartLayout edge produces a prompt identical to the unwired case. Manually verify: wire Collection → SmartLayout, run the Smart Layout node, confirm no backend error and the prompt JSON (network tab, `/prompt` POST) has no `vars` input.

- [ ] **Step 5: Edge validation sanity check**

`typesCompatible` in `app/utils/portTypes.ts` is exact-string based, so `VARS` → `vars (VARS)` connects and `VARS` → `IMAGE` refuses with no code change. Verify by attempting both connections in the app.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/varsInput.ts frontend/tests/unit/collection-vars-input.unit.spec.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/composables/useFilteredPrompt.ts
git commit -m "feat(collections): VARS input on Smart Layout + prompt-build guard"
```

---

### Task 8: Bottom drawer — table editor

**Files:**
- Create: `frontend/app/components/vue-canvas/CollectionDrawer.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (mount + `sailor:openCollection` listener)

**Interfaces:**
- Consumes: everything from Tasks 1-2; node lookup by id from the `nodes` prop.
- Produces: a bottom drawer (Teleport to body, `fixed left-0 right-0 bottom-0`, height 320px, `z-[9000]`) with: editable header name; table grid (editable cells, per-column type dropdown, color cells get a swatch + native color input, image cells show a thumbnail if the value looks like a URL); add/remove row/column; "Paste data" (textarea modal-less popover that calls `importTable`); "Import CSV" (file input, `.csv`, read as text → `importTable`); row click sets `previewRow` (active row highlighted). All mutations write directly into `node.data.properties.sailor_collection` (deep watch → undo + persistence for free).

- [ ] **Step 1: Build the drawer component**

```vue
<!-- frontend/app/components/vue-canvas/CollectionDrawer.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { X, Plus, Upload, ClipboardPaste, Trash2 } from 'lucide-vue-next'
import { COLLECTION_PROP, type CollectionData, type VariableType } from '~/lib/collection/types'
import { addColumn, addRow, removeColumn, removeRow, setCell, clampPreviewRow } from '~/lib/collection/model'
import { importTable } from '~/lib/collection/parse'

const props = defineProps<{ nodeId: string; nodes: any[]; edges: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const node = computed(() => props.nodes.find(n => String(n.id) === String(props.nodeId)))
const collection = computed<CollectionData | null>(() =>
  (node.value?.data?.properties?.[COLLECTION_PROP] as CollectionData) ?? null)

const TYPES: VariableType[] = ['text', 'color', 'number', 'image', 'font', 'select']

const pasteOpen = ref(false)
const pasteText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function onAddRow() { if (collection.value) addRow(collection.value) }
function onAddColumn() { if (collection.value) addColumn(collection.value, `Column ${collection.value.columns.length + 1}`, 'text') }
function onRemoveRow(rowId: string) {
  if (!collection.value) return
  removeRow(collection.value, rowId)
  clampPreviewRow(collection.value)
}
function onRemoveColumn(key: string) { if (collection.value) removeColumn(collection.value, key) }
function onCell(rowId: string, key: string, e: Event) {
  if (!collection.value) return
  setCell(collection.value, rowId, key, (e.target as HTMLInputElement).value)
}
function selectRow(i: number) { if (collection.value) collection.value.previewRow = i }
function applyPaste() {
  if (collection.value && pasteText.value.trim()) importTable(collection.value, pasteText.value)
  pasteOpen.value = false
  pasteText.value = ''
}
async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f || !collection.value) return
  importTable(collection.value, await f.text())
  if (fileInput.value) fileInput.value.value = ''
}
function isImageUrl(v: unknown): boolean {
  const s = String(v ?? '')
  return /(\.(png|jpe?g|webp|gif|svg)(\?|#|$))|(^\/view\?)/i.test(s) || /^https?:\/\//i.test(s)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="collection"
      class="fixed left-0 right-0 bottom-0 z-[9000] h-[320px] bg-[#141414] border-t border-[#2a2a2a] flex flex-col text-white/90"
    >
      <div class="flex items-center gap-2 px-4 h-10 border-b border-white/10 shrink-0">
        <input
          v-model="collection.name"
          class="bg-transparent text-[12px] font-medium outline-none w-40 border-b border-transparent focus:border-white/20"
        />
        <span class="text-[11px] text-white/40">
          {{ collection.rows.length }} rows · {{ collection.columns.length }} columns
        </span>
        <div class="flex-1" />
        <button class="drawer-btn" @click="pasteOpen = !pasteOpen">
          <ClipboardPaste class="size-3.5" /> Paste data
        </button>
        <button class="drawer-btn" @click="fileInput?.click()">
          <Upload class="size-3.5" /> Import CSV
        </button>
        <input ref="fileInput" type="file" accept=".csv,.tsv,.txt" class="hidden" @change="onFile" />
        <button class="drawer-btn" @click="onAddColumn"><Plus class="size-3.5" /> Column</button>
        <button class="p-1.5 rounded hover:bg-white/10" @click="emit('close')"><X class="size-4" /></button>
      </div>

      <div v-if="pasteOpen" class="px-4 py-2 border-b border-white/10 shrink-0">
        <textarea
          v-model="pasteText"
          rows="4"
          placeholder="Paste CSV or spreadsheet cells — first row is headers"
          class="w-full bg-white/5 border border-white/10 rounded-md p-2 text-[12px] outline-none focus:border-white/25"
        />
        <div class="flex justify-end gap-2 mt-1">
          <button class="drawer-btn" @click="pasteOpen = false">Cancel</button>
          <button class="drawer-btn !bg-white/15" @click="applyPaste">Replace table</button>
        </div>
      </div>

      <div class="flex-1 overflow-auto">
        <table class="w-full text-[12px] border-collapse">
          <thead>
            <tr class="text-white/40 sticky top-0 bg-[#141414]">
              <th class="w-9 border-b border-white/10" />
              <th v-for="col in collection.columns" :key="col.key" class="text-left font-normal px-2 py-1.5 border-b border-white/10 min-w-[140px]">
                <div class="flex items-center gap-1.5">
                  <input v-model="col.label" class="bg-transparent outline-none w-24 text-white/70" />
                  <select v-model="col.type" class="bg-[#141414] text-white/40 text-[11px] outline-none">
                    <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                  <button class="opacity-40 hover:opacity-100" @click="onRemoveColumn(col.key)">
                    <Trash2 class="size-3" />
                  </button>
                </div>
              </th>
              <th class="border-b border-white/10 w-full" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in collection.rows"
              :key="row.id"
              class="cursor-pointer"
              :class="i === collection.previewRow ? 'bg-white/10' : 'hover:bg-white/5'"
              @click="selectRow(i)"
            >
              <td class="px-2 py-1 text-white/30 tabular-nums border-b border-white/5 text-right">{{ i + 1 }}</td>
              <td v-for="col in collection.columns" :key="col.key" class="px-2 py-1 border-b border-white/5">
                <div class="flex items-center gap-1.5">
                  <template v-if="col.type === 'color'">
                    <input
                      type="color"
                      :value="/^#([0-9a-f]{6})$/i.test(String(row.values[col.key] ?? '')) ? String(row.values[col.key]) : '#000000'"
                      class="size-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                      @input="onCell(row.id, col.key, $event)"
                      @click.stop
                    />
                  </template>
                  <img
                    v-else-if="col.type === 'image' && isImageUrl(row.values[col.key])"
                    :src="String(row.values[col.key])"
                    class="size-5 rounded object-cover border border-white/10"
                  />
                  <input
                    :value="row.values[col.key] ?? ''"
                    class="bg-transparent outline-none flex-1 min-w-[60px] focus:bg-white/5 rounded px-1"
                    @input="onCell(row.id, col.key, $event)"
                    @click.stop
                  />
                </div>
              </td>
              <td class="border-b border-white/5 pr-2 text-right">
                <button class="opacity-0 hover:opacity-100 [tr:hover_&]:opacity-40" @click.stop="onRemoveRow(row.id)">
                  <Trash2 class="size-3" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button class="drawer-btn m-2" @click="onAddRow"><Plus class="size-3.5" /> Row</button>
      </div>

      <div class="flex items-center gap-3 px-4 h-9 border-t border-white/10 shrink-0 text-[11px] text-white/40">
        <span>Click a row to preview it on canvas</span>
        <div class="flex-1" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-btn {
  @apply flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 text-white/80;
}
</style>
```

- [ ] **Step 2: Mount in VueNodeCanvas**

Next to the TimelineEditor teleport (~line 6120):

```vue
<Teleport to="body">
  <VueCanvasCollectionDrawer
    v-if="collectionDrawerForId"
    :node-id="collectionDrawerForId"
    :nodes="nodes as any[]"
    :edges="edges as any[]"
    @close="collectionDrawerForId = null"
  />
</Teleport>
```

State + listener (mirror the `sailor:openSpaceType` listener registration around line 3350):

```typescript
const collectionDrawerForId = ref<string | null>(null)
function handleOpenCollection(e: Event) {
  collectionDrawerForId.value = String((e as CustomEvent).detail?.nodeId ?? '') || null
}
// register/unregister with the other sailor:* listeners:
window.addEventListener('sailor:openCollection', handleOpenCollection)
```

Note Nuxt auto-import naming: a component at `app/components/vue-canvas/CollectionDrawer.vue` is `<VueCanvasCollectionDrawer>` (match how `VueCanvasTimelineEditor` is referenced).

- [ ] **Step 3: Verify in the app**

Add Collection node → "Open table" → drawer opens. Add columns/rows, edit cells, paste a small CSV, import a .csv file, click rows (highlight moves, node scrubber label updates), close/reopen (state persists), Cmd+Z undoes edits.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CollectionDrawer.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(collections): bottom drawer table editor with CSV import + preview-row select"
```

---

### Task 9: Bindings panel + live preview propagation

**Files:**
- Create: `frontend/app/lib/collection/preview.ts`
- Modify: `frontend/app/components/vue-canvas/CollectionDrawer.vue` (bindings strip + preview writes)
- Modify: `frontend/app/components/vue-canvas/SmartLayoutNodeBody.vue` (on-node preview + `N vars` badge)
- Test: `frontend/tests/unit/collection-preview.unit.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4 exports.
- Produces:
  - `wiredTargets(collectionNodeId: string, nodes: any[], edges: any[]): any[]` — target nodes connected from the collection's `output-0` (in `preview.ts`).
  - `pushVarPreview(collectionNode: any, targets: any[]): void` — for each target with bindings: resolve the preview row, `splitRenderOverrides`, write `{ props, brand, ts: Date.now() }` to `target.data.properties.sailor_varPreview` (in `preview.ts`).
  - Drawer: a "Bindings" strip listing each Smart Layout bindable with a column `<select>` (auto-align pre-fill on first wire; stores to `target.data.properties.sailor_varBindings`; records `lastLiteral` from current binding value when set).
  - SmartLayoutNodeBody: watches `props.data.properties?.sailor_varPreview` (deep) → debounced (400ms) POST `/api/render-template` `{ template, aspect: template.master, props, brand }` → object URL shown as an `<img>` preview (~160px) above the existing summary; badge `N vars` in its header area when bindings exist.

- [ ] **Step 1: Write the failing test for the pure parts**

```typescript
// frontend/tests/unit/collection-preview.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { wiredTargets, pushVarPreview } from '~/lib/collection/preview'
import { COLLECTION_PROP, BINDINGS_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

function scene() {
  const c = createCollection('Teams')
  addColumn(c, 'team', 'text'); addColumn(c, 'primary', 'color')
  const r = addRow(c)
  setCell(c, r.id, 'team', 'France'); setCell(c, r.id, 'primary', '#0C447C')
  const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
  const slNode = { id: '2', data: { nodeType: 'SmartLayout', properties: {
    [BINDINGS_PROP]: {
      'props.text_layer_1': { collectionId: c.id, columnKey: 'team' },
      'brand.primary': { collectionId: c.id, columnKey: 'primary' },
    },
  } } }
  const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-9', data: { dataType: 'VARS' } }]
  return { colNode, slNode, edges }
}

describe('wiredTargets', () => {
  it('finds nodes wired from output-0', () => {
    const { colNode, slNode, edges } = scene()
    expect(wiredTargets('1', [colNode, slNode], edges).map(n => n.id)).toEqual(['2'])
  })
})

describe('pushVarPreview', () => {
  it('writes resolved props/brand for the preview row onto the target', () => {
    const { colNode, slNode, edges } = scene()
    pushVarPreview(colNode, wiredTargets('1', [colNode, slNode], edges))
    const p = (slNode.data.properties as any)[VAR_PREVIEW_PROP]
    expect(p.props).toEqual({ text_layer_1: 'France' })
    expect(p.brand).toEqual({ primary: '#0C447C' })
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

```typescript
// frontend/app/lib/collection/preview.ts
import { BINDINGS_PROP, COLLECTION_PROP, VAR_PREVIEW_PROP } from './types'
import type { CollectionData, VarBindings } from './types'
import { resolveBindings, splitRenderOverrides } from './resolve'

export function wiredTargets(collectionNodeId: string, nodes: any[], edges: any[]): any[] {
  const ids = new Set(
    edges
      .filter(e => String(e.source) === String(collectionNodeId) && e.sourceHandle === 'output-0')
      .map(e => String(e.target)),
  )
  return nodes.filter(n => ids.has(String(n.id)))
}

export function pushVarPreview(collectionNode: any, targets: any[]): void {
  const c = collectionNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
  if (!c) return
  for (const target of targets) {
    const bindings = target?.data?.properties?.[BINDINGS_PROP] as VarBindings | undefined
    if (!bindings || !Object.keys(bindings).length) continue
    const { values } = resolveBindings(c, bindings, c.previewRow)
    const { props, brand } = splitRenderOverrides(values)
    if (!target.data.properties) target.data.properties = {}
    target.data.properties[VAR_PREVIEW_PROP] = { props, brand, ts: Date.now() }
  }
}
```

Run: `cd frontend && npm run test:unit -- tests/unit/collection-preview.unit.spec.ts` → PASS.

- [ ] **Step 3: Bindings strip in the drawer**

Add to `CollectionDrawer.vue`, between header and table — computed `targets = wiredTargets(props.nodeId, props.nodes, props.edges)` filtered to `data.nodeType === 'SmartLayout'`. For the first target: `bindables = listSmartLayoutBindables(readTemplateFromNode(target))`. Render a horizontal strip: per bindable, label + `<select>` of type-compatible columns (`typeCompatible`) + a "—" unbound option. On change, write `target.data.properties[BINDINGS_PROP][path] = { collectionId, columnKey, lastLiteral: <current resolved value or previous literal> }` (delete the entry when "—" chosen). When the target has NO bindings object yet and a wire exists, initialize with `autoAlign(bindables, collection.columns, collection.id)`. Empty state (no wire): "Wire this collection to a Smart Layout node to bind columns".

Add a deep watcher in the drawer: `watch([collection, targetsBindings], () => pushVarPreview(node.value, targets.value), { deep: true })` so cell edits, preview-row changes, and binding edits all propagate. Also call `pushVarPreview` from `CollectionNode.vue`'s `step()` (import `wiredTargets`/`pushVarPreview`; the node component receives no `nodes`/`edges` props — instead dispatch a `sailor:collectionScrub` CustomEvent `{ nodeId }` and handle it in `VueNodeCanvas.vue` by calling `pushVarPreview(node, wiredTargets(id, nodes.value, edges.value))`).

- [ ] **Step 4: Smart Layout on-node preview**

In `SmartLayoutNodeBody.vue`: read the node's template via `readTemplateFromNode`, watch `data.properties?.[VAR_PREVIEW_PROP]` (deep). On change (and on mount when present), debounce 400ms then:

```typescript
const res = await fetch('/api/render-template', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ template, aspect: (template as any).master, props: preview.props, brand: preview.brand }),
})
if (res.ok) {
  const blob = await res.blob()
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(blob)
}
```

Template: `<img v-if="previewUrl" :src="previewUrl" class="w-full rounded-md border border-white/10 mb-1" />` above the existing summary; badge `<span v-if="varCount" class="...">{{ varCount }} vars</span>` where `varCount = Object.keys(data.properties?.sailor_varBindings ?? {}).length`. Follow the file's existing markup conventions.

- [ ] **Step 5: Verify in the app**

Build a Smart Layout with `{{ props.text_layer_1 }}` + a brand color; add Collection with matching `text_layer_1` + `primary` columns and 2 rows; wire; open drawer → bindings auto-aligned; scrub rows on node and in drawer → on-node preview updates with each row's text/color.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/preview.ts frontend/tests/unit/collection-preview.unit.spec.ts frontend/app/components/vue-canvas/CollectionDrawer.vue frontend/app/components/vue-canvas/CollectionNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/SmartLayoutNodeBody.vue
git commit -m "feat(collections): bindings panel + live preview-row scrub on Smart Layout"
```

---

### Task 10: Generate — confirm, run, progress, assets

**Files:**
- Create: `frontend/app/lib/collection/generate.ts`
- Modify: `frontend/app/components/vue-canvas/CollectionDrawer.vue` (Generate CTA, confirm popover, status column)

**Interfaces:**
- Consumes: Tasks 3-5, 9 exports; `deriveOutputs` from `~~/shared/template-grid/resolve`.
- Produces (in `generate.ts`):
  - `buildRenderItem(target, collection, bindings)` returning `(item: BatchItem) => Promise<void>` that: resolves `item.rowIndex` bindings → `splitRenderOverrides` → POST `/api/render-template` `{ template, outputId: item.outputId, aspect: outputFormatFor(item.outputId), props, brand }` → on !ok throw `Error('render failed: ' + status)` → blob → upload:

```typescript
const fname = `collection_${runStamp}_${sanitize(rowLabelText)}_${item.outputId}.png`
const fd = new FormData()
fd.append('image', new File([blob], fname, { type: 'image/png' }))
fd.append('overwrite', 'true')
const up = await fetch('/upload/image', { method: 'POST', body: fd })
if (!up.ok) throw new Error('upload failed')
const meta = await up.json() as { name?: string; subfolder?: string }
const rel = meta.subfolder ? `${meta.subfolder}/${meta.name}` : (meta.name ?? fname)
await fetch('/sailor/asset_import', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: rel }),
})
item.assetName = rel
item.url = `/view?${new URLSearchParams({ filename: meta.name ?? fname, type: 'input', ...(meta.subfolder ? { subfolder: meta.subfolder } : {}) })}`
```

  - `estimateBatch(itemCount: number): { label: string }` — v1 label: `` `${itemCount} renders · free · ~${Math.ceil(itemCount * 1.2)}s` `` (cost seam: swap in `estimateUsdForNodes` when paid targets land).

- Drawer additions: footer right side gets `Generate N` button (emerald accent — run action) where `N = rows × outputs`. Click → inline confirm popover: the estimate label + `validateRun` warnings (row + message, max 5 shown) + Cancel / Generate. On confirm: `planBatch` → store items in a `ref`, add a status column to the table (per-row dot: queued gray, rendering pulse, done emerald, failed red + title=error), run `runBatch(items, renderItem, { concurrency: 3, signal, onUpdate })`. Cancel button while running (sets `signal.cancelled = true`). After the run: "Retry failed" button when any failed (re-plans only failed items and re-runs them).

- [ ] **Step 1: Implement `generate.ts`** (full code per the interface above — resolve `outputFormatFor` via `deriveOutputs(template)` lookup; `sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)`; `runStamp = Date.now().toString(36)` created per run and passed in).

- [ ] **Step 2: Wire the drawer UI** (status column keyed by `rowId` — a row shows the worst status among its items; confirm popover uses the existing dark tokens; no new modal component).

- [ ] **Step 3: Verify in the app**

2-row collection bound to a 1-output Smart Layout → Generate 2 → confirm → both rows go done → files exist (`/view` URLs load) → assets appear in the Assets panel (`/sailor/assets` returns them). Break one row (bad image URL in a bound image column → render still succeeds server-side, so instead test failure by stopping ComfyUI? No — simplest failure test: temporarily bind a column, delete the collection mid-run is overkill; rely on unit-tested isolation and verify the happy path + cancel manually).

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/collection/generate.ts frontend/app/components/vue-canvas/CollectionDrawer.vue
git commit -m "feat(collections): batch generate — confirm, worker pool, drawer progress, assets"
```

---

### Task 11: Results view + zip export

**Files:**
- Modify: `frontend/app/components/vue-canvas/CollectionDrawer.vue`

**Interfaces:**
- Consumes: `BatchItem[]` results from Task 10; JSZip (`import JSZip from 'jszip'`).
- Produces: after a run completes, the drawer offers a "Results" toggle (segmented: `Table | Results`). Results view: thumbnail grid (`grid grid-cols-6 gap-2`, `<img :src="item.url">` labeled with `rowLabel` + output id), failed items show a red tile with the error and a per-item retry button; clicking a thumbnail sets `collection.previewRow = item.rowIndex` (canvas scrubs to match); "Export zip" button:

```typescript
const zip = new JSZip()
for (const item of items.filter(i => i.status === 'done' && i.url)) {
  const blob = await fetch(item.url!).then(r => r.blob())
  zip.file(`${sanitize(rowLabelFor(item))}_${item.outputId}.png`, blob)
}
const out = await zip.generateAsync({ type: 'blob' })
const url = URL.createObjectURL(out)
const a = document.createElement('a')
a.href = url; a.download = `${sanitize(collection.name)}_batch.zip`; a.click()
setTimeout(() => URL.revokeObjectURL(url), 2000)
```

- [ ] **Step 1: Implement the results view + zip** (per above; keep the run's items in the drawer ref so reopening the drawer within the session retains them — persistence of results across reload is via Assets, not the drawer).

- [ ] **Step 2: Verify in the app** — run a batch, flip to Results, click a thumbnail (canvas scrubs), export zip (downloads, contains the PNGs).

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CollectionDrawer.vue
git commit -m "feat(collections): drawer results grid + zip export"
```

---

### Task 12: End-to-end visual verification (required gate)

**Files:** none (verification + fixes).

- [ ] **Step 1:** Full unit suite: `cd frontend && npm run test:unit` — all green (including pre-existing tests).
- [ ] **Step 2:** With the dev server + ComfyUI running, walk the World-Cup-style flow: Smart Layout with text socket + brand color → Collection with 4 rows (paste CSV) → wire → auto-align → scrub all 4 rows watching the on-node preview → Generate 4 → Results → zip. Screenshot at each stage (node + drawer, bindings strip, scrub states, progress, results grid).
- [ ] **Step 3:** Regression: an unwired Smart Layout still renders/behaves identically (run it; prompt JSON unchanged); workflow save/reload preserves collection + bindings; undo works across drawer edits.
- [ ] **Step 4:** Fix anything found; re-verify; commit fixes individually.

---

## Self-Review Notes

- Spec coverage: §3 canvas model → Tasks 6-7; §4 drawer → Task 8; §5.2 bindings/lastLiteral → Tasks 3, 9; §5.3 scrub → Tasks 6, 9; §5.6 generate → Task 10; §5.7 results → Task 11; §2 types → Task 1. Deliberately deferred to Slice 2 (per spec): promote-from-control gesture, chips *inside* the Smart Layout modal (Slice 1 binds via the drawer strip), inspector form, sweep, AI-fill, link columns, results artifact node, named-picker widget.
- Write-through (§5.2) in Slice 1 scope: editing bound values happens in the drawer/table (the canonical store), so no write-through plumbing is needed until studio-control chips exist (Slice 2).
- Type consistency: `COLLECTION_PROP`/`BINDINGS_PROP`/`VAR_PREVIEW_PROP` names used identically across Tasks 1, 6, 8, 9, 10. `BatchItem` shape shared between Tasks 5, 10, 11.
