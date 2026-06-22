# Texture Studio — Slice 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Texture Studio that generates perfectly-seamless geometric tiles (square / brick / diagonal lattices × checker / stripes / dots / grid motifs), with a live "repeat" preview, seam highlighting, seeded rolls, PNG export, and Send-to-canvas — following the exact Gradient Studio pattern.

**Architecture:** A pure-TS pattern sampler (`pattern.ts`) defines a seamless, periodic `patternColor(params, u, v)` function and is the unit-tested source of truth for tileability. A WebGL2 fragment shader (`renderer.ts`) mirrors that sampler for fast rendering and is verified visually. Controls are a flat `ControlSpec[]` (reusing Space Type's `ControlSpec`/`defaultsFromControls`/`Params`) gated by a `TEXTURE_SECTIONS` allow-list. A node card + modal surface + `VueNodeCanvas` wiring mirror Gradient Studio one-to-one.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2, Vitest (`tests/unit/*.unit.spec.ts`, node env, `~`→`app`), existing studio primitives (`StudioModalShell`, `StudioSection`, `StudioSlider`, `StudioSelect`, `StudioColor`, `StudioButton`, `StudioSwitch`), `uploadFrameBatch`, `recordAsset`.

---

## Slice roadmap (this plan = Slice 1 only)

1. **Slice 1 — Foundation (this plan):** procedural lattice tiler, seamless math + tests, node + surface, repeat preview + seam highlight, roll/seed, PNG export, Send-to-canvas, registration, visual harness.
2. **Slice 2 — Truchet mode:** 4 tile families (Arcs/Diagonal/Multi-scale/Weave), per-state rotation weights, palette (1–4 colors), contextual control reveal, **hex lattice**.
3. **Slice 3 — Stylize stage:** wire the existing `shaderfx` passes (dither/halftone/posterize/duotone/grain) as a post step on the texture tile.
4. **Slice 4 — Raster content:** import asset + generate-from-prompt cell content; seamless tiers 1–2 (offset-wrap + mirror/feather) in `seamless.ts`.
5. **Slice 5 — AI-seamless (tier 3):** backend Flux.1-dev circular-padding low-denoise img2img node; single "Make seamless (AI)" toggle; graceful degrade to tier-2.
6. **Slice 6 — WFC placement, SVG export, animated video loops.**

---

## File structure (Slice 1)

- Create `frontend/app/lib/texturefx/types.ts` — `TextureParams` alias + small enums (lattice/motif lists), `cloneParams`.
- Create `frontend/app/lib/texturefx/controls.ts` — `TEXTURE_CONTROLS: ControlSpec[]` + `textureDefaults()`.
- Create `frontend/app/lib/texturefx/sections.ts` — `TEXTURE_SECTIONS` allow-list.
- Create `frontend/app/lib/texturefx/pattern.ts` — pure-TS seamless sampler (`patternColor`, `latticeCell`, motif helpers).
- Create `frontend/app/lib/texturefx/renderer.ts` — WebGL2 singleton `textureFx` mirroring the sampler; `render()`, `renderToBlob()`.
- Create `frontend/app/components/vue-canvas/TextureStudioNode.vue` — node card + open event + live preview.
- Create `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — modal editor.
- Modify `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — open-state ref, listeners, Teleport, output handler.
- Create `frontend/tests/unit/texturefx-controls.unit.spec.ts` — defaults + sections allow-list.
- Create `frontend/tests/unit/texturefx-pattern.unit.spec.ts` — **seamless-wrap invariants**.
- Create `frontend/.playground/texture-harness.html` — standalone visual harness.

**Seamlessness invariant (the crown jewel, enforced by tests):** for integer `cells` (even `cells` when `lattice === 'brick'` or `'diagonal'`), `patternColor(p, 0, v) === patternColor(p, 1, v)` for all `v`, and `patternColor(p, u, 0) === patternColor(p, u, 1)` for all `u`. The shader must reproduce the same math.

---

## Task 1: Params, controls, and sections

**Files:**
- Create: `frontend/app/lib/texturefx/types.ts`
- Create: `frontend/app/lib/texturefx/controls.ts`
- Create: `frontend/app/lib/texturefx/sections.ts`
- Test: `frontend/tests/unit/texturefx-controls.unit.spec.ts`

- [ ] **Step 1: Write `types.ts`**

```typescript
// frontend/app/lib/texturefx/types.ts
import type { Params } from '~/lib/spacetype/effect'

export type TextureParams = Params

export const LATTICES = ['square', 'brick', 'diagonal'] as const
export const MOTIFS = ['checker', 'stripes', 'dots', 'grid'] as const

export type Lattice = typeof LATTICES[number]
export type Motif = typeof MOTIFS[number]

// JSON clone — safe on Vue reactive proxies (structuredClone is not).
export function cloneParams<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
```

- [ ] **Step 2: Write `controls.ts`**

```typescript
// frontend/app/lib/texturefx/controls.ts
import { defaultsFromControls, type ControlSpec, type Params } from '~/lib/spacetype/effect'
import { LATTICES, MOTIFS } from '~/lib/texturefx/types'

export const TEXTURE_CONTROLS: ControlSpec[] = [
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice' },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice' },
  { key: 'motif', label: 'Motif', kind: 'select', options: [...MOTIFS], default: 'checker', group: 'Content' },
  { key: 'scale', label: 'Motif size', kind: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.7, group: 'Content' },
  { key: 'lineWeight', label: 'Line weight', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.12, group: 'Content' },
  { key: 'jitter', label: 'Color jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Content' },
  { key: 'colorA', label: 'Color A', kind: 'color', default: '#e8eef5', group: 'Color' },
  { key: 'colorB', label: 'Color B', kind: 'color', default: '#7aa2f7', group: 'Color' },
  { key: 'background', label: 'Background', kind: 'color', default: '#0e1116', group: 'Color' },
]

// Numeric seed lives outside the control list (driven by the Roll button).
export function textureDefaults(): Params {
  return { ...defaultsFromControls(TEXTURE_CONTROLS), seed: 1 }
}
```

- [ ] **Step 3: Write `sections.ts`**

```typescript
// frontend/app/lib/texturefx/sections.ts
// SINGLE SOURCE OF TRUTH — any control whose `group` is not listed here is
// silently dropped from the panel. Guarded by texturefx-controls.unit.spec.ts.
export const TEXTURE_SECTIONS = ['Lattice', 'Content', 'Color', 'Output'] as const
export type TextureSection = typeof TEXTURE_SECTIONS[number]
```

- [ ] **Step 4: Write the failing test**

```typescript
// frontend/tests/unit/texturefx-controls.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'

describe('texturefx controls', () => {
  it('defaults include every control key plus seed', () => {
    const d = textureDefaults()
    for (const c of TEXTURE_CONTROLS) expect(d[c.key]).toBe(c.default)
    expect(d.seed).toBe(1)
  })

  it('every control group is in the section allow-list', () => {
    const allowed = new Set<string>(TEXTURE_SECTIONS)
    for (const c of TEXTURE_CONTROLS) {
      expect(c.group, `control "${c.key}" has group "${c.group}"`).toBeDefined()
      expect(allowed.has(String(c.group)), `group "${c.group}" not in TEXTURE_SECTIONS`).toBe(true)
    }
  })

  it('select defaults are valid options', () => {
    for (const c of TEXTURE_CONTROLS) {
      if (c.kind === 'select') expect(c.options).toContain(c.default)
    }
  })
})
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/texturefx-controls.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/controls.ts frontend/app/lib/texturefx/sections.ts frontend/tests/unit/texturefx-controls.unit.spec.ts
git commit -m "feat(texture-studio): params, controls, and section allow-list"
```

---

## Task 2: Pure-TS seamless pattern sampler

**Files:**
- Create: `frontend/app/lib/texturefx/pattern.ts`
- Test: `frontend/tests/unit/texturefx-pattern.unit.spec.ts`

- [ ] **Step 1: Write the failing test (seamless invariants first)**

```typescript
// frontend/tests/unit/texturefx-pattern.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { patternColor } from '~/lib/texturefx/pattern'
import { textureDefaults } from '~/lib/texturefx/controls'
import { MOTIFS, LATTICES } from '~/lib/texturefx/types'

const eq = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

describe('patternColor seamlessness', () => {
  for (const lattice of LATTICES) {
    for (const motif of MOTIFS) {
      it(`${lattice}/${motif} wraps left↔right and top↔bottom`, () => {
        const p = { ...textureDefaults(), lattice, motif, cells: 8, jitter: 0.6 }
        for (let i = 0; i <= 10; i++) {
          const t = i / 10
          expect(eq(patternColor(p, 0, t), patternColor(p, 1, t)), `x-wrap @ v=${t}`).toBe(true)
          expect(eq(patternColor(p, t, 0), patternColor(p, t, 1)), `y-wrap @ u=${t}`).toBe(true)
        }
      })
    }
  }

  it('returns rgba in 0..1', () => {
    const p = textureDefaults()
    const c = patternColor(p, 0.3, 0.7)
    expect(c).toHaveLength(4)
    for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  it('checker alternates between adjacent cells', () => {
    const p = { ...textureDefaults(), motif: 'checker', lattice: 'square', cells: 8 }
    const a = patternColor(p, 0.5 / 8, 0.5 / 8) // cell (0,0)
    const b = patternColor(p, 1.5 / 8, 0.5 / 8) // cell (1,0)
    expect(eq(a, b)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts`
Expected: FAIL — `patternColor` is not defined.

- [ ] **Step 3: Implement `pattern.ts`**

```typescript
// frontend/app/lib/texturefx/pattern.ts
import type { Params } from '~/lib/spacetype/effect'

export type RGBA = [number, number, number, number]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Deterministic 0..1 hash of an integer cell index.
function hash1(i: number): number {
  let x = (i | 0) * 374761393 + 668265263
  x = (x ^ (x >>> 13)) * 1274126177
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

const posmod = (a: number, n: number) => ((a % n) + n) % n

/**
 * Lattice mapping. Returns the integer cell (cx, cy) and the in-cell local
 * coords (fx, fy) in [0,1). Offsets use period-2 shifts so the field tiles
 * seamlessly whenever `cells` is even (enforced for brick/diagonal).
 */
export function latticeCell(lattice: string, cells: number, u: number, v: number) {
  let gx = u * cells
  let gy = v * cells
  const row = Math.floor(gy)
  const col = Math.floor(gx)
  if (lattice === 'brick' && posmod(row, 2) === 1) gx += 0.5
  if (lattice === 'diagonal') {
    if (posmod(row, 2) === 1) gx += 0.5
    if (posmod(col, 2) === 1) gy += 0.5
  }
  const cx = posmod(Math.floor(gx), cells)
  const cy = posmod(Math.floor(gy), cells)
  return { cx, cy, fx: gx - Math.floor(gx), fy: gy - Math.floor(gy) }
}

export function patternColor(p: Params, u: number, v: number): RGBA {
  const cells = Math.max(2, Math.round(Number(p.cells) || 8))
  const A = hexToRgb(String(p.colorA))
  const B = hexToRgb(String(p.colorB))
  const BG = hexToRgb(String(p.background))
  const scale = Number(p.scale) || 0.7
  const lw = Number(p.lineWeight) || 0.12
  const jitter = Number(p.jitter) || 0
  const seed = Math.round(Number(p.seed) || 1)
  const motif = String(p.motif)

  const { cx, cy, fx, fy } = latticeCell(String(p.lattice), cells, u, v)

  // Per-cell A/B swap — periodic over `cells`, so it stays seamless.
  const swap = jitter > 0 && hash1(cx * 73856093 + cy * 19349663 + seed * 83492791) < jitter
  const ink: [number, number, number] = swap ? B : A
  const ink2: [number, number, number] = swap ? A : B

  const out = (c: [number, number, number]): RGBA => [c[0], c[1], c[2], 1]

  switch (motif) {
    case 'stripes':
      return out(fx < 0.5 ? ink : ink2)
    case 'dots': {
      const d = Math.hypot(fx - 0.5, fy - 0.5)
      return d < scale * 0.5 ? out(ink) : out(BG)
    }
    case 'grid':
      return (fx < lw || fy < lw) ? out(ink) : out(BG)
    case 'checker':
    default:
      return out(posmod(cx + cy, 2) === 0 ? ink : ink2)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts`
Expected: PASS (all wrap, range, and checker tests green).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/texturefx/pattern.ts frontend/tests/unit/texturefx-pattern.unit.spec.ts
git commit -m "feat(texture-studio): seamless pattern sampler + wrap invariants"
```

---

## Task 3: WebGL2 renderer (mirrors the sampler)

**Files:**
- Create: `frontend/app/lib/texturefx/renderer.ts`

> No headless unit test — WebGL2 is unavailable in the node test env. Correctness is checked against `pattern.ts` in the visual harness (Task 7). The GLSL below must mirror `pattern.ts` exactly.

- [ ] **Step 1: Write `renderer.ts`**

```typescript
// frontend/app/lib/texturefx/renderer.ts
import type { Params } from '~/lib/spacetype/effect'
import { LATTICES, MOTIFS } from '~/lib/texturefx/types'

const VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag;
uniform float u_cells, u_lattice, u_motif, u_scale, u_lw, u_jitter, u_seed;
uniform vec3 u_a, u_b, u_bg;

float posmod(float a, float n){ return mod(mod(a,n)+n, n); }
float hash1(float i){
  float x = i*374761393.0 + 668265263.0;
  x = mod(x, 2147483647.0);
  x = mod((x*1274126177.0), 2147483647.0);
  return fract(x/2147483647.0);
}
void main(){
  float cells = max(2.0, floor(u_cells + 0.5));
  float gx = v_uv.x * cells;
  float gy = v_uv.y * cells;
  float row = floor(gy);
  float col = floor(gx);
  if (u_lattice < 1.5 && u_lattice > 0.5 && posmod(row,2.0)==1.0) gx += 0.5;        // brick
  if (u_lattice > 1.5) { if (posmod(row,2.0)==1.0) gx += 0.5; if (posmod(col,2.0)==1.0) gy += 0.5; } // diagonal
  float cx = posmod(floor(gx), cells);
  float cy = posmod(floor(gy), cells);
  float fx = gx - floor(gx);
  float fy = gy - floor(gy);

  float swap = (u_jitter > 0.0 && hash1(cx*73856093.0 + cy*19349663.0 + u_seed*83492791.0) < u_jitter) ? 1.0 : 0.0;
  vec3 ink  = mix(u_a, u_b, swap);
  vec3 ink2 = mix(u_b, u_a, swap);

  vec3 c;
  if (u_motif < 0.5) {                 // checker
    c = (posmod(cx+cy,2.0)==0.0) ? ink : ink2;
  } else if (u_motif < 1.5) {          // stripes
    c = (fx < 0.5) ? ink : ink2;
  } else if (u_motif < 2.5) {          // dots
    c = (distance(vec2(fx,fy), vec2(0.5)) < u_scale*0.5) ? ink : u_bg;
  } else {                             // grid
    c = (fx < u_lw || fy < u_lw) ? ink : u_bg;
  }
  frag = vec4(c, 1.0);
}`

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

class TextureFxRenderer {
  private canvas?: HTMLCanvasElement
  private gl?: WebGL2RenderingContext
  private prog?: WebGLProgram

  private ensure(w: number, h: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!gl) throw new Error('WebGL2 unavailable')
      this.gl = gl
      this.prog = this.compile(gl)
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(this.prog!, 'a_pos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }
    const c = this.canvas!
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    this.gl.viewport(0, 0, w, h)
    return this.gl
  }

  private compile(gl: WebGL2RenderingContext): WebGLProgram {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed')
    return p
  }

  render(p: Params, width: number, height: number, _time = 0): HTMLCanvasElement {
    const gl = this.ensure(width, height)
    gl.useProgram(this.prog!)
    const u = (n: string) => gl.getUniformLocation(this.prog!, n)
    const li = Math.max(0, LATTICES.indexOf(String(p.lattice) as any))
    const mi = Math.max(0, MOTIFS.indexOf(String(p.motif) as any))
    gl.uniform1f(u('u_cells'), Number(p.cells) || 8)
    gl.uniform1f(u('u_lattice'), li)
    gl.uniform1f(u('u_motif'), mi)
    gl.uniform1f(u('u_scale'), Number(p.scale) || 0.7)
    gl.uniform1f(u('u_lw'), Number(p.lineWeight) || 0.12)
    gl.uniform1f(u('u_jitter'), Number(p.jitter) || 0)
    gl.uniform1f(u('u_seed'), Math.round(Number(p.seed) || 1))
    gl.uniform3fv(u('u_a'), hex(String(p.colorA)))
    gl.uniform3fv(u('u_b'), hex(String(p.colorB)))
    gl.uniform3fv(u('u_bg'), hex(String(p.background)))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas!
  }

  async renderToBlob(p: Params, width: number, height: number, time = 0, type = 'image/png'): Promise<Blob> {
    const c = this.render(p, width, height, time)
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type))
  }
}

interface Scope { __comfynextTextureFx?: TextureFxRenderer }
export function resolveTextureFx(scope: Scope): TextureFxRenderer {
  return scope.__comfynextTextureFx ?? (scope.__comfynextTextureFx = new TextureFxRenderer())
}
export const textureFx = resolveTextureFx(globalThis as unknown as Scope)
```

- [ ] **Step 2: Typecheck the new module**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep texturefx || echo "no texturefx type errors"`
Expected: `no texturefx type errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/lib/texturefx/renderer.ts
git commit -m "feat(texture-studio): WebGL2 renderer mirroring the pattern sampler"
```

---

## Task 4: Node card (`TextureStudioNode.vue`)

**Files:**
- Create: `frontend/app/components/vue-canvas/TextureStudioNode.vue`

- [ ] **Step 1: Write the component**

```vue
<!-- frontend/app/components/vue-canvas/TextureStudioNode.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { textureFx } from '~/lib/texturefx/renderer'
import { textureDefaults } from '~/lib/texturefx/controls'
import type { Params } from '~/lib/spacetype/effect'

const props = defineProps<{ id: string; data?: { properties?: Record<string, unknown> } }>()

const PREVIEW_W = 240
const PREVIEW_H = 160
const canvasEl = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)

