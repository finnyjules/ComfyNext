# Texture Studio — Slice 3 (Stylize) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stylize stage that runs the rendered texture tile through the EXISTING shaderFx effects — Dither, Posterize, Duotone — staying perfectly seamless (dither scale auto-snapped so its pattern period tiles the image).

**Architecture:** A new `texturefx/stylize.ts` preloads the three shaderFx `EffectDef`s + their textures (blue-noise for dither) once, then `stylizeTile(base, params, w, h)` builds a single-effect `ShaderPass[]` (via `resolveUniforms`+`expandPasses`) and calls `shaderFx.render(passes, base, w, h)`, returning the stylized canvas (no-op when stylize='none' or not-yet-loaded). The surface and node card render the base tile with `textureFx` then pipe it through `stylizeTile`. Seamlessness: render dims are multiples of 64 (preview 256, export 1024); dither u_scale is snapped so cells-across (=1/u_scale) is a multiple of the chosen pattern's period; only tileable dither patterns are exposed.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2, Vitest. Reuses `~/lib/shaderfx/{renderer,params,catalog}` and the texture catalog endpoint `/comfynext/shader_effects`.

---

## Background: exact shaderFx API (verified)

- `import { shaderFx, expandPasses, type ShaderPass } from '~/lib/shaderfx/renderer'`. `shaderFx.render(passes: ShaderPass[], base: TexImageSource, width: number, height: number): HTMLCanvasElement` (returns its internal canvas; `shaderFx.outputCanvas` also holds it). `ShaderPass = { id: string; source: string; uniforms: Record<string,number>; textures?: Record<string,TexImageSource> }`. `expandPasses(id, source, uniforms, textures, passCount): ShaderPass[]`.
- `import { resolveUniforms } from '~/lib/shaderfx/params'` — `resolveUniforms(effect: EffectDef, overrides: Record<string,number>): Record<string,number>` (merges defaults, clamps, validates enums).
- `import { getEffect } from '~/lib/shaderfx/catalog'` — `getEffect(id): Promise<EffectDef|null>` (catalog fetched + cached). `EffectDef` has `.id`, `.source`, `.params`, `.passes`, `.textures: { uniform, file, extraUniforms? }[]`.
- ShaderStudioSurface builds textures via a `texBundle(effectDef)` helper returning `{ sources: Record<string,TexImageSource>, uniforms: Record<string,number> }` — **find this helper's export (in `~/lib/shaderstudio/…`) and reuse it** to load effect textures (blue-noise). If it isn't exported, load each `effect.textures[]` file from the shader-effects asset URL into an HTMLImageElement keyed by `uniform`.

### Effect ids + params (from manifest)
- **Dither** `bayer_dither`: `u_pattern` (enum 0-11), `u_scale` (0.003-0.05, def 0.01), `u_levels` (2-8, def 3), `u_colored` (0/1, def 1). Texture `u_blueNoise` (blue_noise.png, 64×64). **Tileable patterns only: 0 (Coarse 2×2, period 2), 1 (Bayer 4×4, period 4), 2 (Fine 8×8, period 8), 3 (Clustered, period 8), 8 (Blue 1×, period 64), 9 (Blue 2×, period 128), 10 (Blue ½×, period 32). Exclude 4,5,6,7,11 (scanline/diag/noise/R2 — not robustly tileable here).**
- **Posterize** `posterize`: `u_levels` (2-12, def 5). Always seamless.
- **Duotone** `duotone`: `u_shadowHue` (0-1, def 0.6), `u_lightHue` (0-1, def 0.1), `u_contrast` (0-2, def 0.4). Always seamless.

### Seamless-dither rule
Dither cells-across = `1/u_scale` (independent of resolution for a square tile, since cell px = `u_scale*height` and cellsAcross = `width/cellPx` = `1/u_scale` when width=height). For the pattern to wrap, cellsAcross must be a multiple of the pattern's period. So snap: `cellsAcross = max(period, round((1/scale)/period)*period); snappedScale = 1/cellsAcross`.

---

## File structure

