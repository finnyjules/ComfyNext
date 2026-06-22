# Texture Studio — Slice 4a (Raster import + seamless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `raster` content mode: import an image, and the WebGL renderer makes it seamlessly tileable via tier-2 methods — **mirror** (triangle-wave, guaranteed clean) or **feather** (offset-wrap + cross-fade-healed center seam). No backend/generation (that's Slice 4b).

**Architecture:** A new `texturefx/raster.ts` holds a module-level image cache (`loadRaster(filename)` async + `getRaster(filename)` sync) and the pure, unit-tested seamless UV mapping (`rasterSampleUV(method, u, v, scale)`). The renderer gains a raster branch: when `mode='raster'`, it uploads the cached image as an RGBA texture (mirroring shaderfx's `uploadTexture`: RGBA8, `UNPACK_FLIP_Y_WEBGL`, LINEAR, CLAMP) on texture unit 1 and samples it with the seamless mapping; no image → background. Stylize (Slice 3) still composites on top. Import uses the existing `/upload/image` POST → filename stored in params (filename-only, like Gradient Studio's baseImage); image loads from `/view?filename=…&type=input`.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2, Vitest. Reuses `/upload/image`, `/view`, `recordAsset`, and the shaderfx texture-upload idiom.

---

## Slice roadmap
- Slices 1–3 shipped (procedural + Truchet + placement + multiscale + stylize).
- **Slice 4a (this plan):** raster import → seamless (mirror/feather).
- Slice 4b: generate-from-prompt (paid backend). Slice 5: AI-seamless (local Flux). Slice 6: SVG/video.

---

## Background (verified patterns)
- **Upload:** `POST /upload/image` (FormData `image` + `overwrite='true'`) → `{ name, subfolder }`; filename = `subfolder ? subfolder/name : name`. File-picker idiom: `KitPanel.vue:14-26`.
- **Load:** `/view?${new URLSearchParams({ filename, type: 'input' })}` → `new Image()` + onload (`useCompositorLayers.ts:379-395`, image-cache precedent).
- **Texture upload (shaderfx `renderer.ts:133-145`):** `gl.pixelStorei(UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(TEXTURE_2D, 0, RGBA8, RGBA, UNSIGNED_BYTE, src); pixelStorei(…, false)`; LINEAR; CLAMP_TO_EDGE.
- **Persist filename only:** store in `node.data.properties.comfynext_textureStudio` (Gradient Studio baseImage precedent). `recordAsset(projectUuid, 'image', filename)` to surface it in Assets.
- Current `MODES = ['procedural','truchet']`; renderer already manages `u_stateTex` on unit 0 + a fullscreen-triangle program.

**Seamless invariant for raster:** the sampled texture coord must match at opposite tile edges → `rasterSampleUV(m,0,v)≈rasterSampleUV(m,1,v)` and `(m,u,0)≈(m,u,1)`. Mirror: `tri(x)=abs(2*fract(x)-1)` (tri(0)=tri(1)=1). Feather: `fract(x+0.5)` (0.5 at both 0 and 1) + a position-symmetric heal blend.

---

## File structure
- Modify `types.ts` — add `'raster'` to `MODES`; `SEAM_METHODS = ['mirror','feather']`.
- Modify `controls.ts` — raster controls (seamMethod/feather/rasterScale, when raster); hide lattice/cells/content/truchet when raster.
- Modify `sections.ts` — add `'Raster'`.
- Create `texturefx/raster.ts` — image cache + `rasterSampleUV` (pure).
- Modify `renderer.ts` — raster texture (unit 1) + shader raster branch.
- Modify `TextureStudioSurface.vue` — Import button + load-on-change + re-render; node card load.
- Create `tests/unit/texturefx-raster.unit.spec.ts`; modify `texturefx-controls.unit.spec.ts`.

---

## Task 1: Controls — raster mode + seam controls

**Files:** `types.ts`, `sections.ts`, `controls.ts`, `tests/unit/texturefx-controls.unit.spec.ts`

