# Generate Object (drag-to-generate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a box in the frame modal, describe an object, and generate a brand-new **transparent cutout** as its own layer — in either **Style** mode (their prompt, optionally driven by a trained LoRA) or **Scene** mode (fitted to the existing frame).

**Architecture:** Extend the modal's existing "Generative Fill" mode (`CompositorModal.vue:1251+`), which already has a box-drag region tool, a "New layer" text2img path (`runRegionFill`), a nearest-aspect picker, and a `remove-bg` cutout helper. We add (1) a `lora-gen` Nitro route for trained-LoRA inference, (2) a lightweight style picker, (3) a Style↔Scene toggle, and (4) an always-on cutout step on the new-object path. The existing "inpaint a selected image" branch is left untouched.

**Tech Stack:** Nuxt 4 (Vue 3 + TS), Nitro server routes, Replicate (flux-schnell / flux-fill-dev / trained LoRA models / 851-labs background-remover), Vitest for unit tests, Playwright/preview tools for visual sign-off.

## Global Constraints

- **Work on `main` directly. Do NOT create a feature branch.** (User convention — branches caused merge conflicts.)
- **No purple/violet accents.** Use neutral white-opacity, type-color, emerald for the run/Generate action (matches existing panel).
- **UI changes live in the Vue frontend** (this is all frontend — no bridge/LiteGraph, no backend graph nodes).
- **New object generation is ADDITIVE** — it only ever creates a new layer; it never replaces an existing layer. (The existing "inpaint a selected image" path is a separate, untouched branch.)
- **Both new-object modes end in a transparent cutout** via `/api/inpaint/remove-bg`.
- **Cost-conscious:** one image per Generate click; the pricier paths (trained LoRA, flux-fill) run only when a style is picked or Scene mode is chosen.
- New Nitro routes go under `/api/inpaint/` — already allowlisted in `server/middleware/comfyui-proxy.ts` via `NITRO_API_PREFIXES` (no middleware edit needed).
- Tests: pure helpers use Vitest TDD (`npm run test:unit`). The Vue SFC integration and visual behavior are verified with the screenshot workflow (project convention: never sign off a visual feature on unit tests alone), not unit tests.

---

### Task 1: `lora-gen` Nitro route + prompt helper

Trained-LoRA inference from the frontend: take a LoRA filename + prompt, read its sidecar for the private Replicate model + trigger + aesthetic, run it, return a data URL — mirroring the proven `lora-cover.post.ts` pattern but generic over prompt/aspect.

**Files:**
- Create: `frontend/server/utils/loraPrompt.ts`
- Test: `frontend/server/utils/loraPrompt.test.ts`
- Create: `frontend/server/api/inpaint/lora-gen.post.ts`

**Interfaces:**
- Produces: `buildLoraPrompt(trigger: string, aesthetic: string, userPrompt: string): string` — composes the final prompt.
- Produces: `POST /api/inpaint/lora-gen` — body `{ name: string; prompt: string; aspectRatio?: string; loraScale?: number; guidanceScale?: number }` → returns `{ images: string[]; model: string }` (images are base64 data URLs, matching `text2img`).

- [ ] **Step 1: Write the failing test**

`frontend/server/utils/loraPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildLoraPrompt } from './loraPrompt'

describe('buildLoraPrompt', () => {
  it('composes aesthetic + trigger + prompt', () => {
    expect(buildLoraPrompt('mystyle', 'oil paint, warm', 'a red car'))
      .toBe('oil paint, warm mystyle, a red car')
  })
  it('omits a missing trigger', () => {
    expect(buildLoraPrompt('', 'oil paint', 'a red car')).toBe('oil paint a red car')
  })
  it('omits a missing aesthetic', () => {
    expect(buildLoraPrompt('mystyle', '', 'a red car')).toBe('mystyle, a red car')
  })
  it('trims and tolerates all-empty', () => {
    expect(buildLoraPrompt('  ', '  ', '  ')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run server/utils/loraPrompt.test.ts`
Expected: FAIL — cannot find module `./loraPrompt` / `buildLoraPrompt is not a function`.

- [ ] **Step 3: Write the helper**

`frontend/server/utils/loraPrompt.ts`:

