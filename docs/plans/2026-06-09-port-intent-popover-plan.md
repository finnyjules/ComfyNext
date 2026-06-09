# Port Intent Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a node port (or dropping a wire on empty canvas) opens a popover that offers type-filtered node search instantly and AI-built node/pipeline insertion on demand.

**Architecture:** Pure logic (type compatibility, catalog trimming, suggestion validation) lives in dependency-free files under `frontend/app/lib/`, unit-tested with vitest. A Nuxt server route (`/api/pipeline-suggest`) calls the Anthropic API (Haiku, structured outputs) with the user's own key, mirroring the existing `explain.post.ts`. A `usePortIntent` composable orchestrates request → validate → one repair retry. `PortIntentPopover.vue` is a dumb UI component; `VueNodeCanvas.vue` owns the triggers (Vue Flow `onConnectStart`/`onConnectEnd`) and the insertion (reusing `createNodeData` + `addEdges`).

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vue Flow 1.48, vitest (new devDependency, unit only), Playwright (existing, e2e), Anthropic Messages API (`claude-haiku-4-5`, `output_config.format` structured outputs).

**Spec:** `docs/plans/2026-06-09-port-intent-popover-design.md`

**Key codebase facts (verified):**
- Node factory: `createNodeData(nodeType, position, widgetOverrides?, propertyOverrides?)` at [VueNodeCanvas.vue:573](frontend/app/components/vue-canvas/VueNodeCanvas.vue) — `id` is `String(Date.now())` (collides for multi-node inserts in one tick — override it), `widgetOverrides` is keyed by widget name.
- Edges: `addEdges([{ source, sourceHandle: 'output-N', target, targetHandle: 'input-N', type: 'comfy', data: { dataType } }])`. Helpers `inputHandleFor(node, type)` / `outputHandleFor(node, type)` exist (lines 633–644). After pushing nodes, `await nextTick()` before `addEdges` or Vue Flow prunes the edges.
- Undo: `useCanvasHistory` snapshots on a 350 ms debounced watch of `[nodes, edges]` — a synchronous multi-node insert is automatically one undo step. No extra work needed.
- `useNodeSearch().nodeTypes` has `{ name, displayName, description, category, inputs[], outputs[] }` (inputs from `input.required` only — fine for candidate filtering; the AI catalog uses `objectInfo` directly for accuracy).
- Anthropic key: `useLocalSettings().getLocalSetting('ComfyNext.AI.AnthropicApiKey')`, forwarded in the request body like `explain.post.ts` does.
- Components under `app/components/vue-canvas/` are auto-imported with the path prefix, e.g. `<VueCanvasPortIntentPopover>`.
- `onConnectStart`/`onConnectEnd` are NOT currently wired in VueNodeCanvas; Vue Flow's `useVueFlow()` provides them.
- Tests: Playwright in `frontend/tests/` (servers must already be running: `npm run dev` on port 3002 per `playwright.config.ts`, ComfyUI on 8188). No unit test runner yet — Task 1 adds vitest scoped to `app/lib/**`.

---

## File structure

| File | Responsibility |
|---|---|
| Create `frontend/app/lib/portIntent.ts` | Types (`PortAnchor`, `NodeTypeLite`), type compatibility, candidate filtering, port-list derivation from `object_info` |
| Create `frontend/app/lib/portIntentCatalog.ts` | Widget-schema extraction with enum capping; trimmed catalog with 1-hop bridging |
| Create `frontend/app/lib/portIntentValidate.ts` | Validate + normalize the AI's suggestion JSON against `object_info` |
| Create `frontend/app/lib/portIntent.test.ts`, `portIntentCatalog.test.ts`, `portIntentValidate.test.ts` | Unit tests |
| Create `frontend/vitest.config.ts`, modify `frontend/package.json` | Unit test runner |
| Create `frontend/server/api/pipeline-suggest.post.ts` | Anthropic call (Haiku, structured outputs), repair-prompt support |
| Create `frontend/app/composables/usePortIntent.ts` | Build request (catalog + graph context), call endpoint, validate, one repair retry |
| Create `frontend/app/components/vue-canvas/PortIntentPopover.vue` | Popover UI: input, fuzzy list, Ask-AI row, keyboard nav |
| Modify `frontend/app/components/vue-canvas/VueNodeCanvas.vue` | Triggers (connect-start/end click-vs-drag), `insertSuggestion`, handlers, mount popover |
| Create `frontend/tests/port-intent.spec.ts` | Playwright e2e |

---

## Task 1: Vitest setup + core types & compatibility (`portIntent.ts`)

**Files:**
- Modify: `frontend/package.json` (devDependency + script)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/app/lib/portIntent.ts`
- Test: `frontend/app/lib/portIntent.test.ts`

- [ ] **Step 1: Install vitest and add config**

```bash
cd frontend && npm install -D vitest
```

Create `frontend/vitest.config.ts` (scoped to `app/lib` so it never picks up the Playwright specs in `tests/`):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['app/lib/**/*.test.ts'],
  },
})
```

Add to `frontend/package.json` `"scripts"`:

```json
"test:unit": "vitest run"
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/app/lib/portIntent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isTypeCompatible, anchorCandidates, linkInputPorts, outputPorts, type NodeTypeLite } from './portIntent'

const upscaler: NodeTypeLite = {
  name: 'ImageUpscaleWithModel', displayName: 'Upscale Image (using Model)',
  description: '', category: 'image/upscaling',
  inputs: [{ name: 'upscale_model', type: 'UPSCALE_MODEL' }, { name: 'image', type: 'IMAGE' }],
  outputs: [{ name: 'IMAGE', type: 'IMAGE' }],
}
const sampler: NodeTypeLite = {
  name: 'KSampler', displayName: 'KSampler', description: '', category: 'sampling',
  inputs: [{ name: 'model', type: 'MODEL' }, { name: 'latent_image', type: 'LATENT' }],
  outputs: [{ name: 'LATENT', type: 'LATENT' }],
}

describe('isTypeCompatible', () => {
  it('matches identical types and wildcards', () => {
    expect(isTypeCompatible('IMAGE', 'IMAGE')).toBe(true)
    expect(isTypeCompatible('*', 'IMAGE')).toBe(true)
    expect(isTypeCompatible('IMAGE', '*')).toBe(true)
  })
  it('rejects different types and empty strings', () => {
    expect(isTypeCompatible('IMAGE', 'LATENT')).toBe(false)
    expect(isTypeCompatible('', 'IMAGE')).toBe(false)
  })
})

describe('anchorCandidates', () => {
  const all = [upscaler, sampler]
  it('output anchor: returns nodes with a compatible input', () => {
    const out = anchorCandidates(all, { portType: 'IMAGE', direction: 'output' })
    expect(out.map(n => n.name)).toEqual(['ImageUpscaleWithModel'])
  })
  it('input anchor: returns nodes with a compatible output', () => {
    const out = anchorCandidates(all, { portType: 'LATENT', direction: 'input' })
    expect(out.map(n => n.name)).toEqual(['KSampler'])
  })
  it('wildcard anchor returns everything', () => {
    expect(anchorCandidates(all, { portType: '*', direction: 'output' })).toHaveLength(2)
  })
})

describe('object_info port derivation', () => {
  // Mirrors a real /object_info entry shape
  const info = {
    input: {
      required: {
        image: ['IMAGE'],
        upscale_model: ['UPSCALE_MODEL'],
        scale_by: ['FLOAT', { default: 1.5, min: 0.01, max: 8.0 }],
        method: [['nearest', 'bilinear', 'area']],
      },
      optional: { mask: ['MASK'] },
    },
    output: ['IMAGE'],
    output_name: ['IMAGE'],
  }
  it('linkInputPorts keeps link types, drops widgets and enums', () => {
    expect(linkInputPorts(info)).toEqual([
      { name: 'image', type: 'IMAGE' },
      { name: 'upscale_model', type: 'UPSCALE_MODEL' },
      { name: 'mask', type: 'MASK' },
    ])
  })
  it('linkInputPorts honors forceInput on scalar types', () => {
    const i2 = { input: { required: { seed: ['INT', { forceInput: true }] } } }
    expect(linkInputPorts(i2)).toEqual([{ name: 'seed', type: 'INT' }])
  })
  it('outputPorts uses output_name when present', () => {
    expect(outputPorts(info)).toEqual([{ name: 'IMAGE', type: 'IMAGE' }])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — cannot resolve `./portIntent`.

- [ ] **Step 4: Implement `frontend/app/lib/portIntent.ts`**

```ts
// Pure helpers for the port-intent popover. No Vue/Nuxt imports — unit-testable.