const params = computed<Params>(
  () => (props.data?.properties?.comfynext_textureStudio as Params) ?? textureDefaults(),
)

function renderFrame() {
  const c = canvasEl.value
  if (!c) return
  if (c.width !== PREVIEW_W || c.height !== PREVIEW_H) { c.width = PREVIEW_W; c.height = PREVIEW_H }
  try { c.getContext('2d')!.drawImage(textureFx.render(params.value, PREVIEW_W, PREVIEW_H, 0), 0, 0); glError.value = null }
  catch (e: any) { glError.value = String(e?.message ?? e) }
}

let timer: any
watch(params, () => { clearTimeout(timer); timer = setTimeout(renderFrame, 60) }, { deep: true })
onMounted(renderFrame)
onBeforeUnmount(() => clearTimeout(timer))

function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openTextureStudio', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div class="flex flex-col gap-2 p-2">
    <canvas ref="canvasEl" class="w-full rounded-md border border-white/10" :style="{ aspectRatio: '3 / 2' }" />
    <p v-if="glError" class="text-[10px] text-red-300">{{ glError }}</p>
    <button
      class="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
      @click="openEditor"
    >Open Texture Studio</button>
  </div>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep TextureStudioNode || echo "no TextureStudioNode type errors"`
Expected: `no TextureStudioNode type errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/TextureStudioNode.vue
git commit -m "feat(texture-studio): node card with live seamless preview"
```

---

## Task 5: Modal surface (`TextureStudioSurface.vue`)

**Files:**
- Create: `frontend/app/components/vue-canvas/TextureStudioSurface.vue`

This mirrors `GradientStudioSurface.vue`: load/save params on the node, a repeat preview with 1×/2×/3× + seam highlight, Roll (reseed), PNG export via `uploadFrameBatch`, and Send-to-canvas via the `comfynext:textureStudioOutput` event.

- [ ] **Step 1: Write the component**

```vue
<!-- frontend/app/components/vue-canvas/TextureStudioSurface.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { textureFx } from '~/lib/texturefx/renderer'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'
import { cloneParams } from '~/lib/texturefx/types'
import type { ControlSpec, Params } from '~/lib/spacetype/effect'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ close: [] }>()