```ts
/**
 * Compose a trained-LoRA generation prompt from its sidecar style + the user's
 * text, mirroring the style branch of lora-cover.post.ts:
 *   "<aesthetic> <trigger>, <userPrompt>"
 * Any empty part is dropped. Returned string is trimmed.
 */
export function buildLoraPrompt(trigger: string, aesthetic: string, userPrompt: string): string {
  const t = (trigger || '').trim()
  const a = (aesthetic || '').trim()
  const p = (userPrompt || '').trim()
  return [a, t ? `${t},` : '', p].filter(Boolean).join(' ').trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run server/utils/loraPrompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the route**

`frontend/server/api/inpaint/lora-gen.post.ts`:

```ts
/**
 * POST /api/inpaint/lora-gen   Body: { name, prompt, aspectRatio?, loraScale?, guidanceScale? }
 *
 * Generate from a trained LoRA's PRIVATE Replicate model (the one baked at train
 * time), used by the frame modal's "Generate Object" Style mode when a style is
 * picked. Reads models/loras/<base>.json for replicate_model + trigger +
 * aesthetic, composes the prompt, runs the model, and returns the image as a
 * base64 data URL (CORS-safe) — same response shape as /api/inpaint/text2img.
 *
 * Under /api/inpaint → already allowlisted by NITRO_API_PREFIXES.
 * Helpers (runReplicate/firstOutputUrl/fetchAsDataUrl/requireReplicateToken and
 * buildLoraPrompt) are auto-imported from server/utils.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

function safeBase(name: string): string | null {
  const base = (name || '').replace(/\.safetensors$/i, '')
  return /^[a-zA-Z0-9_-]+$/.test(base) ? base : null
}

interface Body {
  name?: string
  prompt?: string
  aspectRatio?: string
  loraScale?: number
  guidanceScale?: number
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const base = safeBase(String(body?.name ?? ''))
  if (!base) throw createError({ statusCode: 400, message: 'Invalid LoRA name' })
  const userPrompt = (body?.prompt ?? '').trim()
  if (!userPrompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const lorasDir = path.resolve(process.cwd(), '..', 'models', 'loras')
  let meta: any = {}
  try {
    meta = JSON.parse(await fs.readFile(path.join(lorasDir, `${base}.json`), 'utf8'))
  } catch {
    throw createError({ statusCode: 404, message: 'No sidecar for that LoRA.' })
  }
  const modelRef = String(meta.replicate_model ?? '').split(':')[0] // <owner>/<model>
  if (!modelRef) throw createError({ statusCode: 400, message: 'This LoRA has no trained Replicate model to run.' })

  const prompt = buildLoraPrompt(
    String(meta.trigger ?? ''),
    String(meta.aesthetic ?? meta.taste_profile ?? ''),
    userPrompt,
  )

  const out = await runReplicate(modelRef, {
    prompt,
    aspect_ratio: body?.aspectRatio || '1:1',
    megapixels: '1',
    num_inference_steps: 22,
    guidance_scale: Number.isFinite(body?.guidanceScale) ? body!.guidanceScale : 3.5,
    num_outputs: 1,
    output_format: 'png',
    lora_scale: Number.isFinite(body?.loraScale) ? body!.loraScale : 1,
  }, token, { timeoutMs: 120_000 })

  const url = firstOutputUrl(out)
  if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
  return { images: [await fetchAsDataUrl(url)], model: modelRef }
})
```

- [ ] **Step 6: Verify the route file type-checks**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i lora-gen || echo "no lora-gen type errors"`
Expected: `no lora-gen type errors` (auto-imports resolve; if `vue-tsc` is slow/unavailable, skip — the route mirrors `lora-cover.post.ts` exactly).

- [ ] **Step 7: Commit**

```bash
git add frontend/server/utils/loraPrompt.ts frontend/server/utils/loraPrompt.test.ts frontend/server/api/inpaint/lora-gen.post.ts
git commit -m "feat(compositor): /api/inpaint/lora-gen — trained-LoRA inference for Generate Object"
```

---

### Task 2: Style list (client helper for the picker)

A small composable that fetches the user's trained styles and exposes the ones that can actually be run (have a trained Replicate model). The filter is a pure function so it can be unit-tested.

**Files:**
- Create: `frontend/app/composables/useStyleList.ts`
- Test: `frontend/tests/unit/style-list.unit.spec.ts` (project convention: `tests/unit/**/*.unit.spec.ts`)

**Interfaces:**
- Consumes: `GET /api/loras-local` → `{ loras: LoraRecord[] }` where each record has `{ filename, name, kind, coverUrl, canGenerateCover, trigger, aesthetic }` (see `server/api/loras-local.get.ts`).
- Produces: `interface StyleItem { filename: string; name: string; coverUrl: string | null }`.
- Produces: `selectGeneratableStyles(loras: any[]): StyleItem[]` — styles only (`kind !== 'character'`) that `canGenerateCover` (i.e. have a trained model).
- Produces: `useStyleList(): { styles: Ref<StyleItem[]>; loading: Ref<boolean>; error: Ref<string>; refresh: () => Promise<void> }`.

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/style-list.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectGeneratableStyles } from '../../app/composables/useStyleList'

const rec = (p: any) => ({
  filename: 'x.safetensors', name: 'X', kind: 'style', coverUrl: null,
  canGenerateCover: true, trigger: null, aesthetic: null, ...p,
})

describe('selectGeneratableStyles', () => {
  it('keeps runnable styles', () => {
    const out = selectGeneratableStyles([rec({ filename: 'a.safetensors', name: 'A' })])
    expect(out).toEqual([{ filename: 'a.safetensors', name: 'A', coverUrl: null }])
  })
  it('drops characters', () => {
    expect(selectGeneratableStyles([rec({ kind: 'character' })])).toEqual([])
  })
  it('drops styles with no trained model', () => {
    expect(selectGeneratableStyles([rec({ canGenerateCover: false })])).toEqual([])
  })
  it('tolerates non-array input', () => {
    expect(selectGeneratableStyles(undefined as any)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/style-list.unit.spec.ts`