- [ ] **Step 1: types.ts** — change `MODES` and add seam methods:
```typescript
export const MODES = ['procedural', 'truchet', 'raster'] as const
export const SEAM_METHODS = ['mirror', 'feather'] as const
export type SeamMethod = typeof SEAM_METHODS[number]
```

- [ ] **Step 2: sections.ts** — add `'Raster'` after `'Truchet'`:
```typescript
export const TEXTURE_SECTIONS = ['Lattice', 'Cell', 'Content', 'Truchet', 'Raster', 'Stylize', 'Color', 'Output'] as const
```

- [ ] **Step 3: controls.ts** — add `SEAM_METHODS` to the types import. Add an `isRaster` helper next to `isProcedural`/`isTruchet`:
```typescript
const isRaster = (p: Params) => String(p.mode) === 'raster'
```
Gate the Lattice `cells`/`lattice` controls so they hide for raster (raster is whole-tile, no lattice). Update their entries to add `when: (p) => !isRaster(p)`:
```typescript
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice', when: (p) => !isRaster(p) },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice', when: (p) => !isRaster(p) },
```
Append the raster controls (after the Color block):
```typescript
  { key: 'seamMethod', label: 'Seamless method', kind: 'select', options: [...SEAM_METHODS], default: 'mirror', group: 'Raster', when: isRaster },
  { key: 'feather', label: 'Seam feather', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.15, group: 'Raster', when: (p) => isRaster(p) && String(p.seamMethod) === 'feather' },
  { key: 'rasterScale', label: 'Image scale', kind: 'slider', min: 0.25, max: 4, step: 0.05, default: 1, group: 'Raster', when: isRaster },
```
(`rasterSrc` filename is NOT a ControlSpec — it's set by the Import button in the surface and stored in params directly.)

- [ ] **Step 4: controls test** — append:
```typescript
  it('raster controls reveal; lattice hidden for raster', () => {
    const proc = textureDefaults()
    const ras = { ...textureDefaults(), mode: 'raster' }
    const rasFeather = { ...textureDefaults(), mode: 'raster', seamMethod: 'feather' }
    const find = (k: string) => TEXTURE_CONTROLS.find((c) => c.key === k)!
    expect(find('seamMethod').when!(proc)).toBe(false)
    expect(find('seamMethod').when!(ras)).toBe(true)
    expect(find('lattice').when!(ras)).toBe(false)
    expect(find('lattice').when!(proc)).toBe(true)
    expect(find('feather').when!(ras)).toBe(false)          // mirror default
    expect(find('feather').when!(rasFeather)).toBe(true)
  })
```

- [ ] **Step 5: Run** — `cd frontend && npx vitest run tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(texture-studio): raster mode + seam controls (mirror/feather)"`

---

## Task 2: `raster.ts` — image cache + seamless UV (pure)

**Files:** Create `frontend/app/lib/texturefx/raster.ts`; Test `frontend/tests/unit/texturefx-raster.unit.spec.ts`

- [ ] **Step 1: Failing test:**
```typescript
import { describe, expect, it } from 'vitest'
import { rasterSampleUV } from '~/lib/texturefx/raster'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe('rasterSampleUV seamlessness', () => {
  for (const method of ['mirror', 'feather'] as const) {
    it(`${method} sample coord matches opposite edges`, () => {
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        const [x0] = rasterSampleUV(method, 0, t, 1)
        const [x1] = rasterSampleUV(method, 1, t, 1)
        const [, y0] = rasterSampleUV(method, t, 0, 1)
        const [, y1] = rasterSampleUV(method, t, 1, 1)
        expect(close(x0, x1), `x @ v=${t}`).toBe(true)
        expect(close(y0, y1), `y @ u=${t}`).toBe(true)
      }
    })
  }
  it('mirror is a triangle wave (0→ edges map to 1)', () => {
    expect(close(rasterSampleUV('mirror', 0, 0, 1)[0], 1)).toBe(true)
    expect(close(rasterSampleUV('mirror', 0.5, 0.5, 1)[0], 0)).toBe(true)
  })
  it('scale zooms about the centre (scale 2 halves the sampled span)', () => {
    // at u=0.5 the sample is the image centre regardless of scale
    expect(close(rasterSampleUV('feather', 0.5, 0.5, 2)[0], rasterSampleUV('feather', 0.5, 0.5, 1)[0])).toBe(true)
  })
})
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `raster.ts`:**
```typescript
const fract = (x: number) => x - Math.floor(x)
const tri = (x: number) => Math.abs(2 * fract(x) - 1) // seamless triangle wave: tri(0)=tri(1)=1

/**
 * Seamless texture coord (0..1) to sample for tile uv (u,v). `scale` zooms about
 * the tile centre. mirror → triangle wave (clean, mirrored). feather → half-tile
 * offset so the image seam lands at tile centre (edges become the image interior,
 * already continuous); the shader cross-fades the centre band to hide it.
 */
export function rasterSampleUV(method: string, u: number, v: number, scale: number): [number, number] {
  const s = scale > 0 ? scale : 1
  // zoom about centre, wrap into [0,1)
  const zu = fract((u - 0.5) / s + 0.5)
  const zv = fract((v - 0.5) / s + 0.5)
  if (method === 'feather') return [fract(zu + 0.5), fract(zv + 0.5)]
  return [tri((u - 0.5) / s + 0.5), tri((v - 0.5) / s + 0.5)]
}

// --- image cache ---
const _cache = new Map<string, HTMLImageElement>()

export function rasterViewUrl(filename: string): string {
  return `/view?${new URLSearchParams({ filename, type: 'input' })}`
}

/** Load (and cache) the imported raster image. Resolves when decoded (or on error). */
export function loadRaster(filename: string): Promise<void> {
  if (!filename) return Promise.resolve()
  const url = rasterViewUrl(filename)
  const cached = _cache.get(filename)
  if (cached && cached.complete && cached.naturalWidth) return Promise.resolve()
  return new Promise<void>((res) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { _cache.set(filename, img); res() }
    img.onerror = () => res()
    img.src = url
  })
}

