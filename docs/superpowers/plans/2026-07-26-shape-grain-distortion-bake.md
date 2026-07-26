# Shape Studio — bake grain & distortion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `style.grain` and `style.distortion` real parts of the rendered image instead of live-preview-only CSS/SVG overlays, so every render path agrees.

**Architecture:** Both effects move into `ShapeEngine` as a single optional post-processing pass — the scene renders to a `WebGLRenderTarget`, then a fullscreen quad applies displacement and grain. Both `render()` and `frameToBlob()` go through one shared `drawFrame()`, so preview and bake cannot diverge again. The CSS overlay and SVG filter are deleted in the SAME task, or the preview would double-apply.

**Why now:** this is a live bug, not a nicety. A Collection sweep over `style.grain` produces N identical PNGs today, because the param baker renders through a detached offscreen engine that never sees the DOM overlays. It also blocks Shape motion — animating a preview-only effect would make preview and export visibly disagree.

**Tech Stack:** TypeScript, three.js (raw WebGLRenderTarget + ShaderMaterial, no EffectComposer), Vue 3, Vitest.

## Global Constraints

- **Reuse Gradient's grain hash.** `app/lib/gradientfx/shaders.ts:104-109` defines `hashGrain` (Dave Hoskins, "Hash without Sine") with a comment explaining it replaced a fract-multiply hash that showed a visible repeating tile. Copy that function and its luminance-shaped application (`:720-725`) so grain looks the same across studios. Do not invent a third noise.
- **Visual parity with the old SVG is NOT the goal and is not achievable.** `feTurbulence` is a specific Perlin variant; a GLSL equivalent will differ in character. The goal is that all five render paths agree with each other. Say so in the commit message.
- **Zero cost when unused.** When `style.grain` and `style.distortion` are both 0, render straight to the canvas with no render target and no second pass — matching today's `filter: none` short-circuit.
- **Transparency must survive.** The renderer is constructed `alpha: true` and `style.background === 'transparent'` sets `scene.background = null`. The render target needs an alpha channel and the final blit must preserve it, or transparent exports turn black.
- **`preserveDrawingBuffer: true`** is already set (`engine.ts:44`) and `frameToBlob` depends on it — do not change renderer construction.
- Working directory: `/Users/julien/Documents/GitHub/Sailor/frontend`. Test: `pnpm test:unit`.
- ~100 files are modified by OTHER concurrent sessions. Stage only the paths each task names; run `git diff --cached` and read it before every commit. Never `git add -A` / `git add .` / `git stash`.
- The WebGL boundary has **no test coverage today** — no test touches `engine.ts` or either baker. Test the pure parts (shader source, the skip predicate, uniform mapping); do not attempt to test GL output.

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `app/lib/shapefx/post.ts` | The post-pass shader source + a `postNeeded(config)` predicate. Pure, testable, three-free except types. | Create |
| `app/lib/shapefx/engine.ts` | Render target, fullscreen quad, shared `drawFrame()`; `render()` and `frameToBlob()` both route through it. | Modify |
| `app/components/vue-canvas/ShapeStudioSurface.vue` | Delete the grain overlay div, the SVG filter host, and their computeds. | Modify |
| `tests/unit/shapefx-post.unit.spec.ts` | Shader source + predicate tests. | Create |

---

### Task 1: The post pass, and deleting the overlays

This is one task on purpose: shipping the engine pass without deleting the overlays would make the preview apply both.

**Files:**
- Create: `app/lib/shapefx/post.ts`, `tests/unit/shapefx-post.unit.spec.ts`
- Modify: `app/lib/shapefx/engine.ts`, `app/components/vue-canvas/ShapeStudioSurface.vue`

**Interfaces:**
- Produces:
  - `postNeeded(cfg: ShapeConfig): boolean`
  - `POST_VERT: string`, `POST_FRAG: string`

- [ ] **Step 1: Read the three references before writing**

```bash
sed -n '99,112p' app/lib/gradientfx/shaders.ts        # hashGrain
sed -n '714,728p' app/lib/gradientfx/shaders.ts       # how grain is applied
sed -n '210,240p' app/components/vue-canvas/ShapeStudioSurface.vue   # the overlays being deleted
sed -n '440,500p' app/components/vue-canvas/ShapeStudioSurface.vue   # the template that hosts them
```

Note the old overlay's parameters so the new pass lands in a similar range: grain opacity was `grain/100` over a 160px-tiled noise at `mix-blend-mode: overlay`; distortion scale was `(distortion/100) * 45` pixels of displacement.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/shapefx-post.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { postNeeded, POST_FRAG, POST_VERT } from '../../app/lib/shapefx/post'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'

const cfg = (style: Partial<typeof DEFAULT_CONFIG.style>): any =>
  mergeConfig({ ...structuredClone(DEFAULT_CONFIG), style: { ...DEFAULT_CONFIG.style, ...style } })

