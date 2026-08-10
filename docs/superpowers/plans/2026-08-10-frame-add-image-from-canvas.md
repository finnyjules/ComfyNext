# Frame "Add image" picks a canvas image — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Frame/Compositor "Add image" button offer both "upload from computer" and "pick an image already on the canvas", in both toolbars.

**Architecture:** Reuse the existing `FillImagePicker` canvas grid and extract the paste path's URL→File logic into a shared, testable helper. Add a composable helper `addImageFromCanvasSrc` and a small shared popover both "Add image" toolbars mount.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), Vitest (unit).

## Global Constraints

- Snapshot semantics only — a picked canvas image is fetched + uploaded to the input dir at pick time (like drag-drop/paste); no live link.
- Feature parity: wire both `CompositorModal.vue` and `ArtifactFrameNode.vue`.
- Do not change the shape-fill flow or `BrandImagePicker`.
- Frontend unit tests: `cd frontend && npm run test:unit`.
- Commit hygiene (shared working tree, parallel sessions): stage only the exact paths each step names; never `git add -A`/`.`, never `git stash`; commit to `main`. If a file you must edit is unexpectedly already modified by another session, STOP and report rather than committing foreign hunks. Commit trailer exactly: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Shared `imageUrlToFile` helper + `addImageFromCanvasSrc`

**Files:**
- Create: `frontend/app/lib/canvas/imageUrlToFile.ts`
- Test: `frontend/tests/unit/image-url-to-file.unit.spec.ts`
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (add helper ~after line 682, export ~line 744)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (refactor `pastedNodeImageFile` ~3391; destructure `addImageFromCanvasSrc` ~344)

**Interfaces:**
- Produces: `imageUrlToFile(url: string, fallbackName?: string): Promise<File>` — fetches a URL and returns an image `File` named from the URL's `?filename=` param (or `fallbackName`, default `'canvas.png'`); throws on non-ok response or non-image blob.
- Produces: `addImageFromCanvasSrc(src: string): Promise<void>` on the `useLocalLayerEditor` return object — fetches a canvas image URL and adds it as an image layer via the existing upload path.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/image-url-to-file.unit.spec.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { imageUrlToFile } from '~/lib/canvas/imageUrlToFile'

function stubFetch(impl: { ok: boolean; status?: number; blob?: Blob }) {
  ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: impl.ok,
    status: impl.status ?? 200,
    blob: async () => impl.blob,
  })
}
afterEach(() => { vi.restoreAllMocks() })