Expected: FAIL — cannot find module `../../app/composables/useStyleList`.

- [ ] **Step 3: Write the composable**

`frontend/app/composables/useStyleList.ts`:

```ts
/**
 * Lists the user's trained STYLE LoRAs that can be run for generation (have a
 * private Replicate model). Powers the Generate Object style picker.
 */
export interface StyleItem { filename: string; name: string; coverUrl: string | null }

/** Pure filter: style LoRAs (not characters) that have a runnable trained model. */
export function selectGeneratableStyles(loras: any[]): StyleItem[] {
  if (!Array.isArray(loras)) return []
  return loras
    .filter((l) => l && l.kind !== 'character' && l.canGenerateCover)
    .map((l) => ({ filename: String(l.filename), name: String(l.name || l.filename), coverUrl: l.coverUrl ?? null }))
}

export function useStyleList() {
  const styles = ref<StyleItem[]>([])
  const loading = ref(false)
  const error = ref('')

  async function refresh() {
    loading.value = true; error.value = ''
    try {
      const res = await $fetch<{ loras: any[] }>('/api/loras-local')
      styles.value = selectGeneratableStyles(res?.loras ?? [])
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Could not load styles'
    } finally {
      loading.value = false
    }
  }

  return { styles, loading, error, refresh }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/style-list.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useStyleList.ts frontend/tests/unit/style-list.unit.spec.ts
git commit -m "feat(compositor): useStyleList — runnable trained styles for Generate Object"
```

---

### Task 3: Add `loraGen` client method to `useInpaint`

Give the modal a typed client call for the new route, mirroring `text2img`.

**Files:**
- Modify: `frontend/app/composables/useInpaint.ts` (add method + export)

**Interfaces:**
- Consumes: `POST /api/inpaint/lora-gen` from Task 1.
- Produces: `useInpaint().loraGen(name: string, prompt: string, aspectRatio?: string): Promise<string[]>` — returns data URLs (length 1).

- [ ] **Step 1: Add the method**

In `frontend/app/composables/useInpaint.ts`, immediately after the `text2img` function (ends at the line `}` before the `pose` function, ~line 123), insert:

```ts
  /** Generate from a trained LoRA's private Replicate model (Style mode with a
   *  style selected). `name` is the LoRA's .safetensors filename. */
  async function loraGen(name: string, prompt: string, aspectRatio = '1:1'): Promise<string[]> {
    busy.value = true; error.value = ''
    try {
      const res = await $fetch<{ images: string[] }>('/api/inpaint/lora-gen', {
        method: 'POST',
        body: { name, prompt, aspectRatio },
      })
      results.value = res.images
      return res.images
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Generation failed'
      throw err
    } finally {
      busy.value = false
    }
  }
```