export interface PortAnchor {
  nodeId: string
  nodeType: string
  portName: string
  portType: string
  portIndex: number
  direction: 'input' | 'output'
}

export interface NodeTypeLite {
  name: string
  displayName: string
  description: string
  category: string
  inputs: { name: string; type: string }[]
  outputs: { name: string; type: string }[]
}

// Same semantics as typesCompatible() in VueNodeCanvas.vue, plus an empty guard.
export function isTypeCompatible(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b || a === '*' || b === '*'
}

/** The port on `node` that could legally connect to the anchor, if any.
 *  Output anchor → node's inputs (downstream); input anchor → node's outputs (upstream). */
export function matchingPort(
  node: NodeTypeLite,
  anchor: Pick<PortAnchor, 'portType' | 'direction'>,
): { name: string; type: string } | null {
  const ports = anchor.direction === 'output' ? node.inputs : node.outputs
  return ports.find(p => isTypeCompatible(p.type, anchor.portType)) ?? null
}

/** Node types that can connect to the anchor port. Wildcard anchors match all. */
export function anchorCandidates(
  nodeTypes: NodeTypeLite[],
  anchor: Pick<PortAnchor, 'portType' | 'direction'>,
): NodeTypeLite[] {
  return nodeTypes.filter(n => matchingPort(n, anchor))
}

/** Inputs that render as ports — mirrors createNodeData's filter in VueNodeCanvas.vue.
 *  Enum specs (array type) are widgets; scalar types are widgets unless forceInput. */
export function linkInputPorts(info: any): { name: string; type: string }[] {
  const entries = [
    ...Object.entries((info?.input?.required ?? {}) as Record<string, any>),
    ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>),
  ]
  return entries
    .filter(([, s]) => {
      const arr = Array.isArray(s) ? s : [s]
      const t = arr[0]
      const cfg = arr[1] || {}
      if (Array.isArray(t)) return false
      if (cfg.forceInput) return true
      return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(t))
    })
    .map(([n, s]) => {
      const arr = Array.isArray(s) ? s : [s]
      return { name: n, type: String(arr[0]) }
    })
}