- Modify `types.ts` — `STYLIZE_KINDS`, `DITHER_PATTERNS` (label→value) maps + a `STYLIZE_EFFECT_ID` map + `DITHER_PERIOD` map.
- Modify `sections.ts` — add `'Stylize'`.
- Modify `controls.ts` — `stylize` select + per-effect params (contextual `when`).
- Create `texturefx/stylize.ts` — preload + `stylizeUniforms()` (pure, testable) + `snapDitherScale()` (pure) + `stylizeTile()`.
- Modify `TextureStudioSurface.vue` + `TextureStudioNode.vue` — preload effects, pipe tile through `stylizeTile`.
- Create `tests/unit/texturefx-stylize.unit.spec.ts`; modify `texturefx-controls.unit.spec.ts`.

---

## Task 1: Stylize maps, section, controls

**Files:** `types.ts`, `sections.ts`, `controls.ts`, `tests/unit/texturefx-controls.unit.spec.ts`

- [ ] **Step 1: types.ts** — append:
```typescript
export const STYLIZE_KINDS = ['none', 'dither', 'posterize', 'duotone'] as const
export type StylizeKind = typeof STYLIZE_KINDS[number]

// Curated, tileable dither patterns (label → bayer_dither u_pattern value).
export const DITHER_PATTERNS: Record<string, number> = {
  'Bayer 4×4': 1, 'Fine 8×8': 2, 'Coarse 2×2': 0, 'Clustered': 3,
  'Blue noise': 8, 'Blue noise 2×': 9, 'Blue noise ½×': 10,
}
// Pattern value → tiling period (cells-across must be a multiple of this).
export const DITHER_PERIOD: Record<number, number> = { 0: 2, 1: 4, 2: 8, 3: 8, 8: 64, 9: 128, 10: 32 }

export const STYLIZE_EFFECT_ID: Record<string, string> = {
  dither: 'bayer_dither', posterize: 'posterize', duotone: 'duotone',
}
```

- [ ] **Step 2: sections.ts** — add `'Stylize'` before `'Output'`:
```typescript
export const TEXTURE_SECTIONS = ['Lattice', 'Cell', 'Content', 'Truchet', 'Stylize', 'Color', 'Output'] as const
```

- [ ] **Step 3: controls.ts** — add `STYLIZE_KINDS`, `DITHER_PATTERNS` to the types import, and append these controls (after the Color controls). Stylize applies in BOTH procedural and truchet modes, so no mode gate on the `stylize` select itself:
```typescript
  { key: 'stylize', label: 'Stylize', kind: 'select', options: [...STYLIZE_KINDS], default: 'none', group: 'Stylize' },
  // Dither
  { key: 'ditherPattern', label: 'Dither pattern', kind: 'select', options: Object.keys(DITHER_PATTERNS), default: 'Bayer 4×4', group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'ditherScale', label: 'Dither size', kind: 'slider', min: 0.004, max: 0.05, step: 0.001, default: 0.012, group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'ditherLevels', label: 'Dither levels', kind: 'slider', min: 2, max: 8, step: 1, default: 3, group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'ditherColor', label: 'Dither color', kind: 'select', options: ['color', 'mono'], default: 'color', group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  // Posterize
  { key: 'posterizeLevels', label: 'Posterize levels', kind: 'slider', min: 2, max: 12, step: 1, default: 5, group: 'Stylize', when: (p) => String(p.stylize) === 'posterize' },
  // Duotone
  { key: 'duoShadow', label: 'Shadow hue', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.62, group: 'Stylize', when: (p) => String(p.stylize) === 'duotone' },
  { key: 'duoLight', label: 'Light hue', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.12, group: 'Stylize', when: (p) => String(p.stylize) === 'duotone' },
  { key: 'duoContrast', label: 'Duotone contrast', kind: 'slider', min: 0, max: 2, step: 0.01, default: 0.5, group: 'Stylize', when: (p) => String(p.stylize) === 'duotone' },
```