/** Cached, fully-decoded image for `filename`, or null if not loaded yet. */
export function getRaster(filename: string): HTMLImageElement | null {
  const img = _cache.get(filename)
  return img && img.complete && img.naturalWidth ? img : null
}
```
> NOTE: mirror uses `tri(...)` directly (not `fract`-then-tri) so the triangle wave is continuous across the wrap; feather uses the wrapped `zu/zv`. The test asserts both are edge-seamless.

- [ ] **Step 4: Run, confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(texture-studio): raster.ts — image cache + seamless mirror/feather UV"`

---

## Task 3: Renderer raster branch (image texture + seamless shader)

**Files:** `renderer.ts`

- [ ] **Step 1: Read** the current `renderer.ts` (shader uniform block, the `u_mode` ladder, `render()` uniform-setting + state-texture upload, `ensure()` one-time init). Note `MODES` import.

- [ ] **Step 2: Add uniforms + a raster texture (unit 1).** In the FS uniform block add:
```glsl
uniform sampler2D u_rasterTex;
uniform float u_hasRaster, u_seamMethod, u_feather, u_rasterScale;
```
Add a GLSL helper above `main()`:
```glsl
float u_fract(float x){ return x - floor(x); }
float u_tri(float x){ return abs(2.0*u_fract(x)-1.0); }
```