describe('postNeeded', () => {
  it('is false when both effects are off, so the pass can be skipped entirely', () => {
    expect(postNeeded(cfg({ grain: 0, distortion: 0 }))).toBe(false)
  })
  it('is true when either effect is on', () => {
    expect(postNeeded(cfg({ grain: 20, distortion: 0 }))).toBe(true)
    expect(postNeeded(cfg({ grain: 0, distortion: 35 }))).toBe(true)
  })
  it('treats a hair above zero as on, matching the shader guards', () => {
    expect(postNeeded(cfg({ grain: 0.5, distortion: 0 }))).toBe(true)
  })
})

describe('post shader source', () => {
  it('declares every uniform the engine sets', () => {
    for (const u of ['uScene', 'uGrain', 'uDistort', 'uResolution', 'uSeed']) {
      expect(POST_FRAG, `missing uniform ${u}`).toContain(u)
    }
  })
  it('reuses the shared grain hash rather than inventing another', () => {
    // Same function as gradientfx/shaders.ts so grain reads identically across studios.
    expect(POST_FRAG).toContain('hashGrain')
    expect(POST_FRAG).toContain('0.1031')   // the Dave Hoskins constant
  })
  it('guards each effect so a zero value is a true no-op inside the shader', () => {
    expect(POST_FRAG).toMatch(/uGrain\s*>\s*0\.0/)
    expect(POST_FRAG).toMatch(/uDistort\s*>\s*0\.0/)
  })
  it('preserves alpha rather than forcing opaque, so transparent exports survive', () => {
    // A `vec4(col, 1.0)` here would turn every transparent background black.
    expect(POST_FRAG).not.toMatch(/gl_FragColor\s*=\s*vec4\([^)]*,\s*1\.0\s*\)/)
  })
  it('has a vertex shader that passes UVs through', () => {
    expect(POST_VERT).toContain('vUv')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test:unit tests/unit/shapefx-post.unit.spec.ts`
Expected: FAIL — cannot resolve `.../shapefx/post`.

- [ ] **Step 4: Write `app/lib/shapefx/post.ts`**

A fullscreen-quad pass. Displacement first (sample the scene at an offset driven by value noise), then grain on the result, matching the old ordering where the SVG filter warped the canvas and the noise div sat on top.

```ts
import type { ShapeConfig } from './config'

/** True when the post pass would do anything. When false the engine renders straight to
 *  the canvas with no render target — matching the old overlay's `filter: none` skip. */
export function postNeeded(cfg: ShapeConfig): boolean {
  return (cfg.style.grain ?? 0) > 0 || (cfg.style.distortion ?? 0) > 0
}

export const POST_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const POST_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform float uGrain;        // 0..1
uniform float uDistort;      // 0..1
uniform vec2  uResolution;
uniform float uSeed;

// Shared with gradientfx/shaders.ts — same hash so grain reads identically across studios.
float hashGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = vUv;
  // Displacement: two decorrelated noise fields drive x/y, scaled to a pixel budget that
  // matches the old SVG filter's (distortion/100)*45px.
  if (uDistort > 0.0) {
    float n1 = vnoise(uv * 6.0 + uSeed);
    float n2 = vnoise(uv * 6.0 - uSeed + 17.3);
    vec2 px = (vec2(n1, n2) - 0.5) * (uDistort * 45.0);
    uv += px / uResolution;
  }
  vec4 src = texture2D(uScene, clamp(uv, 0.0, 1.0));
  vec3 col = src.rgb;
  // Grain: luminance-shaped so it sits in the midtones, same formula as gradientfx.
  if (uGrain > 0.0) {
    float g = hashGrain(gl_FragCoord.xy + uSeed) - 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float midtone = 0.35 + 0.65 * (lum * (1.0 - lum) * 4.0);
    col += g * uGrain * 0.5 * midtone;
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
`
```

The `0.5` grain coefficient is a starting point — the old overlay used `mix-blend-mode: overlay` at `grain/100` opacity, which is not directly convertible. Tune it by eye in Step 8 and say what you landed on.

- [ ] **Step 5: Wire the pass into `ShapeEngine`**

In `app/lib/shapefx/engine.ts`:

1. Add private fields: `rt: THREE.WebGLRenderTarget | null`, `postScene: THREE.Scene | null`, `postCam: THREE.OrthographicCamera | null`, `postMat: THREE.ShaderMaterial | null`.
2. Lazily build them on first use (`ensurePost()`), sized to `this.w/this.h`. The render target MUST have an alpha channel — three's default `RGBAFormat` is correct; do not set `format: RGBFormat`.
3. Extract the duplicated draw into one private method, and route BOTH callers through it:

```ts
  /** The single place the scene reaches pixels. `render()` and `frameToBlob()` both call
   *  this, so the preview and every bake apply exactly the same post chain. */
  private drawFrame(): void {
    const cfg = this.config
    if (!cfg || !postNeeded(cfg)) {
      this.renderer.setRenderTarget(null)
      this.renderer.render(this.scene, this.cam)
      return
    }
    this.ensurePost()
    this.renderer.setRenderTarget(this.rt)
    this.renderer.clear()
    this.renderer.render(this.scene, this.cam)
    this.renderer.setRenderTarget(null)
    const u = this.postMat!.uniforms
    u.uScene!.value = this.rt!.texture
    u.uGrain!.value = (cfg.style.grain ?? 0) / 100
    u.uDistort!.value = (cfg.style.distortion ?? 0) / 100
    u.uResolution!.value.set(this.w, this.h)
    this.renderer.render(this.postScene!, this.postCam!)
  }
```

4. `render(orbit)` keeps its transform/camera work, then calls `this.drawFrame()` instead of `this.renderer.render(...)`.
5. `frameToBlob` calls `this.drawFrame()` instead of `this.renderer.render(...)`.
6. `setSize` must also resize the render target when it exists.
7. `dispose` must dispose the render target, the quad geometry, and the post material.

Seed the `uSeed` uniform from the config's `seed` string hashed to a number, so the grain pattern is stable per shape rather than jumping between renders.

- [ ] **Step 6: Delete the overlays from the surface**

In `app/components/vue-canvas/ShapeStudioSurface.vue`, remove:
- `NOISE_BG`, `grainStyle`, and the grain `<div>` in the template
- `distortFilterId`, `distortionScale`, `distortionFilter`, the `:style="{ filter: ... }"` binding on the `<canvas>`, and the 0×0 SVG filter host
- `previewBox` **only if** nothing else uses it — check first; the rAF loop writes it at `:303`, so if it has no remaining reader, delete the write too.

Leave the two `StudioSlider`s for grain and distortion exactly as they are — they now drive the engine instead of CSS.

- [ ] **Step 7: Run the tests**

Run: `pnpm test:unit tests/unit/shapefx-post.unit.spec.ts && pnpm test:unit`
Expected: post tests PASS; full suite shows no new failures beyond the 16 known pre-existing ones.

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "shapefx/post|shapefx/engine|ShapeStudioSurface"` — report exactly what it prints. A pre-existing `ShaderStudioSurface` error is unrelated.

- [ ] **Step 8: Verify by eye, and tune**

Start the dev server (`./dev.sh` from the repo root is the kill-and-take-over launcher; if another session's server is already on 127.0.0.1:3000, reuse it rather than killing theirs). Open a Shape Studio node.

1. Grain at 0 and distortion at 0 → the render must be identical to before (the pass is skipped).
2. Raise grain → noise appears in the preview. **Then hit Render in the node footer and compare** — the baked PNG must now show the same grain. That is the bug this task fixes.
3. Raise distortion → the shape warps in preview, and the bake warps too.
4. Set the background to transparent with grain on, export, and confirm the exported PNG is still transparent — not black.
5. Tune the grain coefficient in `post.ts` until the preview reads close to the old CSS overlay at the same slider value. Report what you changed it to.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/shapefx/post.ts frontend/app/lib/shapefx/engine.ts \
        frontend/app/components/vue-canvas/ShapeStudioSurface.vue \
        frontend/tests/unit/shapefx-post.unit.spec.ts
git commit -m "fix(shapefx): bake grain and distortion instead of faking them in CSS"
```

---

### Task 2: Prove the paths agree

**Files:**
- Modify: `tests/unit/shapefx-post.unit.spec.ts`

- [ ] **Step 1: Add a test pinning the shared draw path**

The real regression risk is someone adding a third render call that bypasses `drawFrame()`. Pin it by source inspection — crude, but it is the only thing that catches it without a GL context:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('every render path goes through drawFrame', () => {
  it('has exactly one direct renderer.render of the main scene', () => {
    // render() and frameToBlob() must both route through drawFrame(), or the preview and
    // the bake can diverge again — which is the bug this whole change fixes.
    const src = readFileSync(resolve(__dirname, '../../app/lib/shapefx/engine.ts'), 'utf8')
    const direct = src.match(/this\.renderer\.render\(this\.scene, this\.cam\)/g) ?? []
    expect(direct.length, 'scene should be drawn from exactly one place (drawFrame)').toBe(1)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm test:unit tests/unit/shapefx-post.unit.spec.ts`
Expected: PASS. If it reports 2, `frameToBlob` was not converted — fix the engine, not the test.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/unit/shapefx-post.unit.spec.ts
git commit -m "test(shapefx): pin the single scene-draw path"
```

---

## Follow-on, explicitly not here

**Shape Studio motion.** This task unblocks it: once grain and distortion bake, animating them no longer makes preview and export disagree. The motion scope itself stays as mapped — only `orbit.yaw/pitch/zoom` and `shape.scale` are free per frame, because `setConfig()` disposes and rebuilds geometry, material and vertex attributes on every call with no diffing. Scene3D (`app/lib/scene3d/motion/`) is the structural precedent, not Gradient: animate only what composes onto the render, never what forces a rebuild. Orbit should stay outside `ShapeConfig` and be supplied as a delta, because promoting it in would make the deep `watch(config)` fire a full rebuild on every mousemove of an orbit drag.

**Extracting a shared `renderShapeFrame(engine, cfg, orbit, w, h)`.** `bakeOutput()`, `renderBlobWithOverrides()` and `exportPng()` each hand-roll the same five-line construct/setConfig/render/readback/dispose sequence. Worth collapsing when the frame source lands and becomes the fourth.