- [ ] **Step 4: controls test** — append:
```typescript
  it('stylize controls reveal by kind', () => {
    const none = textureDefaults()
    const dith = { ...textureDefaults(), stylize: 'dither' }
    const post = { ...textureDefaults(), stylize: 'posterize' }
    const find = (k: string) => TEXTURE_CONTROLS.find((c) => c.key === k)!
    expect(find('stylize').when).toBeUndefined()       // always visible
    expect(find('ditherPattern').when!(none)).toBe(false)
    expect(find('ditherPattern').when!(dith)).toBe(true)
    expect(find('posterizeLevels').when!(dith)).toBe(false)
    expect(find('posterizeLevels').when!(post)).toBe(true)
  })

  it('stylize defaults to none', () => { expect(textureDefaults().stylize).toBe('none') })
```

- [ ] **Step 5: Run** — `cd frontend && npx vitest run tests/unit/texturefx-controls.unit.spec.ts` → all pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(texture-studio): stylize controls (dither/posterize/duotone)"`

---

## Task 2: `texturefx/stylize.ts` — pass building + seamless snap

**Files:** Create `frontend/app/lib/texturefx/stylize.ts`; Test `frontend/tests/unit/texturefx-stylize.unit.spec.ts`

- [ ] **Step 1: Write the failing test** (pure logic only — shaderFx.render is WebGL, not unit-tested):
```typescript
import { describe, expect, it } from 'vitest'
import { snapDitherScale, stylizeUniforms } from '~/lib/texturefx/stylize'

describe('snapDitherScale', () => {
  it('snaps so cells-across is a multiple of the pattern period', () => {
    // pattern 1 (Bayer 4×4, period 4): 1/scale rounded to a multiple of 4
    const s = snapDitherScale(1, 0.012) // 1/0.012 ≈ 83.3 → 84 (mult of 4)
    expect(Math.round(1 / s) % 4).toBe(0)
    // pattern 8 (blue noise, period 64)
    const b = snapDitherScale(8, 0.012) // → multiple of 64
    expect(Math.round(1 / b) % 64).toBe(0)
  })
  it('never returns a degenerate scale (cells-across >= period)', () => {
    const s = snapDitherScale(8, 0.05) // 1/0.05 = 20 < 64 → clamp to 64
    expect(Math.round(1 / s)).toBe(64)
  })
})

describe('stylizeUniforms', () => {
  it('dither maps params (with snapped scale + pattern value + colored flag)', () => {
    const u = stylizeUniforms('dither', { ditherPattern: 'Bayer 4×4', ditherScale: 0.012, ditherLevels: 3, ditherColor: 'mono' } as any)
    expect(u.u_pattern).toBe(1)
    expect(Math.round(1 / u.u_scale) % 4).toBe(0)
    expect(u.u_levels).toBe(3)
    expect(u.u_colored).toBe(0)
  })
  it('posterize + duotone map their params', () => {
    expect(stylizeUniforms('posterize', { posterizeLevels: 6 } as any).u_levels).toBe(6)
    const d = stylizeUniforms('duotone', { duoShadow: 0.6, duoLight: 0.1, duoContrast: 0.5 } as any)
    expect(d).toEqual({ u_shadowHue: 0.6, u_lightHue: 0.1, u_contrast: 0.5 })
  })
})
```

- [ ] **Step 2: Run, confirm fail** — `npx vitest run tests/unit/texturefx-stylize.unit.spec.ts`.

