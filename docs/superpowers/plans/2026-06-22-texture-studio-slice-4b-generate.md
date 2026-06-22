# Texture Studio — Slice 4b (Generate-from-prompt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In raster mode, let the user type a prompt and **generate** the cell image in-studio (Replicate Flux-schnell), which then becomes the raster source and tiles seamlessly via the existing 4a mirror/feather. Paid (1 cheap Flux-schnell call per generate).

**Architecture:** Reuse the existing `POST /api/inpaint/text2img` route (`runReplicate('black-forest-labs/flux-schnell', {prompt, aspect_ratio})` → `{ images: dataURL[] }`). The surface's Generate handler calls it (aspect `1:1`), uploads the returned data URL to `input/` via `/upload/image` (→ filename), sets `params.rasterSrc`, records the asset, loads it, and re-renders. No backend changes; the generated image flows through the already-built raster pipeline. Prompt persists in `params.texturePrompt`.

**Tech Stack:** Nuxt 4 / Vue 3 / TS. Reuses `/api/inpaint/text2img`, `/upload/image`, `recordAsset`, `loadRaster` (raster.ts), and 4a's seamless rendering. No new backend route, no model changes.

---

## Background (verified)
- `frontend/server/api/inpaint/text2img.post.ts`: `POST /api/inpaint/text2img` body `{ prompt, aspect_ratio='1:1', count=1, seed? }` → `{ images: string[] }` (base64 data URLs). Uses `requireReplicateToken()` (env `NUXT_REPLICATE_TOKEN` / Settings). Flux-schnell, 4-step, 1 MP.
- Surface already has: `params` reactive, `recordAsset`, `activeTab`, `renderPreview`, `loadRaster`/`getRaster` import, the raster `#preview` control block (Import button), and the onParam/loadParams raster-restore wiring.
- Generated image is NOT seamless on its own — 4a's mirror/feather tiles it (same as an imported image).

---

## Task 1: Generate UI + handler in the surface

**Files:** Modify `frontend/app/components/vue-canvas/TextureStudioSurface.vue`

- [ ] **Step 1: Add a generating ref + the generate handler** (near `onImportFile`):
```typescript
const generating = ref(false)
const genError = ref('')

async function onGenerate() {
  const prompt = String(params.texturePrompt ?? '').trim()
  if (!prompt || generating.value) return
  generating.value = true; genError.value = ''
  try {
    const res = await $fetch<{ images?: string[] }>('/api/inpaint/text2img', {
      method: 'POST',
      body: { prompt, aspect_ratio: '1:1', count: 1 },
    })
    const dataUrl = res?.images?.[0]
    if (!dataUrl) { genError.value = 'No image returned'; return }
    // upload the data URL into input/ → filename (unique name = fresh cache key)
    const blob = await (await fetch(dataUrl)).blob()
    const name = `texgen_${Date.now()}.png`
    const fd = new FormData()
    fd.append('image', new File([blob], name, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const up = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!up.ok) { genError.value = 'Upload failed'; return }
    const d = await up.json() as { name?: string; subfolder?: string }
    const fname = d.subfolder ? `${d.subfolder}/${d.name}` : (d.name ?? name)
    params.rasterSrc = fname
    await recordAsset(activeTab.value?.projectUuid, 'image', fname)
    await loadRaster(fname)
    renderPreview()
  } catch (e: any) {
    console.error('[texture] generate failed', e)
    genError.value = e?.statusMessage || e?.message || 'Generate failed'
  } finally { generating.value = false }
}
```
> `$fetch` is Nuxt's auto-imported fetch. The data URL → blob via `fetch(dataUrl).blob()` is standard. Unique `texgen_<ts>.png` name avoids stale-cache reuse (same fix as 4a import).

- [ ] **Step 2: Add the prompt field + Generate button to the raster `#preview` block.** In the existing `v-if="params.mode === 'raster'"` control area (next to the Import button), add a prompt input + Generate button. Match the existing studio input styling:
```vue
        <div v-if="params.mode === 'raster'" class="flex w-full max-w-[420px] items-center gap-2 text-xs">
          <input
            v-model="params.texturePrompt"
            type="text"
            placeholder="Describe a texture to generate…"
            class="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-white/90 placeholder:text-white/35"
            @keydown.enter="onGenerate"
          >
          <button
            type="button"
            class="shrink-0 rounded border border-white/15 px-2 py-1 transition-colors hover:bg-white/10 disabled:opacity-50"
            :disabled="generating || !String(params.texturePrompt ?? '').trim()"
            @click="onGenerate"
          >{{ generating ? 'Generating…' : 'Generate' }}</button>
        </div>
        <p v-if="genError" class="text-[10px] text-red-300">{{ genError }}</p>
```
(Place this near/after the existing Import-image row inside the raster block. Keep the Import button — Import and Generate are both ways to set the raster source.)

- [ ] **Step 3: Typecheck** — `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep TextureStudioSurface || echo clean`.

- [ ] **Step 4: Commit** — `git commit -m "feat(texture-studio): generate raster from a prompt (Flux-schnell)"`

---

## Task 2: Spec + code-quality review
- [ ] Dispatch a combined review of the diff: confirm the handler reuses `/api/inpaint/text2img` correctly (body shape, data-URL→upload→filename, rasterSrc set, recordAsset, loadRaster, renderPreview), error/disabled states, prompt persistence via `params.texturePrompt`, unique upload name, no regression to import/seamless/stylize paths. Fix any Critical/Important findings.

---

## Task 3: Functional sign-off (one real generation)
> Paid — the user authorized 4b. Spend ONE Flux-schnell call to verify end-to-end.
- [ ] **Step 1:** Confirm a Replicate token is configured: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3002/api/inpaint/text2img -H 'content-type: application/json' -d '{"prompt":"seamless small floral pattern, flat vector, two colors"}'` — expect 200 (or read the error; if 401/500 token-missing, NOTE it and skip the live gen, since infra not creds is the blocker).
- [ ] **Step 2:** If 200: build a temp harness page that calls the same flow (text2img → upload → loadRaster → render mode=raster mirror, 2×2) for one prompt, screenshot, confirm the generated texture renders as a seamless tile. (Or drive the real surface via Playwright: open a TextureStudio node, switch to raster, type a prompt, click Generate, screenshot the seamless preview.)
- [ ] **Step 3:** Present the screenshot + self-sign-off if clean. Remove any temp harness, run `npm run test:unit`, commit (`--allow-empty`).

---

## Self-review (completed)
- **Spec coverage:** generate-from-prompt content source (the 2nd raster source the user picked) via the existing Flux-schnell route; the generated image tiles via 4a's mirror/feather. AI-seamless tier-3 (true circular-padding) = Slice 5 (separate; blocked on local models).
- **Placeholders:** none; complete handler + template code.
- **Type consistency:** reuses `/api/inpaint/text2img`'s real `{ images }` shape; `params.texturePrompt` is a new free param (persists via saveParams' `{...params}` spread; defaults to '' via `?? ''`); `rasterSrc`/`recordAsset`/`loadRaster` already wired in 4a.
- **Cost:** 1 Flux-schnell call per Generate click (cheap, ~4-step). Disabled while generating + when prompt empty. Errors surfaced in `genError`.
- **Reuse / no backend change:** no new route or model; the generated image flows through the existing raster + seamless + stylize pipeline unchanged.