const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

const params = reactive<Params>(textureDefaults())
const repeat = ref(2)
const seams = ref(true)
const baking = ref(false)
const bakeMsg = ref('')
const canvas = ref<HTMLCanvasElement | null>(null)

function currentNode() { return props.nodes.find((n) => String(n.id) === String(props.nodeId)) }

function loadParams() {
  const p = currentNode()?.data?.properties?.comfynext_textureStudio
  if (p && typeof p === 'object') Object.assign(params, { ...textureDefaults(), ...cloneParams(p) })
}
function saveParams() {
  const n = currentNode(); if (!n) return
  n.data ||= {}; n.data.properties ||= {}
  n.data.properties.comfynext_textureStudio = cloneParams({ ...params })
}
function closeEditor() { try { saveParams() } catch (e) { console.error('[texture] save failed', e) }; emit('close') }

// Sections: only allow-listed groups, in declared order.
const sections = computed(() => {
  const byGroup = new Map<string, ControlSpec[]>()
  for (const c of TEXTURE_CONTROLS) {
    const g = String(c.group)
    if (!(TEXTURE_SECTIONS as readonly string[]).includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }
  return TEXTURE_SECTIONS.filter((g) => byGroup.has(g)).map((g) => ({ title: g, controls: byGroup.get(g)! }))
})

// Repeat preview: draw the single tile `repeat`×`repeat` times into the canvas.
function renderPreview() {
  const el = canvas.value; if (!el) return
  const TILE = 256
  const n = repeat.value
  el.width = TILE * n; el.height = TILE * n
  const ctx = el.getContext('2d')!
  const tile = textureFx.render(params, TILE, TILE, 0)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) ctx.drawImage(tile, x * TILE, y * TILE)
  if (seams.value) {
    ctx.strokeStyle = 'rgba(159,232,208,0.7)'; ctx.lineWidth = 1
    for (let i = 1; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, el.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * TILE); ctx.lineTo(el.width, i * TILE); ctx.stroke()
    }
  }
}

