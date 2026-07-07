# Named image references (`@refs`) — Implementation Plan (first slice)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user name any image on the canvas (`@tracksuit`), then reuse it by a shorthand Reference node, by binding an image-loader widget to `@name`, or by mentioning `@name` in a prompt (Mode 1 text substitution) — all resolved client-side at submit, backed by the project doc.

**Architecture:** A project-scoped `name → { filename, text? }` registry lives on `ProjectDoc.assetRegistry` (round-trips exactly like `brandKitId`). Pure helpers create/resolve entries. A pure `applyRefsToWorkflow` transform substitutes `@name` tokens in prompt widget values; a thin Vue method (`injectAssetRegistry`) additionally resolves image-loader widgets bound to `@name` and materializes Reference nodes, inserted into `runVueWorkflow` right after brand-kit injection. UI: an `@` promote button on media, a ref-picker binding glyph on image-loader widgets, and a new frontend-only `Reference` node.

**Tech Stack:** Nuxt 4, Vue 3 (`<script setup>`), TypeScript, Vue Flow canvas, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-06-named-image-references-design.md`

## Global Constraints

- Tests: Vitest. Run from `frontend/` with `npm run test:unit`, or one file with `npx vitest run tests/unit/<name>.unit.spec.ts`. Unit tests live in `frontend/tests/unit/*.unit.spec.ts`.
- Pure-logic tasks are TDD (failing test first). Vue/canvas tasks end with an explicit **browser verification** step — never claim UI works on unit tests alone.
- Variable/reference affordance color is pink `--var-accent` (never purple, never emerald, never pastel). Reuse existing tokens.
- Reference handles are bare names in the registry (no leading `@`); the `@` is display/typing sugar only.
- Stage only files you touched with explicit paths; never `git add -A`.
- Work on `main` (no feature branch). Commit after every task.
- This plan is the **first slice only**. Out of scope here (own future plans): Mode 2 (the multimodal `@`-prompt chip node), cross-project reference sharing, retrofitting free-text prompt autocomplete.

---

### Task 1: Reference registry model + pure helpers

**Files:**
- Create: `frontend/app/lib/refs/registry.ts`
- Test: `frontend/tests/unit/refs-registry.unit.spec.ts`

**Interfaces:**
- Produces:
  - `interface RefEntry { filename: string; text?: string }`
  - `type RefRegistry = Record<string, RefEntry>`
  - `normalizeRefName(raw: string): string | null`
  - `setRef(reg: RefRegistry, name: string, entry: RefEntry): RefRegistry`
  - `resolveRef(reg: RefRegistry, name: string): RefEntry | undefined`
  - `resolveRefFilename(reg: RefRegistry, name: string): string | undefined`
  - `resolveRefText(reg: RefRegistry, name: string): string | undefined`
  - `renameRef(reg: RefRegistry, from: string, to: string): RefRegistry`
  - `removeRef(reg: RefRegistry, name: string): RefRegistry`
  - `listRefNames(reg: RefRegistry): string[]`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/refs-registry.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  normalizeRefName, setRef, resolveRef, resolveRefFilename, resolveRefText,
  renameRef, removeRef, listRefNames, type RefRegistry,
} from '../../app/lib/refs/registry'

describe('normalizeRefName', () => {
  it('strips a leading @, trims, and keeps valid chars', () => {
    expect(normalizeRefName('@tracksuit')).toBe('tracksuit')
    expect(normalizeRefName('  Grey_Cyc-2 ')).toBe('Grey_Cyc-2')
  })
  it('collapses inner whitespace to a single hyphen', () => {
    expect(normalizeRefName('grey cyc')).toBe('grey-cyc')
  })
  it('rejects empty / invalid names as null', () => {
    expect(normalizeRefName('')).toBeNull()
    expect(normalizeRefName('@@@')).toBeNull()
    expect(normalizeRefName('   ')).toBeNull()
  })
})

describe('registry CRUD (immutable)', () => {
  it('setRef adds under the normalized key and does not mutate input', () => {
    const a: RefRegistry = {}
    const b = setRef(a, '@Tracksuit', { filename: 'suit.png' })
    expect(a).toEqual({})
    expect(b).toEqual({ Tracksuit: { filename: 'suit.png' } })
  })
  it('setRef is a no-op returning the same object for an invalid name', () => {
    const a: RefRegistry = { x: { filename: 'x.png' } }
    expect(setRef(a, '   ', { filename: 'y.png' })).toBe(a)
  })
  it('resolveRef / resolveRefFilename / resolveRefText tolerate a leading @', () => {
    const r = setRef({}, 'tracksuit', { filename: 'suit.png', text: 'black Nike tracksuit' })
    expect(resolveRef(r, '@tracksuit')?.filename).toBe('suit.png')
    expect(resolveRefFilename(r, 'tracksuit')).toBe('suit.png')
    expect(resolveRefText(r, '@tracksuit')).toBe('black Nike tracksuit')
    expect(resolveRefFilename(r, 'missing')).toBeUndefined()
  })
  it('renameRef moves the entry and drops the old key', () => {
    const r = setRef({}, 'a', { filename: 'a.png' })
    expect(renameRef(r, 'a', 'b')).toEqual({ b: { filename: 'a.png' } })
  })
  it('removeRef deletes without mutating input', () => {
    const r = setRef({}, 'a', { filename: 'a.png' })
    expect(removeRef(r, 'a')).toEqual({})
    expect(r).toEqual({ a: { filename: 'a.png' } })
  })
  it('listRefNames returns names sorted', () => {
    const r = setRef(setRef({}, 'zed', { filename: 'z.png' }), 'alpha', { filename: 'a.png' })
    expect(listRefNames(r)).toEqual(['alpha', 'zed'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/refs-registry.unit.spec.ts`
Expected: FAIL — cannot find module `../../app/lib/refs/registry`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/app/lib/refs/registry.ts
/**
 * Project-scoped named image references (`@refs`). A handle like `@tracksuit`
 * maps to a ComfyUI input-dir filename an image widget can load, plus optional
 * text used for Mode 1 prompt substitution. Keys are bare (no leading '@').
 */
