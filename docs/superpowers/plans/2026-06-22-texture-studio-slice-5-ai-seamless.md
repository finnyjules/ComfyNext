# Texture Studio — Slice 5 (AI-seamless via Replicate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** A "Make seamless (AI)" action for raster mode that turns any imported/generated image into a genuinely seamless tile by **offset-wrapping** it (so the seam moves to the center and the edges become the image interior — already continuous) and **generatively inpainting the center seam band** via Replicate flux-fill. The result is a baked, fully-seamless image rendered with a new `direct` sample mode. Cloud, paid; no local models (the specced local-Flux path is blocked — empty model dirs).

**Architecture:** Client-side: build (a) an offset-wrapped copy of the source image on a canvas (½-shift, wrapped → seamless edges, a cross-shaped seam at center) and (b) a mask canvas (white cross band at center = inpaint, black = keep). POST both to the existing `POST /api/inpaint/flux-fill` (`black-forest-labs/flux-fill-dev`, white=inpaint, preserves the rest) with the texture prompt → a healed image whose edges are still seamless and whose center seam is gone = fully seamless. Upload it (→ filename), set `rasterSrc` to it and `seamMethod` to **`direct`** (sample the image 1:1 with `fract` wrap — seamless because the pixels now match at edges). The renderer + `rasterSampleUV` gain a `direct` branch.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 (raster branch), Vitest. Reuses `/api/inpaint/flux-fill`, `/upload/image`, `recordAsset`, `loadRaster`, and 4a's raster renderer. No backend changes, no local models.

---

## Background (verified)
- `POST /api/inpaint/flux-fill` body `{ image: dataURL|url, mask: dataURL (WHITE=inpaint, BLACK=keep), prompt, tier:'dev'|'pro', count, guidance, steps, seed }` → `{ images: string[] }` (data URLs). Empty prompt = generative fill. flux-fill preserves the unmasked region.
- Raster pipeline (4a/4b): `params.rasterSrc` (filename) + `params.seamMethod` (`mirror`/`feather`) → renderer raster branch + `rasterSampleUV` (raster.ts, unit-tested). `params.texturePrompt` holds the generate prompt.
- Surface already imports `loadRaster`/`getRaster`, has `recordAsset`/`activeTab`, the raster `#preview` block, and the `onGenerate`/`onImportFile` upload idiom (unique names).

**Why this is seamless:** offset-wrap makes the tile edges = the source's interior (continuous), so the outer edges already tile. Only the center cross seam is discontinuous; inpainting *only* that band (mask) heals it while flux-fill preserves the seamless edges. The baked image is then seamless under plain `fract` wrap → `direct`.

---

## File structure
- Modify `types.ts` — add `'direct'` to `SEAM_METHODS`.
- Modify `raster.ts` — `rasterSampleUV` `direct` branch; add `buildSeamlessInputs(img, band)` → `{ image: dataURL, mask: dataURL }` (offset-wrap + cross mask) [browser canvas helper].
- Modify `renderer.ts` — shader raster branch: 3-way (mirror/feather/direct).
- Modify `TextureStudioSurface.vue` — "Make seamless (AI)" button + `onMakeSeamless` (build inputs → flux-fill → upload → rasterSrc + seamMethod='direct').
- Modify `tests/unit/texturefx-raster.unit.spec.ts` — `direct` seamless coord test.

---

## Task 1: `direct` seam method (types + rasterSampleUV + shader)

**Files:** `types.ts`, `raster.ts`, `renderer.ts`, `tests/unit/texturefx-raster.unit.spec.ts`

- [ ] **Step 1: types.ts** — `export const SEAM_METHODS = ['mirror', 'feather', 'direct'] as const`.

- [ ] **Step 2: raster.ts `rasterSampleUV`** — add a `direct` branch (sample the zoomed coord with plain wrap; seamless because the image is already seamless):
```typescript
export function rasterSampleUV(method: string, u: number, v: number, scale: number): [number, number] {
  const s = scale > 0 ? scale : 1
  const cu = (u - 0.5) / s + 0.5
  const cv = (v - 0.5) / s + 0.5
  if (method === 'direct') return [cu - Math.floor(cu), cv - Math.floor(cv)] // fract wrap
  if (method === 'feather') {
    const zu = cu - Math.floor(cu), zv = cv - Math.floor(cv)
    return [(zu + 0.5) - Math.floor(zu + 0.5), (zv + 0.5) - Math.floor(zv + 0.5)]
  }
  const tri = (x: number) => Math.abs(2 * (x - Math.floor(x)) - 1)
  return [tri(cu), tri(cv)]
}
```
(Keep behavior identical for mirror/feather — this is a refactor that adds the `direct` case. `fract(0)=0`, `fract(1)=0` → edge-seamless.)