- [ ] **Step 3: Implement `stylize.ts`:**
```typescript
import type { Params } from '~/lib/spacetype/effect'
import type { EffectDef } from '~/lib/shaderfx/types'
import { shaderFx, expandPasses, type ShaderPass } from '~/lib/shaderfx/renderer'
import { resolveUniforms } from '~/lib/shaderfx/params'
import { getEffect } from '~/lib/shaderfx/catalog'
import { DITHER_PATTERNS, DITHER_PERIOD, STYLIZE_EFFECT_ID } from '~/lib/texturefx/types'

// Snap u_scale so dither cells-across (= 1/scale) is a multiple of the pattern's
// tiling period, keeping the dithered tile seamless.
export function snapDitherScale(pattern: number, scale: number): number {
  const period = DITHER_PERIOD[pattern] ?? 4
  const cells = Math.max(period, Math.round((1 / scale) / period) * period)
  return 1 / cells
}

// Pure param → uniform mapping for one stylize kind (no GL).
export function stylizeUniforms(kind: string, p: Params): Record<string, number> {
  if (kind === 'dither') {
    const pattern = DITHER_PATTERNS[String(p.ditherPattern)] ?? 1
    return {
      u_pattern: pattern,
      u_scale: snapDitherScale(pattern, Number(p.ditherScale) || 0.012),
      u_levels: Number(p.ditherLevels) || 3,
      u_colored: String(p.ditherColor) === 'mono' ? 0 : 1,
    }
  }
  if (kind === 'posterize') return { u_levels: Number(p.posterizeLevels) || 5 }
  if (kind === 'duotone') {
    return { u_shadowHue: Number(p.duoShadow) || 0, u_lightHue: Number(p.duoLight) || 0, u_contrast: Number(p.duoContrast) || 0 }
  }
  return {}
}

// --- preload + render ---
interface Loaded { effect: EffectDef; textures: Record<string, TexImageSource>; uniforms: Record<string, number> }
const _loaded: Record<string, Loaded | null> = {}
let _preloading: Promise<void> | null = null

async function loadEffectTextures(effect: EffectDef): Promise<{ textures: Record<string, TexImageSource>; uniforms: Record<string, number> }> {
  const textures: Record<string, TexImageSource> = {}
  const uniforms: Record<string, number> = {}
  for (const t of effect.textures ?? []) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = `/shader_effects/assets/${t.file}${t.v ? `?v=${t.v}` : ''}`
    await img.decode().catch(() => {})
    textures[t.uniform] = img
    Object.assign(uniforms, t.extraUniforms ?? {})
  }
  return { textures, uniforms }
}

// Preload the three stylize effects + their textures. Idempotent.
export function preloadStylize(): Promise<void> {
  if (_preloading) return _preloading
  _preloading = (async () => {
    for (const id of Object.values(STYLIZE_EFFECT_ID)) {
      if (_loaded[id] !== undefined) continue
      const effect = await getEffect(id).catch(() => null)
      if (!effect) { _loaded[id] = null; continue }
      const { textures, uniforms } = await loadEffectTextures(effect)
      _loaded[id] = { effect, textures, uniforms }
    }
  })()
  return _preloading
}

// Run the tile through the selected stylize effect. Returns `base` unchanged when
// stylize is 'none' or the effect isn't loaded yet (caller re-renders after preload).
export function stylizeTile(base: HTMLCanvasElement, p: Params, w: number, h: number): HTMLCanvasElement {
  const kind = String(p.stylize ?? 'none')
  if (kind === 'none') return base
  const id = STYLIZE_EFFECT_ID[kind]
  const L = id ? _loaded[id] : null
  if (!L) return base
  const uniforms = { ...resolveUniforms(L.effect, stylizeUniforms(kind, p)), u_time: 0, u_seed: 42, u_hasInput: 1, ...L.uniforms }
  const passes: ShaderPass[] = expandPasses(L.effect.id, L.effect.source, uniforms, L.textures, L.effect.passes ?? 1)
  return shaderFx.render(passes, base, w, h)
}
```
> If `texBundle` from `~/lib/shaderstudio/…` is exported, use it instead of the local `loadEffectTextures` (same contract). The asset path `/shader_effects/assets/<file>` matches how ShaderStudio loads textures — confirm against the real `texBundle`/asset helper and adjust if different.

- [ ] **Step 4: Run, confirm pass** — `npx vitest run tests/unit/texturefx-stylize.unit.spec.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(texture-studio): stylize.ts — seamless dither snap + shaderFx pass building"`

---

## Task 3: Wire stylize into the surface + node card

**Files:** `TextureStudioSurface.vue`, `TextureStudioNode.vue`