describe('imageUrlToFile', () => {
  it('names the File from the URL ?filename= param', async () => {
    stubFetch({ ok: true, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) })
    const f = await imageUrlToFile('/view?filename=foo.png&type=input')
    expect(f).toBeInstanceOf(File)
    expect(f.name).toBe('foo.png')
    expect(f.type).toBe('image/png')
  })

  it('falls back to the given name when there is no filename param', async () => {
    stubFetch({ ok: true, blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) })
    const f = await imageUrlToFile('blob:whatever', 'pasted.png')
    expect(f.name).toBe('pasted.png')
  })

  it('throws on a non-ok response', async () => {
    stubFetch({ ok: false, status: 404 })
    await expect(imageUrlToFile('/view?filename=x.png')).rejects.toThrow(/404/)
  })

  it('throws when the blob is not an image', async () => {
    stubFetch({ ok: true, blob: new Blob(['hi'], { type: 'text/plain' }) })
    await expect(imageUrlToFile('/view?filename=x.txt')).rejects.toThrow(/not an image/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- image-url-to-file`
Expected: FAIL — cannot resolve `~/lib/canvas/imageUrlToFile` (module doesn't exist yet).

- [ ] **Step 3: Create the helper**

Create `frontend/app/lib/canvas/imageUrlToFile.ts`:

```ts
/**
 * Fetch an image URL and wrap it as a File suitable for /upload/image.
 * Shared by the Compositor paste path and the "pick a canvas image" add path.
 * The name is taken from the URL's `?filename=` param (ComfyUI /view URLs carry
 * it) or `fallbackName` otherwise. Throws on a non-ok response or a non-image
 * blob so callers can toast/log rather than silently add a broken layer.
 */
export async function imageUrlToFile(url: string, fallbackName = 'canvas.png'): Promise<File> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type || 'unknown'})`)
  const name = new URLSearchParams(url.split('?')[1] ?? '').get('filename') || fallbackName
  return new File([blob], name, { type: blob.type })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- image-url-to-file`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `addImageFromCanvasSrc` to the composable**

In `frontend/app/composables/useLocalLayerEditor.ts`, add the import near the top (with the other imports):

```ts
import { imageUrlToFile } from '~/lib/canvas/imageUrlToFile'
```

Immediately after the `addImageFromName` function (ends ~line 687), add:

```ts
  // Add an image layer from a canvas node's image URL (a snapshot: the URL is
  // fetched + uploaded to the input dir, exactly like drag-drop/paste).
  async function addImageFromCanvasSrc(src: string) {
    if (!src) return
    await addImageFromFile(await imageUrlToFile(src))
  }
```

In the returned object (the `return { ... }` block ~line 744, which already lists `addImageFromFile, addImageFromName,`), add `addImageFromCanvasSrc`:

```ts
    addText, addRect, addEllipse, addLine, addPolygon, addStar, addImageFromFile, addImageFromName, addImageFromCanvasSrc,
```

- [ ] **Step 6: Refactor `pastedNodeImageFile` to use the shared helper (DRY)**

In `frontend/app/components/vue-canvas/CompositorModal.vue`, add the import near the other `~/lib/canvas` import (there is already `import { imageUrlForNode } from '~/lib/canvas/nodeImage'` ~line 46):

```ts
import { imageUrlToFile } from '~/lib/canvas/imageUrlToFile'
```

Replace the body of `pastedNodeImageFile` (~3391) — the `fetch(url)`→blob→`new File(...)` block — so the loop uses the helper:

```ts
async function pastedNodeImageFile(): Promise<File | null> {
  const clip = nodeClipboard.read()
  if (!clip?.nodes?.length) return null
  for (const n of clip.nodes) {
    const url = imageUrlForNode(n)
    if (!url) continue
    return imageUrlToFile(url, 'pasted.png')
  }
  return null
}
```

Also add `addImageFromCanvasSrc` to the composable destructure (~line 344, alongside `addImageFromFile, addImageFromName,`):

```ts
  addText, addRect, addEllipse, addLine, addPolygon, addStar, addImageFromFile, addImageFromName, addImageFromCanvasSrc,
```

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E 'imageUrlToFile|useLocalLayerEditor|CompositorModal' | tail -20`
Expected: no errors naming these files/symbols (repo carries a large pre-existing baseline; only errors referencing this task's changes are regressions).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/canvas/imageUrlToFile.ts frontend/tests/unit/image-url-to-file.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): shared imageUrlToFile + addImageFromCanvasSrc

Extract the paste path's URL->File logic into a tested helper and add a
composable helper that adds a canvas image URL as a layer."
```

(append the `Co-Authored-By` trailer)

---

### Task 2: Shared `AddImageSourcePopover` + wire both toolbars

**Files:**
- Create: `frontend/app/components/vue-canvas/compositor/AddImageSourcePopover.vue`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (toolbar ~4177 + script)
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` (toolbar ~978 + script)

**Interfaces:**
- Consumes: `addImageFromCanvasSrc` (Task 1), `FillImagePicker` (existing).
- Produces: `AddImageSourcePopover` — props `{ open: boolean }`, emits `upload: []`, `pick: [src: string]`, `close: []`.

- [ ] **Step 1: Create the popover component**

Create `frontend/app/components/vue-canvas/compositor/AddImageSourcePopover.vue`:

```vue
<script setup lang="ts">
/** Source chooser for adding an image to a Frame: "Upload from computer" plus
 *  the canvas-image grid (FillImagePicker). Content-only popover — the caller
 *  owns the trigger button and the `open` state, and must wrap both in a
 *  positioned (`relative`) container. */
import { ImagePlus } from 'lucide-vue-next'
import FillImagePicker from '~/components/vue-canvas/compositor/FillImagePicker.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ upload: []; pick: [src: string]; close: [] }>()
</script>

<template>
  <template v-if="open">
    <!-- click-away backdrop (below the panel) -->
    <div class="fixed inset-0 z-40" @click="emit('close')" />
    <div class="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/10 bg-[#1a1a1a] p-2 shadow-xl">
      <button
        type="button"
        class="mb-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-white/80 hover:bg-white/10 cursor-pointer"
        @click="emit('upload')"
      >
        <ImagePlus class="size-3.5" /> Upload from computer
      </button>
      <div class="mb-1 px-1 text-[10px] uppercase tracking-wide text-white/40">On the canvas</div>
      <FillImagePicker @pick="(s: string) => emit('pick', s)" />
    </div>
  </template>
</template>
```

- [ ] **Step 2: Wire the CompositorModal toolbar**

In `frontend/app/components/vue-canvas/CompositorModal.vue` script, add the import (near other component imports):

```ts
import AddImageSourcePopover from '~/components/vue-canvas/compositor/AddImageSourcePopover.vue'
```

Add state + handlers near `triggerAddImage`/`onAddImageFile` (~3301):

```ts
const addMenuOpen = ref(false)
function onUploadChoice() { addMenuOpen.value = false; triggerAddImage() }
async function onPickCanvasImage(src: string) {
  addMenuOpen.value = false
  try { await addImageFromCanvasSrc(src) } catch (err) { console.error('[Compositor] add canvas image failed:', err) }
}
```

In the template, the current "Add image" button (~4177) is:

```html
        <button class="flex items-center justify-center size-8 rounded hover:bg-white/10 text-white/80 cursor-pointer" title="Add image" @click="triggerAddImage">
```

Change its `@click="triggerAddImage"` to `@click="addMenuOpen = !addMenuOpen"`, and wrap the button plus the new popover in a positioned container. Keep the button's existing inner icon markup unchanged. Result:

```html
        <div class="relative inline-flex">
          <button class="flex items-center justify-center size-8 rounded hover:bg-white/10 text-white/80 cursor-pointer" title="Add image" @click="addMenuOpen = !addMenuOpen">
            <!-- existing icon markup, unchanged -->
          </button>
          <AddImageSourcePopover :open="addMenuOpen" @upload="onUploadChoice" @pick="onPickCanvasImage" @close="addMenuOpen = false" />
        </div>
```

Leave the hidden `<input ref="imageInputRef" ...>` (~4189), `onAddImageFile`, and `<BrandImagePicker>` exactly as they are.

- [ ] **Step 3: Wire the ArtifactFrameNode toolbar**

In `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` script, add the import:

```ts
import AddImageSourcePopover from '~/components/vue-canvas/compositor/AddImageSourcePopover.vue'
```

Add state + handlers near `triggerAddImage`/`onAddImageFile` (~602):

```ts
const addMenuOpen = ref(false)
function onUploadChoice() { addMenuOpen.value = false; triggerAddImage() }
async function onPickCanvasImage(src: string) {
  addMenuOpen.value = false
  try { await editor.addImageFromCanvasSrc(src) } catch (err) { console.error('[Frame] add canvas image:', err) }
}
```

The current button (~978) is:

```html
        <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add image" @click="triggerAddImage"><ImagePlus class="size-3" /></button>
```

Change `@click="triggerAddImage"` to `@click="addMenuOpen = !addMenuOpen"` and wrap it + the popover in a positioned container:

```html
        <div class="relative inline-flex">
          <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add image" @click="addMenuOpen = !addMenuOpen"><ImagePlus class="size-3" /></button>
          <AddImageSourcePopover :open="addMenuOpen" @upload="onUploadChoice" @pick="onPickCanvasImage" @close="addMenuOpen = false" />
        </div>
```

Leave the hidden `<input ref="imageInputRef" ...>` (~979) and `<BrandImagePicker>` (~980) unchanged. `ImagePlus` is already imported in this file.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E 'AddImageSourcePopover|CompositorModal|ArtifactFrameNode' | tail -20`
Expected: no errors naming these files.

- [ ] **Step 5: Browser-pane verification**

With ComfyUI + the dev server running, open the canvas (127.0.0.1:3000). Ensure at least one image node exists on the canvas.
- Open a Frame (Compositor modal). Click "Add image" → confirm the popover shows "Upload from computer" + a grid of the canvas's images.
- Click a canvas thumbnail → a new image layer appears showing that image. Screenshot.
- Click "Add image" → "Upload from computer" → confirm the file dialog still opens and an uploaded file still adds a layer.
- Repeat the canvas-pick on the inline Frame node's "Add image" button.
- Empty-canvas case (or a canvas with no image nodes): popover shows "No images on the canvas yet." with Upload still working.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/AddImageSourcePopover.vue frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/components/vue-canvas/ArtifactFrameNode.vue
git commit -m "feat(frame): Add image can pick a canvas image (both toolbars)"
```

(append the `Co-Authored-By` trailer)

---

## Self-Review

**Spec coverage:**
- Add image offers upload + canvas grid → Task 2 popover. ✓
- Picking adds a layer → Task 1 `addImageFromCanvasSrc` + Task 2 `onPickCanvasImage`. ✓
- Both surfaces → Task 2 Steps 2 + 3. ✓
- Reuse FillImagePicker + paste URL→File → Task 1 helper + Task 2 popover. ✓
- Snapshot semantics → `addImageFromCanvasSrc` routes through `addImageFromFile` (uploads to input dir). ✓
- Don't touch shape-fill / BrandImagePicker → only the layer-add button + a new helper are touched. ✓
- Empty-canvas + fetch-failure edge cases → FillImagePicker's own empty state; `imageUrlToFile` throws + caller try/catch. ✓ (empty-canvas asserted in Task 2 Step 5; throw path unit-tested in Task 1.)

**Placeholder scan:** none — full code in every code step; the one "existing icon markup, unchanged" note is a preserve-instruction, not a missing implementation.

**Type consistency:** `addImageFromCanvasSrc(src: string): Promise<void>` defined in Task 1, called in Task 2 (CompositorModal via destructure, ArtifactFrameNode via `editor.`). `imageUrlToFile(url, fallbackName?)` defined + used consistently. Popover emits (`upload`/`pick`/`close`) match the handlers wired in both toolbars.
