# Studio Actions Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every studio modal the same bottom bar — quiet utilities + status on the left, a `Download ▾` and a `Render on canvas ▾` menu button docked right — driven by one shared `StudioActionsFooter` component.

**Architecture:** A new `StudioActionsFooter.vue` renders three zones from a declarative spec (`{ status, utilities[], downloads[], canvas[] }`). Each right-hand zone is a `StudioFooterMenu.vue` (a `StudioButton` trigger + an upward menu). Studios stop hand-writing footer markup and instead pass the spec into `StudioModalShell`'s `#actions` slot. All canvas paths already exist (they only get relabeled); the only new behaviour is Download items (PNG everywhere, Video on studios that already encode).

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup>` / TypeScript / Tailwind v4 / Vitest (`environment: node`, no component-test framework — pure logic is unit-tested, components verified by driving the real app).

## Global Constraints

- Reuse `StudioButton` (`~/components/vue-canvas/studio/StudioButton.vue`): `variant="primary"` = action-blue, `variant="secondary"` = grey, `variant="subtle"` = quiet text. Do not restyle it.
- The footer occupies `StudioModalShell`'s existing `#actions` slot (full-width, hairline-topped, `px-4 py-3`). Add no new modal chrome.
- **A Download item saves a file and leaves the studio open. A Render-on-canvas item drops a node and closes the studio** — matching today's behaviour. Never swap these.
- Reuse each studio's existing image blob fn and existing `encodeFrames` encoder — **write no new renderer or encoder**. `encodeFrames` is `~/lib/engine/encodeVideo.ts`, returns `{ filename: string; ext: 'mp4'|'webm' }` (server-written file under `input/`); to download it, fetch `input/<filename>` → blob → save.
- **Vector video is out of scope** (no encoder exists). Vector's `Download ▾` = PNG · SVG only; its `Render on canvas ▾` = As image only.
- Remove the explicit **Save** button from Space Type and Scene3D (all studios auto-save); replace with the footer's `Saving… / Saved ✓ / ⚠ error` status. Keep the auto-save/persist code.
- Verify every component claim by driving the real app (dev server on `127.0.0.1:3000`, compile-check via `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/_nuxt/<path>` → 200). Synthetic events prove nothing — real clicks or it didn't happen.
- Per parallel-session hygiene: stage only your own hunks; commit to `main` directly; co-author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Footer types + status resolver (pure logic)

**Files:**
- Create: `frontend/app/lib/studio/footer.ts`
- Test: `frontend/tests/unit/studio-footer-status.unit.spec.ts`

**Interfaces:**
- Produces: `StudioFooterAction`, `StudioFooterStatus`, `StudioFooterSpec` interfaces; `resolveStatus(s?: StudioFooterStatus): { text: string; tone: 'error'|'saved'|'saving' } | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveStatus } from '~/lib/studio/footer'

describe('resolveStatus', () => {
  it('returns null when nothing is set', () => {
    expect(resolveStatus()).toBeNull()
    expect(resolveStatus({})).toBeNull()
  })
  it('error wins over saved and saving', () => {
    expect(resolveStatus({ error: 'Boom', saved: true, saving: true }))
      .toEqual({ text: 'Boom', tone: 'error' })
  })
  it('saving wins over saved', () => {
    expect(resolveStatus({ saving: true, saved: true })).toEqual({ text: 'Saving…', tone: 'saving' })
  })
  it('saved shows the check', () => {
    expect(resolveStatus({ saved: true })).toEqual({ text: 'Saved ✓', tone: 'saved' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/studio-footer-status.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/studio/footer`.

- [ ] **Step 3: Write the module**