export function outputPorts(info: any): { name: string; type: string }[] {
  return ((info?.output ?? []) as string[]).map((t, i) => ({
    name: String(info?.output_name?.[i] ?? t),
    type: String(t),
  }))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/app/lib/portIntent.ts frontend/app/lib/portIntent.test.ts
git commit -m "Port intent: core type-compatibility lib + vitest setup"
```

---

## Task 2: Catalog building (`portIntentCatalog.ts`)

**Files:**
- Create: `frontend/app/lib/portIntentCatalog.ts`
- Test: `frontend/app/lib/portIntentCatalog.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/lib/portIntentCatalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { widgetDefsFromInfo, buildCatalog } from './portIntentCatalog'
import type { NodeTypeLite } from './portIntent'

const upscaleInfo = {
  input: {
    required: {
      image: ['IMAGE'],
      upscale_model: [['4x_esrgan.pth', '4x_ultrasharp.pth']],
      scale_by: ['FLOAT', { default: 1.5, min: 0.01, max: 8.0 }],
    },
  },
  output: ['IMAGE'],
}

describe('widgetDefsFromInfo', () => {
  it('extracts enum, numeric, and skips link inputs', () => {
    const defs = widgetDefsFromInfo(upscaleInfo, 20)
    expect(defs).toEqual([
      { name: 'upscale_model', type: 'ENUM', default: '4x_esrgan.pth', options: ['4x_esrgan.pth', '4x_ultrasharp.pth'], optionsOmitted: 0 },
      { name: 'scale_by', type: 'FLOAT', default: 1.5, min: 0.01, max: 8.0 },
    ])
  })
  it('caps enum options and records the omitted count', () => {
    const info = { input: { required: { ckpt: [['a', 'b', 'c', 'd']] } } }
    const defs = widgetDefsFromInfo(info, 2)
    expect(defs[0]).toMatchObject({ options: ['a', 'b'], optionsOmitted: 2 })
  })
})

describe('buildCatalog', () => {
  const lite = (name: string, inputs: any[], outputs: any[]): NodeTypeLite =>
    ({ name, displayName: name, description: '', category: '', inputs, outputs })
  const imgToLatent = lite('VAEEncode', [{ name: 'pixels', type: 'IMAGE' }], [{ name: 'LATENT', type: 'LATENT' }])
  const latentConsumer = lite('KSampler', [{ name: 'latent_image', type: 'LATENT' }], [{ name: 'LATENT', type: 'LATENT' }])
  const unrelated = lite('LoadAudio', [{ name: 'audio', type: 'AUDIO' }], [{ name: 'AUDIO', type: 'AUDIO' }])
  const objectInfo = { VAEEncode: { input: { required: { pixels: ['IMAGE'] } }, output: ['LATENT'] } }

  it('includes direct-compatible nodes first, then 1-hop bridged nodes, never unrelated ones', () => {
    const cat = buildCatalog([imgToLatent, latentConsumer, unrelated], objectInfo, { portType: 'IMAGE', direction: 'output' })
    expect(cat.map(e => e.type)).toEqual(['VAEEncode', 'KSampler'])
  })
  it('respects maxNodes', () => {
    const cat = buildCatalog([imgToLatent, latentConsumer], objectInfo, { portType: 'IMAGE', direction: 'output' }, { maxNodes: 1 })
    expect(cat).toHaveLength(1)
    expect(cat[0]!.type).toBe('VAEEncode')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — cannot resolve `./portIntentCatalog`.

- [ ] **Step 3: Implement `frontend/app/lib/portIntentCatalog.ts`**

```ts
import type { NodeTypeLite, PortAnchor } from './portIntent'
import { matchingPort, linkInputPorts, outputPorts } from './portIntent'

export interface CatalogWidget {
  name: string
  type: string
  default?: unknown
  min?: number
  max?: number
  options?: string[]
  optionsOmitted?: number
}

export interface CatalogEntry {
  type: string
  name: string
  description: string
  inputs: { name: string; type: string }[]
  outputs: { name: string; type: string }[]
  widgets: CatalogWidget[]
}

/** Widget definitions derived from an /object_info entry. Enum option lists are
 *  capped at maxEnum (pass Infinity for the full list, used by validation). */
export function widgetDefsFromInfo(info: any, maxEnum = 20): CatalogWidget[] {
  const out: CatalogWidget[] = []
  const all = {
    ...((info?.input?.required ?? {}) as Record<string, any>),
    ...((info?.input?.optional ?? {}) as Record<string, any>),
  }
  for (const [name, spec] of Object.entries(all)) {
    const arr = Array.isArray(spec) ? spec : [spec]
    const t = arr[0]
    const cfg = arr[1] || {}
    if (Array.isArray(t)) {
      const options = t.map(String)
      out.push({
        name, type: 'ENUM',
        default: cfg.default ?? options[0],
        options: options.slice(0, maxEnum),
        optionsOmitted: Math.max(0, options.length - Math.min(maxEnum, options.length)),
      })
    } else if (['INT', 'FLOAT'].includes(String(t)) && !cfg.forceInput) {
      out.push({ name, type: String(t), default: cfg.default, min: cfg.min, max: cfg.max })
    } else if (['STRING', 'BOOLEAN'].includes(String(t)) && !cfg.forceInput) {
      out.push({ name, type: String(t), default: cfg.default })
    }
  }
  return out
}

export interface BuildCatalogOpts { maxEnum?: number; maxNodes?: number }

/** Trimmed catalog for the AI request: nodes directly compatible with the anchor
 *  first, then nodes one type-hop away (so chains can bridge, e.g. IMAGE→LATENT→…). */
export function buildCatalog(
  nodeTypes: NodeTypeLite[],
  objectInfo: Record<string, any>,
  anchor: Pick<PortAnchor, 'portType' | 'direction'>,
  opts: BuildCatalogOpts = {},
): CatalogEntry[] {
  const { maxEnum = 20, maxNodes = 150 } = opts
  const hop1 = nodeTypes.filter(n => matchingPort(n, anchor))
  const hop1Names = new Set(hop1.map(n => n.name))

  // Far-side types of hop-1 nodes seed the second hop, continuing in the same
  // direction of flow (downstream for output anchors, upstream for input anchors).
  const farTypes = new Set<string>()
  for (const n of hop1) {
    const far = anchor.direction === 'output' ? n.outputs : n.inputs
    for (const p of far) farTypes.add(p.type)
  }
  const hop2 = nodeTypes.filter(n =>
    !hop1Names.has(n.name)
    && (anchor.direction === 'output'
      ? n.inputs.some(p => farTypes.has(p.type))
      : n.outputs.some(p => farTypes.has(p.type))),
  )

  return [...hop1, ...hop2].slice(0, maxNodes).map((n) => {
    const info = objectInfo[n.name]
    return {
      type: n.name,
      name: n.displayName,
      description: (n.description || '').slice(0, 200),
      inputs: info ? linkInputPorts(info) : n.inputs,
      outputs: info ? outputPorts(info) : n.outputs,
      widgets: info ? widgetDefsFromInfo(info, maxEnum) : [],
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/portIntentCatalog.ts frontend/app/lib/portIntentCatalog.test.ts
git commit -m "Port intent: trimmed AI catalog with hop bridging and enum capping"
```

---

## Task 3: Suggestion validation (`portIntentValidate.ts`)

**Files:**
- Create: `frontend/app/lib/portIntentValidate.ts`
- Test: `frontend/app/lib/portIntentValidate.test.ts`

The AI returns `{ nodes: [{ id, type, widgets: [{ name, value }] }], edges: [{ from, to }], note }` where edge endpoints are `"anchor"` or `"<id>.<portName>"`. Validation normalizes it into something the canvas can insert directly: nodes get `widgetOverrides` keyed by widget name (the exact shape `createNodeData` accepts), edges get resolved endpoint structs.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/lib/portIntentValidate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateSuggestion } from './portIntentValidate'
import type { PortAnchor } from './portIntent'

const objectInfo = {
  ImageUpscaleWithModel: {
    input: { required: { upscale_model: ['UPSCALE_MODEL'], image: ['IMAGE'] } },
    output: ['IMAGE'], output_name: ['IMAGE'],
  },
  UpscaleModelLoader: {
    input: { required: { model_name: [['4x_esrgan.pth', '4x_ultrasharp.pth']] } },
    output: ['UPSCALE_MODEL'], output_name: ['UPSCALE_MODEL'],
  },
  ImageScaleBy: {
    input: { required: { image: ['IMAGE'], scale_by: ['FLOAT', { default: 1.5, min: 0.01, max: 8.0 }] } },
    output: ['IMAGE'],
  },
}

const outAnchor: PortAnchor = {
  nodeId: '42', nodeType: 'LoadImage', portName: 'IMAGE',
  portType: 'IMAGE', portIndex: 0, direction: 'output',
}

const goodChain = {
  nodes: [
    { id: 'a', type: 'UpscaleModelLoader', widgets: [{ name: 'model_name', value: '4x_esrgan.pth' }] },
    { id: 'b', type: 'ImageUpscaleWithModel', widgets: [] },
  ],
  edges: [
    { from: 'anchor', to: 'b.image' },
    { from: 'a.UPSCALE_MODEL', to: 'b.upscale_model' },
  ],
  note: 'Upscales with ESRGAN',
}

describe('validateSuggestion', () => {
  it('accepts a valid chain and normalizes it', () => {
    const r = validateSuggestion(goodChain, objectInfo, outAnchor)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.nodes).toEqual([
      { localId: 'a', type: 'UpscaleModelLoader', widgetOverrides: { model_name: '4x_esrgan.pth' } },
      { localId: 'b', type: 'ImageUpscaleWithModel', widgetOverrides: {} },
    ])
    expect(r.edges[0]).toEqual({ fromAnchor: true, toId: 'b', toPort: 'image' })
    expect(r.note).toBe('Upscales with ESRGAN')
  })

  it('rejects unknown node types', () => {
    const r = validateSuggestion({ ...goodChain, nodes: [{ id: 'a', type: 'NotANode', widgets: [] }] }, objectInfo, outAnchor)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('NotANode')
  })

  it('rejects edges with incompatible types and unknown ports', () => {
    const bad = {
      nodes: [{ id: 'a', type: 'UpscaleModelLoader', widgets: [] }],
      edges: [{ from: 'anchor', to: 'a.nope' }],
      note: '',
    }
    const r = validateSuggestion(bad, objectInfo, outAnchor)
    expect(r.ok).toBe(false)
  })

  it('requires exactly one anchor edge, oriented to the anchor direction', () => {
    const noAnchor = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [] }],
      edges: [], note: '',
    }
    expect(validateSuggestion(noAnchor, objectInfo, outAnchor).ok).toBe(false)

    const wrongDir = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [] }],
      edges: [{ from: 'a.IMAGE', to: 'anchor' }], note: '',
    }
    expect(validateSuggestion(wrongDir, objectInfo, outAnchor).ok).toBe(false)
  })

  it('silently drops bad widget values and clamps numerics (best-effort)', () => {
    const s = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [
        { name: 'scale_by', value: 99 },          // above max → clamp to 8
        { name: 'not_a_widget', value: 'x' },     // unknown → dropped
      ] }],
      edges: [{ from: 'anchor', to: 'a.image' }], note: '',
    }
    const r = validateSuggestion(s, objectInfo, outAnchor)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.widgetOverrides).toEqual({ scale_by: 8 })
  })

  it('drops enum values not in the full option list', () => {
    const s = {
      nodes: [{ id: 'a', type: 'UpscaleModelLoader', widgets: [{ name: 'model_name', value: 'fake.pth' }] }],
      edges: [{ from: 'a.UPSCALE_MODEL', to: 'anchor' }], note: '',
    }
    const inAnchor: PortAnchor = { ...outAnchor, direction: 'input', portType: 'UPSCALE_MODEL' }
    const r = validateSuggestion(s, objectInfo, inAnchor)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.widgetOverrides).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — cannot resolve `./portIntentValidate`.

- [ ] **Step 3: Implement `frontend/app/lib/portIntentValidate.ts`**

```ts
import type { PortAnchor } from './portIntent'
import { isTypeCompatible, linkInputPorts, outputPorts } from './portIntent'
import { widgetDefsFromInfo } from './portIntentCatalog'

export interface NormalizedNode {
  localId: string
  type: string
  widgetOverrides: Record<string, unknown>
}

export interface NormalizedEdge {
  fromAnchor?: boolean
  toAnchor?: boolean
  fromId?: string
  fromPort?: string
  toId?: string
  toPort?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  nodes: NormalizedNode[]
  edges: NormalizedEdge[]
  note: string
}

/** Validate the AI suggestion against the real /object_info schema.
 *  Structural problems (bad node type, bad port, bad wiring) are errors that
 *  fail validation; bad widget values are silently dropped or clamped — widget
 *  configuration is best-effort by design. */
export function validateSuggestion(
  raw: any,
  objectInfo: Record<string, any>,
  anchor: PortAnchor,
): ValidationResult {
  const errors: string[] = []
  const nodes: NormalizedNode[] = []
  const edges: NormalizedEdge[] = []
  const note = typeof raw?.note === 'string' ? raw.note : ''

  if (!Array.isArray(raw?.nodes) || raw.nodes.length === 0) {
    return { ok: false, errors: ['"nodes" must be a non-empty array'], nodes, edges, note }
  }

  for (const sn of raw.nodes) {
    const type = String(sn?.type ?? '')
    const localId = String(sn?.id ?? '')
    const info = objectInfo[type]
    if (!info) { errors.push(`Unknown node type "${type}" — use only types from the catalog`); continue }
    if (!localId) { errors.push(`Node of type "${type}" is missing an "id"`); continue }

    const defs = widgetDefsFromInfo(info, Infinity)
    const widgetOverrides: Record<string, unknown> = {}
    for (const w of Array.isArray(sn.widgets) ? sn.widgets : []) {
      const def = defs.find(d => d.name === w?.name)
      if (!def) continue
      let value: unknown = w.value
      if (def.type === 'ENUM') {
        if (!def.options?.includes(String(value))) continue
        value = String(value)
      } else if (def.type === 'INT' || def.type === 'FLOAT') {
        let num = typeof value === 'number' ? value : Number.parseFloat(String(value))
        if (Number.isNaN(num)) continue
        if (typeof def.min === 'number') num = Math.max(def.min, num)
        if (typeof def.max === 'number') num = Math.min(def.max, num)
        value = def.type === 'INT' ? Math.round(num) : num
      } else if (def.type === 'BOOLEAN') {
        value = value === true || value === 'true'
      } else {
        value = String(value)
      }
      widgetOverrides[def.name] = value
    }
    nodes.push({ localId, type, widgetOverrides })
  }

  const byLocalId = new Map(nodes.map(n => [n.localId, n]))
  let anchorEdges = 0

  for (const se of Array.isArray(raw.edges) ? raw.edges : []) {
    const from = String(se?.from ?? '')
    const to = String(se?.to ?? '')
    const edge: NormalizedEdge = {}
    let fromType = ''
    let toType = ''
    let bad = false

    if (from === 'anchor') {
      if (anchor.direction !== 'output') { errors.push('"anchor" used as a source but the anchor is an input port'); bad = true }
      else { edge.fromAnchor = true; fromType = anchor.portType }
    } else {
      const dot = from.indexOf('.')
      const id = dot >= 0 ? from.slice(0, dot) : from
      const port = dot >= 0 ? from.slice(dot + 1) : ''
      const n = byLocalId.get(id)
      if (!n) { errors.push(`Edge source "${from}" references an unknown node id`); bad = true }
      else {
        const p = outputPorts(objectInfo[n.type]).find(o => o.name === port)
        if (!p) { errors.push(`Node "${n.type}" has no output named "${port}"`); bad = true }
        else { edge.fromId = n.localId; edge.fromPort = p.name; fromType = p.type }
      }
    }

    if (to === 'anchor') {
      if (anchor.direction !== 'input') { errors.push('"anchor" used as a target but the anchor is an output port'); bad = true }
      else { edge.toAnchor = true; toType = anchor.portType }
    } else {
      const dot = to.indexOf('.')
      const id = dot >= 0 ? to.slice(0, dot) : to
      const port = dot >= 0 ? to.slice(dot + 1) : ''
      const n = byLocalId.get(id)
      if (!n) { errors.push(`Edge target "${to}" references an unknown node id`); bad = true }
      else {
        const p = linkInputPorts(objectInfo[n.type]).find(i => i.name === port)
        if (!p) { errors.push(`Node "${n.type}" has no link input named "${port}"`); bad = true }
        else { edge.toId = n.localId; edge.toPort = p.name; toType = p.type }
      }
    }

    if (edge.fromAnchor || edge.toAnchor) anchorEdges++
    if (bad) continue
    if (!isTypeCompatible(fromType, toType)) {
      errors.push(`Edge ${from} → ${to} connects incompatible types ${fromType} → ${toType}`)
      continue
    }
    edges.push(edge)
  }

  if (anchorEdges !== 1) {
    errors.push(`Exactly one edge must reference "anchor" (got ${anchorEdges})`)
  }

  return { ok: errors.length === 0, errors, nodes, edges, note }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit`
Expected: PASS (all three test files).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/portIntentValidate.ts frontend/app/lib/portIntentValidate.test.ts
git commit -m "Port intent: suggestion validation and normalization"
```

---

## Task 4: Server endpoint `/api/pipeline-suggest`

**Files:**
- Create: `frontend/server/api/pipeline-suggest.post.ts`

Mirrors `explain.post.ts` (raw fetch, user-supplied key — the project deliberately has no Anthropic SDK dependency in the frontend). Uses `claude-haiku-4-5` with **structured outputs** (`output_config.format` json_schema) so the response text block is guaranteed-valid JSON — note `widgets` is an array of `{name, value}` pairs because structured-output schemas forbid free-form objects (`additionalProperties` must be `false`).

- [ ] **Step 1: Implement the endpoint**

Create `frontend/server/api/pipeline-suggest.post.ts`:

```ts
const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short unique id, e.g. "a"' },
          type: { type: 'string', description: 'Node type from the catalog' },
          widgets: {
            type: 'array',
            description: 'Widget overrides; empty array if none',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
              },
              required: ['name', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'type', 'widgets'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '"anchor" or "<id>.<outputPortName>"' },
          to: { type: 'string', description: '"anchor" or "<id>.<inputPortName>"' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: 'One short sentence describing what was built' },
  },
  required: ['nodes', 'edges', 'note'],
  additionalProperties: false,
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, intent, anchor, catalog, graphContext, validationErrors, previousAttempt } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Anthropic API key' })
  }
  if (!intent || typeof intent !== 'string' || !anchor || !Array.isArray(catalog)) {
    throw createError({ statusCode: 400, message: 'Missing intent, anchor, or catalog' })
  }

  const directionNote = anchor.direction === 'output'
    ? 'The anchor is an OUTPUT port: your nodes consume its data (downstream). Exactly one edge must use "anchor" as its "from".'
    : 'The anchor is an INPUT port: your nodes produce its data (upstream). Exactly one edge must use "anchor" as its "to".'

  const repair = Array.isArray(validationErrors) && validationErrors.length
    ? `\n\nYour previous attempt:\n${JSON.stringify(previousAttempt)}\n\nIt failed validation:\n- ${validationErrors.join('\n- ')}\n\nReturn a corrected suggestion that fixes every error.`
    : ''

  const prompt = `You are a ComfyUI pipeline-building assistant. The user clicked a node port on the canvas and described what they want. Choose 1..N nodes to insert and wire to that port.

ANCHOR (the port the user clicked):
${JSON.stringify(anchor)}
${directionNote}

SURROUNDING GRAPH:
${typeof graphContext === 'string' ? graphContext : ''}

AVAILABLE NODES — you may ONLY use node types from this catalog:
${JSON.stringify(catalog)}

USER INTENT: "${intent}"

Rules:
- Use the minimal number of nodes that fulfils the intent — one node when one suffices.
- "widgets" holds only the values you want to override based on the intent; otherwise []. Enum values must come from that widget's listed options.
- Edge endpoints are "anchor" or "<id>.<portName>" using the exact port names from the catalog. Every edge must connect type-compatible ports.
- "note" is one short sentence shown to the user.${repair}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        output_config: { format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[pipeline-suggest] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    if (!text) throw createError({ statusCode: 502, message: 'Empty response from Claude' })
    try {
      return { suggestion: JSON.parse(text) }
    } catch {
      throw createError({ statusCode: 502, message: 'Claude returned invalid JSON' })
    }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
```