- [ ] **Step 3: Raster branch in `main()`** — at the very top of the mode dispatch (before procedural/truchet), add:
```glsl
  if (u_mode > 1.5) { // raster (MODES index 2)
    if (u_hasRaster < 0.5) { frag = vec4(u_bg, 1.0); return; }
    float zu = u_fract((v_uv.x - 0.5)/u_rasterScale + 0.5);
    float zv = u_fract((v_uv.y - 0.5)/u_rasterScale + 0.5);
    vec3 col;
    if (u_seamMethod > 0.5) { // feather: offset-wrap + cross-fade heal at the centre seam
      vec2 a = vec2(u_fract(zu + 0.5), u_fract(zv + 0.5));
      col = texture(u_rasterTex, a).rgb;
      // heal the seam that now sits at the tile centre (zu/zv near 0.5)
      float fx = smoothstep(0.5 - u_feather, 0.5, zu) * (1.0 - smoothstep(0.5, 0.5 + u_feather, zu));
      float fy = smoothstep(0.5 - u_feather, 0.5, zv) * (1.0 - smoothstep(0.5, 0.5 + u_feather, zv));
      float m = max(fx, fy);
      vec3 mir = texture(u_rasterTex, vec2(u_tri((v_uv.x-0.5)/u_rasterScale+0.5), u_tri((v_uv.y-0.5)/u_rasterScale+0.5))).rgb;
      col = mix(col, mir, m); // blend toward the seam-free mirror sample across the feather band
    } else { // mirror: triangle wave → seamless by construction
      col = texture(u_rasterTex, vec2(u_tri((v_uv.x-0.5)/u_rasterScale+0.5), u_tri((v_uv.y-0.5)/u_rasterScale+0.5))).rgb;
    }
    frag = vec4(col, 1.0);
    return;
  }
```
(Mirror branch math equals `rasterSampleUV('mirror',…)`; feather's primary sample equals `rasterSampleUV('feather',…)`, with the heal blend added.)

- [ ] **Step 4: Class field + texture in `ensure()`** — add `private rasterTex?: WebGLTexture`. In the one-time init guard create it with LINEAR + CLAMP_TO_EDGE (mirror/feather is done in-shader, so wrap mode is irrelevant; CLAMP is safe).

- [ ] **Step 5: Upload the image + set uniforms in `render()`** — import `getRaster` from `~/lib/texturefx/raster` and `MODES` (already imported). Add:
```typescript
    const raster = String(p.mode) === 'raster'
    const rimg = raster ? getRaster(String(p.rasterSrc ?? '')) : null
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.rasterTex!)
    if (rimg) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, rimg)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    }
    gl.uniform1i(u('u_rasterTex'), 1)
    gl.uniform1f(u('u_hasRaster'), rimg ? 1 : 0)
    gl.uniform1f(u('u_seamMethod'), Math.max(0, ['mirror', 'feather'].indexOf(String(p.seamMethod))))
    gl.uniform1f(u('u_feather'), Number(p.feather) || 0.15)
    gl.uniform1f(u('u_rasterScale'), Number(p.rasterScale) || 1)
```
> Set the LINEAR/CLAMP params on `rasterTex` once in `ensure()` (re-uploading via `texImage2D` keeps params). The 1×1 black placeholder keeps the sampler complete when no image. `u_hasRaster=0` → shader fills `u_bg`. Texture unit 1 (state texture stays on unit 0).

- [ ] **Step 6: Typecheck** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep texturefx/renderer || echo clean`.
- [ ] **Step 7: Commit** — `git commit -m "feat(texture-studio): renderer raster branch (image texture + seamless mirror/feather)"`

---

## Task 4: Surface Import button + wiring; node card

**Files:** `TextureStudioSurface.vue`, `TextureStudioNode.vue`

- [ ] **Step 1: Surface — import handler + raster load.** Import `{ loadRaster, getRaster }` from `~/lib/texturefx/raster`. Add a hidden `<input type="file" accept="image/*">` + an "Import image" button shown in the preview area when `params.mode === 'raster'`. Handler (mirrors `KitPanel.vue`):
```typescript
const fileInput = ref<HTMLInputElement | null>(null)
async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const fd = new FormData(); fd.append('image', file); fd.append('overwrite', 'true')
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) return
    const data = await res.json() as { name?: string; subfolder?: string }
    const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
    if (!name) return
    params.rasterSrc = name
    await recordAsset(activeTab.value?.projectUuid, 'image', name)
    await loadRaster(name)
    renderPreview()
  } catch (err) { console.error('[texture] import failed', err) }
}
```
- In `loadParams()` (after merging), if `params.mode === 'raster' && params.rasterSrc`, call `loadRaster(String(params.rasterSrc)).then(renderPreview)` so a saved raster node restores its image.
- In `onParam()` (the control-change hook), if mode just became raster with a src not yet cached, `loadRaster(...).then(renderPreview)`.
- Template: in the preview block, when `params.mode==='raster'`, show the Import button (and the current filename if set). Wire `@change="onImportFile"` on the file input, button `@click="fileInput?.click()"`.

- [ ] **Step 2: Node card — load saved raster.** Import `{ loadRaster, getRaster }`. In `onMounted` (and the params watcher), if `params.value.mode==='raster' && params.value.rasterSrc && !getRaster(String(params.value.rasterSrc))`, call `loadRaster(String(params.value.rasterSrc)).then(renderFrame)`.

- [ ] **Step 3: Typecheck** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TextureStudio(Surface|Node)" || echo clean`.
- [ ] **Step 4: Commit** — `git commit -m "feat(texture-studio): raster import button + load/restore wiring"`