- [ ] **Step 3: Add the seamless-input builder to raster.ts** (browser canvas; used by the surface):
```typescript
/**
 * Build the flux-fill inputs for AI-seamless: an offset-wrapped copy of `img`
 * (½-shift, wrapped → seamless edges, a cross seam at centre) and a mask whose
 * white cross band (width `band` fraction) marks the seam to inpaint.
 */
export function buildSeamlessInputs(img: HTMLImageElement, band = 0.14): { image: string, mask: string } {
  const S = Math.min(1024, Math.max(256, img.naturalWidth || 512))
  const wrap = document.createElement('canvas'); wrap.width = S; wrap.height = S
  const wx = wrap.getContext('2d')!
  // draw the image at the four half-shifted positions → half-offset wrapped tile
  for (const dx of [-S / 2, S / 2]) for (const dy of [-S / 2, S / 2]) wx.drawImage(img, dx, dy, S, S)
  const mask = document.createElement('canvas'); mask.width = S; mask.height = S
  const mc = mask.getContext('2d')!
  mc.fillStyle = '#000'; mc.fillRect(0, 0, S, S)
  const w = Math.round(S * band)
  mc.fillStyle = '#fff'
  mc.fillRect(0, S / 2 - w / 2, S, w)   // horizontal seam band
  mc.fillRect(S / 2 - w / 2, 0, w, S)   // vertical seam band
  return { image: wrap.toDataURL('image/png'), mask: mask.toDataURL('image/png') }
}
```

- [ ] **Step 4: renderer.ts** — make the shader raster branch 3-way. Replace the `if (u_seamMethod > 0.5) { feather } else { mirror }` with:
```glsl
    if (u_seamMethod > 1.5) {        // direct: image already seamless → plain wrap
      col = texture(u_rasterTex, vec2(fract(cu), fract(cv))).rgb;
    } else if (u_seamMethod > 0.5) { // feather
      vec2 a = vec2(fract(fract(cu) + 0.5), fract(fract(cv) + 0.5));
      col = texture(u_rasterTex, a).rgb;
      vec3 mir = texture(u_rasterTex, vec2(r_tri(cu), r_tri(cv))).rgb;
      float zu = fract(cu), zv = fract(cv);
      float fx = smoothstep(0.5 - u_feather, 0.5, zu) * (1.0 - smoothstep(0.5, 0.5 + u_feather, zu));
      float fy = smoothstep(0.5 - u_feather, 0.5, zv) * (1.0 - smoothstep(0.5, 0.5 + u_feather, zv));
      col = mix(col, mir, max(fx, fy));
    } else {                         // mirror
      col = texture(u_rasterTex, vec2(r_tri(cu), r_tri(cv))).rgb;
    }
```
(Mirror/feather GLSL unchanged; only a `u_seamMethod > 1.5` direct branch added. `u_seamMethod` is set from `['mirror','feather','direct'].indexOf(...)` in render() — confirm the render() indexOf array includes 'direct'; UPDATE it to `['mirror','feather','direct']`.)

- [ ] **Step 5: Update the render() seam index array** in renderer.ts: `gl.uniform1f(u('u_seamMethod'), Math.max(0, ['mirror', 'feather', 'direct'].indexOf(String(p.seamMethod))))`.

- [ ] **Step 6: Test** — append to `texturefx-raster.unit.spec.ts`: add `'direct'` to the seamless-loop method list (`for (const method of ['mirror','feather','direct'] as const)`), so the existing edge-match assertions cover it. Run `cd frontend && npx vitest run tests/unit/texturefx-raster.unit.spec.ts` → pass.

