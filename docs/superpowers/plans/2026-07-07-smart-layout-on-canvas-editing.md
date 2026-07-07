# Smart Layout On-Canvas Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Frame's on-canvas editing *feel* to Smart Layout — inline text editing, a contextual floating toolbar (with on-slot variable promotion), and keyboard nudge/duplicate/delete — without importing Frame's free-transform model.

**Architecture:** Smart Layout already has all the state/mutation plumbing in `useGridEditor` (`patchStyle`, `patchElement`, `setRegion`, `duplicateElement`, `removeElement`, `nudgeSelected`, `undo`/`redo`) and the binding/promote layer in `frontend/app/lib/collection/` (`promoteLayoutElement`, `resolveBindings`, `setCell`, `pushVarPreview`). This plan adds three **surfaces** that call that existing API: (1) an inline text-edit overlay in `GridEditorCanvas.vue`, (2) a new `GridInlineToolbar.vue` modeled on the existing `CompositorInlineToolbar.vue`, (3) a keyboard listener. A shared `useLayoutTextEdit` composable centralizes the bound-vs-unbound text write so the canvas and the property panel agree by construction.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>`, TypeScript, Tailwind, Vitest.

## Global Constraints

- Frontend dir: `frontend/`. All paths below are relative to it unless absolute.
- Test runner: **Vitest**, `npm run test:unit` (which runs `vitest run`). Single file: `npm run test:unit -- tests/unit/<file>`.
- Variable-bound affordances are **PINK** (`--var-accent`, `#f472b6`). Never purple/violet. Reuse `VariableGlyph.vue`.
- Mutations go **only** through `useGridEditor` ctx functions (injected as `'gridEditor'`) — never mutate template refs directly from a component.
- Do NOT add rotation, skew, blend modes, per-element opacity, or free positioning — those are Frame's model and out of scope.
- Browser verification is **required** for every UI task (project rule: visual/interaction work is never signed off on unit tests alone). Verify in the Smart Layout modal; dev server on `http://localhost:3017` (or whatever `npm run dev` reports). Harness page: `/dev/v3editor` if the modal is hard to reach.
- Git: commit directly to `main`. Stage only the files you touched with explicit paths — never `git add -A`. End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- **Create** `app/composables/useLayoutTextEdit.ts` — bound/unbound text commit + bound-socket detection. Shared by canvas inline-edit and (optionally) the panel.
- **Create** `tests/unit/layout-text-edit.unit.spec.ts` — unit tests for the composable's commit logic.
- **Create** `app/components/templates/GridInlineToolbar.vue` — floating contextual toolbar (text controls + variable glyph).
- **Modify** `app/components/templates/GridEditorCanvas.vue` — double-click-to-edit text overlay; mount the toolbar anchored to the selection; keydown listener.
- **Modify** `app/components/templates/GridPropertyPanel.vue` — delegate `writeThroughBoundText` to the shared composable (DRY; small change).

---

### Task 1: Shared bound-text composable