---

## Task 5: Visual verification + sign-off

> Controller-driven. Make seamlessness undeniable: generate a deliberately NON-seamless test image (a diagonal gradient with a sharp edge, drawn to a canvas → upload), set it as the raster source, then render mode=raster under mirror + feather (varied scale), each tiled 2×2. Confirm: (a) the raw image's hard seam disappears, (b) the 2×2 has no discontinuity at tile mid-lines for BOTH methods, (c) scale zooms, (d) stylize (e.g. dither) still composites on top of raster.

- [ ] **Step 1:** Temp harness page: build a non-seamless test image on a canvas (diagonal gradient + a bright corner), upload it via `/upload/image`, `await loadRaster(name)`, then render swatches: `mirror`, `feather (feather 0.15)`, `feather (0.3)`, `mirror scale 2`, and `mirror + stylize dither` — each `stylizeTile(textureFx.render({mode:'raster', rasterSrc:name, …}, 512,512,0), …)` drawn 2×2 at 512².
- [ ] **Step 2:** Screenshot (Playwright, domcontentloaded + waitForFunction on figures + delay for upload/load, dpr 2, fullPage). Confirm no seams, effects compose.
- [ ] **Step 3:** Present + self-sign-off if clean (or get user sign-off). Iterate the feather heal (band width / blend) if the center seam shows.
- [ ] **Step 4:** Remove harness, full `npm run test:unit`, commit (`--allow-empty`).

---

## Self-review (completed)
- **Spec coverage:** raster content = import an image (the first content source the user picked) + cheap seamless tiers (tier-2 mirror/feather). Generate-from-prompt (tier-2 raster from AI) = Slice 4b; AI-seamless tier-3 = Slice 5. Noted.
- **Placeholders:** none; complete code + expected outputs.
- **Type consistency:** `'raster'` added to `MODES` (index 2 → shader `u_mode>1.5`); `SEAM_METHODS` (index → `u_seamMethod`); `rasterSampleUV`/`loadRaster`/`getRaster`/`rasterViewUrl` defined in Task 2, consumed by renderer (Task 3) + surface/card (Task 4); control keys (`seamMethod`,`feather`,`rasterScale`,`rasterSrc`) consistent across controls/renderer/surface; the mirror shader math equals `rasterSampleUV('mirror',…)`, feather's primary sample equals `rasterSampleUV('feather',…)`.
- **Seamlessness:** mirror = triangle wave (edges→1, seamless by construction); feather = half-offset (edges = image interior) + centre cross-fade heal. Task 2 unit-tests the sample-coord edge-match for both; Task 5 verifies visually with a deliberately non-seamless image.
- **Composition:** raster bypasses lattice/truchet (lattice/cells hidden via `when`); stylize (Slice 3) composites on the raster tile unchanged (stylizeTile takes the rendered canvas). State texture stays on unit 0, raster on unit 1 — no collision.
- **Persistence:** `rasterSrc` filename stored in params (filename-only, Gradient precedent); image re-loaded from `/view` on open. Upload via `/upload/image`; `recordAsset` surfaces it in Assets.
- **Deferred:** cell-placed raster motifs (raster is whole-tile in 4a); generate-from-prompt (4b).