```ts
// frontend/app/lib/studio/footer.ts
import type { Component } from 'vue'

/** One action in a footer zone. Rendered as a menu row (downloads/canvas) or a
 *  subtle button (utilities). */
export interface StudioFooterAction {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean            // shows a spinner / busy label on the trigger + row
  icon?: Component          // optional leading icon (e.g. Dices for Roll)
  subtitle?: string         // small dim second line, menu rows only (e.g. a caveat)
}

export interface StudioFooterStatus {
  saving?: boolean
  saved?: boolean
  error?: string | null
}

/** The whole footer, declarative. Utilities + status sit left; downloads then
 *  canvas dock right. An empty/absent zone renders nothing. */
export interface StudioFooterSpec {
  status?: StudioFooterStatus
  utilities?: StudioFooterAction[]
  downloads?: StudioFooterAction[]
  canvas?: StudioFooterAction[]
}

/** Status precedence: error > saving > saved. Returns null when idle. */
export function resolveStatus(
  s?: StudioFooterStatus,
): { text: string; tone: 'error' | 'saved' | 'saving' } | null {
  if (!s) return null
  if (s.error) return { text: s.error, tone: 'error' }
  if (s.saving) return { text: 'Saving…', tone: 'saving' }
  if (s.saved) return { text: 'Saved ✓', tone: 'saved' }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/studio-footer-status.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/studio/footer.ts frontend/tests/unit/studio-footer-status.unit.spec.ts
git commit -m "feat(studio): footer spec types + status resolver"
```

---

### Task 2: `StudioFooterMenu` + `StudioActionsFooter` components

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/StudioFooterMenu.vue`
- Create: `frontend/app/components/vue-canvas/studio/StudioActionsFooter.vue`

**Interfaces:**
- Consumes: `StudioFooterAction`, `StudioFooterSpec`, `resolveStatus` from `~/lib/studio/footer` (Task 1); `StudioButton` from `~/components/vue-canvas/studio/StudioButton.vue`.
- Produces: `<StudioActionsFooter :spec="StudioFooterSpec" />` — the single child studios place in `#actions`.

- [ ] **Step 1: Write `StudioFooterMenu.vue`**

A menu button: a `StudioButton` trigger showing `label ▾`, opening an upward panel that lists its actions. Owns its own open state; closes on outside pointerdown and on select. The trigger disables while any action is `busy`.

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import type { StudioFooterAction } from '~/lib/studio/footer'

const props = defineProps<{
  label: string
  variant: 'primary' | 'secondary'
  actions: StudioFooterAction[]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const anyBusy = computed(() => props.actions.some(a => a.busy))

function pick(a: StudioFooterAction) {
  if (a.disabled || a.busy) return
  open.value = false
  a.onClick()
}
function onDocPointerDown(e: PointerEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))
</script>

<template>
  <div ref="rootEl" class="relative">
    <StudioButton :variant="variant" :disabled="anyBusy" @pointerdown.stop @click="open = !open">
      {{ anyBusy ? 'Working…' : label }}
      <span class="ml-1 inline-block rotate-90 text-white/70">›</span>
    </StudioButton>
    <div v-if="open" @pointerdown.stop
         class="absolute bottom-full right-0 z-20 mb-1.5 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#1a1a1e] py-1 shadow-xl">
      <button v-for="(a, i) in actions" :key="i" type="button" :disabled="a.disabled || a.busy"
              class="block w-full px-3 py-1.5 text-left text-xs text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              @click="pick(a)">
        <span class="flex items-center gap-1.5">
          <component :is="a.icon" v-if="a.icon" class="h-3.5 w-3.5" />
          {{ a.busy ? 'Working…' : a.label }}
        </span>
        <span v-if="a.subtitle" class="mt-0.5 block text-[10px] leading-snug text-white/40">{{ a.subtitle }}</span>
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Write `StudioActionsFooter.vue`**