- [ ] **Step 2: Verify the endpoint rejects bad input (no API key needed)**

With the dev server running (`cd frontend && npm run dev`):

```bash
curl -s -X POST http://localhost:3000/api/pipeline-suggest -H 'content-type: application/json' -d '{}' | head -c 200
```

Expected: a 400 JSON error mentioning `Missing Anthropic API key`.

- [ ] **Step 3: (Optional, requires a real key) smoke-test the happy path**

```bash
curl -s -X POST http://localhost:3000/api/pipeline-suggest -H 'content-type: application/json' -d '{
  "apiKey": "'$ANTHROPIC_API_KEY'",
  "intent": "preview this image",
  "anchor": {"nodeId":"1","nodeType":"LoadImage","portName":"IMAGE","portType":"IMAGE","portIndex":0,"direction":"output"},
  "graphContext": "Anchor node: [1] Load Image (LoadImage)",
  "catalog": [{"type":"PreviewImage","name":"Preview Image","description":"Preview an image","inputs":[{"name":"images","type":"IMAGE"}],"outputs":[],"widgets":[]}]
}'
```

Expected: `{"suggestion":{"nodes":[{"id":"a","type":"PreviewImage","widgets":[]}],"edges":[{"from":"anchor","to":"a.images"}],"note":"..."}}` (ids/note may vary).