- [ ] **Step 2: Export it**

In the `return { ... }` at the end of `useInpaint` (currently `return { busy, error, results, fluxFill, kontext, segment, text2img, pose, removeBackground, uploadDataUrl }`), add `loraGen`:

```ts
  return { busy, error, results, fluxFill, kontext, segment, text2img, loraGen, pose, removeBackground, uploadDataUrl }
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i useInpaint || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useInpaint.ts
git commit -m "feat(compositor): useInpaint.loraGen client call"
```

---

### Task 4: Generate-Object state + panel UI (Style↔Scene toggle + style picker)

Add the mode toggle and style picker to the existing Generative Fill panel, shown **only when generating a new layer** (no target image selected). No generation-behavior change yet — the picker just sets state; verify it renders.

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (script: state near line 1264; template: gen panel near lines 2079–2106)

**Interfaces:**
- Consumes: `useStyleList` (Task 2), `genTarget`, `genTargetLabel`, `inpaint`, existing gen panel.
- Produces (script-local refs used by Task 5): `genMode: Ref<'style'|'scene'>`, `genStyle: Ref<StyleItem | null>`, `styleList` (from `useStyleList`).

- [ ] **Step 1: Add state**

In `CompositorModal.vue`, just after `const genPrompt = ref('')` (line 1258), add:

```ts
// Generate Object: new-layer generation has two modes — Style (prompt, optional
// trained LoRA) and Scene (fit the existing frame). Both output a transparent
// cutout. Only shown when there's no target image (i.e. making a NEW layer).
type GenMode = 'style' | 'scene'
const genMode = ref<GenMode>('style')
const styleList = useStyleList()
const genStyle = ref<import('~/composables/useStyleList').StyleItem | null>(null)
const stylePickerOpen = ref(false)
```

- [ ] **Step 2: Load styles when entering gen mode**

In `enterGenMode()` (line 1301), add `styleList.refresh()` and reset the picker. Change the body so it ends with:

```ts
  genActive.value = true
  genTargetId.value = sel
  genStyle.value = null
  stylePickerOpen.value = false
  styleList.refresh()
  clearGenMask()
```

- [ ] **Step 3: Add the toggle + picker to the template**

In the gen panel, insert this block **between** the `<!-- Target -->` div (closes at line 2084) and the `<!-- Region tool -->` div (opens line 2086). It renders only when making a new layer (`!genTarget`):

```vue
          <!-- Mode + style (new-object generation only) -->
          <template v-if="!genTarget">
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Mode</div>
              <div class="flex items-center gap-1 p-0.5 rounded-md bg-white/[0.05]">
                <button
                  class="flex-1 h-7 rounded text-[11px] cursor-pointer transition-colors"
                  :class="genMode === 'style' ? 'bg-white text-neutral-900 font-medium' : 'text-white/70 hover:bg-white/10'"
                  @click="genMode = 'style'">Style</button>
                <button
                  class="flex-1 h-7 rounded text-[11px] cursor-pointer transition-colors"
                  :class="genMode === 'scene' ? 'bg-white text-neutral-900 font-medium' : 'text-white/70 hover:bg-white/10'"
                  @click="genMode = 'scene'">Scene</button>
              </div>
              <p class="text-[10px] text-white/35 mt-1.5">
                {{ genMode === 'style' ? 'Generate from your prompt (optionally a trained style).' : 'Fit the new object to the existing frame.' }}
              </p>
            </div>

            <!-- Style picker (Style mode) -->
            <div v-if="genMode === 'style'">
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Style</div>
              <button
                class="w-full h-8 px-2 rounded-md bg-white/[0.06] hover:bg-white/12 text-[12px] flex items-center gap-2 cursor-pointer"
                @click="stylePickerOpen = !stylePickerOpen">
                <img v-if="genStyle?.coverUrl" :src="genStyle.coverUrl" class="size-5 rounded object-cover" />
                <span class="truncate text-left flex-1">{{ genStyle ? genStyle.name : 'None (flux-schnell)' }}</span>
                <button v-if="genStyle" class="text-white/40 hover:text-white/80" title="Clear" @click.stop="genStyle = null"><X class="size-3" /></button>
              </button>
              <div v-if="stylePickerOpen" class="mt-1 max-h-40 overflow-y-auto rounded-md bg-neutral-900 border border-white/10 flex flex-col">
                <button class="h-8 px-2 text-left text-[12px] hover:bg-white/10 cursor-pointer"
                  @click="genStyle = null; stylePickerOpen = false">None (flux-schnell)</button>
                <button v-for="s in styleList.styles.value" :key="s.filename"
                  class="h-8 px-2 text-left text-[12px] hover:bg-white/10 cursor-pointer flex items-center gap-2"
                  @click="genStyle = s; stylePickerOpen = false">
                  <img v-if="s.coverUrl" :src="s.coverUrl" class="size-5 rounded object-cover" />
                  <span class="truncate">{{ s.name }}</span>
                </button>
                <p v-if="!styleList.styles.value.length" class="px-2 py-2 text-[11px] text-white/30">
                  {{ styleList.loading.value ? 'Loading…' : 'No trained styles yet.' }}
                </p>
              </div>
            </div>
          </template>
```