- [ ] **Step 7: Typecheck + commit** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "texturefx" || echo clean`; `git commit -m "feat(texture-studio): direct seam mode + AI-seamless input builder"`.

---

## Task 2: "Make seamless (AI)" action in the surface

**Files:** `TextureStudioSurface.vue`

- [ ] **Step 1: Import** `buildSeamlessInputs` (add to the existing `~/lib/texturefx/raster` import).

- [ ] **Step 2: Add a sealing ref + handler:**
```typescript
const sealing = ref(false)
async function onMakeSeamless() {
  const src = String(params.rasterSrc ?? '')
  if (!src || sealing.value) return
  sealing.value = true; genError.value = ''
  try {
    await loadRaster(src)
    const img = getRaster(src)
    if (!img) { genError.value = 'Image not loaded'; return }
    const { image, mask } = buildSeamlessInputs(img)
    const res = await $fetch<{ images?: string[] }>('/api/inpaint/flux-fill', {
      method: 'POST',
      body: { image, mask, prompt: String(params.texturePrompt ?? '').trim() || 'seamless continuous texture, fill to match surroundings', tier: 'dev', count: 1 },
    })
    const dataUrl = res?.images?.[0]
    if (!dataUrl) { genError.value = 'No image returned'; return }
    const blob = await (await fetch(dataUrl)).blob()
    const name = `texseam_${Date.now()}.png`
    const fd = new FormData()
    fd.append('image', new File([blob], name, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const up = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!up.ok) { genError.value = 'Upload failed'; return }
    const d = await up.json() as { name?: string; subfolder?: string }
    const fname = d.subfolder ? `${d.subfolder}/${d.name}` : (d.name ?? name)
    params.rasterSrc = fname
    params.seamMethod = 'direct'   // the baked image is already seamless
    await recordAsset(activeTab.value?.projectUuid, 'image', fname)
    await loadRaster(fname)
    renderPreview()
  } catch (e: any) {
    console.error('[texture] make-seamless failed', e)
    genError.value = e?.statusMessage || e?.message || 'Make seamless failed'
  } finally { sealing.value = false }
}
```

- [ ] **Step 3: Add the button** in the raster `#preview` block (only when a source is set):
```vue
        <button
          v-if="params.mode === 'raster' && params.rasterSrc"
          type="button"
          class="rounded border border-white/15 px-2 py-1 text-xs transition-colors hover:bg-white/10 disabled:opacity-50"
          :disabled="sealing"
          @click="onMakeSeamless"
        >{{ sealing ? 'Sealing…' : 'Make seamless (AI)' }}</button>
```
(Place near the Import/Generate controls. It bakes the current source into a perfectly-seamless `direct` tile.)

- [ ] **Step 4: Typecheck + commit** — `grep TextureStudioSurface`; `git commit -m "feat(texture-studio): Make seamless (AI) — flux-fill seam heal on offset-wrapped tile"`.

---

## Task 3: Review + functional sign-off (one real flux-fill)
- [ ] Combined spec+quality review of the diff (direct mode math + shader 3-way; buildSeamlessInputs offset-wrap+mask correctness; onMakeSeamless flow + error/disabled states; no regression to mirror/feather/import/generate).
- [ ] Functional sign-off (paid, authorized): generate or use an existing input image, run the full make-seamless flow once (build inputs → flux-fill → bake), render the baked image with `seamMethod='direct'` 2×2, and confirm the center seam is GONE and the tile is seamless (compare against the same image under plain `direct` WITHOUT healing, which should show the offset-wrap center seam). Drive via a temp harness (build inputs in-page, call flux-fill, render) or the real surface via Playwright. Self-sign-off if clean.
- [ ] Remove harness, full `npm run test:unit`, final review, update memory.

---

## Self-review (completed)
- **Spec coverage:** "AI-seamless" tier-3 delivered via Replicate (flux-fill seam-heal on an offset-wrapped tile) since local Flux is unavailable — the practical equivalent, runnable now. The local-circular-padding path remains a future option once models are installed (documented).
- **Placeholders:** none; complete code.
- **Type consistency:** `'direct'` added to `SEAM_METHODS` (index 2 → shader `u_seamMethod>1.5` + render() indexOf array updated); `rasterSampleUV` direct branch matches the shader's `fract` wrap; `buildSeamlessInputs` returns `{image,mask}` consumed by `onMakeSeamless`; `params.seamMethod='direct'` set after bake; reuses `rasterSrc`/`recordAsset`/`loadRaster`.
- **Seamlessness:** offset-wrap → seamless edges (image interior); inpaint heals ONLY the center cross (mask), flux-fill preserves edges → baked image fully seamless → `direct` (fract wrap) tiles it. `rasterSampleUV('direct')` edge-match unit-tested.
- **Cost:** one flux-fill-dev call per "Make seamless" click (disabled while sealing; errors surfaced). User authorized paid.
- **No backend change / no local model.** Stylize still composes on the baked tile.
