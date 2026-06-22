# Texture Studio — Slice 1b+1c (Region fills: image + nested-pattern) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the Slice-1a per-region fill system so each role can also be filled with an **imported image** (1b, via the Slice-4a raster pipeline) or a **nested pattern** (1c, a sub-texture rendered recursively by textureFx), in cell-local or tile-global frame, staying seamless.

**Architecture:** Both image and pattern fills resolve to a **per-role fill texture** sampled in the shader. The renderer gains 3 fill-texture units (state=unit0, raster=unit1, fill roles = units 2/3/4) and a `sampleFillTex(int r, vec2 uv)` that branches on `r` (so each `texture()` uses a constant sampler — dynamic sampler indexing is illegal in GLSL ES 3.00). `evalFill` grows image (type 2) and pattern (type 3) branches that compute a seam-handled UV and sample that role's texture. Image fills load via `loadRaster`/`getRaster` (Slice 4a). Pattern fills render a sub-config through a **separate** TextureFxRenderer instance (`patternfill.ts`, cached) to avoid reentering the main singleton, then upload the resulting canvas as the role's texture.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-region-fills-design.md`. Builds on Slice 1a (`roles.ts`, `fills.ts`, `evalFill`, Fills panel).

## Global Constraints
- Seamless per fill × frame: cell-local repeats per cell; tile-global image uses the Slice-4a seam modes (mirror/feather/direct); pattern output already tiles (sample with `fract`).
- Backward compatible: solid/gradient fills (1a) and no-fills render unchanged.
- Dynamic sampler array indexing is ILLEGAL in GLSL ES 3.00 — `sampleFillTex` MUST branch on `r` with constant sampler references.
- Pattern sub-render is ONE level: the sub-config has no `fills` (its roles are legacy solids) → no unbounded recursion. Use a SEPARATE renderer instance, never reenter the main `textureFx`.
- NO backtick / non-ASCII char anywhere in GLSL comments (JS template literal breaks).
- NEVER `git add -A` — stage explicit paths only. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Fills only apply in procedural/truchet modes; the raster-mode branch returns before evalFill (unchanged).

## Numeric fill-type codes (shader `u_fillType[r]`): solid=0, gradient=1, image=2, pattern=3.
## Texture units: state=0, raster=1, fill role0=2, role1=3, role2=4. Samplers `u_fillTex0/1/2` = units 2/3/4.

---

## Task 1: Renderer fill-texture mechanism + image (type 2) shader branch

**Files:** Modify `frontend/app/lib/texturefx/renderer.ts`.

**Interfaces — Consumes (Slice 1a/4a):** `fillForRole`, `rolesFor`, `getRaster`. **Produces:** the shader uniforms `u_fillTex0/1/2`, `u_fillSeam[3]`, `u_fillScale[3]`; per-role fill-texture binding in `render()`; `sampleFillTex`/image branch in `evalFill`.

- [ ] **Step 1: ensure() — create 3 fill textures.** Where `rasterTex` is created (~line 229), add `fillTex: WebGLTexture[]` (length 3), each a 1×1 RGBA placeholder (`new Uint8Array([128,128,128,255])`), with CLAMP_TO_EDGE + LINEAR (same params as rasterTex). Track `_lastFillSrc: (string|null)[] = [null,null,null]`.

- [ ] **Step 2: Shader uniforms + helpers.** Add to the fragment shader (plain-ASCII comments only):
```glsl
uniform sampler2D u_fillTex0, u_fillTex1, u_fillTex2;
uniform int u_fillSeam[3];   // 0 mirror, 1 feather, 2 direct
uniform float u_fillScale[3];
```
Add a sampler-dispatch (constant sampler per branch — required):
```glsl
vec3 sampleFillTex(int r, vec2 uv){
  if (r == 0) return texture(u_fillTex0, uv).rgb;
  if (r == 1) return texture(u_fillTex1, uv).rgb;
  return texture(u_fillTex2, uv).rgb;
}
```
Add a seam-handled UV sampler reused by image+pattern (mirrors the raster-branch seam logic; `r_tri` already exists):
```glsl
vec3 sampleFillSeam(int r, vec2 uv){
  float s = max(u_fillScale[r], 0.0001);
  float cu = (uv.x - 0.5)/s + 0.5;
  float cv = (uv.y - 0.5)/s + 0.5;
  if (u_fillSeam[r] == 2) return sampleFillTex(r, vec2(fract(cu), fract(cv)));      // direct
  if (u_fillSeam[r] == 1) {                                                          // feather
    vec2 a = fract(vec2(cu, cv) + 0.5);
    return sampleFillTex(r, a);
  }
  return sampleFillTex(r, vec2(r_tri(cu), r_tri(cv)));                                // mirror
}
```

- [ ] **Step 3: evalFill image branch.** Before the gradient logic, add `if (u_fillType[r] == 2) { vec2 uv = (u_fillFrame[r]==1) ? tc : fc; return sampleFillSeam(r, uv); }`. (Leave solid type 0 and gradient type 1 as-is. Pattern type 3 is added in Task 4.)

- [ ] **Step 4: render() — bind per-role fill textures.** In the existing `for (let r = 0; r < 3; r++)` fill-uniform loop, before/after the solid/gradient branches, handle image: when `fill.type === 'image'`, `const fimg = getRaster(String(fill.src ?? ''))`; if `fimg` is non-null bind it to unit `2+r` (`gl.activeTexture(gl.TEXTURE0 + 2 + r); gl.bindTexture(2D, this.fillTex[r])`), re-upload only when `String(fill.src) !== this._lastFillSrc[r]` (guard, like raster), set `gl.uniform1i(loc('u_fillType'), 2)`, `gl.uniform1i(loc('u_fillSeam'), {mirror:0,feather:1,direct:2}[fill.seam] ?? 0)`, `gl.uniform1f(loc('u_fillScale'), Number(fill.scale)||1)`. If `fimg` is null (not yet decoded) fall back to solid: `gl.uniform1i(loc('u_fillType'),0); gl.uniform3fv(loc('u_fillC0'), hexToRgb('#808080'))`. Set the sampler uniforms once after the loop: `gl.uniform1i(u('u_fillTex0'),2); u_fillTex1=3; u_fillTex2=4`. Restore `gl.activeTexture(gl.TEXTURE0)` at the end (already done ~line 344). For roles whose fill is NOT image, bind the 1×1 placeholder to their unit (or leave the placeholder bound) and reset `_lastFillSrc[r]=null` so a later image re-uploads.

- [ ] **Step 5: Typecheck** — from `frontend/`: `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep 'texturefx/renderer' || echo "renderer clean"` → `renderer clean`. (No unit test — visual in Task 3.)

- [ ] **Step 6: Commit** — `git add frontend/app/lib/texturefx/renderer.ts` → `feat(texture-studio): per-role image fill (raster pipeline) in evalFill`.

---

## Task 2: Fills panel — enable the Image tab

**Files:** Modify `frontend/app/components/vue-canvas/TextureStudioSurface.vue`.

**Interfaces — Consumes:** the existing `roleFill`/`setFill`/`setFillType` helpers, the existing image-upload flow (the surface already has `onImportFile` for raster mode → POST `/upload/image` with a unique name → `loadRaster` → re-render; reuse that pattern per role).

- [ ] **Step 1:** Add `'image'` to the type picker options for each role (now `['solid','gradient','image']`; pattern added in Task 5). Extend `setFillType` to handle `'image'`: seed `{ type:'image', frame:'tile', src:'', seam:'mirror', scale:1 }`.
- [ ] **Step 2:** When a role's fill is image, render: a **Source** row with an Import button + the current filename; a **Seam** StudioSelect (`['mirror','feather','direct']`); a **Scale** StudioSlider (0.25–4, step 0.05); a **Frame** Cell/Tile StudioSelect. Each writes back a complete image `Fill` via `setFill`.
- [ ] **Step 3:** Per-role import handler `onFillImport(rk, i, e)`: read the file, POST to `/upload/image` with a UNIQUE name (`fillimg_<role>_<ts>.png` — unique names avoid stale-cache, per the Slice-4a gotcha), then `loadRaster(name)` and on resolve `setFill(rk, { ...currentImageFill, src: name })` + `onParam()`. Mirror the existing `onImportFile` exactly; factor a shared helper if clean.
- [ ] **Step 4:** Verify — `npx vue-tsc … | grep TextureStudioSurface || echo surface clean`; `npx vitest run tests/unit/texturefx-controls.unit.spec.ts tests/unit/texturefx-fills.unit.spec.ts` pass.
- [ ] **Step 5: Commit** — `git add frontend/app/components/vue-canvas/TextureStudioSurface.vue` → `feat(texture-studio): Fills panel image-fill controls (source/seam/scale/frame)`.

---

## Task 3: Image-fill visual sign-off (controller-driven)
- [ ] Build a harness (bundle `~/lib/texturefx/renderer` + `controls`) that, after `loadRaster`-ing a small test image (or a data-URL drawn to a canvas then registered), renders: arcs with `ground` = image fill (tile, mirror) + `stroke` = solid; checker with `a` = image fill (cell). 2×2 each. Confirm the image fills the role region and tiles seamlessly. Self-sign-off if clean (user is away); remove harness.

---

## Task 4: Nested-pattern fill — `patternfill.ts` + shader (type 3)

**Files:** Create `frontend/app/lib/texturefx/patternfill.ts`; Modify `frontend/app/lib/texturefx/renderer.ts`.

**Interfaces — Produces:** `getPatternFillCanvas(sub, size): HTMLCanvasElement | null` (cached by JSON key) using a SEPARATE renderer instance; the evalFill pattern branch.

- [ ] **Step 1: Export a renderer factory.** In `renderer.ts`, export the `TextureFxRenderer` class (or add `export function createTextureFx(): TextureFxRenderer { return new TextureFxRenderer() }`) so a second, independent instance can be made.
- [ ] **Step 2: patternfill.ts** — a module-scope second renderer instance + a small JSON-keyed cache:
```ts
import { createTextureFx } from '~/lib/texturefx/renderer'
import type { Params } from '~/lib/spacetype/effect'
let _r: ReturnType<typeof createTextureFx> | null = null
const _cache = new Map<string, HTMLCanvasElement>()
// Render a sub-pattern (one level: caller must pass a config WITHOUT `fills`)
// to a cached canvas, on a SEPARATE renderer so the main render is never reentered.
export function getPatternFillCanvas(sub: Record<string, unknown>, size = 256): HTMLCanvasElement | null {
  if (!sub) return null
  const key = JSON.stringify(sub) + ':' + size
  const hit = _cache.get(key); if (hit) return hit
  try {
    if (!_r) _r = createTextureFx()
    const safe = { ...sub } as any; delete safe.fills   // hard guard: never recurse
    const c = _r.render(safe as Params, size, size)
    // copy out (the renderer reuses its own canvas) so the cache is stable
    const out = document.createElement('canvas'); out.width = size; out.height = size
    out.getContext('2d')!.drawImage(c, 0, 0)
    _cache.set(key, out); return out
  } catch { return null }
}
export function clearPatternFillCache(){ _cache.clear() }
```
- [ ] **Step 3: renderer evalFill pattern branch.** Add `if (u_fillType[r] == 3) { vec2 uv = (u_fillFrame[r]==1) ? tc : fc; return sampleFillSeam(r, uv); }` (pattern output tiles already; seam=direct is the natural default, but reuse the same path so scale/frame work). Actually for pattern, force the `direct` sampling (fract) regardless of seam — pass through `sampleFillSeam` with seam treated as direct, OR set `u_fillSeam[r]=2` for pattern roles in render(). Simplest: in render(), for pattern roles set `u_fillSeam=2`.
- [ ] **Step 4: render() pattern binding.** In the per-role loop, when `fill.type === 'pattern'`: `const pc = getPatternFillCanvas(fill.sub as any)`; if non-null, bind to unit `2+r` via `gl.texImage2D(2D, 0, RGBA8, RGBA, UNSIGNED_BYTE, pc)` (canvas upload; guard re-upload with a `_lastFillSrc[r]` set to the JSON key), set `u_fillType=3`, `u_fillSeam=2`, `u_fillScale=Number(fill.scale)||1` (default 1; pattern may omit scale). If null, solid gray fallback (type 0). Import `getPatternFillCanvas` from patternfill.ts.
- [ ] **Step 5: Typecheck** — `renderer clean` + no error in patternfill.ts. Commit `git add frontend/app/lib/texturefx/patternfill.ts frontend/app/lib/texturefx/renderer.ts` → `feat(texture-studio): nested-pattern fill via recursive textureFx (separate instance)`.

---

## Task 5: Fills panel — Pattern tab (compact sub-picker)

**Files:** Modify `frontend/app/components/vue-canvas/TextureStudioSurface.vue`.

- [ ] **Step 1:** Add `'pattern'` to the type picker (`['solid','gradient','image','pattern']`). `setFillType('pattern')` seeds `{ type:'pattern', frame:'tile', scale:1, sub:{ mode:'procedural', motif:'checker', cells:4, colorA:'#e8eef5', colorB:'#7aa2f7', background:'#0e1116' } }` (a flat sub-config, NO `fills`).
- [ ] **Step 2:** When a role's fill is pattern, render a compact sub-picker writing into `fill.sub`: a mode/family StudioSelect (procedural motif: checker/stripes/dots/grid; or simply expose motif), a `cells` StudioSlider (2–12), and 2 StudioColors (sub colorA/colorB) + optional background. Plus the Cell/Tile frame select. Each writes back a complete pattern `Fill` (spread sub, change one key) via `setFill`.
- [ ] **Step 3:** Verify vue-tsc surface clean + the two unit suites pass.
- [ ] **Step 4: Commit** `git add …TextureStudioSurface.vue` → `feat(texture-studio): Fills panel nested-pattern sub-picker`.

---

## Task 6: Nested-pattern visual sign-off + final review + memory (controller-driven)
- [ ] Harness: arcs with `ground` = pattern fill (a tiny checker/dots sub-pattern, tile frame) + `stroke` solid; checker with `a` = pattern fill (cell frame). 2×2. Confirm the sub-pattern renders inside the role region and tiles seamlessly. Self-sign-off if clean; remove harness.
- [ ] Full unit suite `npx vitest run` green.
- [ ] Final whole-branch review (the 1b+1c range). Fix Critical/Important.
- [ ] Update memory (`project_texture_studio.md` + `MEMORY.md`).

---

## Self-review
- **Spec coverage:** image fills (1b) via raster pipeline with seam modes + scale + frame ✓; nested-pattern fills (1c) via recursive textureFx, one level, separate instance ✓; both resolve to a per-role fill texture sampled in evalFill ✓; panel Image + Pattern tabs enabled ✓; seamless per fill×frame ✓.
- **Placeholders:** the renderer mechanism, sampleFillTex/sampleFillSeam GLSL, patternfill recursion guard, and binding code are complete; UI tasks give the exact data contract (write-back full `Fill` via `setFill`, mirror existing import flow) for the implementer to build against the existing 1a panel.
- **Type consistency:** fill-type codes (0/1/2/3), texture units (2/3/4), sampler names (`u_fillTex0/1/2`), and `getPatternFillCanvas`/`createTextureFx` signatures are consistent across tasks. `sampleFillSeam` is shared by image (Task 1) and pattern (Task 4). Dynamic-sampler-index hazard explicitly avoided via branch dispatch.
- **Recursion safety:** sub-config stripped of `fills` + separate renderer instance + JSON cache — no reentrancy, no unbounded depth.