- [ ] **Step 4: Commit**

```bash
git add frontend/server/api/pipeline-suggest.post.ts
git commit -m "Port intent: /api/pipeline-suggest endpoint (Haiku, structured outputs)"
```

---

## Task 5: `usePortIntent` composable

**Files:**
- Create: `frontend/app/composables/usePortIntent.ts`

- [ ] **Step 1: Implement the composable**

```ts
import type { PortAnchor } from '~/lib/portIntent'
import { buildCatalog } from '~/lib/portIntentCatalog'
import { validateSuggestion, type ValidationResult } from '~/lib/portIntentValidate'

interface SuggestContext {
  objectInfo: Record<string, any>
  nodes: any[]
  edges: any[]
}

export function usePortIntent() {
  const { getLocalSetting } = useLocalSettings()
  const { nodeTypes, fetchNodeTypes } = useNodeSearch()

  // Small summary of the graph around the anchor so the model knows the context
  // (same spirit as useExplain's formatGraphForClaude, scoped to neighbors).
  function buildGraphContext(anchor: PortAnchor, nodes: any[], edges: any[]): string {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const lines: string[] = []
    const anchorNode = byId.get(anchor.nodeId)
    if (anchorNode) {
      lines.push(`Anchor node: [${anchorNode.id}] ${anchorNode.data?.title} (${anchorNode.data?.nodeType})`)
    }
    const neighborIds = new Set<string>()
    for (const e of edges) {
      if (e.source === anchor.nodeId) neighborIds.add(e.target)
      if (e.target === anchor.nodeId) neighborIds.add(e.source)
    }
    for (const id of neighborIds) {
      const n = byId.get(id)
      if (n) lines.push(`Connected: [${n.id}] ${n.data?.title} (${n.data?.nodeType})`)
    }
    return lines.join('\n') || 'The anchor node has no connections yet.'
  }

  async function callEndpoint(payload: Record<string, unknown>) {
    return await $fetch<{ suggestion: unknown }>('/api/pipeline-suggest', {
      method: 'POST',
      body: payload,
    })
  }

  /** Resolve an intent into a validated suggestion. One repair retry on
   *  validation failure; throws with a user-readable message otherwise. */
  async function suggest(intent: string, anchor: PortAnchor, ctx: SuggestContext): Promise<ValidationResult> {
    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
    if (!apiKey) throw new Error('No Anthropic API key set. Add your key in Settings → AI.')

    await fetchNodeTypes()
    const catalog = buildCatalog(nodeTypes.value, ctx.objectInfo, anchor)
    if (!catalog.length) throw new Error('No installed nodes are compatible with this port.')
    const graphContext = buildGraphContext(anchor, ctx.nodes, ctx.edges)
    const base = { apiKey, intent, anchor, catalog, graphContext }

    let res = await callEndpoint(base)
    let validated = validateSuggestion(res.suggestion, ctx.objectInfo, anchor)
    if (!validated.ok) {
      res = await callEndpoint({ ...base, previousAttempt: res.suggestion, validationErrors: validated.errors })
      validated = validateSuggestion(res.suggestion, ctx.objectInfo, anchor)
    }
    if (!validated.ok) {
      throw new Error(`The AI couldn't build a valid pipeline: ${validated.errors[0]}`)
    }
    return validated
  }

  return { suggest }
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i portintent || echo "no portIntent type errors"`
Expected: no portIntent type errors. (If `nuxt typecheck` isn't configured in this repo, `npx vue-tsc --noEmit -p .` or simply rely on the dev server console showing no errors for these files.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/usePortIntent.ts
git commit -m "Port intent: usePortIntent composable with repair retry"
```