(`X` is already imported in this file — it's used at line 2077.)

- [ ] **Step 4: Verify it renders (screenshot)**

Start the app (preview_start or the dev servers), open a project with a Frame, open the modal, click the Generate-in-region toolbar button, and confirm:
- With nothing selected: the **Mode** (Style/Scene) toggle and **Style** picker appear above the Region tools.
- Opening the picker lists styles (or "No trained styles yet.").
- With an image layer selected before entering: the toggle/picker are hidden (target = that image).

Take a `preview_screenshot` of the panel. Check `preview_console_logs` for errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): Generate Object — Style/Scene toggle + style picker UI"
```

---

### Task 5: Wire the new-object generation (Style/Scene + always-cutout)

Replace the "no target → text2img" branch of `runRegionFill` so a new object is generated per the selected mode and always placed as a transparent cutout. The "target image selected → flux-fill inpaint" branch is left exactly as-is.

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (`runRegionFill`, lines ~1465–1483)

**Interfaces:**
- Consumes: `genMode`, `genStyle` (Task 4); `inpaint.loraGen` (Task 3); existing `inpaint.text2img/fluxFill/removeBackground/uploadDataUrl`, `renderStaticComposite`, `genMaskBounds`, `pickAspectRatio`, `capDims`, `loadImage`, `imageToDataUrl`, `addImageFromName`, `canvasDisplay`.

- [ ] **Step 1: Replace the else-branch body**

In `runRegionFill`, replace the entire `else { ... }` block (the comment starting "No image selected" through the `addImageFromName(...)` call, lines ~1465–1483) with:

```ts
    } else {
      // No target image → generate a BRAND-NEW object, sized to the painted
      // region's bbox, and drop it in as a new transparent cutout layer.
      const W = canvasDisplay.w, H = canvasDisplay.h
      const bnd = genMaskBounds(); if (!bnd) return
      const cx = (bnd.minX + bnd.maxX) / 2, cy = (bnd.minY + bnd.maxY) / 2
      const boxW = Math.max(1, bnd.maxX - bnd.minX), boxH = Math.max(1, bnd.maxY - bnd.minY)
      const prompt = genPrompt.value.trim() || 'subject'
      const aspect = pickAspectRatio(boxW / boxH)

      // 1) Generate the raw image for the object.
      let raw: string | undefined
      if (genMode.value === 'scene') {
        // Inpaint the box region of the current composite so the result matches
        // the scene, then crop the box out for cutting.
        const compBlob = await renderStaticComposite(W, H); if (!compBlob) return
        const compImg = await loadImage(URL.createObjectURL(compBlob))
        const { w: capW, h: capH } = capDims(W, H)
        const imageData = imageToDataUrl(compImg, capW, capH)
        const mc = document.createElement('canvas'); mc.width = capW; mc.height = capH
        const mctx = mc.getContext('2d')!
        mctx.fillStyle = '#000'; mctx.fillRect(0, 0, capW, capH)        // BLACK = keep
        if (genMaskCanvas) mctx.drawImage(genMaskCanvas, 0, 0, capW, capH) // WHITE region = generate
        const filled = await inpaint.fluxFill(imageData, mc.toDataURL('image/png'), prompt)
        if (!filled.length) return
        const r0 = await loadImage(filled[0])
        const sx = (bnd.minX / W) * capW, sy = (bnd.minY / H) * capH
        const sw = (boxW / W) * capW, sh = (boxH / H) * capH
        const crop = document.createElement('canvas')
        crop.width = Math.max(1, Math.round(sw)); crop.height = Math.max(1, Math.round(sh))
        crop.getContext('2d')!.drawImage(r0, sx, sy, sw, sh, 0, 0, crop.width, crop.height)
        raw = crop.toDataURL('image/png')
      } else if (genStyle.value) {
        const r = await inpaint.loraGen(genStyle.value.filename, prompt, aspect)
        raw = r[0]
      } else {
        const r = await inpaint.text2img(prompt, aspect)
        raw = r[0]
      }
      if (!raw) return

      // 2) Always cut out → transparent object, then place sized to the box.
      const cutout = await inpaint.removeBackground(raw)
      const gi = await loadImage(cutout)
      const genAspect = (gi.naturalWidth || 1) / (gi.naturalHeight || 1)
      const name = await inpaint.uploadDataUrl(cutout, 'compobj')
      const lw = boxW / W
      addImageFromName(name, genAspect, { x: cx / W, y: cy / H, w: lw, h: lw / genAspect })
    }
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i CompositorModal || echo "ok"`
Expected: `ok`.

- [ ] **Step 3: Visual end-to-end verification (requires a Replicate token)**

Per project convention, sign off visually — unit tests don't cover this. Ensure a Replicate token is set (Settings → AI). In the modal, with nothing selected, enter Generate mode, set Region = **box**, drag a box, then:
- **Style, no style picked:** prompt e.g. "a red sneaker", Generate → a transparent sneaker lands in the box as a new layer; move/scale it to confirm it's a normal image layer with no background. `preview_screenshot`.
- **Style + a trained style** (if one exists): pick a style, Generate → object reflects the style; cutout placed. `preview_screenshot`.
- **Scene:** switch to Scene, prompt e.g. "a potted plant", Generate → object's lighting/palette fits the frame; cutout placed. `preview_screenshot`.
- Confirm `removeImageBg`/existing inpaint-on-selected-image still works (select an image, enter Generate, brush, Generate → in-place inpaint unchanged).
Check `preview_console_logs` for errors after each run.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): Generate Object — Style/Scene generation with transparent cutout"
```