function roll() { params.seed = Math.floor(Math.random() * 1e6); renderPreview() }
function setRepeat(n: number) { repeat.value = n; renderPreview() }
function toggleSeams() { seams.value = !seams.value; renderPreview() }
function onParam() { renderPreview() }

async function sendToCanvas() {
  baking.value = true; bakeMsg.value = 'Rendering…'
  try {
    const blob = await textureFx.renderToBlob(params, 1024, 1024, 0)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'texture_img')
    if (filename) {
      saveParams()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:textureStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } catch (e) { console.error('[texture] send failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false }
}

async function downloadPng() {
  const blob = await textureFx.renderToBlob(params, 1024, 1024, 0)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `texture_${params.seed}.png`; a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(() => { loadParams(); renderPreview() })
onBeforeUnmount(() => {})
</script>

<template>
  <StudioModalShell title="Texture Studio" @close="closeEditor">
    <template #preview>
      <div class="flex h-full flex-col items-center justify-center gap-3 p-4">
        <canvas ref="canvas" class="max-h-[60vh] max-w-full rounded-lg border border-white/10" />
        <div class="flex items-center gap-2 text-xs">
          <button v-for="n in [1,2,3]" :key="n"
                  class="rounded border px-2 py-1"
                  :class="repeat===n ? 'border-white bg-white/10' : 'border-white/15'"
                  @click="setRepeat(n)">{{ n }}×</button>
          <button class="rounded border px-2 py-1"
                  :class="seams ? 'border-white bg-white/10' : 'border-white/15'"
                  @click="toggleSeams">Highlight seams</button>
        </div>
      </div>
    </template>

    <template #actions>
      <StudioButton variant="secondary" @click="roll">🎲 Roll · seed {{ params.seed }}</StudioButton>
      <StudioButton variant="secondary" @click="downloadPng">Download PNG</StudioButton>
      <StudioButton variant="primary" :disabled="baking" @click="sendToCanvas">{{ baking ? bakeMsg : 'Send to canvas' }}</StudioButton>
    </template>

    <template #controls>
      <StudioSection v-for="s in sections" :key="s.title" :title="s.title">
        <div v-for="c in s.controls" :key="c.key" class="text-xs">
          <label v-if="c.kind !== 'slider'" class="mb-1 block text-white/60">{{ c.label }}</label>
          <StudioSlider v-if="c.kind === 'slider'"
            :label="c.label" :min="Number(c.min)" :max="Number(c.max)" :step="Number(c.step)" :default="Number(c.default)"
            :model-value="Number(params[c.key])"
            @update:model-value="(v: number) => { params[c.key] = v; onParam() }" />
          <StudioSelect v-else-if="c.kind === 'select'"
            :options="c.options"
            :model-value="String(params[c.key])"
            @update:model-value="(v: string) => { params[c.key] = v; onParam() }" />
          <StudioColor v-else-if="c.kind === 'color'"
            :model-value="String(params[c.key])"
            @update:model-value="(v: string) => { params[c.key] = v; onParam() }" />
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep TextureStudioSurface || echo "no TextureStudioSurface type errors"`
Expected: `no TextureStudioSurface type errors`. (If `StudioModalShell` slot names differ from `preview`/`actions`/`controls`, open `StudioModalShell.vue` and match its actual `<slot name=…>` — adjust the template to those names.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/TextureStudioSurface.vue
git commit -m "feat(texture-studio): modal surface with repeat preview, seams, roll, export"
```

---

## Task 6: Register in `VueNodeCanvas.vue`

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (mirror the Gradient Studio blocks; search for `gradientStudioOpenForId`, `handleOpenGradientStudio`, `comfynext:openGradientStudio`, and the `GradientStudioOutput` listener and Teleport).

- [ ] **Step 1: Add the open-state ref + handler** (next to `handleOpenGradientStudio`)

```typescript
const textureStudioOpenForId = ref<string | null>(null)
function handleOpenTextureStudio(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) textureStudioOpenForId.value = String(detail.nodeId)
}
```

- [ ] **Step 2: Register listeners** (next to the `comfynext:openGradientStudio` and `comfynext:gradientStudioOutput` listeners — reuse the **existing** output handler used for gradient/spacetype outputs; find its exact name in the file, e.g. `handleSpaceTypeOutput`, and add a matching `addEventListener` for the texture event)

```typescript
window.addEventListener('comfynext:openTextureStudio', handleOpenTextureStudio)
window.addEventListener('comfynext:textureStudioOutput', handleSpaceTypeOutput) // same {sourceNodeId,nodeType,widgetOverrides} contract
```

Add the matching `removeEventListener` calls wherever the gradient ones are torn down (search `removeEventListener('comfynext:openGradientStudio'`).

- [ ] **Step 3: Add the Teleport** (next to the `GradientStudioSurface` Teleport)

```vue
<Teleport to="body">
  <VueCanvasTextureStudioSurface
    v-if="textureStudioOpenForId"
    :node-id="textureStudioOpenForId"
    :nodes="nodes as any[]"
    @close="textureStudioOpenForId = null"
  />
</Teleport>
```

> Confirm the auto-import component name: Nuxt names it from the path `components/vue-canvas/TextureStudioSurface.vue` → `<VueCanvasTextureStudioSurface>`, matching the existing `<VueCanvasGradientStudioSurface>`.

- [ ] **Step 4: Verify the dev server boots clean**

Run: `cd frontend && npm run dev` (then check the terminal for compile errors; Ctrl-C after it reports "ready"). Expected: no Vue/TS compile errors mentioning Texture Studio.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(texture-studio): register open/output events + surface teleport"
```

---

## Task 7: Visual verification harness + sign-off

**Files:**
- Create: `frontend/.playground/texture-harness.html`

> Per the standing rule (never ship a visual/WebGL effect on unit tests alone): this harness renders each lattice×motif tile **2×2** and overlays the `pattern.ts` CPU reference at low opacity, so any shader/sampler mismatch shows as a visible ghost. Iterate via Playwright screenshot until the look is signed off.

- [ ] **Step 1: Write the harness**

```html
<!-- frontend/.playground/texture-harness.html -->
<!doctype html><html><head><meta charset="utf-8"><title>Texture harness</title>
<style>body{background:#0e1116;color:#e8eef5;font-family:system-ui;margin:0;padding:16px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
figure{margin:0}canvas{width:100%;image-rendering:pixelated;border:1px solid #333}
figcaption{font-size:11px;opacity:.6;margin-top:4px}</style></head>
<body><h3>Lattice × Motif — each tile drawn 2×2 (must be seamless)</h3><div class="grid" id="g"></div>
<script type="module">
import { patternColor } from '/app/lib/texturefx/pattern.ts'
import { textureDefaults } from '/app/lib/texturefx/controls.ts'
const LAT=['square','brick','diagonal'], MOT=['checker','stripes','dots','grid']
const TILE=120
for(const lattice of LAT) for(const motif of MOT){
  const p={...textureDefaults(),lattice,motif,cells:8,jitter:0.3,seed:7}
  const cv=document.createElement('canvas'); cv.width=TILE*2; cv.height=TILE*2
  const ctx=cv.getContext('2d'); const img=ctx.createImageData(TILE,TILE)
  for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++){
    const c=patternColor(p,x/TILE,y/TILE); const i=(y*TILE+x)*4
    img.data[i]=c[0]*255; img.data[i+1]=c[1]*255; img.data[i+2]=c[2]*255; img.data[i+3]=255
  }
  const t=document.createElement('canvas'); t.width=TILE;t.height=TILE; t.getContext('2d').putImageData(img,0,0)
  for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++) ctx.drawImage(t,xx*TILE,yy*TILE)
  const fig=document.createElement('figure'); fig.appendChild(cv)
  const cap=document.createElement('figcaption'); cap.textContent=`${lattice} / ${motif}`; fig.appendChild(cap)
  document.getElementById('g').appendChild(fig)
}
</script></body></html>
```

- [ ] **Step 2: Serve + screenshot**

Run (with the dev server up so `/app/...` and `.ts` resolve via Vite):
`cd frontend && npm run dev` in one shell, then open `http://localhost:3000/.playground/texture-harness.html` (or use a Playwright screenshot script targeting that URL). Inspect that every 2×2 tile is seamless — no visible seam at the tile midlines.

- [ ] **Step 3: User sign-off**

Present the screenshot. Get explicit approval of the look before considering Slice 1 done. Iterate on `pattern.ts` / `FS` together (keep them in sync) until approved.

- [ ] **Step 4: Run the full unit suite + commit**

```bash
cd frontend && npm run test:unit
git add frontend/.playground/texture-harness.html
git commit -m "test(texture-studio): visual seamlessness harness"
```

---

## Self-review (completed)

- **Spec coverage (Slice 1 scope):** lattice (square/brick/diagonal — *hex deferred to Slice 2, noted*), procedural cell content, live repeat preview + highlight-seams, seeded Roll, PNG export + Send-to-canvas, persistence to `comfynext_textureStudio`, registration, seamless unit tests, visual harness — all have tasks. Truchet, stylize, raster, AI-seamless, WFC, SVG/video are explicitly out of Slice 1 (roadmap §2–6).
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every command has expected output.
- **Type consistency:** `patternColor`/`latticeCell` signatures match between `pattern.ts`, the test, and the GLSL mirror; `textureDefaults()` returns the same keys used by `controls.ts`, the renderer, node, and surface; event names (`comfynext:openTextureStudio`, `comfynext:textureStudioOutput`) and property key (`comfynext_textureStudio`) are identical everywhere; output event detail matches the existing `{ sourceNodeId, nodeType, widgetOverrides }` handler.
- **Known follow-ups for executor:** confirm `StudioModalShell` slot names and the existing output-handler function name in `VueNodeCanvas.vue` before wiring (flagged inline in Tasks 5–6).