export interface RefEntry {
  /** ComfyUI input-dir filename an image widget consumes (e.g. 'suit.png'). */
  filename: string
  /** Optional expansion for `@name` inside a prompt (descriptor / trigger word). */
  text?: string
}
export type RefRegistry = Record<string, RefEntry>

/** Bare, storable handle from raw user text, or null if there's nothing valid. */
export function normalizeRefName(raw: string): string | null {
  const stripped = (raw || '').trim().replace(/^@+/, '').trim()
  const collapsed = stripped.replace(/\s+/g, '-')
  return /^[a-zA-Z0-9_-]+$/.test(collapsed) ? collapsed : null
}

export function setRef(reg: RefRegistry, name: string, entry: RefEntry): RefRegistry {
  const key = normalizeRefName(name)
  if (!key) return reg
  return { ...reg, [key]: entry }
}

export function resolveRef(reg: RefRegistry, name: string): RefEntry | undefined {
  const key = normalizeRefName(name)
  return key ? reg[key] : undefined
}

export function resolveRefFilename(reg: RefRegistry, name: string): string | undefined {
  return resolveRef(reg, name)?.filename
}

export function resolveRefText(reg: RefRegistry, name: string): string | undefined {
  const t = resolveRef(reg, name)?.text
  return t && t.trim() ? t.trim() : undefined
}

export function renameRef(reg: RefRegistry, from: string, to: string): RefRegistry {
  const fromKey = normalizeRefName(from)
  const toKey = normalizeRefName(to)
  if (!fromKey || !toKey || !(fromKey in reg)) return reg
  const next: RefRegistry = { ...reg }
  next[toKey] = next[fromKey]!
  delete next[fromKey]
  return next
}

export function removeRef(reg: RefRegistry, name: string): RefRegistry {
  const key = normalizeRefName(name)
  if (!key || !(key in reg)) return reg
  const next: RefRegistry = { ...reg }
  delete next[key]
  return next
}