```vue
<script setup lang="ts">
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioFooterMenu from '~/components/vue-canvas/studio/StudioFooterMenu.vue'
import { resolveStatus, type StudioFooterSpec } from '~/lib/studio/footer'
import { computed } from 'vue'

const props = defineProps<{ spec: StudioFooterSpec }>()
const status = computed(() => resolveStatus(props.spec.status))
const toneClass: Record<string, string> = {
  error: 'text-red-400/90', saved: 'text-emerald-400/80', saving: 'text-white/50',
}
</script>

<template>
  <div class="flex w-full items-center gap-2">
    <!-- ① status + utilities (left, quiet) -->
    <p v-if="status" class="truncate text-xs" :class="toneClass[status.tone]">{{ status.text }}</p>
    <StudioButton
      v-for="(u, i) in spec.utilities" :key="'u' + i"
      variant="subtle" :disabled="u.disabled || u.busy" @click="u.onClick">
      <span class="flex items-center gap-1.5">
        <component :is="u.icon" v-if="u.icon" class="h-3.5 w-3.5" />
        {{ u.busy ? 'Working…' : u.label }}
      </span>
    </StudioButton>
    <span class="flex-1" />
    <!-- ② download ▾ -->
    <StudioFooterMenu v-if="spec.downloads?.length" label="Download" variant="secondary" :actions="spec.downloads" />
    <!-- ③ render on canvas ▾ -->
    <StudioFooterMenu v-if="spec.canvas?.length" label="Render on canvas" variant="primary" :actions="spec.canvas" />
  </div>
</template>
```

- [ ] **Step 3: Compile-check both components**

Ensure the dev server is running (`cd frontend && npm run dev` if needed), then:
Run: `for f in StudioFooterMenu StudioActionsFooter; do curl -s -o /dev/null -w "$f %{http_code}\n" http://127.0.0.1:3000/_nuxt/components/vue-canvas/studio/$f.vue; done`
Expected: both `200`.

- [ ] **Step 4: Live smoke test via a temp harness**

Create `frontend/app/pages/dev/footer-temp.vue` rendering `<StudioActionsFooter :spec="…" />` with a status, one utility, a 2-item downloads menu, and a 3-item canvas menu. Navigate the Browser pane to `http://127.0.0.1:3000/dev/footer-temp`, screenshot, and read computed styles to confirm: two right-docked buttons (grey `Download ▾`, blue `Render on canvas ▾`), each opens an upward menu on click, utility + status sit left. Delete the temp page after.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioFooterMenu.vue frontend/app/components/vue-canvas/studio/StudioActionsFooter.vue
git commit -m "feat(studio): StudioActionsFooter + StudioFooterMenu"
```

---

### Task 3: Space Type — reference conversion (Save removed, transparency as item, Download PNG+Video)

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (`#actions` block ~1712–1755; script for a new `downloadPng`/`downloadVideoFile`)

**Interfaces:**
- Consumes: `StudioActionsFooter` (Task 2), `StudioFooterSpec` (Task 1).

Existing handlers to reuse (do not rewrite): `saveNow` (its Save button is being removed), `generateImage()`, `generateVideo()`, `sendToTimeline()`, `exportWebEmbed()`, refs `baking`, `savedFlash`, `embedMsg`, `embedErr`, `embedding`, `exportAlpha`, `exportAlphaAvailable`, and the per-frame blob path `engine.frameToBlob(W.value, H.value)` used inside `generateVideo`. `encodeFrames` is already imported.

- [ ] **Step 1: Add a shared download helper (used here and by later tasks)**

Create `frontend/app/lib/studio/downloadBlob.ts`:

```ts
/** Save a Blob as a file download, cleaning up the object URL. */
export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 2: Add `downloadPng` + `downloadVideoFile` to Space Type's script**

Place near the other export fns. `downloadPng` reuses the still-frame blob; `downloadVideoFile` mirrors `generateVideo`'s bake→encode but saves the encoded file instead of dispatching a Video node (fetch `input/<filename>` → blob → `downloadBlobAsFile`). Use the SAME frame-baking the existing `generateVideo` uses (copy its `frames`/`fps`/`W`/`H` derivation); only the tail differs.

```ts
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'

async function downloadPng() {
  const blob = await engine!.frameToBlob(W.value, H.value)
  downloadBlobAsFile(blob, `spacetype_${Date.now()}.png`)
}