Extract the bound-vs-unbound text-commit logic (today only living inside `GridPropertyPanel.vue`'s `writeThroughBoundText`) into a reusable composable, so the new inline canvas editor writes through *identically*.

**Files:**
- Create: `app/composables/useLayoutTextEdit.ts`
- Test: `tests/unit/layout-text-edit.unit.spec.ts`

**Interfaces:**
- Consumes: `GridEditorContext` (the `useGridEditor` return, injected as `'gridEditor'`), `SmartLayoutBindingContext | null` (from `app/lib/collection/layoutBinding.ts`), `setCell`/`pushVarPreview`/`wiredTargets`, `COLLECTION_PROP`.
- Produces:
  ```ts
  export function useLayoutTextEdit(
    ctx: GridEditorContext,
    binding: SmartLayoutBindingContext | null,
  ): {
    boundSocket(el: { content?: string }): string | null
    commitText(el: { id: string; content?: string }, value: string): void
  }
  ```

- [ ] **Step 1: Confirm exact import paths.** Open `app/components/templates/GridPropertyPanel.vue` and copy the exact import specifiers for `setCell`, `pushVarPreview`, `wiredTargets`, `COLLECTION_PROP`, and the `{{ props.<socket> }}` matching (look near `writeThroughBoundText`, lines ~88–103, and the import block at the top). Use those exact specifiers in Step 3.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/layout-text-edit.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { useLayoutTextEdit } from '~/composables/useLayoutTextEdit'
import { COLLECTION_PROP } from '~/lib/collection/types'

function fakeCtx() {
  return { patchElement: vi.fn(), template: { value: {} } } as any
}
function fakeBinding(collection: any) {
  return {
    nodeId: 'n1',
    nodesAccessor: () => [],
    edgesAccessor: () => [],
    bindings: { value: { 'props.text_layer_1': { collectionId: collection.id, columnKey: 'headline' } } },
    collectionNode: { value: { id: 'c1', data: { properties: { [COLLECTION_PROP]: collection } } } },
  } as any
}

describe('useLayoutTextEdit', () => {
  it('unbound element: commit patches literal content', () => {
    const ctx = fakeCtx()
    const { commitText } = useLayoutTextEdit(ctx, null)
    commitText({ id: 'e1', content: 'Old' }, 'New')
    expect(ctx.patchElement).toHaveBeenCalledWith('e1', { content: 'New' })
  })

  it('bound element: commit writes the preview-row cell, not the template', () => {
    const collection = {
      id: 'c1', name: 'C', columns: [{ key: 'headline', label: 'Headline', type: 'text' }],
      rows: [{ id: 'r0', values: { headline: 'A' } }, { id: 'r1', values: { headline: 'B' } }],
      previewRow: 1,
    }
    const ctx = fakeCtx()
    const { commitText } = useLayoutTextEdit(ctx, fakeBinding(collection))
    commitText({ id: 'e1', content: '{{ props.text_layer_1 }}' }, 'Edited')
    expect(collection.rows[1].values.headline).toBe('Edited') // preview row updated
    expect(collection.rows[0].values.headline).toBe('A')       // other row untouched
    expect(ctx.patchElement).not.toHaveBeenCalled()            // template token preserved
  })

  it('boundSocket returns the socket name for a bound token element', () => {
    const collection = { id: 'c1', name: 'C', columns: [], rows: [], previewRow: 0 }
    const { boundSocket } = useLayoutTextEdit(fakeCtx(), fakeBinding(collection))
    expect(boundSocket({ content: '{{ props.text_layer_1 }}' })).toBe('text_layer_1')
    expect(boundSocket({ content: 'literal' })).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/layout-text-edit.unit.spec.ts`
Expected: FAIL — `useLayoutTextEdit` not found.

- [ ] **Step 4: Implement the composable**

```ts
// app/composables/useLayoutTextEdit.ts
import { COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionData } from '~/lib/collection/types'
import type { SmartLayoutBindingContext } from '~/lib/collection/layoutBinding'
// NOTE: use the EXACT specifiers copied in Step 1 for the next two lines.
import { setCell } from '~/lib/collection/model'
import { pushVarPreview, wiredTargets } from '~/lib/collection/preview'

const TOKEN_RE = /^\s*\{\{\s*props\.([a-zA-Z0-9_]+)\s*\}\}\s*$/

export function useLayoutTextEdit(ctx: any, binding: SmartLayoutBindingContext | null) {
  function boundSocket(el: { content?: string }): string | null {
    const m = TOKEN_RE.exec(el?.content ?? '')
    if (!m) return null
    const socket = m[1]
    return binding?.bindings.value[`props.${socket}`] ? socket : null
  }

  function commitText(el: { id: string; content?: string }, value: string): void {
    const socket = boundSocket(el)
    if (socket && binding) {
      const b = binding.bindings.value[`props.${socket}`]
      const colNode = binding.collectionNode.value
      const c = colNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
      const row = c?.rows[c.previewRow]
      if (c && b?.columnKey && row) {
        setCell(c, row.id, b.columnKey, value)
        pushVarPreview(colNode, wiredTargets(String(colNode.id), binding.nodesAccessor(), binding.edgesAccessor()), binding.nodesAccessor())
      }
      return
    }
    ctx.patchElement(el.id, { content: value })
  }

  return { boundSocket, commitText }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/layout-text-edit.unit.spec.ts`
Expected: PASS (3 tests). If `pushVarPreview`/`wiredTargets` import path is wrong, fix per Step 1's findings.

- [ ] **Step 6: DRY the panel.** In `GridPropertyPanel.vue`, replace the body of `writeThroughBoundText(value)` with a call into the composable: instantiate `const layoutText = useLayoutTextEdit(ctx, binding)` near the other setup, and make `writeThroughBoundText(value)` call `layoutText.commitText(el.value as any, value)`. Leave the unbound `patchElement(..., { content })` paths as-is (they already match). Run the existing panel/collection specs to confirm no regression: `npm run test:unit -- tests/unit/layout-binding.unit.spec.ts tests/unit/layout-promote.unit.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/composables/useLayoutTextEdit.ts tests/unit/layout-text-edit.unit.spec.ts app/components/templates/GridPropertyPanel.vue
git commit -m "feat(smart-layout): shared bound/unbound text-commit composable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Inline text editing on canvas

Double-click a text element on the canvas → edit in place → commit routes through `useLayoutTextEdit` (bound → cell, unbound → literal). Escape cancels; Enter/blur commits.

**Files:**
- Modify: `app/components/templates/GridEditorCanvas.vue`

**Interfaces:**
- Consumes: `useLayoutTextEdit` (Task 1); existing injected `ctx` (`'gridEditor'`) and `binding` (`'smartLayoutBinding'`); `selectedId`, `resolved.value.elements` (each has `el`, `rect`, `text`).
- Produces: an `editingId: Ref<string | null>` on the canvas (later tasks suppress toolbar/keyboard while editing).

- [ ] **Step 1: Add editing state + start handler.** Near the existing `selectedId` in `<script setup>`, add:

```ts
import { useLayoutTextEdit } from '~/composables/useLayoutTextEdit'
const layoutText = useLayoutTextEdit(ctx, binding)
const editingId = ref<string | null>(null)
const editDraft = ref('')

function startTextEdit(r: any) {
  if (r.el.type !== 'text' || r.el.locked) return
  editingId.value = r.el.id
  // Show the resolved value while editing a bound element, the literal otherwise.
  const socket = layoutText.boundSocket(r.el)
  editDraft.value = socket ? (r.text?.content ?? '') : ((r.el as any).content ?? '')
  nextTick(() => {
    const node = document.querySelector<HTMLTextAreaElement>('[data-inline-text-edit]')
    node?.focus(); node?.select()
  })
}

function commitTextEdit() {
  if (!editingId.value) return
  const r = resolved.value.elements.find((x: any) => x.el.id === editingId.value)
  if (r) layoutText.commitText(r.el, editDraft.value)
  editingId.value = null
}
function cancelTextEdit() { editingId.value = null }
```

(If `resolved`, `ctx`, `binding`, `nextTick`, `ref` aren't already in scope, add the imports/`inject` lines — check the top of the file; `ctx`/`binding` are injected per the existing code.)

- [ ] **Step 2: Wire double-click on text elements.** Find the element render loop (the `v-for` over `resolved.elements`, around the element `<div>` that uses `onElementPointerDown`). Add `@dblclick.stop="startTextEdit(r)"` to the text element wrapper.

- [ ] **Step 3: Render the edit overlay.** Inside the element wrapper, when `editingId === r.el.id`, render a textarea positioned to fill the element rect, styled to match (transparent bg, inherit font). Minimal version:

```vue
<textarea
  v-if="editingId === r.el.id"
  data-inline-text-edit
  v-model="editDraft"
  class="absolute inset-0 w-full h-full resize-none bg-transparent outline outline-1 outline-[var(--var-accent)] p-0 m-0"
  :style="{ font: 'inherit', color: 'inherit', textAlign: (r.el.style?.align || 'left') }"
  @pointerdown.stop
  @dblclick.stop
  @keydown.enter.prevent="commitTextEdit"
  @keydown.escape.prevent="cancelTextEdit"
  @blur="commitTextEdit"
/>
```

- [ ] **Step 4: Suppress drag while editing.** In `onElementPointerDown`, early-return if `editingId.value === r.el.id` so clicking inside the textarea doesn't start a drag. Add at the top of the handler: `if (editingId.value === r.el.id) return`.

- [ ] **Step 5: Browser-verify.** Start the dev server (`preview_start`, config `smart-layout` or `frontend`). Open the Smart Layout modal (or `/dev/v3editor`). Verify with `preview_click` + `preview_snapshot`:
  1. Double-click an unbound text element → textarea appears with its text → type → Enter → canvas shows new text. Confirm via `preview_snapshot`.
  2. Double-click a text element bound to a collection column → edit → Enter → the collection cell for the current preview row updates (the node/preview reflects it); the element still renders the token binding (pink glyph still present). Check `preview_console_logs` for errors.
  3. Escape cancels without changing text.
  Take a `preview_screenshot` for the record.

- [ ] **Step 6: Commit**

```bash
git add app/components/templates/GridEditorCanvas.vue
git commit -m "feat(smart-layout): inline (double-click) text editing on canvas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: GridInlineToolbar component

A floating toolbar for a selected element, modeled on `CompositorInlineToolbar.vue`. This task builds the **component in isolation** (props/emits + text controls + variable glyph); Task 4 mounts and positions it.

**Files:**
- Create: `app/components/templates/GridInlineToolbar.vue`
- Reference (read, do not modify): `app/components/vue-canvas/CompositorInlineToolbar.vue`, `app/components/vue-canvas/studio/VariableGlyph.vue`

**Interfaces:**
- Produces:
  ```ts
  defineProps<{ element: any; bound: string | null }>()   // element = ElementV2; bound = column label or null
  defineEmits<{
    style: [patch: Record<string, any>]   // → ctx.patchStyle
    promote: []                            // → dispatch comfynext:promoteLayoutElement
    remove: []                             // → ctx.removeElement
  }>()
  ```

- [ ] **Step 1: Read the two reference components** (`CompositorInlineToolbar.vue` for control markup/emit patterns, `VariableGlyph.vue` for its `bound` prop + `promote`/`menu` emits).

- [ ] **Step 2: Build the component.** Text controls mirror `GridPropertyPanel`'s text section (font size, weight, align, color) but emit a single `style` patch each; include the variable glyph. Only render text controls when `element.type === 'text'`.

```vue
<script setup lang="ts">
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'
const props = defineProps<{ element: any; bound: string | null }>()
const emit = defineEmits<{ style: [patch: Record<string, any>]; promote: []; remove: [] }>()
const s = () => props.element?.style ?? {}
</script>

<template>
  <div class="flex items-center gap-1 rounded-md border border-white/10 bg-[#1b1b1f] px-1.5 py-1 shadow-lg text-xs">
    <template v-if="element?.type === 'text'">
      <input type="number" min="1" class="w-12 bg-white/5 rounded px-1 py-0.5"
             :value="s().fontSize" @change="(e:any)=>emit('style',{ fontSize: e.target.value ? Math.max(1,Math.round(Number(e.target.value))) : undefined })" />
      <select class="bg-white/5 rounded px-1 py-0.5" :value="s().fontWeight ?? 400"
              @change="(e:any)=>emit('style',{ fontWeight: Number(e.target.value) })">
        <option :value="400">Regular</option><option :value="700">Bold</option>
      </select>
      <div class="flex">
        <button v-for="a in ['left','center','right']" :key="a"
                class="px-1.5 py-0.5 rounded" :class="s().align===a ? 'bg-white/15' : 'hover:bg-white/10'"
                @click="emit('style',{ align: a })">{{ a[0].toUpperCase() }}</button>
      </div>
      <input type="color" class="w-6 h-6 bg-transparent" :value="s().color ?? '#ffffff'"
             @input="(e:any)=>emit('style',{ color: e.target.value })" />
      <span class="w-px h-4 bg-white/10 mx-0.5" />
    </template>
    <VariableGlyph :bound="bound" @promote="emit('promote')" @menu="emit('promote')" />
    <button class="px-1.5 py-0.5 rounded hover:bg-white/10" title="Delete" @click="emit('remove')">✕</button>
  </div>
</template>
```

- [ ] **Step 3: Typecheck.** Run `npm run test:unit -- tests/unit/layout-text-edit.unit.spec.ts` (fast sanity that the project still compiles) and `cd frontend && npx vue-tsc --noEmit -p tsconfig.json` if the repo uses it (check `package.json` for a `typecheck` script; if present run that instead). Fix any type errors in the new file.

- [ ] **Step 4: Commit**

```bash
git add app/components/templates/GridInlineToolbar.vue
git commit -m "feat(smart-layout): GridInlineToolbar component (text controls + variable glyph)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Mount + position the toolbar; wire its emits

Anchor `GridInlineToolbar` above the selected element and connect its emits to the existing ctx mutations + promote event.

**Files:**
- Modify: `app/components/templates/GridEditorCanvas.vue`

**Interfaces:**
- Consumes: Task 3's `GridInlineToolbar`; `selectedId`, `selectedResolved` (rect in canvas space), `editingId` (Task 2), `binding`, `ctx.patchStyle`, `ctx.removeElement`.

- [ ] **Step 1: Compute the anchor.** Add a `toolbarStyle` computed that positions the toolbar centered above `selectedResolved.value.rect` (canvas space), hidden when nothing is selected or while `editingId` is set:

```ts
const showToolbar = computed(() => !!selectedResolved.value && !editingId.value)
const toolbarStyle = computed(() => {
  const rect = selectedResolved.value?.rect
  if (!rect) return { display: 'none' }
  return { position: 'absolute', left: rect.x + rect.w / 2 + 'px', top: rect.y - 8 + 'px', transform: 'translate(-50%, -100%)', zIndex: '40' } as any
})
```

(If the canvas is scaled/zoomed, multiply rect by the same scale the element wrappers use — check how existing element `<div>`s compute their `left/top/width/height` and mirror it exactly.)

- [ ] **Step 2: Compute `bound` label.** Reuse the canvas's existing `boundSocket(el)` helper (present per the context-menu code) to derive the bound column label, or pass the socket name as the label if the column label isn't cheaply available:

```ts
const selectedBound = computed(() => {
  const el = selectedResolved.value?.el
  const socket = el ? layoutText.boundSocket(el) : null
  return socket ? (binding?.bindings.value[`props.${socket}`]?.columnKey ?? socket) : null
})
```

- [ ] **Step 3: Add the promote dispatch.** Mirror the existing context-menu "Turn into variable" path (the canvas already dispatches `comfynext:promoteLayoutElement`). Factor a `promoteSelected()` that reuses the same socket/label derivation the context menu uses (`nextFreeSocket`/`tokenizeElementContent`/`columnLabelForElement` if in scope, else the existing menu handler) and dispatches the event. If a `promoteElement(r)` already exists for the context menu, call it directly.

- [ ] **Step 4: Render it.** Add near the top of the canvas root (after the elements loop):

```vue
<TemplatesGridInlineToolbar
  v-if="showToolbar"
  :style="toolbarStyle"
  :element="selectedResolved.el"
  :bound="selectedBound"
  @style="(patch) => ctx.patchStyle(selectedResolved.el.id, patch)"
  @promote="promoteSelected"
  @remove="() => ctx.removeElement(selectedResolved.el.id)"
/>
```

(Confirm the auto-import prefix — Nuxt components under `components/templates/` resolve as `Templates<Name>`; verify against how `GridPropertyPanel` is referenced.)

- [ ] **Step 5: Browser-verify.** In the modal / `/dev/v3editor`:
  1. Select a text element → toolbar appears above it. Change size/weight/align/color via the toolbar → canvas updates live (`preview_snapshot` + `preview_inspect` on the element for the CSS value).
  2. Click the pink hexagon on an **unbound** element → it promotes to a variable (glyph fills pink, a collection column appears). Verify no purple anywhere (`preview_inspect` the glyph color = `--var-accent`).
  3. Toolbar hides while double-click-editing text (Task 2) and when nothing is selected.
  4. `preview_console_logs` clean. `preview_screenshot` for the record.

- [ ] **Step 6: Commit**

```bash
git add app/components/templates/GridEditorCanvas.vue
git commit -m "feat(smart-layout): mount contextual toolbar with live style + on-slot promote

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Keyboard layer (nudge / duplicate / delete)

Wire a keydown listener that drives the composable functions that already exist (`nudgeSelected`, `duplicateElement`, `removeElement`). No new mutation logic.

**Files:**
- Modify: `app/components/templates/GridEditorCanvas.vue`

**Interfaces:**
- Consumes: `ctx.nudgeSelected`, `ctx.duplicateElement`, `ctx.removeElement`, `selectedId`, `editingId`.

- [ ] **Step 1: Confirm `nudgeSelected`'s signature** in `useGridEditor.ts` (arg shape — direction vs dx/dy). Match it in Step 2.

- [ ] **Step 2: Add the handler.**

```ts
function onCanvasKeydown(e: KeyboardEvent) {
  if (editingId.value) return
  const ae = document.activeElement
  if (ae instanceof Element && ae.matches('input, textarea, [contenteditable]')) return
  if (!selectedId.value) return
  const meta = e.metaKey || e.ctrlKey
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ctx.removeElement(selectedId.value) }
  else if (meta && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); ctx.duplicateElement(selectedId.value) }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault()
    const step = e.shiftKey ? 4 : 1
    const d = { ArrowLeft: [-step,0], ArrowRight: [step,0], ArrowUp: [0,-step], ArrowDown: [0,step] }[e.key]
    if (d) ctx.nudgeSelected(...d)   // adapt to the real signature from Step 1
  }
}
```

- [ ] **Step 3: Register/unregister** on the canvas root element (prefer scoping to the canvas, not `window`, to avoid clashing with the node graph). Add `tabindex="0"` to the canvas root and `@keydown="onCanvasKeydown"`, or `onMounted(() => el.addEventListener('keydown', onCanvasKeydown))` with matching cleanup in `onBeforeUnmount`.

- [ ] **Step 4: Browser-verify.** In the modal: select an element, press arrows (moves one cell; Shift = larger), Cmd/Ctrl+D (duplicates), Delete (removes). Confirm each via `preview_snapshot`. Confirm typing in the property panel / inline editor is NOT hijacked (focus an input, press arrows → caret moves, element does not). `preview_screenshot`.

- [ ] **Step 5: Commit**

```bash
git add app/components/templates/GridEditorCanvas.vue
git commit -m "feat(smart-layout): keyboard nudge / duplicate / delete for selected element

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deferred (not in this plan — documented so scope is explicit)

These are real, from the spec, but lower-urgency because the default behavior already holds or they carry more risk. Do NOT build them in this pass; log them for a follow-up:

- **Explicit propagation escape hatches** ("this format only" / "apply to all formats" buttons). The *default* rule already works (`setRegion` writes per-class/per-output; content resolves from the shared cell), so these are affordances over existing behavior, not new behavior. Add to the toolbar/panel in a follow-up.
- **Multi-select + marquee** — no existing selection-set infra; larger build.
- **Cross-layout copy-paste of elements** — `duplicateElement` covers in-place; a real element clipboard (Cmd+C/V across layouts) is separate.
- **Inline copy-assist in the toolbar** — the panel's copy-assist works; surfacing it inline is polish.
- **Non-text toolbar controls** (shape fill/radius, image fit) — the toolbar renders text controls only in this pass.

---

## Self-Review

- **Spec coverage:** inline text (Task 2) ✓; contextual toolbar with variable-promote (Tasks 3–4) ✓; on-slot variable glyph (Task 4) ✓; keyboard nudge/duplicate/delete (Task 5) ✓; content-shared/geometry-per-format rule — already implemented in `useGridEditor` (documented, verified in Task 2 browser check) ✓; ported copy-paste/multi-select and explicit escape hatches — **deferred, documented above** ✓; inline copy-assist — deferred ✓.
- **Placeholders:** none — every code step has real code; the two "confirm exact path/signature" steps (1.1, 5.1) are explicit read-instructions, not TODOs.
- **Type consistency:** `commitText`/`boundSocket` names match across Tasks 1→2→4; `style`/`promote`/`remove` emits match between Task 3 (definition) and Task 4 (handlers); toolbar consumes `element`/`bound` props as defined.