export function listRefNames(reg: RefRegistry): string[] {
  return Object.keys(reg).sort((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/refs-registry.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/refs/registry.ts frontend/tests/unit/refs-registry.unit.spec.ts
git commit -m "feat(refs): reference registry model + pure helpers"
```

---

### Task 2: Mode 1 prompt token substitution

**Files:**
- Create: `frontend/app/lib/refs/resolve.ts`
- Test: `frontend/tests/unit/refs-resolve.unit.spec.ts`

**Interfaces:**
- Consumes: `RefRegistry`, `resolveRefText` from Task 1.
- Produces:
  - `REF_TOKEN_RE: RegExp` (global, matches `@name`)
  - `substituteRefTokens(text: string, reg: RefRegistry): string`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/refs-resolve.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { substituteRefTokens } from '../../app/lib/refs/resolve'
import { setRef, type RefRegistry } from '../../app/lib/refs/registry'

const reg: RefRegistry = setRef(
  setRef({}, 'doue', { filename: 'doue.png', text: 'TOK man' }),
  'tracksuit', { filename: 'suit.png', text: 'black Nike tracksuit' },
)

describe('substituteRefTokens', () => {
  it('replaces @name with the entry text', () => {
    expect(substituteRefTokens('a shot of @doue in @tracksuit', reg))
      .toBe('a shot of TOK man in black Nike tracksuit')
  })
  it('leaves unknown @tokens untouched', () => {
    expect(substituteRefTokens('lit like @greycyc', reg)).toBe('lit like @greycyc')
  })
  it('leaves a known ref that has no text untouched (image-only ref)', () => {
    const r = setRef({}, 'plate', { filename: 'plate.png' })
    expect(substituteRefTokens('use @plate', r)).toBe('use @plate')
  })
  it('is a no-op on strings with no @ tokens', () => {
    expect(substituteRefTokens('plain prompt', reg)).toBe('plain prompt')
  })
  it('handles adjacent punctuation without eating it', () => {
    expect(substituteRefTokens('@doue, centered.', reg)).toBe('TOK man, centered.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/refs-resolve.unit.spec.ts`
Expected: FAIL — cannot find module `../../app/lib/refs/resolve`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/app/lib/refs/resolve.ts
import { resolveRefText, type RefRegistry } from './registry'

/** Matches `@name` handles (letters, digits, underscore, hyphen). */
export const REF_TOKEN_RE = /@([a-zA-Z0-9_-]+)/g

/**
 * Mode 1: replace `@name` in a prompt with the reference's text expansion.
 * Unknown refs, and known refs with no text, are left verbatim so nothing is
 * silently dropped.
 */
export function substituteRefTokens(text: string, reg: RefRegistry): string {
  if (!text || text.indexOf('@') === -1) return text
  return text.replace(REF_TOKEN_RE, (whole, name) => resolveRefText(reg, name) ?? whole)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/refs-resolve.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/refs/resolve.ts frontend/tests/unit/refs-resolve.unit.spec.ts
git commit -m "feat(refs): Mode 1 @name prompt substitution"
```

---

### Task 3: Pure workflow transform — substitute `@refs` in prompt widget values

**Files:**
- Create: `frontend/app/lib/refs/injectWorkflow.ts`
- Test: `frontend/tests/unit/refs-inject-workflow.unit.spec.ts`

**Interfaces:**
- Consumes: `substituteRefTokens` (Task 2), `RefRegistry` (Task 1).
- Produces: `applyRefPromptTokens(workflow: any, reg: RefRegistry): void` — mutates each node's string entries in `widgets_values` in place. (Image-widget and Reference-node handling are added in later tasks; this task does prompt strings only.)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/refs-inject-workflow.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyRefPromptTokens } from '../../app/lib/refs/injectWorkflow'
import { setRef, type RefRegistry } from '../../app/lib/refs/registry'

const reg: RefRegistry = setRef({}, 'tracksuit', { filename: 'suit.png', text: 'black Nike tracksuit' })

describe('applyRefPromptTokens', () => {
  it('substitutes @name inside string widget values, in place', () => {
    const wf = { nodes: [{ type: 'CLIPTextEncode', widgets_values: ['man in @tracksuit', 20] }] }
    applyRefPromptTokens(wf, reg)
    expect(wf.nodes[0].widgets_values[0]).toBe('man in black Nike tracksuit')
    expect(wf.nodes[0].widgets_values[1]).toBe(20)
  })
  it('ignores non-string widget values and nodes without widgets_values', () => {
    const wf = { nodes: [{ type: 'X', widgets_values: [3, null, true] }, { type: 'Y' }] }
    expect(() => applyRefPromptTokens(wf, reg)).not.toThrow()
    expect(wf.nodes[0].widgets_values).toEqual([3, null, true])
  })
  it('tolerates an empty / missing nodes array', () => {
    expect(() => applyRefPromptTokens({}, reg)).not.toThrow()
    expect(() => applyRefPromptTokens({ nodes: [] }, reg)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/refs-inject-workflow.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/app/lib/refs/injectWorkflow.ts
import { substituteRefTokens } from './resolve'
import type { RefRegistry } from './registry'

/**
 * Mode 1 over a serialized workflow: rewrite every STRING widget value,
 * substituting `@name` tokens. Runs client-side at submit, before the graph is
 * sent to ComfyUI. Mutates in place (the caller has already deep-cloned).
 */
export function applyRefPromptTokens(workflow: any, reg: RefRegistry): void {
  const nodes: any[] = workflow?.nodes
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    const vals = node?.widgets_values
    if (!Array.isArray(vals)) continue
    for (let i = 0; i < vals.length; i++) {
      if (typeof vals[i] === 'string' && vals[i].indexOf('@') !== -1) {
        vals[i] = substituteRefTokens(vals[i], reg)
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/refs-inject-workflow.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/refs/injectWorkflow.ts frontend/tests/unit/refs-inject-workflow.unit.spec.ts
git commit -m "feat(refs): pure prompt-token workflow transform"
```

---

### Task 4: Persist the registry on `ProjectDoc` + a reactive accessor

**Files:**
- Modify: `frontend/app/lib/projectDoc.ts` (the `ProjectDoc` interface, ~lines 16-22, and the `toProjectDoc` wrapper)
- Create: `frontend/app/composables/useRefRegistry.ts`
- Test: `frontend/tests/unit/refs-projectdoc.unit.spec.ts`

**Interfaces:**
- Consumes: `RefRegistry` (Task 1), the existing `ProjectDoc` / `toProjectDoc` in `projectDoc.ts`.
- Produces:
  - `ProjectDoc.assetRegistry?: RefRegistry` (new optional field)
  - `useRefRegistry(doc: Ref<ProjectDoc | null | undefined>)` returning `{ registry: ComputedRef<RefRegistry>, upsert(name, entry), rename(from, to), remove(name) }`.

- [ ] **Step 1: Read `projectDoc.ts` first**

Run: `sed -n '1,60p' frontend/app/lib/projectDoc.ts`
Confirm the exact shape of `ProjectDoc` and the `toProjectDoc(...)` signature before editing. The field addition and the test below assume `toProjectDoc` returns a `ProjectDoc` and spreads/normalizes known fields.

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/tests/unit/refs-projectdoc.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { toProjectDoc } from '../../app/lib/projectDoc'

describe('ProjectDoc.assetRegistry round-trip', () => {
  it('preserves an existing assetRegistry through toProjectDoc', () => {
    const doc = {
      canvases: [{ id: 'c1', name: 'Shot 1', workflow: { nodes: [] } }],
      activeCanvasId: 'c1',
      assetRegistry: { tracksuit: { filename: 'suit.png', text: 'black Nike tracksuit' } },
    }
    const out = toProjectDoc(doc as any)
    expect(out.assetRegistry).toEqual({ tracksuit: { filename: 'suit.png', text: 'black Nike tracksuit' } })
  })
  it('defaults assetRegistry to an empty object when absent', () => {
    const out = toProjectDoc({ nodes: [] } as any)
    expect(out.assetRegistry).toEqual({})
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/refs-projectdoc.unit.spec.ts`
Expected: FAIL — `assetRegistry` is undefined (field + defaulting not yet added).

- [ ] **Step 4: Add the field + defaulting**

In `frontend/app/lib/projectDoc.ts`, add to the `ProjectDoc` interface (after `brandKitId`):

```typescript
  /** Project-scoped named image references (`@refs`): handle → { filename, text? }. */
  assetRegistry?: import('./refs/registry').RefRegistry
```

Then in `toProjectDoc(...)`, ensure the returned object carries the registry (mirror how `brandKitId` is passed through), defaulting to `{}`:

```typescript
  // inside the object toProjectDoc returns:
  assetRegistry: (input as any)?.assetRegistry ?? {},
```

(If `toProjectDoc` has both a "already a doc" branch and a "bare workflow" branch, set `assetRegistry` in both — `?? {}` in each.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/refs-projectdoc.unit.spec.ts`
Expected: PASS.

- [ ] **Step 6: Add the reactive accessor composable**

```typescript
// frontend/app/composables/useRefRegistry.ts
import { computed, type Ref } from 'vue'
import type { ProjectDoc } from '~/lib/projectDoc'
import {
  setRef, renameRef, removeRef, type RefRegistry, type RefEntry,
} from '~/lib/refs/registry'

/**
 * Read/write the active project's `@refs` registry. Writes go straight onto
 * ProjectDoc.assetRegistry so they ride the existing autosave/versioning that
 * already persists brandKitId — no separate storage.
 */
export function useRefRegistry(doc: Ref<ProjectDoc | null | undefined>) {
  const registry = computed<RefRegistry>(() => doc.value?.assetRegistry ?? {})

  function write(next: RefRegistry) {
    if (doc.value) doc.value.assetRegistry = next
  }
  return {
    registry,
    upsert: (name: string, entry: RefEntry) => write(setRef(registry.value, name, entry)),
    rename: (from: string, to: string) => write(renameRef(registry.value, from, to)),
    remove: (name: string) => write(removeRef(registry.value, name)),
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/projectDoc.ts frontend/app/composables/useRefRegistry.ts frontend/tests/unit/refs-projectdoc.unit.spec.ts
git commit -m "feat(refs): persist registry on ProjectDoc + reactive accessor"
```

---

### Task 5: Extend `VarBinding` to represent a reference binding

**Files:**
- Modify: `frontend/app/lib/collection/types.ts` (the `VarBinding` interface, ~lines 35-44)
- Create: `frontend/app/lib/refs/binding.ts`
- Test: `frontend/tests/unit/refs-binding.unit.spec.ts`

**Interfaces:**
- Consumes: `VarBinding`, `BINDINGS_PROP` from `collection/types.ts`.
- Produces:
  - `VarBinding` gains optional `kind?: 'collection' | 'reference'` and `refName?: string` (undefined `kind` ⇒ collection, for backward compatibility).
  - `refBinding(refName: string): VarBinding` — build a reference binding.
  - `isRefBinding(b: VarBinding | undefined): boolean`
  - `refBindingLabel(b: VarBinding | undefined): string | null` — `@name` for display, else null.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/refs-binding.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { refBinding, isRefBinding, refBindingLabel } from '../../app/lib/refs/binding'

describe('reference bindings', () => {
  it('refBinding builds a reference-kind VarBinding', () => {
    expect(refBinding('tracksuit')).toEqual({ kind: 'reference', refName: 'tracksuit', collectionId: '', columnKey: '' })
  })
  it('isRefBinding is true only for kind reference', () => {
    expect(isRefBinding(refBinding('a'))).toBe(true)
    expect(isRefBinding({ collectionId: 'c', columnKey: 'k' })).toBe(false)
    expect(isRefBinding(undefined)).toBe(false)
  })
  it('refBindingLabel returns @name for a ref binding, null otherwise', () => {
    expect(refBindingLabel(refBinding('grey-cyc'))).toBe('@grey-cyc')
    expect(refBindingLabel({ collectionId: 'c', columnKey: 'k' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/refs-binding.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend the interface**

In `frontend/app/lib/collection/types.ts`, add two optional fields to `VarBinding` (keep existing fields; `collectionId`/`columnKey` stay required so existing code compiles — reference bindings set them to `''`):

```typescript
export interface VarBinding {
  collectionId: string
  columnKey: string
  /** Discriminator: undefined or 'collection' = data-merge binding; 'reference' = @refs binding. */
  kind?: 'collection' | 'reference'
  /** Bare reference handle when kind === 'reference'. */
  refName?: string
  /** Last literal value, used when the binding dangles (deleted column/collection). */
  lastLiteral?: string | number
}
```

- [ ] **Step 4: Write the helper module**

```typescript
// frontend/app/lib/refs/binding.ts
import type { VarBinding } from '~/lib/collection/types'

/** A VarBinding that points at a named `@ref` instead of a collection column. */
export function refBinding(refName: string): VarBinding {
  return { kind: 'reference', refName, collectionId: '', columnKey: '' }
}

export function isRefBinding(b: VarBinding | undefined): boolean {
  return !!b && b.kind === 'reference' && !!b.refName
}

export function refBindingLabel(b: VarBinding | undefined): string | null {
  return isRefBinding(b) ? `@${b!.refName}` : null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/refs-binding.unit.spec.ts`
Expected: PASS.

- [ ] **Step 6: Guard against regressions in the collection suite**

Run: `cd frontend && npx vitest run tests/unit/vars-edge-persistence.unit.spec.ts tests/unit/collection-resolve-lookup.unit.spec.ts`
Expected: PASS (the new optional fields must not break existing binding logic).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/collection/types.ts frontend/app/lib/refs/binding.ts frontend/tests/unit/refs-binding.unit.spec.ts
git commit -m "feat(refs): reference-kind VarBinding + helpers"
```

---

### Task 6: Resolve image-loader bindings + prompt tokens at submit (`injectAssetRegistry`)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (add method near `injectSmartLayoutBrand` ~line 4437; expose it via the component's `defineExpose`)
- Modify: `frontend/app/layouts/default.vue` (`runVueWorkflow`, insert after brand-kit injection ~line 611)

**Interfaces:**
- Consumes: `applyRefPromptTokens` (Task 3), `resolveRefFilename` (Task 1), `isRefBinding` (Task 5), `BINDINGS_PROP` from `collection/types.ts`, `setNamedWidget` (`useFilteredPrompt.ts:732`), `objectInfo`.
- Produces: `injectAssetRegistry(workflow: any, reg: RefRegistry): Promise<void>` exposed on the canvas ref.

- [ ] **Step 1: Add imports at the top of `VueNodeCanvas.vue` `<script setup>`**

```typescript
import { applyRefPromptTokens } from '~/lib/refs/injectWorkflow'
import { resolveRefFilename, type RefRegistry } from '~/lib/refs/registry'
import { isRefBinding } from '~/lib/refs/binding'
import { BINDINGS_PROP } from '~/lib/collection/types'
```

(`setNamedWidget` and `objectInfo` are already in scope in this file — confirm with `grep -n 'setNamedWidget\|const objectInfo' frontend/app/components/vue-canvas/VueNodeCanvas.vue`.)

- [ ] **Step 2: Add the method (mirror `injectSmartLayoutBrand`, ~line 4437)**

```typescript
/**
 * Resolve `@refs` into the outgoing workflow, client-side, before submit:
 *  (a) prompt strings: substitute `@name` → the ref's text (Mode 1);
 *  (b) image-loader widgets bound to `@name`: set the 'image' widget to the
 *      resolved input filename.
 * Frontend-only; ComfyUI never sees a reference.
 */
async function injectAssetRegistry(workflow: any, reg: RefRegistry): Promise<void> {
  if (!reg || !Object.keys(reg).length || !workflow?.nodes?.length) return

  // (a) prompt tokens
  applyRefPromptTokens(workflow, reg)

  // (b) image-loader widgets bound to @name
  for (const node of workflow.nodes as any[]) {
    if ((node.mode ?? 0) !== 0) continue // muted/bypassed won't execute
    const bindings = node.properties?.[BINDINGS_PROP]
    if (!bindings) continue
    for (const b of Object.values(bindings) as any[]) {
      if (!isRefBinding(b)) continue
      const filename = resolveRefFilename(reg, b.refName)
      if (filename) setNamedWidget(node, 'image', filename, objectInfo.value)
    }
  }
}
```

- [ ] **Step 3: Expose it**

Find the `defineExpose({ ... })` in `VueNodeCanvas.vue` (grep `defineExpose`) and add `injectAssetRegistry` alongside `injectSmartLayoutBrand`:

```typescript
defineExpose({ /* ...existing... */ injectSmartLayoutBrand, injectAssetRegistry })
```

- [ ] **Step 4: Call it from `runVueWorkflow` (default.vue, after brand-kit injection ~line 611)**

```typescript
// after: await vueCanvasRef.value.injectSmartLayoutBrand?.(plainWorkflow, kit ? brandKitToKv(kit) : '')
const assetReg = activeProjectDoc.value?.assetRegistry
if (assetReg && Object.keys(assetReg).length) {
  try {
    await vueCanvasRef.value.injectAssetRegistry?.(plainWorkflow, assetReg)
  } catch (err) {
    console.error('[Run] @refs injection failed', err)
  }
}
```

- [ ] **Step 5: Typecheck + unit guard**

Run: `cd frontend && npx vue-tsc --noEmit` (or the project's typecheck script — check `package.json`; if `npm run typecheck` exists use that).
Expected: no new type errors.
Run: `cd frontend && npx vitest run tests/unit/refs-inject-workflow.unit.spec.ts`
Expected: PASS (unchanged — proves the pure core still green).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/layouts/default.vue
git commit -m "feat(refs): resolve @refs (prompts + image bindings) at submit"
```

---

### Task 7: The `@` promote button on media (create a reference)

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (footer button row ~lines 687-739)
- Create: `frontend/app/components/vue-canvas/RefNameDialog.vue` (small name/text prompt)

**Interfaces:**
- Consumes: `useRefRegistry` (Task 4), `normalizeRefName` (Task 1), the active project doc ref (the same `activeProjectDoc` the layout uses — confirm how child components reach it; if not injected, emit an event the layout handles — see Step 2).
- Produces: user can name the currently-displayed image → writes `{ filename, text? }` into the registry.

- [ ] **Step 1: Build the naming dialog**

```vue
<!-- frontend/app/components/vue-canvas/RefNameDialog.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { normalizeRefName } from '~/lib/refs/registry'

const props = defineProps<{ open: boolean; suggested?: string }>()
const emit = defineEmits<{ (e: 'confirm', name: string, text: string): void; (e: 'cancel'): void }>()

const name = ref('')
const text = ref('')
watch(() => props.open, (o) => { if (o) { name.value = props.suggested ?? ''; text.value = '' } })

const valid = () => !!normalizeRefName(name.value)
function confirm() {
  const n = normalizeRefName(name.value)
  if (!n) return
  emit('confirm', n, text.value.trim())
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('cancel')">
    <div class="w-[320px] rounded-xl border border-white/10 bg-neutral-900 p-4 text-white">
      <p class="text-sm font-medium">Name this reference</p>
      <p class="mt-0.5 text-[11px] text-white/45">Reuse it anywhere as <span class="font-mono" style="color: var(--var-accent-text)">@{{ normalizeRefName(name) || 'name' }}</span></p>
      <input v-model="name" placeholder="tracksuit" class="mt-3 w-full rounded bg-white/5 border border-white/10 px-2 py-1.5 text-xs outline-none focus:border-white/25" @keydown.enter="confirm" />
      <input v-model="text" placeholder="text for prompts (optional): black Nike tracksuit" class="mt-2 w-full rounded bg-white/5 border border-white/10 px-2 py-1.5 text-[11px] outline-none focus:border-white/25" @keydown.enter="confirm" />
      <div class="mt-3 flex justify-end gap-2">
        <button class="rounded px-2.5 py-1 text-[11px] text-white/60 hover:text-white" @click="emit('cancel')">Cancel</button>
        <button class="rounded px-2.5 py-1 text-[11px] disabled:opacity-40" style="background: var(--var-accent); color: #111" :disabled="!valid()" @click="confirm">Create</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Wire the `@` button into `ArtifactImageNode.vue`**

First confirm how this node reaches the project registry:
Run: `grep -n 'activeProjectDoc\|useRefRegistry\|provide(\|inject(' frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/layouts/default.vue`

- If `activeProjectDoc` is `provide()`d, `inject()` it and use `useRefRegistry` directly.
- Otherwise (simplest, decoupled): emit a window event the layout already listens to the same way it handles `comfynext:addNode`, and have the layout write the registry. Use this fallback:

In `ArtifactImageNode.vue` `<script setup>`:
```typescript
import RefNameDialog from '~/components/vue-canvas/RefNameDialog.vue'
const refDialogOpen = ref(false)
// `widgetFilename` / `displayedUrl` already exist in this component — use the
// bound input filename. Confirm the exact ref name with:
//   grep -n 'widgetFilename\|displayedUrl\|const dims' ArtifactImageNode.vue
function currentFilename(): string | null {
  // Prefer the loaded input filename; fall back to parsing ?filename= from the URL.
  const w = (props.data?.properties?.image as string) || (props.data as any)?.widgets_values?.[0]
  if (typeof w === 'string' && w) return w
  const m = /[?&]filename=([^&]+)/.exec(displayedUrl.value || '')
  return m ? decodeURIComponent(m[1]) : null
}
function openRefDialog() { if (currentFilename()) refDialogOpen.value = true }
function onRefConfirm(name: string, text: string) {
  refDialogOpen.value = false
  const filename = currentFilename(); if (!filename) return
  window.dispatchEvent(new CustomEvent('comfynext:createRef', { detail: { name, entry: { filename, text: text || undefined } } }))
}
```

Add the button to the footer row (after the "Save as Character" button ~line 739):
```vue
<button
  class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer"
  title="Name as reusable reference (@)"
  @click.stop="openRefDialog"
>
  <span class="text-xs font-bold" style="color: var(--var-accent-text)">@</span>
</button>
<RefNameDialog :open="refDialogOpen" :suggested="''" @confirm="onRefConfirm" @cancel="refDialogOpen = false" />
```

- [ ] **Step 3: Handle `comfynext:createRef` in the layout**

In `frontend/app/layouts/default.vue`, import `setRef` and `provide` a read-only registry for child node components, then handle the create event. Near the top of `<script setup>`:
```typescript
import { provide, computed } from 'vue'
import { setRef, type RefRegistry } from '~/lib/refs/registry'

// Read-only registry for descendant node components (Tasks 8 & 9 inject this).
provide('assetRegistry', computed<RefRegistry>(() => activeProjectDoc.value?.assetRegistry ?? {}))
```
Near where `comfynext:addNode` / other window listeners are registered (grep `addEventListener('comfynext`), add:
```typescript
function onCreateRef(e: Event) {
  const { name, entry } = (e as CustomEvent).detail || {}
  if (!name || !entry?.filename || !activeProjectDoc.value) return
  activeProjectDoc.value.assetRegistry = setRef(activeProjectDoc.value.assetRegistry ?? {}, name, entry)
  toast.success(`Reference @${name} created`)
}
// register in onMounted: window.addEventListener('comfynext:createRef', onCreateRef)
// remove in onBeforeUnmount: window.removeEventListener('comfynext:createRef', onCreateRef)
```
(Writes go straight onto `activeProjectDoc.value.assetRegistry` so they ride the existing autosave. Register/unregister the listener beside the existing `comfynext:addNode` handler.)

- [ ] **Step 4: Browser verification**

Start the app (`cd frontend && npm run dev`; ComfyUI running per project README). Then:
1. Generate or paste an image so an `Image` node shows a picture.
2. Hover the node footer → confirm a pink **`@`** button appears next to the existing footer buttons.
3. Click it → dialog opens → type `tracksuit`, optionally text → **Create**.
4. Confirm a success toast `Reference @tracksuit created`.
5. Open devtools console: `JSON.parse(sessionStorage-or-store).assetRegistry` — or simpler, verify via Task 8's picker showing `@tracksuit`.
6. **Reload the page** → the reference must still exist (persistence). Verify via the picker in Task 8, or re-open the app and confirm it's still selectable.

Capture a screenshot of the footer with the `@` button and the open dialog.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/RefNameDialog.vue frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/layouts/default.vue
git commit -m "feat(refs): @ promote button + naming dialog on image nodes"
```

---

### Task 8: Bind an image-loader widget to `@name` (the pink no-wire skin)

**Files:**
- Modify: the image-loader widget component (locate it — see Step 1)
- Reuse: `frontend/app/components/vue-canvas/studio/VariableGlyph.vue` (pink hexagon)

**Interfaces:**
- Consumes: `VariableGlyph.vue`, `refBinding`/`refBindingLabel` (Task 5), `listRefNames` (Task 1), `BINDINGS_PROP`, the active registry.
- Produces: an image-loader node whose `image` widget shows the pink glyph; picking a ref writes `properties[BINDINGS_PROP].image = refBinding(name)`, resolved at submit by Task 6.

- [ ] **Step 1: Locate the image-loader widget component**

Run: `grep -rln "type === 'IMAGE'\|widget.*image\|LoadImage\|upload/image" frontend/app/components/vue-canvas/ | head`
Identify the component that renders the `image` widget on a `ComfyNode` (the generic node widget renderer). Read its template around where a widget label is rendered — this is where the `VariableGlyph` goes, mirroring `StudioSlider.vue:45-77`.

- [ ] **Step 2: Add the glyph + picker to the image widget's label row**

Following the `StudioSlider` precedent (`<div class="group">` wrapper, glyph hidden until hover):
```vue
<!-- in the image widget's label row -->
<div class="group flex items-center justify-between">
  <span class="text-[11px] text-white/55">{{ widget.label ?? 'image' }}</span>
  <div class="flex items-center gap-1.5">
    <span v-if="refLabel" class="font-mono text-[11px]" style="color: var(--var-accent-text)">{{ refLabel }}</span>
    <VariableGlyph :bound="refLabel" @promote="openRefPicker" @menu="openRefPicker" />
  </div>
</div>
<!-- tiny picker popover -->
<div v-if="pickerOpen" class="mt-1 rounded-md border border-white/10 bg-neutral-900 p-1">
  <button v-for="n in refNames" :key="n" class="block w-full px-2 py-1 text-left text-[11px] hover:bg-white/10" @click="bindRef(n)">@{{ n }}</button>
  <button v-if="refLabel" class="block w-full px-2 py-1 text-left text-[11px] text-white/50 hover:bg-white/10" @click="unbindRef">Unbind</button>
  <p v-if="!refNames.length" class="px-2 py-1 text-[11px] text-white/40">No references yet</p>
</div>
```

Script:
```typescript
import { inject, ref, computed, type ComputedRef } from 'vue'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'
import { refBinding, refBindingLabel } from '~/lib/refs/binding'
import { listRefNames, type RefRegistry } from '~/lib/refs/registry'
import { BINDINGS_PROP } from '~/lib/collection/types'
// Read-only registry provided by the layout (Task 7 Step 3).
const activeRegistry = inject<ComputedRef<RefRegistry>>('assetRegistry', computed(() => ({})))
const pickerOpen = ref(false)
const refNames = computed(() => listRefNames(activeRegistry.value))
const refLabel = computed(() => refBindingLabel(props.node.properties?.[BINDINGS_PROP]?.image))
function openRefPicker() { pickerOpen.value = !pickerOpen.value }
function bindRef(name: string) {
  const p = props.node.properties ??= {}
  ;(p[BINDINGS_PROP] ??= {}).image = refBinding(name)
  pickerOpen.value = false
}
function unbindRef() {
  const b = props.node.properties?.[BINDINGS_PROP]; if (b) delete b.image
  pickerOpen.value = false
}
```

- [ ] **Step 3: Browser verification**

1. Create `@tracksuit` (Task 7) on some image.
2. Add a node with an `image` widget (e.g. a Person Swap / any LoadImage-style node).
3. Hover its `image` widget label → pink hexagon appears → click → picker lists `@tracksuit` → select it.
4. Confirm the label now shows `@tracksuit` in pink and the input reads as bound (not a free file field).
5. **Run the graph.** Confirm the node executes against `suit.png` (check the ComfyUI result uses that image). This proves Task 6 resolves the binding at submit.
6. Screenshot the bound widget showing `@tracksuit` in pink.

- [ ] **Step 4: Commit**

```bash
git add <the image-widget component>
git commit -m "feat(refs): bind image widgets to @name via pink glyph picker"
```

---

### Task 9: The `Reference` shorthand node (register + component)

**Files:**
- Modify: `frontend/app/composables/useVueNodes.ts` (`ARTIFACT_NODE_COMPONENTS` ~line 199)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (import ~line 94; `nodeTypes` ~line 205; `createNodeData` output injection ~lines 1448-1472)
- Create: `frontend/app/components/vue-canvas/ReferenceNode.vue`

**Interfaces:**
- Consumes: `listRefNames`, `resolveRefFilename` (Task 1), the active registry, Vue Flow `Handle`.
- Produces: a frontend-only node of type `Reference` with one `IMAGE` output and a `properties.comfynext_refName`.

- [ ] **Step 1: Register the type**

`useVueNodes.ts` — add to `ARTIFACT_NODE_COMPONENTS`:
```typescript
  Reference: 'reference',
```
`VueNodeCanvas.vue` — add import beside the other artifact-node imports (~line 94):
```typescript
import ReferenceNode from '~/components/vue-canvas/ReferenceNode.vue'
```
`VueNodeCanvas.vue` — add to `nodeTypes` (~line 205):
```typescript
  'reference': markRaw(ReferenceNode),
```
`VueNodeCanvas.vue` — in `createNodeData` (~line 1448, beside the `Character` output injection), add:
```typescript
if (nodeType === 'Reference' && (!data.data.outputs || data.data.outputs.length === 0)) {
  data.data.outputs = [{ name: 'image', type: 'IMAGE', links: null }]
}
```

- [ ] **Step 2: Create the component**

```vue
<!-- frontend/app/components/vue-canvas/ReferenceNode.vue -->
<script setup lang="ts">
import { computed, ref, inject, type ComputedRef } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { AtSign } from 'lucide-vue-next'
import { listRefNames, resolveRef, type RefRegistry } from '~/lib/refs/registry'

const props = defineProps<{ id: string; data: { properties?: Record<string, any> } }>()
// Read-only registry provided by the layout (Task 7 Step 3).
const activeRegistry = inject<ComputedRef<RefRegistry>>('assetRegistry', computed(() => ({})))

const refName = computed<string | null>(() => props.data?.properties?.comfynext_refName ?? null)
const entry = computed(() => refName.value ? resolveRef(activeRegistry.value, refName.value) : undefined)
const thumbUrl = computed(() => entry.value ? `/view?filename=${encodeURIComponent(entry.value.filename)}&type=input` : null)
const names = computed(() => listRefNames(activeRegistry.value))
const picking = ref(false)

function pick(name: string) {
  ;(props.data.properties ??= {}).comfynext_refName = name
  picking.value = false
}
</script>

<template>
  <div class="relative w-[200px] rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg">
    <Handle id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]" :style="{ top: '50%' }" />
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <AtSign class="h-3.5 w-3.5" style="color: var(--var-accent-text)" />
      <span class="text-xs font-medium text-white/80">Reference</span>
    </div>
    <div class="p-2.5">
      <img v-if="thumbUrl" :src="thumbUrl" class="mb-2 h-24 w-full rounded object-cover bg-black/40" />
      <button class="w-full rounded bg-white/5 px-2 py-1 text-left text-[11px]" @click.stop="picking = !picking">
        <span v-if="refName" class="font-mono" style="color: var(--var-accent-text)">@{{ refName }}</span>
        <span v-else class="text-white/40">Pick a reference…</span>
      </button>
      <div v-if="picking" class="mt-1 rounded-md border border-white/10 bg-neutral-900 p-1">
        <button v-for="n in names" :key="n" class="block w-full px-2 py-1 text-left text-[11px] hover:bg-white/10" @click.stop="pick(n)">@{{ n }}</button>
        <p v-if="!names.length" class="px-2 py-1 text-[11px] text-white/40">No references yet</p>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Browser verification**

1. Add a `Reference` node (via the add-node menu, or `window.dispatchEvent(new CustomEvent('comfynext:addNode', { detail: { nodeType: 'Reference' } }))` in the console).
2. Confirm it renders with the pink `@` header and an IMAGE output handle on the right.
3. Pick `@tracksuit` → confirm the thumbnail appears and the label shows `@tracksuit`.
4. Wire the output into a downstream node's IMAGE input → confirm the wire connects.
5. Screenshot the node with thumbnail + wire.

(The node is visible/creatable/wireable here; submit-time resolution is Task 10.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/ReferenceNode.vue
git commit -m "feat(refs): Reference shorthand node (register + component)"
```

---

### Task 10: Reference node submit resolution (materialize → the image reaches ComfyUI)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`injectAssetRegistry` from Task 6)
- Investigate first: how an `Image` artifact node reaches the backend at submit (its serialized `class_type` + image widget), so a `Reference` node can be materialized the same way.
- Test: `frontend/tests/unit/refs-inject-reference.unit.spec.ts`

**Interfaces:**
- Consumes: `resolveRefFilename` (Task 1), the Task 6 method.
- Produces: at submit, every `Reference` node is converted into the same image-source form an `Image` node uses (its `comfynext_refName` resolved to a filename), so downstream IMAGE inputs receive the image; no `Reference` type reaches ComfyUI.

- [ ] **Step 1: Investigate the Image-artifact submit path**

Run:
```bash
grep -rn "FRONTEND_ONLY_NODE_TYPES" frontend/app
grep -rn "'Image'\|LoadImage\|class_type" frontend/app/lib frontend/app/composables | grep -i image | head
```
Determine what a pasted/loaded `Image` node serializes to when it reaches ComfyUI (the backend `class_type` and the widget that carries the filename). The `Reference` node must be transformed into that same shape. Record the exact class_type and widget name; the code below uses placeholders `IMAGE_LOADER_TYPE` / `IMAGE_WIDGET` — replace them with the real values you find.

- [ ] **Step 2: Write the failing test (pure transform)**

Add a pure helper `materializeReferenceNodes(workflow, reg)` to `frontend/app/lib/refs/injectWorkflow.ts` and test it. Use the real class_type/widget you found in Step 1 in both the test and the impl.

```typescript
// frontend/tests/unit/refs-inject-reference.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { materializeReferenceNodes } from '../../app/lib/refs/injectWorkflow'
import { setRef } from '../../app/lib/refs/registry'

const reg = setRef({}, 'tracksuit', { filename: 'suit.png' })

describe('materializeReferenceNodes', () => {
  it('rewrites a Reference node into the image-loader shape with the resolved filename', () => {
    const wf = { nodes: [{ id: 7, type: 'Reference', properties: { comfynext_refName: 'tracksuit' }, widgets_values: [] }] }
    materializeReferenceNodes(wf, reg)
    const n = wf.nodes[0] as any
    expect(n.type).toBe('IMAGE_LOADER_TYPE')        // ← replace with real class_type
    expect(n.widgets_values[0]).toBe('suit.png')    // ← index of the real IMAGE_WIDGET
  })
  it('leaves a Reference node with an unknown ref as-is (so it gets stripped, not mis-wired)', () => {
    const wf = { nodes: [{ id: 8, type: 'Reference', properties: { comfynext_refName: 'ghost' }, widgets_values: [] }] }
    materializeReferenceNodes(wf, reg)
    expect((wf.nodes[0] as any).type).toBe('Reference')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/refs-inject-reference.unit.spec.ts`
Expected: FAIL — `materializeReferenceNodes` not exported.

- [ ] **Step 4: Implement the transform**

```typescript
// append to frontend/app/lib/refs/injectWorkflow.ts
import { resolveRefFilename } from './registry'

// Replace with the real values found in Step 1:
const IMAGE_LOADER_TYPE = 'IMAGE_LOADER_TYPE'
const IMAGE_WIDGET_INDEX = 0

/**
 * Convert every `Reference` node into the canonical image-loader node carrying
 * the resolved input filename, so its downstream IMAGE wire delivers a real
 * image. A Reference whose handle can't be resolved is left untouched (it will
 * be stripped as frontend-only, failing safe rather than mis-wiring).
 */
export function materializeReferenceNodes(workflow: any, reg: RefRegistry): void {
  const nodes: any[] = workflow?.nodes
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (node?.type !== 'Reference') continue
    const filename = resolveRefFilename(reg, node.properties?.comfynext_refName ?? '')
    if (!filename) continue
    node.type = IMAGE_LOADER_TYPE
    if (!Array.isArray(node.widgets_values)) node.widgets_values = []
    while (node.widgets_values.length <= IMAGE_WIDGET_INDEX) node.widgets_values.push(null)
    node.widgets_values[IMAGE_WIDGET_INDEX] = filename
  }
}
```
(`RefRegistry` is already imported at the top of this file from Task 3.)

- [ ] **Step 5: Call it from `injectAssetRegistry`**

In `VueNodeCanvas.vue`, import and call it inside `injectAssetRegistry` (before the prompt/binding loop is fine, since it changes node types):
```typescript
import { applyRefPromptTokens, materializeReferenceNodes } from '~/lib/refs/injectWorkflow'
// ...at the top of injectAssetRegistry, after the guard:
materializeReferenceNodes(workflow, reg)
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run tests/unit/refs-inject-reference.unit.spec.ts tests/unit/refs-inject-workflow.unit.spec.ts`
Expected: PASS.

- [ ] **Step 7: Browser verification (the end-to-end payoff)**

1. Create `@tracksuit` (Task 7).
2. Drop a `Reference` node far from the image; pick `@tracksuit`; wire it into a consumer's IMAGE input.
3. **Run the graph.** Confirm the consumer executes against `suit.png` — the Reference node delivered the image with only a short local wire, the source image nowhere near it.
4. Confirm no `Reference`-type node error appears in the ComfyUI console (it was materialized before submit).
5. Screenshot the run result.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/refs/injectWorkflow.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/tests/unit/refs-inject-reference.unit.spec.ts
git commit -m "feat(refs): materialize Reference nodes into image loaders at submit"
```

---

## Final verification

- [ ] Run the full unit suite: `cd frontend && npm run test:unit` — all green, including the pre-existing `vars-edge-persistence` and collection suites (no regressions from the `VarBinding` extension).
- [ ] Typecheck clean: `cd frontend && npx vue-tsc --noEmit` (or the project typecheck script).
- [ ] End-to-end smoke in the browser: create `@tracksuit` → (a) bind an image widget to it and run; (b) mention `@tracksuit` in a prompt and confirm the substituted text reaches the model; (c) wire a Reference node and run. All three deliver the same image/text.

## Spec coverage check

- Registry `name → { filename, text? }`, project-scoped, persistent → Tasks 1, 4.
- Hover `@` creation on media → Task 7 (`ArtifactImageNode`; `TakesStrip`/`AssetsPanel` surfaces are follow-ons — same pattern, deferred to keep this slice tight).
- Reuse skin A (bind-by-name, pink, no wire) → Tasks 5, 6, 8.
- Reuse skin B (Reference node) → Tasks 9, 10.
- Mode 1 prompt substitution → Tasks 2, 3, 6.
- Client-side resolution at submit, ComfyUI sees a normal graph → Tasks 6, 10.
- Deferred (not in this plan): Mode 2 chip node, `@`-autocomplete inside free-text prompt fields, cross-project sharing, the other media surfaces' `@` buttons.