---

## Task 6: `PortIntentPopover.vue`

**Files:**
- Create: `frontend/app/components/vue-canvas/PortIntentPopover.vue`

Dumb component: one input, fuzzy candidate rows, a pinned "✦ Ask AI" row. Parent owns AI state and insertion.

- [ ] **Step 1: Implement the component**

```vue
<script setup lang="ts">
import type { PortAnchor, NodeTypeLite } from '~/lib/portIntent'
import { anchorCandidates } from '~/lib/portIntent'

const props = defineProps<{
  anchor: PortAnchor
  screen: { x: number; y: number }
  aiState: 'idle' | 'loading' | 'error' | 'done'
  aiError?: string | null
  aiNote?: string | null
}>()

const emit = defineEmits<{
  (e: 'select-node', nodeType: string): void
  (e: 'ask-ai', intent: string): void
  (e: 'close'): void
}>()

const { nodeTypes, fetchNodeTypes } = useNodeSearch()

const query = ref('')
const selectedIndex = ref(0)
const rootEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)

const candidates = computed<NodeTypeLite[]>(() => {
  let list = anchorCandidates(nodeTypes.value, props.anchor)
  const q = query.value.toLowerCase().trim()
  if (q) {
    list = list.filter(n =>
      n.displayName.toLowerCase().includes(q)
      || n.name.toLowerCase().includes(q)
      || n.description.toLowerCase().includes(q),
    )
  }
  return list.slice(0, 8)
})

// Rows are candidates + one trailing "Ask AI" row.
const rowCount = computed(() => candidates.value.length + 1)
const aiRowIndex = computed(() => candidates.value.length)

watch(query, () => { selectedIndex.value = 0 })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % rowCount.value
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + rowCount.value) % rowCount.value
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (e.metaKey || e.ctrlKey || selectedIndex.value === aiRowIndex.value) {
      submitAi()
    }
    else {
      const n = candidates.value[selectedIndex.value]
      if (n) emit('select-node', n.name)
    }
  }
  else if (e.key === 'Escape') {
    emit('close')
  }
}

function submitAi() {
  const intent = query.value.trim()
  if (intent && props.aiState !== 'loading') emit('ask-ai', intent)
}

function onDocPointerDown(e: PointerEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) emit('close')
}

onMounted(() => {
  fetchNodeTypes()
  nextTick(() => inputEl.value?.focus())
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown, true))
</script>

<template>
  <div
    ref="rootEl"
    class="fixed z-[90] w-80 rounded-lg border border-white/10 bg-[#1e1e1e] shadow-2xl text-sm overflow-hidden"
    :style="{ left: `${screen.x}px`, top: `${screen.y}px` }"
    @pointerdown.stop
    @click.stop
  >
    <input
      ref="inputEl"
      v-model="query"
      type="text"
      placeholder="What do you want to do?"
      class="w-full bg-transparent px-3 py-2.5 text-white placeholder-white/30 outline-none border-b border-white/10"
      @keydown="onKeydown"
    >

    <div class="max-h-72 overflow-y-auto py-1">
      <button
        v-for="(n, i) in candidates"
        :key="n.name"
        class="w-full flex items-center justify-between px-3 py-1.5 text-left"
        :class="i === selectedIndex ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'"
        @mouseenter="selectedIndex = i"
        @click="emit('select-node', n.name)"
      >
        <span class="truncate">{{ n.displayName }}</span>
        <span class="ml-2 shrink-0 text-[10px] text-white/30">{{ n.category.split('/')[0] }}</span>
      </button>

      <button
        class="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-white/10"
        :class="selectedIndex === aiRowIndex ? 'bg-violet-500/20 text-violet-200' : 'text-violet-300/80 hover:bg-violet-500/10'"
        :disabled="aiState === 'loading' || !query.trim()"
        @mouseenter="selectedIndex = aiRowIndex"
        @click="submitAi"
      >
        <span v-if="aiState === 'loading'" class="inline-block h-3 w-3 animate-spin rounded-full border border-violet-300 border-t-transparent" />
        <span v-else>✦</span>
        <span class="truncate">
          {{ aiState === 'loading' ? 'Asking AI…' : (query.trim() ? `Ask AI: "${query.trim()}"` : 'Ask AI (type your intent)') }}
        </span>
        <span class="ml-auto shrink-0 text-[10px] text-white/30">⌘⏎</span>
      </button>
    </div>

    <div v-if="aiState === 'error' && aiError" class="px-3 py-2 text-xs text-red-400 border-t border-white/10">
      {{ aiError }}
    </div>
    <div v-else-if="aiState === 'done' && aiNote" class="px-3 py-2 text-xs text-emerald-300 border-t border-white/10">
      ✦ {{ aiNote }}
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit** (visual verification happens in Task 7 when it's mounted)

```bash
git add frontend/app/components/vue-canvas/PortIntentPopover.vue
git commit -m "Port intent: popover component (fuzzy list + Ask AI row)"
```

---

## Task 7: Canvas integration (triggers + insertion)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`

- [ ] **Step 1: Verify Vue Flow connect-event signatures**

Run:

```bash
grep -rn "OnConnectStartParams\|onConnectStart\|onConnectEnd" frontend/node_modules/@vue-flow/core/dist/vue-flow-core.d.ts | head -20
```

Expected (Vue Flow 1.x): `onConnectStart` receives `OnConnectStartParams & { event: MouseEvent }` (fields `nodeId`, `handleId`, `handleType`); `onConnectEnd` receives the `MouseEvent`. If the actual signature differs, adapt the destructuring in Step 2 accordingly — the logic is unchanged.