---

### Task 6: Final polish + sign-off

**Files:** none new — small UX touches if Task 5 verification surfaced any.

- [ ] **Step 1: Re-run unit tests**

Run: `cd frontend && npm run test:unit`
Expected: PASS — including `loraPrompt` and `useStyleList` suites.

- [ ] **Step 2: Confirm the Generate button copy/affordance**

The existing panel's Generate button (line 2124) and busy state (`inpaint.busy.value`) already drive the new path. Confirm the empty-state hint ("Mark a region on the canvas to enable Generate.") and error line (`inpaint.error.value`) render for the new path. Adjust the placeholder text on the prompt textarea (line 2113) to `what object to generate…` for clarity.

- [ ] **Step 3: Get user sign-off on the look/behavior** (screenshots from Task 5).

- [ ] **Step 4: Commit any polish**

```bash
git add -A
git commit -m "polish(compositor): Generate Object copy + sign-off"
```

---

## Self-Review

**Spec coverage:**
- Drag a box → describe → new object: Task 4 (box already exists) + Task 5. ✓
- Style mode + trained LoRA selection: Tasks 1–3 (route, style list, client call) + 4 (picker) + 5 (wiring). ✓
- Scene mode (fits the frame): Task 5 (composite flux-fill + crop). ✓
- Transparent cutout in both modes: Task 5 (always `removeBackground`). ✓
- Additive, never replaces: Task 5 only touches the no-target branch, places via `addImageFromName`. ✓
- Modal only; cost-conscious (one image, on-demand pricey paths): Constraints + Task 5. ✓
- `recordAsset` from the original spec is intentionally **omitted** — the existing Generative Fill new-layer path doesn't record assets (these are baked into the frame, not standalone gallery items); matching the surrounding pattern keeps it consistent. Noted as a deliberate deviation.

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `buildLoraPrompt`, `selectGeneratableStyles`, `StyleItem`, `loraGen`, `genMode`, `genStyle` names are used identically across tasks. `loraGen` added to the `useInpaint` return (Task 3) before it's consumed (Task 5). ✓