async function downloadVideoFile() {
  baking.value = true
  try {
    // …identical bake to generateVideo(): build `bake.frames` at `fps.value`,
    // then encode — but SAVE the file rather than dispatch a Video node.
    const encoded = await encodeFrames({ frames: bake.frames, fps: fps.value, width: W.value, height: H.value, alpha: exportAlpha.value && exportAlphaAvailable.value })
    const res = await fetch(`/input/${encoded.filename}`)
    downloadBlobAsFile(await res.blob(), `spacetype_${Date.now()}.${encoded.ext}`)
  } catch (e) { console.error('[spacetype] video download failed', e) }
  finally { baking.value = false }
}
```

Note: the implementer must copy the exact frame-bake lines from the current `generateVideo` (the `ensureSpaceTypeBake`/`renderFrame` block) so the download matches the canvas video. `Date.now()` is fine in app code (only workflow scripts forbid it).

- [ ] **Step 3: Replace the whole `#actions` block with the footer spec**

Delete the entire existing `<template #actions> … </template>` (the Save button, the `renderMenuOpen` dropdown, the transparent-bg checkbox, the status `<p>`s) and replace with:

```vue
    <template #actions>
      <StudioActionsFooter :spec="{
        status: { saved: savedFlash, error: embedErr ? embedMsg : null },
        downloads: [
          { label: 'Download PNG', onClick: downloadPng },
          { label: 'Download video', onClick: downloadVideoFile, busy: baking },
          { label: 'Export embed', onClick: exportWebEmbed, busy: embedding },
        ],
        canvas: [
          { label: 'As image', onClick: generateImage, busy: baking },
          { label: 'As video', onClick: generateVideo, busy: baking },
          ...(exportAlphaAvailable ? [{ label: 'As video (transparent)', subtitle: 'WebM with real transparency · Safari can\'t play it', onClick: () => { exportAlpha = true; generateVideo() } }] : []),
          { label: 'Send to timeline', onClick: sendToTimeline },
        ],
      }" />
    </template>
```

Import `StudioActionsFooter` in `<script setup>`. Remove the now-unused `renderMenuOpen` ref and its template remnants. Keep `exportAlpha`/`exportAlphaAvailable` (still used).

- [ ] **Step 4: Compile + typecheck**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/_nuxt/components/vue-canvas/SpaceTypeSurface.vue` → `200`.
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep SpaceTypeSurface` → no NEW errors (compare against the ~pre-existing baseline; the feature must not add its own).

- [ ] **Step 5: Live verify + commit**

Open Space Type in the app. Confirm: no Save button; `Download ▾` shows PNG/Video/Embed; `Render on canvas ▾` shows As image/As video/(transparent when the frame has alpha)/Send to timeline; picking `As image` drops an Image node and closes the modal (assert a node appeared, not just the click); `Download PNG` saves a file and leaves the modal open. Then:

```bash
git add frontend/app/lib/studio/downloadBlob.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "refactor(studio): Space Type footer → StudioActionsFooter (Save dropped, transparency an item)"
```

---

### Task 4: Scene3D — convert (Save removed; reuse existing exportVideo)

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (`#actions` ~4075–4092; script for `downloadPng`)

Existing handlers: `saveScene` (Save button removed), `exportToCanvas()` (→ canvas image), `exportVideo()` (existing mp4 FILE download — reuse as `Download video`), refs `baking`, `committing`, `bakeError`, `savedFlash`, `dirty`, `doc.objects.length`. Still-image blob: reuse the `cv.toBlob(…, 'image/png')` path already in the file (~line 221, inside the bake helper) — extract or call the smallest existing fn that returns a PNG Blob of the beauty pass; if none is cleanly reusable, bake then fetch `input/<beauty_image>` and save that.

- [ ] **Step 1:** Add `downloadPng` (reuse the existing still-blob/beauty path + `downloadBlobAsFile`).
- [ ] **Step 2:** Replace `#actions` with:

```vue
    <template #actions>
      <StudioActionsFooter :spec="{
        status: { saved: savedFlash, error: (bakeError && !baking) ? bakeError : null },
        downloads: [
          { label: 'Download PNG', onClick: downloadPng, disabled: !doc.objects.length },
          { label: 'Download video', onClick: exportVideo, busy: baking },
        ],
        canvas: [
          { label: 'As image', onClick: exportToCanvas, busy: baking, disabled: committing || !doc.objects.length },
        ],
      }" />
    </template>
```

Import `StudioActionsFooter`. Remove the two `StudioButton`s and the status `<p>`s. Keep `saveScene` defined only if referenced elsewhere; otherwise remove it and its now-dead wiring (keep auto-persist/dirty tracking).
- [ ] **Step 3:** Compile 200 + typecheck no new errors.
- [ ] **Step 4:** Live verify (image drops a node + closes; Download PNG/video save files) and commit `refactor(studio): Scene3D footer → StudioActionsFooter`.

---

### Task 5: Texture — convert (reuse existing downloadPng + sendToCanvas)

**Files:** Modify `frontend/app/components/vue-canvas/TextureStudioSurface.vue` (`#actions` ~597–601).

Existing handlers: `roll()` (utility, icon `Dices`), `downloadPng()` (existing real file download — reuse), `sendToCanvas()` (→ canvas image), refs `baking`, `bakeMsg`, `params.seed`. Import `Dices` is already present.

- [ ] **Step 1:** Replace `#actions` with:

```vue
    <template #actions>
      <StudioActionsFooter :spec="{
        status: baking ? { saving: true } : undefined,
        utilities: [{ label: `Roll · seed ${params.seed}`, onClick: roll, icon: Dices }],
        downloads: [{ label: 'Download PNG', onClick: downloadPng }],
        canvas: [{ label: 'As image', onClick: sendToCanvas, busy: baking }],
      }" />
    </template>
```

Import `StudioActionsFooter`.
- [ ] **Step 2:** Compile 200 + typecheck; live verify Roll re-seeds, Download PNG saves, As image drops a node + closes; commit `refactor(studio): Texture footer → StudioActionsFooter`.

---

### Task 6: Gradient — convert (Copy config utility; add Download PNG + Video)

**Files:** Modify `frontend/app/components/vue-canvas/GradientStudioSurface.vue` (`#actions` ~789–807; script for `downloadPng`/`downloadVideoFile`).

Existing handlers: `generateImage()` (canvas image), `generateVideo()` (canvas video), `exportWebEmbed()`, `copyConfig()` + `copied` (utility), `renderCurrentBlob()` (still blob), refs `baking`, `bakeMsg`, `embedMsg`, `embedErr`, `embedding`. `encodeFrames` imported.