- [ ] **Step 1: Surface** — import `{ preloadStylize, stylizeTile }` from `~/lib/texturefx/stylize`. In `renderPreview()`, after getting the base tile, run it through stylize before the repeat-draw:
```typescript
  const tileBase = textureFx.render(params, TILE, TILE, 0)
  const tile = stylizeTile(tileBase, params, TILE, TILE)
```
(TILE=256 is a multiple of 64 → dither stays seamless.) In `sendToCanvas`/`downloadPng`, stylize the 1024² blob source the same way:
```typescript
  const baseC = textureFx.render(params, 1024, 1024, 0)
  const styled = stylizeTile(baseC, params, 1024, 1024)
  const blob = await new Promise<Blob>((res, rej) => styled.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'))
```
(Replace the existing `textureFx.renderToBlob(...)` calls in both export paths with render→stylize→toBlob.) In `onMounted`, call `preloadStylize().then(() => renderPreview())` so the preview re-renders once effects load.

- [ ] **Step 2: Node card** — import `{ preloadStylize, stylizeTile }`. In `renderFrame()`, pipe through stylize: `const tile = stylizeTile(textureFx.render(params.value, PREVIEW_W, PREVIEW_H, 0), params.value, PREVIEW_W, PREVIEW_H)` then drawImage `tile`. In `onMounted`, `preloadStylize().then(renderFrame)`.
> Note: preview/card dims (256, 240×148) — for the card, dither seamlessness across the *card* preview isn't critical (it's a thumbnail, not the exported tile), so card dims need not be multiples of 64. The exported 1024² and the surface's 256 repeat-preview are the seamless-critical paths and both satisfy it.

- [ ] **Step 3: Typecheck** — `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TextureStudio(Surface|Node)|texturefx/stylize" || echo clean`.
- [ ] **Step 4: Commit** — `git commit -m "feat(texture-studio): apply stylize in surface preview/export + node card"`

---

## Task 4: Visual verification + sign-off

> Controller-driven. Render a Truchet tile (and a procedural one) under each stylize: none / dither (a couple patterns) / posterize / duotone, each tiled 2×2. Confirm: (a) stylize visibly applies, (b) the 2×2 stays seamless — ESPECIALLY dither (the snap must hold; look for grid mismatch at tile mid-lines), (c) no shader errors, (d) the dithered Truchet reads like the user's reference.

- [ ] **Step 1:** Temp harness page: a base Truchet arcs tile (cells 8, structured) under stylize none / dither(Bayer 4×4) / dither(Blue noise) / posterize / duotone, each 2×2, at a 256² tile (mult of 64). Call `await preloadStylize()` before rendering.
- [ ] **Step 2:** Screenshot (Playwright, domcontentloaded + waitForFunction on figures + a delay for preload, dpr 2, fullPage). Confirm dither tiles seamlessly (no seam at mid-lines) and effects apply.
- [ ] **Step 3:** Present, get sign-off. Iterate on defaults / pattern set if needed.
- [ ] **Step 4:** Remove harness, run full unit suite, commit (`--allow-empty`).

---

## Self-review (completed)

- **Spec coverage:** the spec's Stylize stage (dither/halftone/posterize/duotone/grain reusing shaderFx) — delivered as dither+posterize+duotone (the seamless-guaranteed, high-value set; the hero dither look included). **Halftone deferred** (geometric tiling alignment is finicky — own slice); **grain** not in the shaderFx catalog (would need a new effect — out of scope). Noted here, not silently dropped.
- **Placeholders:** none; complete code + expected outputs.
- **Type consistency:** `STYLIZE_KINDS`/`DITHER_PATTERNS`/`DITHER_PERIOD`/`STYLIZE_EFFECT_ID` defined in Task 1, consumed by `stylize.ts` (Task 2) and controls; `snapDitherScale`/`stylizeUniforms`/`stylizeTile`/`preloadStylize` signatures defined in Task 2 and called in Task 3; control keys (`stylize`,`ditherPattern`,`ditherScale`,`ditherLevels`,`ditherColor`,`posterizeLevels`,`duoShadow`,`duoLight`,`duoContrast`) consistent across controls/stylize.
- **Seamlessness:** dither snap guarantees cells-across is a multiple of the pattern period; only tileable patterns exposed; seamless-critical render dims (256 preview, 1024 export) are multiples of 64; posterize/duotone are per-pixel (inherently seamless). Verified visually in Task 4.
- **Reuse:** uses shaderFx renderer/params/catalog as-is; no shaderFx changes. Confirm the `texBundle`/asset-loading detail against the real helper during Task 2.