- [ ] **Step 2: Add trigger wiring and state**

In `VueNodeCanvas.vue` `<script setup>`:

1. Ensure `onConnectStart` and `onConnectEnd` are destructured from the existing `useVueFlow()` call (alongside `project`, `addEdges`, etc.).
2. Add the import: `import type { PortAnchor } from '~/lib/portIntent'`.
3. Inside the existing `onConnect((params) => { ... })` handler (line ~985), add `connectionMade = true` as the first line.
4. Add this block (near the wire-splicing section, after `spliceAfterNode`):

```ts
// ── Port intent popover ──────────────────────────────────────────────────────
// Click a port (no drag) or drop a wire on empty canvas → intent popover.
const portIntent = ref<{ anchor: PortAnchor; screen: { x: number; y: number }; dropFlow?: { x: number; y: number } } | null>(null)
const portIntentAiState = ref<'idle' | 'loading' | 'error' | 'done'>('idle')
const portIntentAiError = ref<string | null>(null)
const portIntentAiNote = ref<string | null>(null)
const { suggest: suggestPortIntent } = usePortIntent()

let connectStartInfo: { nodeId: string; handleId: string; handleType: string; x: number; y: number } | null = null
let connectionMade = false

onConnectStart(({ event, nodeId, handleId, handleType }) => {
  connectionMade = false
  const me = event as MouseEvent
  connectStartInfo = nodeId && handleId
    ? { nodeId, handleId, handleType: handleType || 'source', x: me.clientX, y: me.clientY }
    : null
})

onConnectEnd((event) => {
  const start = connectStartInfo
  connectStartInfo = null
  if (!start || connectionMade) return
  const me = event as MouseEvent
  const anchor = anchorFromHandle(start.nodeId, start.handleId, start.handleType)
  if (!anchor) return
  const travel = Math.hypot(me.clientX - start.x, me.clientY - start.y)
  const droppedOnPane = (me.target as HTMLElement | null)?.closest?.('.vue-flow__pane')
  if (travel <= 6) {
    // Stationary click on the port itself.
    openPortIntent(anchor, { x: start.x + 12, y: start.y + 12 })
  }
  else if (droppedOnPane) {
    // Wire dragged out and released on empty canvas.
    const flow = project({ x: me.clientX, y: me.clientY })
    openPortIntent(anchor, { x: me.clientX + 12, y: me.clientY + 12 }, flow)
  }
})

function anchorFromHandle(nodeId: string, handleId: string, handleType: string): PortAnchor | null {
  const node = (nodes.value as any[]).find(n => n.id === nodeId)
  if (!node) return null
  const direction = handleType === 'source' ? 'output' as const : 'input' as const
  const prefix = direction === 'output' ? 'output-' : 'input-'
  if (!handleId.startsWith(prefix)) return null
  const portIndex = parseInt(handleId.slice(prefix.length) || '0')
  const port = direction === 'output' ? node.data?.outputs?.[portIndex] : node.data?.inputs?.[portIndex]
  if (!port) return null
  return { nodeId, nodeType: node.data?.nodeType || '', portName: port.name, portType: port.type || '*', portIndex, direction }
}

function openPortIntent(anchor: PortAnchor, screen: { x: number; y: number }, dropFlow?: { x: number; y: number }) {
  portIntentAiState.value = 'idle'
  portIntentAiError.value = null
  portIntentAiNote.value = null
  portIntent.value = { anchor, screen, dropFlow }
}
```

- [ ] **Step 3: Add insertion + popover handlers**

Continue in the same block:

```ts
/** Insert a validated AI suggestion: lay nodes out from the anchor, wire them up.
 *  The debounced history snapshot makes the whole insert one undo step. */
async function insertSuggestion(result: Awaited<ReturnType<typeof suggestPortIntent>>, anchor: PortAnchor, dropFlow?: { x: number; y: number }) {
  const anchorNode = (nodes.value as any[]).find(n => n.id === anchor.nodeId)
  const dir = anchor.direction === 'output' ? 1 : -1
  const base = dropFlow ?? {
    x: (anchorNode?.position?.x ?? 0) + dir * 360,
    y: anchorNode?.position?.y ?? 0,
  }
  const created = new Map<string, any>()
  result.nodes.forEach((sn, i) => {
    const node = createNodeData(sn.type, { x: base.x + dir * i * 360, y: base.y }, sn.widgetOverrides)
    node.id = `${Date.now()}-${i}` // createNodeData's Date.now() id collides within one tick
    node.selected = true
    created.set(sn.localId, node)
    nodes.value.push(node)
  })
  await nextTick()

  const newEdges: any[] = []
  for (const e of result.edges) {
    if (e.fromAnchor) {
      const to = created.get(e.toId!)
      if (!to) continue
      const idx = Math.max(0, to.data.inputs.findIndex((p: any) => p.name === e.toPort))
      newEdges.push({ source: anchor.nodeId, sourceHandle: `output-${anchor.portIndex}`, target: to.id, targetHandle: `input-${idx}`, type: 'comfy', data: { dataType: anchor.portType } })
    }
    else if (e.toAnchor) {
      const from = created.get(e.fromId!)
      if (!from) continue
      const idx = Math.max(0, from.data.outputs.findIndex((p: any) => p.name === e.fromPort))
      newEdges.push({ source: from.id, sourceHandle: `output-${idx}`, target: anchor.nodeId, targetHandle: `input-${anchor.portIndex}`, type: 'comfy', data: { dataType: anchor.portType } })
    }
    else {
      const from = created.get(e.fromId!)
      const to = created.get(e.toId!)
      if (!from || !to) continue
      const oIdx = Math.max(0, from.data.outputs.findIndex((p: any) => p.name === e.fromPort))
      const iIdx = Math.max(0, to.data.inputs.findIndex((p: any) => p.name === e.toPort))
      newEdges.push({ source: from.id, sourceHandle: `output-${oIdx}`, target: to.id, targetHandle: `input-${iIdx}`, type: 'comfy', data: { dataType: from.data.outputs[oIdx]?.type ?? '*' } })
    }
  }
  addEdges(newEdges)
}

/** Free tier: a node picked from the fuzzy list, wired straight to the anchor. */
async function handlePortIntentSelect(nodeType: string) {
  const ctx = portIntent.value
  if (!ctx) return
  portIntent.value = null
  if (!objectInfo.value[nodeType]) await fetchObjectInfo()
  const anchor = ctx.anchor
  const anchorNode = (nodes.value as any[]).find(n => n.id === anchor.nodeId)
  const dir = anchor.direction === 'output' ? 1 : -1
  const pos = ctx.dropFlow ?? {
    x: (anchorNode?.position?.x ?? 0) + dir * 360,
    y: anchorNode?.position?.y ?? 0,
  }
  const node = createNodeData(nodeType, pos)
  nodes.value.push(node)
  await nextTick()
  if (anchor.direction === 'output') {
    addEdges([{ source: anchor.nodeId, sourceHandle: `output-${anchor.portIndex}`, target: node.id, targetHandle: inputHandleFor(node, anchor.portType), type: 'comfy', data: { dataType: anchor.portType } }])
  }
  else {
    addEdges([{ source: node.id, sourceHandle: outputHandleFor(node, anchor.portType), target: anchor.nodeId, targetHandle: `input-${anchor.portIndex}`, type: 'comfy', data: { dataType: anchor.portType } }])
  }
}

/** AI tier: resolve the intent, insert the validated result, show the note. */
async function handlePortIntentAi(intent: string) {
  const ctx = portIntent.value
  if (!ctx) return
  portIntentAiState.value = 'loading'
  portIntentAiError.value = null
  try {
    await fetchObjectInfo()
    const result = await suggestPortIntent(intent, ctx.anchor, {
      objectInfo: objectInfo.value,
      nodes: nodes.value as any[],
      edges: edges.value as any[],
    })
    await insertSuggestion(result, ctx.anchor, ctx.dropFlow)
    portIntentAiNote.value = result.note || 'Done'
    portIntentAiState.value = 'done'
    setTimeout(() => { portIntent.value = null }, 2000)
  }
  catch (err: any) {
    portIntentAiState.value = 'error'
    portIntentAiError.value = err?.data?.message || err?.message || 'AI suggestion failed'
  }
}
```