- [ ] **Step 1:** Add `downloadPng` (`renderCurrentBlob()` → `downloadBlobAsFile`) and `downloadVideoFile` (mirror `generateVideo`'s frame bake → `encodeFrames` → fetch `input/<filename>` → save).
- [ ] **Step 2:** Replace `#actions`:

```vue
    <template #actions>
      <StudioActionsFooter :spec="{
        status: { error: glError || (embedErr ? embedMsg : null) },
        utilities: [{ label: copied ? '✓ Copied' : 'Copy config', onClick: copyConfig }],
        downloads: [
          { label: 'Download PNG', onClick: downloadPng },
          { label: 'Download video', onClick: downloadVideoFile, busy: baking },
          { label: 'Export embed', onClick: exportWebEmbed, busy: embedding },
        ],
        canvas: [
          { label: 'As image', onClick: generateImage, busy: baking },
          { label: 'As video', onClick: generateVideo, busy: baking },
        ],
      }" />
    </template>
```

Import `StudioActionsFooter`.
- [ ] **Step 3:** Compile 200 + typecheck; live verify; commit `refactor(studio): Gradient footer → StudioActionsFooter`.

---

### Task 7: Shader — convert (add Download PNG + Video)

**Files:** Modify `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (`#actions` ~667–677; script for `downloadPng`/`downloadVideoFile`).

Existing handlers: `generateImage()` (canvas image), `generateVideo()` (canvas video), `exportWebEmbed()`, the still-blob fn near line ~420 (the `renderToBlob`-equivalent used by `generateImage` — reuse it), refs `baking`, `bakeMsg`, `embedMsg`, `embedErr`, `embedding`, `glError`. `encodeFrames` imported.

- [ ] **Step 1:** Add `downloadPng` (reuse the still-blob fn → `downloadBlobAsFile`) and `downloadVideoFile` (mirror `generateVideo` → encode → fetch → save).
- [ ] **Step 2:** Replace `#actions`:

```vue
    <template #actions>
      <StudioActionsFooter :spec="{
        status: { error: glError || (embedErr ? embedMsg : null) },
        downloads: [
          { label: 'Download PNG', onClick: downloadPng },
          { label: 'Download video', onClick: downloadVideoFile, busy: baking },
          { label: 'Export embed', onClick: exportWebEmbed, busy: embedding },
        ],
        canvas: [
          { label: 'As image', onClick: generateImage, busy: baking },
          { label: 'As video', onClick: generateVideo, busy: baking },
        ],
      }" />
    </template>
```

Import `StudioActionsFooter`.
- [ ] **Step 3:** Compile 200 + typecheck; live verify; commit `refactor(studio): Shader footer → StudioActionsFooter`.

---

### Task 8: Shape — convert (relabel Export PNG → canvas; add real Download PNG)

**Files:** Modify `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` (`#actions` ~490–500; script for `downloadPng`).

**Key:** the existing `exportPng()` already **renders to the canvas** (dispatches `sailor:shapeStudioOutput`, closes the studio) — it becomes the `As image` canvas action, unchanged. Add a genuinely-new `downloadPng` that saves a file.

Existing: `exportPng()` (→ canvas image, keep as-is), `triggerImport()` + `onImportFile` + `importInput` ref, `exportSettings()` (JSON file — utility), refs `exporting`, `webglOk`, `actionError`, blob source `engine.frameToBlob(canvasW.value, canvasH.value)`.

- [ ] **Step 1:** Add:

```ts
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'
async function downloadPng() {
  if (!engine) return
  const blob = await engine.frameToBlob(canvasW.value, canvasH.value)
  downloadBlobAsFile(blob, `shape_${config.seed}.png`)
}
```

(If reading `config.seed` is awkward, use `Date.now()`.)
- [ ] **Step 2:** Replace `#actions` (keep the hidden `<input ref="importInput">` — move it just inside the template, it has no visual footprint):

```vue
    <template #actions>
      <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
      <StudioActionsFooter :spec="{
        status: { error: actionError || null },
        utilities: [
          { label: 'Import settings', onClick: triggerImport },
          { label: 'Export settings', onClick: exportSettings },
        ],
        downloads: [{ label: 'Download PNG', onClick: downloadPng, disabled: !webglOk }],
        canvas: [{ label: 'As image', onClick: exportPng, busy: exporting, disabled: !webglOk }],
      }" />
    </template>
```

Import `StudioActionsFooter`.
- [ ] **Step 3:** Compile 200 + typecheck; live verify (As image drops a node + closes; Download PNG saves a file + stays open; Import/Export settings work); commit `refactor(studio): Shape footer → StudioActionsFooter (Export PNG was canvas; add real Download PNG)`.

---

### Task 9: Vector — convert (relabel Export PNG → canvas; Download PNG + existing SVG)

**Files:** Modify `frontend/app/components/vue-canvas/VectorTypeSurface.vue` (`#actions` ~1479–1515; script for `downloadPng`).

**Key:** existing `exportPng()` already **renders to canvas** (dispatches `sailor:vectorTypeStudioOutput`, closes) — becomes `As image`. `exportSvg()` is a **real file download** — goes in `Download ▾`. No Vector video (out of scope).

Existing: `exportPng()` (→ canvas, keep), `exportSvg()` (SVG file download), `triggerImport`/`onImportFile`/`importInput`, `exportSettings()`, `playing`/`animated` (Play/Pause utility), refs `exporting`, `svgExporting`, `font`, `actionError`, blob source `renderFullResBlob(previewTime.value)`.

- [ ] **Step 1:** Add:

```ts
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'
async function downloadPng() {
  const blob = await renderFullResBlob(previewTime.value)
  if (!blob) return
  downloadBlobAsFile(blob, `vectortype_${Date.now()}.png`)
}
```

- [ ] **Step 2:** Replace `#actions` (keep the hidden import `<input>`):

```vue
    <template #actions>
      <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
      <StudioActionsFooter :spec="{
        status: { error: actionError || null },
        utilities: [
          ...(animated ? [{ label: playing ? 'Pause' : 'Play', onClick: () => { playing = !playing } }] : []),
          { label: 'Import settings', onClick: triggerImport },
          { label: 'Export settings', onClick: exportSettings },
        ],
        downloads: [
          { label: 'Download PNG', onClick: downloadPng, disabled: !font },
          { label: 'Download SVG', onClick: exportSvg, busy: svgExporting, disabled: !font },
        ],
        canvas: [{ label: 'As image', onClick: exportPng, busy: exporting, disabled: !font }],
      }" />
    </template>
```

Import `StudioActionsFooter`.
- [ ] **Step 3:** Compile 200 + typecheck; live verify (Play/Pause toggles; As image drops a node + closes; Download PNG/SVG save files + stay open); commit `refactor(studio): Vector footer → StudioActionsFooter (Export PNG was canvas; SVG is the download)`.

---

### Task 10: Sweep verification + docs

**Files:** Modify `docs/STATE.md`; update the ⛵ State-of-the-Build artifact.

- [ ] **Step 1:** Open all 7 studios in the app in one pass; confirm each shows the identical two-button footer (utilities/status left; `Download ▾` + `Render on canvas ▾` right, either omitted only when genuinely empty — none should be, except Texture/Shape have single-item Download which is still a menu). Confirm no studio still has a Save button and no floating Transparent-background checkbox.
- [ ] **Step 2:** Grep for stragglers: `grep -rn "renderMenuOpen\|Export to Canvas\|Send to canvas\|Generate as image\|Export PNG" frontend/app/components/vue-canvas/*Surface.vue` — expect no user-facing button labels left (handler/internal names are fine).
- [ ] **Step 3:** Run the unit suite touched: `cd frontend && npx vitest run tests/unit/studio-footer-status.unit.spec.ts` → PASS.
- [ ] **Step 4:** Update `docs/STATE.md` (extend the docked-actions entry) and the ⛵ artifact per the standing dashboard rule. Commit `docs: studio actions footer landed`.

## Self-Review

- **Spec coverage:** three zones (Task 2), status/Save-removal (Tasks 1–4), Download PNG everywhere (Tasks 3–9), Download video on the four encoders (Tasks 3,4,6,7), transparency-as-item (Task 3), Shape/Vector relabel (Tasks 8,9), Vector-video out of scope (respected — not in any task). ✓
- **Type consistency:** `StudioFooterSpec`/`StudioFooterAction`/`resolveStatus` defined in Task 1, consumed unchanged in Tasks 2–9. `StudioActionsFooter` prop is `:spec`. `downloadBlobAsFile(blob, filename)` defined in Task 3, reused in 6/7/8/9. ✓
- **Known risk:** Space Type / Gradient / Shader `downloadVideoFile` must copy the exact frame-bake lines from each studio's `generateVideo` — the plan flags this per task rather than inventing bake code. Scene3D's still-PNG blob may need the beauty-fetch fallback; flagged in Task 4.