- [ ] **Step 4: Mount the popover in the template**

In the `VueNodeCanvas.vue` template, next to the other overlay components (search for where dialogs/overlays are rendered near the end of the root element), add:

```vue
<VueCanvasPortIntentPopover
  v-if="portIntent"
  :anchor="portIntent.anchor"
  :screen="portIntent.screen"
  :ai-state="portIntentAiState"
  :ai-error="portIntentAiError"
  :ai-note="portIntentAiNote"
  @select-node="handlePortIntentSelect"
  @ask-ai="handlePortIntentAi"
  @close="portIntent = null"
/>
```

- [ ] **Step 5: Manual smoke check in the browser**

With both servers running, open the Vue canvas, add a `LoadImage` node, then:
1. Click its `IMAGE` output port without dragging → popover opens next to the port, listing IMAGE-consuming nodes.
2. Type `preview`, press Enter on "Preview Image" → node inserted to the right, wired, one ⌘Z removes both.
3. Drag a wire from the port to empty canvas and release → popover opens at the drop point; picking a node inserts it there.
4. Dragging a wire onto another node's compatible port still creates a normal connection, no popover.
5. Esc and click-away both dismiss the popover.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "Port intent: canvas triggers, insertion, and popover wiring"
```

---

## Task 8: Playwright e2e + manual AI protocol

**Files:**
- Create: `frontend/tests/port-intent.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect } from '@playwright/test'
import { openBlankWorkflow, dropNode, waitForBackend } from './_helpers'

test.describe('port intent popover', () => {
  test.beforeEach(async ({ page }) => {
    await openBlankWorkflow(page)
    await waitForBackend(page)
  })

  test('port click opens popover; picking a node inserts and wires it', async ({ page }) => {
    await dropNode(page, 'LoadImage')
    await page.locator('.vue-flow__node .vue-flow__handle.source').first().click({ force: true })

    const input = page.getByPlaceholder('What do you want to do?')
    await expect(input).toBeVisible()

    await input.fill('preview')
    await expect(page.getByText('Preview Image')).toBeVisible()
    await input.press('Enter')

    await expect(page.locator('.vue-flow__node')).toHaveCount(2)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
  })

  test('escape closes the popover without inserting', async ({ page }) => {
    await dropNode(page, 'LoadImage')
    await page.locator('.vue-flow__node .vue-flow__handle.source').first().click({ force: true })
    const input = page.getByPlaceholder('What do you want to do?')
    await expect(input).toBeVisible()
    await input.press('Escape')
    await expect(input).not.toBeVisible()
    await expect(page.locator('.vue-flow__node')).toHaveCount(1)
  })

  test('ask AI without an API key shows an inline error', async ({ page }) => {
    await dropNode(page, 'LoadImage')
    await page.locator('.vue-flow__node .vue-flow__handle.source').first().click({ force: true })
    const input = page.getByPlaceholder('What do you want to do?')
    await input.fill('upscale this image 4x')
    await input.press('ControlOrMeta+Enter')
    await expect(page.getByText(/No Anthropic API key/)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the spec**

Servers must be running (frontend dev on the port `playwright.config.ts` expects, ComfyUI on 8188):

```bash
cd frontend && npx playwright test tests/port-intent.spec.ts
```

Expected: 3 passed. If the handle click is flaky due to the 2.5px hit target, click the handle's bounding-box center via `handle.click({ force: true, position: { x: 5, y: 5 } })`.

- [ ] **Step 3: Run the full unit suite once more**

```bash
cd frontend && npm run test:unit
```

Expected: PASS.

- [ ] **Step 4: Manual AI protocol (requires a real Anthropic key in Settings → AI)**

1. **Single node:** `LoadImage` → click output port → type "upscale this 4x with esrgan" → Ask AI. Expect: `UpscaleModelLoader` + `ImageUpscaleWithModel` (or a single scale node) inserted, wired, widget values set (scale/model), green note shown, popover closes after ~2 s.
2. **Drag-to-empty AI:** drag wire from a `LATENT` output to empty canvas → "decode and save the image" → Ask AI. Expect: `VAEDecode` + `SaveImage` chain at the drop point (VAE input may be unwired — acceptable, widgets best-effort).
3. **Input-port upstream:** click `KSampler`'s `model` *input* port → "load an SDXL checkpoint" → Ask AI. Expect: a checkpoint loader inserted to the LEFT, wired into the input.
4. **Undo:** after any AI insert, one ⌘Z removes the entire inserted chain.
5. **Nonsense intent:** "make me a sandwich" → expect a graceful inline error (validation failure after retry) with fuzzy results still usable.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/port-intent.spec.ts
git commit -m "Port intent: e2e coverage for popover open/insert/error paths"
```

---

## Self-review notes

- **Spec coverage:** both gestures (Task 7 step 2), hybrid popover (Task 6), direction semantics (Tasks 1/7), trimmed catalog + enum capping (Task 2), Haiku endpoint with structured 1..N schema (Task 4), validation + clamping + one repair retry (Tasks 3/5), single-undo insertion via the existing debounced snapshot (Task 7), missing-key path (Tasks 5/8), phasing — the prompt nudges minimal answers; chain quality work is Phase 2.
- **Deviation from spec, intentional:** the spec said "tool-forced JSON"; the implementation uses `output_config.format` structured outputs (the current API-recommended equivalent — same guarantee, simpler parsing). `widgets` is an array of `{name, value}` pairs instead of a free-form object because structured-output schemas require `additionalProperties: false`.
- **Known risk:** Vue Flow connect-event payload shapes — Task 7 Step 1 verifies against the installed `.d.ts` before writing the handlers.
