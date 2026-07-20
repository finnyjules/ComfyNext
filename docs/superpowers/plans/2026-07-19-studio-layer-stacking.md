# Studio Layer Stacking (Gradient + Shader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users stack up to 6 full-instance layers in the Gradient and Shader studios, each with its own blend mode + opacity, reorderable, managed from a shared left-panel layer list.

**Architecture:** A shared `StudioLayerStack.vue` aside component + a shared `~/lib/studio/blend.ts` module supply identical chrome and blending to both studios. Gradient generalizes its fixed 2-layer render path to N via `sampler2DArray` field/ramp textures and a bounded composite loop. Shader turns its single `effect` slot into an ordered `effects[]` chain, adding a hold-FBO composite pass for per-layer blend/opacity while keeping the pure-`normal` chain byte-identical.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 (GLSL ES 3.00), Vitest (unit tests for pure logic), dev harness pages for GL/UI verification.

## Global Constraints

- **Max layers:** `LAYER_MAX = 6` in both studios. Exact constant name in both.
- **Blend modes (verbatim):** `normal | lighten | screen | add | multiply | darken | overlay`. Index map: `{ normal:0, lighten:1, screen:2, add:3, multiply:4, darken:5, overlay:6 }`.
- **Back-compat:** existing saved docs (2-layer gradient, single-effect shader) MUST render byte-identically after the change. This is an acceptance test on Tasks 3 and 6.
- **Layer 0 is the base** in both studios — composited directly over background (gradient) / source (shader); its blend/opacity controls are hidden.
- **Relief keeps lighting gradient layer 0 only** — do not generalize `bandHeight(0, …)`.
- **GLSL program changes require a full page reload** (not HMR) to rebuild — always reload before judging a shader change in a harness.
- **Test reality:** the repo runs vitest via `npx vitest run` with `include: ['tests/unit/**/*.unit.spec.ts']`. ALL new unit tests MUST live in `frontend/tests/unit/<name>.unit.spec.ts` and import source via the `~/` alias (= `frontend/app`). Co-located `app/lib/*.test.ts` files are NOT picked up — never use that location. The suite currently has ~6 pre-existing failing files from the dirty parallel tree; "no new failures" means that count does not rise. Verify GL/UI via the dev labs + typecheck + Vite compile-check.
- **Typecheck baseline:** ~328 pre-existing errors. "No new errors" means the count does not rise.
- **Commit hygiene:** stage only the files listed per task (`git add <exact paths>`); never `git stash`; commit directly on the working branch.

---

## File Structure

**New files:**
- `frontend/app/lib/studio/blend.ts` — shared `BlendKind`, `BLEND_MODES`, `BLEND_IDX`, `BLEND_LAYERS_GLSL`.
- `frontend/tests/unit/studio-blend.unit.spec.ts` — vitest unit test for the blend module.
- `frontend/app/components/vue-canvas/StudioLayerStack.vue` — shared aside layer-list component.
- `frontend/app/lib/shaderstudio/migrate.ts` — `effect → effects[]` migration.
- `frontend/tests/unit/shaderstudio-migrate.unit.spec.ts` — vitest unit test for the migration.
- `frontend/tests/unit/gradientfx-motion-remap.unit.spec.ts` — vitest unit test for gradient track remap.
- `frontend/app/pages/dev/shader-studio-lab.vue` — modal harness for the shader studio.

**Modified files:**
- `frontend/app/lib/gradientfx/types.ts` — `LAYER_MAX`; re-export blend from shared.
- `frontend/app/lib/gradientfx/shaders.ts` — `[LAYER_MAX]` uniforms, `sampler2DArray`, composite loop, shared blend snippet.
- `frontend/app/lib/gradientfx/renderer.ts` — array textures, `u_fieldW`, `LAYER_MAX` uploads.
- `frontend/app/components/vue-canvas/GradientStudioSurface.vue` — aside stack, N-layer UI, track remap.
- `frontend/app/lib/gradientfx/motion.ts` — gradient track remap helper.
- `frontend/app/lib/shaderstudio/types.ts` — `effects[]`, `StudioEffect` blend/opacity/id, `version`.
- `frontend/app/lib/shaderstudio/passes.ts` — loop effects, snapshot/composite passes.
- `frontend/app/lib/shaderfx/renderer.ts` — hold FBO, snapshot + composite pass kinds.
- `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` — aside stack, active-effect editing, track remap, agent scope.
- `frontend/app/components/vue-canvas/ShaderStudioNode.vue` — updated `composePasses` call.

---

## Task 1: Shared blend module

**Files:**
- Create: `frontend/app/lib/studio/blend.ts`
- Create: `frontend/tests/unit/studio-blend.unit.spec.ts`
- Modify: `frontend/app/lib/gradientfx/types.ts` (re-export `BlendKind`, `BLEND_MODES`)
- Modify: `frontend/app/lib/gradientfx/renderer.ts:20` (import `BLEND_IDX` from shared)
- Modify: `frontend/app/lib/gradientfx/shaders.ts:536-545` (inject shared GLSL snippet)

**Interfaces:**
- Produces:
  - `export type BlendKind = 'normal'|'lighten'|'screen'|'add'|'multiply'|'darken'|'overlay'`
  - `export const BLEND_MODES: BlendKind[]`
  - `export const BLEND_IDX: Record<BlendKind, number>`
  - `export const BLEND_LAYERS_GLSL: string` — defines `vec3 blendLayers(vec3 base, vec3 src, float mode)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/studio-blend.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BLEND_MODES, BLEND_IDX, BLEND_LAYERS_GLSL } from '~/lib/studio/blend'

describe('studio blend module', () => {
  it('maps every mode to a stable index', () => {
    expect(BLEND_IDX).toEqual({
      normal: 0, lighten: 1, screen: 2, add: 3, multiply: 4, darken: 5, overlay: 6,
    })
  })
  it('lists all seven modes in index order', () => {
    expect(BLEND_MODES).toEqual(['normal', 'lighten', 'screen', 'add', 'multiply', 'darken', 'overlay'])
  })
  it('exposes a blendLayers GLSL function', () => {
    expect(BLEND_LAYERS_GLSL).toContain('vec3 blendLayers(vec3 base, vec3 src, float mode)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run studio-blend`
Expected: FAIL — cannot resolve `./blend`.

- [ ] **Step 3: Write the module**

Create `frontend/app/lib/studio/blend.ts`:

```ts
// Shared layer-blend vocabulary for the studios (gradient, shader, later pattern).
// Both the gradient fragment shader and the shader-studio composite pass import
// BLEND_LAYERS_GLSL so the two can never blend differently.

export type BlendKind = 'normal' | 'lighten' | 'screen' | 'add' | 'multiply' | 'darken' | 'overlay'

export const BLEND_MODES: BlendKind[] = ['normal', 'lighten', 'screen', 'add', 'multiply', 'darken', 'overlay']

export const BLEND_IDX: Record<BlendKind, number> = {
  normal: 0, lighten: 1, screen: 2, add: 3, multiply: 4, darken: 5, overlay: 6,
}

/** GLSL ES 3.00 snippet defining `blendLayers`. Inject into a fragment source. */
export const BLEND_LAYERS_GLSL = `
vec3 blendLayers(vec3 base, vec3 src, float mode) {
  int m = int(mode + 0.5);
  if (m == 1) return max(base, src);
  if (m == 2) return 1.0 - (1.0 - base) * (1.0 - src);
  if (m == 3) return min(base + src, vec3(1.0));
  if (m == 4) return base * src;
  if (m == 5) return min(base, src);
  if (m == 6) return mix(2.0 * base * src, 1.0 - 2.0 * (1.0 - base) * (1.0 - src), step(0.5, base));
  return src; // normal
}
`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run studio-blend`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export from gradientfx/types.ts and remove the local duplicate**

In `frontend/app/lib/gradientfx/types.ts`: delete the local `BlendKind` definition (line 15) and the `BLEND_MODES` const (line 249), and add near the top:

```ts
export { type BlendKind, BLEND_MODES } from '~/lib/studio/blend'
```

- [ ] **Step 6: Point the renderer at the shared index map**

In `frontend/app/lib/gradientfx/renderer.ts`: remove the local `BLEND_IDX` (line 20) and import it:

```ts
import { BLEND_IDX } from '~/lib/studio/blend'
```

- [ ] **Step 7: Inject the shared GLSL into the gradient shader**

In `frontend/app/lib/gradientfx/shaders.ts`: delete the inline `blendLayers` definition (lines 536-545). At the top of the file add:

```ts
import { BLEND_LAYERS_GLSL } from '~/lib/studio/blend'
```

Then interpolate `${BLEND_LAYERS_GLSL}` into the fragment source template string at the location the definition used to occupy (before `computeLayer`). Verify the fragment source is a template literal (it is — it contains `uniform sampler2D u_field0;`).

- [ ] **Step 8: Typecheck + compile-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c error` (compare to ~328 baseline — must not rise).
Then the Vite compile-check on the touched modules (fetch each through the dev server transform, or `npx vitest run` for the ts files). Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/studio/blend.ts frontend/tests/unit/studio-blend.unit.spec.ts \
        frontend/app/lib/gradientfx/types.ts frontend/app/lib/gradientfx/renderer.ts \
        frontend/app/lib/gradientfx/shaders.ts
git commit -m "refactor(studio): extract shared blend module"
```

---

## Task 2: Shared StudioLayerStack component

**Files:**
- Create: `frontend/app/components/vue-canvas/StudioLayerStack.vue`

**Interfaces:**
- Produces a component with:
  - Props: `layers: { label: string; enabled: boolean; thumb?: string }[]`, `activeIndex: number`, `max: number`.
  - Emits: `select(i: number)`, `reorder(from: number, to: number)`, `add()`, `remove(i: number)`, `duplicate(i: number)`, `toggle(i: number)`.

This component has no independently observable behavior on its own; it is verified when wired into the Gradient studio (Task 4) and shown in the gradient lab. Verification here is typecheck + Vite compile only.

- [ ] **Step 1: Write the component**

Create `frontend/app/components/vue-canvas/StudioLayerStack.vue`:

```vue
<script setup lang="ts">
// Shared aside layer list for the studios. Pure presentation: renders an ordered
// list of layers (top = front), and emits intents. Reorder is via native HTML5
// drag on the row handle. Holds no studio-specific logic.
import { ref } from 'vue'
import { Plus, X, Copy, GripVertical, Eye, EyeOff } from 'lucide-vue-next'

defineProps<{
  layers: { label: string; enabled: boolean; thumb?: string }[]
  activeIndex: number
  max: number
}>()
const emit = defineEmits<{
  select: [i: number]; reorder: [from: number, to: number]
  add: []; remove: [i: number]; duplicate: [i: number]; toggle: [i: number]
}>()

const dragFrom = ref<number | null>(null)
function onDrop(to: number) {
  if (dragFrom.value !== null && dragFrom.value !== to) emit('reorder', dragFrom.value, to)
  dragFrom.value = null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-xs font-medium text-white/70">Layers</span>
      <button v-if="layers.length < max" aria-label="Add layer"
              class="rounded bg-white/[0.06] p-1 text-white/60 hover:text-white" @click="emit('add')">
        <Plus class="h-3.5 w-3.5" />
      </button>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <!-- Rendered front-to-back: index 0 (base) sits at the BOTTOM of the list. -->
      <div v-for="i in layers.map((_, k) => layers.length - 1 - k)" :key="i"
           draggable="true"
           @dragstart="dragFrom = i" @dragover.prevent @drop="onDrop(i)"
           @click="emit('select', i)"
           class="group flex cursor-grab items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition"
           :class="activeIndex === i ? 'border-white/25 bg-white/[0.10] text-white'
                                     : 'border-transparent bg-white/[0.03] text-white/60 hover:bg-white/[0.06]'">
        <GripVertical class="h-3.5 w-3.5 shrink-0 text-white/25" />
        <img v-if="layers[i]!.thumb" :src="layers[i]!.thumb" class="h-6 w-6 shrink-0 rounded object-cover" />
        <span class="min-w-0 flex-1 truncate">{{ layers[i]!.label }}</span>
        <button aria-label="Toggle layer" class="shrink-0 text-white/30 hover:text-white/80"
                @click.stop="emit('toggle', i)">
          <Eye v-if="layers[i]!.enabled" class="h-3.5 w-3.5" />
          <EyeOff v-else class="h-3.5 w-3.5" />
        </button>
        <button aria-label="Duplicate layer" class="shrink-0 text-white/0 group-hover:text-white/40 hover:!text-white/80"
                @click.stop="emit('duplicate', i)">
          <Copy class="h-3 w-3" />
        </button>
        <button v-if="layers.length > 1" aria-label="Remove layer"
                class="shrink-0 text-white/0 group-hover:text-white/40 hover:!text-white/80"
                @click.stop="emit('remove', i)">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Typecheck + compile-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c error` (must not rise above baseline). Confirm `lucide-vue-next` icons used (`GripVertical`, `Eye`, `EyeOff`, `Copy`) exist (they are already used elsewhere in the repo — grep to confirm).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/StudioLayerStack.vue
git commit -m "feat(studio): shared StudioLayerStack aside component"
```

---

## Task 3: Gradient render core — 2 → N layers

**Files:**
- Modify: `frontend/app/lib/gradientfx/types.ts` (add `LAYER_MAX`)
- Modify: `frontend/app/lib/gradientfx/shaders.ts` (uniforms, samplers, sampleField/Ramp, composite loop)
- Modify: `frontend/app/lib/gradientfx/renderer.ts` (array textures, `u_fieldW`, uploads, `arr`, slice)

**Interfaces:**
- Consumes: `BLEND_IDX`, `BLEND_LAYERS_GLSL` (Task 1).
- Produces: `export const LAYER_MAX = 6` in `types.ts`. Render path composites `cfg.layers[0..LAYER_MAX-1]`.

**Background — why array textures:** each layer needs a field texture + ramp texture. GLSL ES can't index a sampler array by a loop variable, so fields/ramps become `sampler2DArray`. `buildField` returns a variable-width `Float32Array` (width = clamped bar count, 1..256), so each field is stored **left-aligned** in a fixed 256-wide array layer and the sample coord is scaled by `u_fieldW[i]/256` (exact — texel centers still return exact bar values). Ramps are already 256-wide (`LUT_W`), so they map 1:1.

- [ ] **Step 1: Add the cap constant**

In `frontend/app/lib/gradientfx/types.ts`, near the other exports:

```ts
export const LAYER_MAX = 6
```

Update the `layers` doc comment (line 237) from `/** 1 or 2 layers. */` to `/** 1..LAYER_MAX layers. */`.

- [ ] **Step 2: Widen shader uniform arrays and switch samplers to arrays**

In `frontend/app/lib/gradientfx/shaders.ts`:

Add a `#define` after the `#version` line of the fragment source:
```glsl
#define LAYER_MAX 6
```

Replace every `[2]` on the per-layer uniform arrays (lines 37-56: `u_count`, `u_dir`, `u_mirrorH`, `u_mirrorV`, `u_gradHoriz`, `u_gap`, `u_rounding`, `u_mapping`, `u_steps`, `u_hueDrift`, `u_hueRotate`, `u_sweep`, `u_scrub`, `u_blend`, `u_opacity`, `u_crisp`, `u_rotStep`, `u_pivot`, `u_ringScale`, `u_ringShape`) with `[LAYER_MAX]`. Add one new uniform:
```glsl
uniform float u_fieldW[LAYER_MAX]; // field texel width per layer (for coord scaling)
```

Replace the four sampler declarations (lines 89-92) with:
```glsl
uniform sampler2DArray u_fields;
uniform sampler2DArray u_ramps;
```

Replace `sampleField` / `sampleRamp` (lines 223-229) with:
```glsl
float sampleField(int i, float x) {
  float sx = clamp(x, 0.0, 1.0) * (u_fieldW[i] / 256.0);
  return textureLod(u_fields, vec3(sx, 0.5, float(i)), 0.0).r;
}
vec3 sampleRamp(int i, float t) {
  return textureLod(u_ramps, vec3(clamp(t, 0.0, 1.0), 0.5, float(i)), 0.0).rgb;
}
```

- [ ] **Step 3: Replace the unrolled composite with a bounded loop**

In `frontend/app/lib/gradientfx/shaders.ts`, replace lines 557-567 (`vec4 l0 = computeLayer(0, pw); … cover = max(cover, a); }`) with:

```glsl
  vec3 col = u_bg;
  float cover = 0.0;
  for (int i = 0; i < LAYER_MAX; i++) {
    if (float(i) > u_layerCount - 0.5) break;
    vec4 li = computeLayer(i, pw);
    if (i == 0) {
      col = mix(col, li.rgb, li.a);
      cover = li.a;
    } else {
      vec3 b = blendLayers(col, li.rgb, u_blend[i]);
      float a = li.a * u_opacity[i];
      col = mix(col, b, a);
      cover = max(cover, a);
    }
  }
```

(The `vec3 col = u_bg;` on line 555 is now redundant — remove the old declaration so `col` is declared once here.)

- [ ] **Step 4: Convert renderer textures to 2D arrays**

In `frontend/app/lib/gradientfx/renderer.ts`:

Replace the per-slot texture fields (line 29 `fieldTex`/`rampTex` arrays) with two array textures:
```ts
private fieldArrayTex: WebGLTexture | null = null
private rampArrayTex: WebGLTexture | null = null
```

In the init block (line 44, `for (let i = 0; i < 2; i++) { … createTexture() }`) replace with allocation of the two array textures at `256 × 1 × LAYER_MAX`:
```ts
const mk = (internal: number) => {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t)
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internal, 256, 1, LAYER_MAX)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
this.fieldArrayTex = mk(gl.R8)
this.rampArrayTex = mk(gl.RGBA8)
```
(Import `LAYER_MAX` from `./types`.)

- [ ] **Step 5: Rewrite uploadField / uploadRamp to target array layers**

Replace `uploadField` (lines 117-128) and `uploadRamp` (lines 130-139):

```ts
private uploadField(gl: WebGL2RenderingContext, layer: number, data: Float32Array) {
  const bytes = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, data[i]!)) * 255)
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldArrayTex!)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  // left-aligned: width = data.length (<=256); the shader scales coords by u_fieldW/256
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, data.length, 1, 1, gl.RED, gl.UNSIGNED_BYTE, bytes)
}

private uploadRamp(gl: WebGL2RenderingContext, layer: number, lut: Uint8Array) {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.rampArrayTex!)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, lut.length / 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, lut)
}
```

- [ ] **Step 6: Generalize the per-layer upload loop, `arr`, and slice**

In `render()`:
- Line 148 `const layers = c.layers.slice(0, 2)` → `const layers = c.layers.slice(0, LAYER_MAX)`.
- Line 149 `const arr = (vals) => new Float32Array([vals[0] ?? 0, vals[1] ?? vals[0] ?? 0])` → 
  ```ts
  const arr = (vals: number[]) => {
    const out = new Float32Array(LAYER_MAX)
    for (let i = 0; i < LAYER_MAX; i++) out[i] = vals[i] ?? vals[0] ?? 0
    return out
  }
  ```
- Line 157 `for (let i = 0; i < 2; i++)` → `for (let i = 0; i < layers.length; i++)`.
- Inside the loop, add `fieldW.push(fieldData.length)` where `fieldData` is the built field. Change lines 160-161 to:
  ```ts
  const fieldData = buildField(s, c.seed + ':' + i)
  this.uploadField(gl, i, fieldData)
  this.uploadRamp(gl, i, buildRampLut(col.stops))
  fieldW.push(fieldData.length)
  ```
- Declare `fieldW: number[] = []` alongside the other per-layer arrays (line 153-156).

- [ ] **Step 7: Bind the array textures and upload `u_fieldW`**

Replace the sampler bindings (lines 184-187 `u_field0/1`, `u_ramp0/1`) with:
```ts
gl.activeTexture(gl.TEXTURE0)
gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldArrayTex)
gl.uniform1i(u('u_fields'), 0)
gl.activeTexture(gl.TEXTURE1)
gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.rampArrayTex)
gl.uniform1i(u('u_ramps'), 1)
```
Add near the other `uniform1fv` calls (after line 301):
```ts
gl.uniform1fv(u('u_fieldW'), arr(fieldW))
```
Ensure `u_layerCount` (line 209) uploads `layers.length` (already does).

**Note:** `uploadField`/`uploadRamp` previously used `activeTexture(TEXTURE0+slot)` / `TEXTURE0+2+slot`; those units are now free. Any other texture (mesh, flow) keeps its own unit — grep for `activeTexture` in this file and confirm no unit collision with 0/1 now used by the arrays. If a collision exists, move the array binds to higher units and update the `uniform1i` targets accordingly.

- [ ] **Step 8: Typecheck + compile-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c error` (must not rise).

- [ ] **Step 9: Verify back-compat + N layers in the gradient lab**

Start this session's server (`preview_start name: frontend-harness`) and open `dev/gradient-studio-lab`. **Full-reload** the page (GLSL program rebuild).
- Back-compat: with the default single-layer gradient, screenshot — must look like a normal gradient (no regression).
- Two layers: via the lab console, push a second layer (`config.layers.push(structuredClone(config.layers[0])); config.layers[1].blend='screen'; config.layers[1].opacity=0.6`), trigger a re-render; confirm it blends.
- N layers: push up to 6 layers with distinct colors + blends; confirm each composites in order, no artifacts, no GL errors in console.
Capture a screenshot as proof.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/lib/gradientfx/types.ts frontend/app/lib/gradientfx/shaders.ts \
        frontend/app/lib/gradientfx/renderer.ts
git commit -m "feat(gradient): render N layers via sampler2DArray fields/ramps"
```

---

## Task 4: Gradient UI — N-layer stack in the aside

**Files:**
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue`
- Modify: `frontend/app/lib/gradientfx/motion.ts` (track remap helper)

**Interfaces:**
- Consumes: `StudioLayerStack` (Task 2), `LAYER_MAX` (Task 3).
- Produces: `export function remapTracksOnReorder(tracks, from, to)` and `export function dropTracksForLayer(tracks, removed)` in `motion.ts` (operate on the gradient `MotionTrack[]`, keying off `track.layer`).

- [ ] **Step 1: Add motion track remap helpers (with test)**

Create `frontend/tests/unit/gradientfx-motion-remap.unit.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { remapTracksOnReorder, dropTracksForLayer } from '~/lib/gradientfx/motion'

const mk = (layer: number) => ({ layer, param: 'phase', from: 0, to: 1, easing: 'linear' as const, loops: 1, hold: 0, cycleOffset: 0, delay: 0 })

describe('gradient motion track remap', () => {
  it('follows a layer moved from 2 to 0', () => {
    const t = [mk(2)]
    remapTracksOnReorder(t, 2, 0)
    expect(t[0]!.layer).toBe(0)
  })
  it('shifts intermediate layers when reordering', () => {
    const t = [mk(0), mk(1)]
    remapTracksOnReorder(t, 0, 1) // layer 0 moves to slot 1; old layer 1 shifts to 0
    expect(t.map(x => x.layer)).toEqual([1, 0])
  })
  it('drops tracks for a removed layer and renumbers higher ones', () => {
    const t = [mk(0), mk(1), mk(2)]
    const kept = dropTracksForLayer(t, 1)
    expect(kept.map(x => x.layer)).toEqual([0, 1]) // layer 2 became 1
  })
})
```

Run: `cd frontend && npx vitest run gradientfx-motion-remap` → FAIL (functions undefined).

Add to `frontend/app/lib/gradientfx/motion.ts`:
```ts
import type { MotionTrack } from './types'

/** Mutate tracks so `track.layer` follows a layer moved from index `from` to `to`. */
export function remapTracksOnReorder(tracks: MotionTrack[], from: number, to: number): void {
  const move = (l: number): number => {
    if (l === from) return to
    if (from < to && l > from && l <= to) return l - 1
    if (from > to && l >= to && l < from) return l + 1
    return l
  }
  for (const t of tracks) t.layer = move(t.layer)
}

/** Return tracks with those on `removed` dropped and higher indices decremented. */
export function dropTracksForLayer(tracks: MotionTrack[], removed: number): MotionTrack[] {
  return tracks.filter(t => t.layer !== removed).map(t => ({ ...t, layer: t.layer > removed ? t.layer - 1 : t.layer }))
}
```

Run the test again → PASS.

- [ ] **Step 2: Provide the aside slot in the surface template**

In `frontend/app/components/vue-canvas/GradientStudioSurface.vue`, inside `<StudioModalShell …>`, add a `#aside` template that maps layers to the stack:

```vue
<template #aside>
  <StudioLayerStack
    :layers="config.layers.map((l, i) => ({ label: `Layer ${i + 1}`, enabled: layerEnabled(i) }))"
    :active-index="activeLayer" :max="LAYER_MAX"
    @select="activeLayer = $event"
    @add="addLayer" @remove="removeLayer" @duplicate="duplicateLayer"
    @reorder="reorderLayer" @toggle="toggleLayer" />
</template>
```

Import `StudioLayerStack` and `LAYER_MAX`. Gradient `LayerConfig` has no `enabled` field; model enable as opacity (a disabled layer renders with opacity 0). Add:
```ts
const disabledOpacity = new Map<number, number>() // remembers pre-toggle opacity
function layerEnabled(i: number) { return !disabledOpacity.has(i) }
function toggleLayer(i: number) {
  const L = config.value.layers[i]!
  if (disabledOpacity.has(i)) { L.opacity = disabledOpacity.get(i)!; disabledOpacity.delete(i) }
  else { disabledOpacity.set(i, L.opacity); L.opacity = 0 }
  onEdit('layer.opacity', L.opacity)
}
```
(Layer 0 has no `opacity` uniform effect since it's the base — its toggle is a no-op visually; acceptable, or hide the eye on index 0 in the stack. Keep simple: allow toggle on all; layer 0 opacity is ignored by the shader so toggling it does nothing, which is fine.)

- [ ] **Step 3: Raise the add cap and add duplicate/reorder handlers**

Change `addLayer`'s guard (line 421) `if (config.value.layers.length >= 2) return` → `>= LAYER_MAX`. Add:
```ts
function duplicateLayer(i: number) {
  if (config.value.layers.length >= LAYER_MAX) return
  const clone = structuredClone(toRaw(config.value.layers[i]!))
  config.value.layers.splice(i + 1, 0, clone)
  remapTracksInsert(i + 1)
  activeLayer.value = i + 1
}
function reorderLayer(from: number, to: number) {
  const [moved] = config.value.layers.splice(from, 1)
  config.value.layers.splice(to, 0, moved!)
  remapTracksOnReorder(config.value.motion.tracks, from, to)
  activeLayer.value = to
}
```
Import `remapTracksOnReorder`, `dropTracksForLayer`, `toRaw`. Add a small `remapTracksInsert(at)` that increments `track.layer >= at`. Update `removeLayer` (line 430) to also run:
```ts
config.value.motion.tracks = dropTracksForLayer(config.value.motion.tracks, i)
```

- [ ] **Step 4: Remove the old horizontal chip strip**

In the "Layers" `StudioSection` (lines 955-976), delete the chip `<div>` (957-963) — the stack now owns add/remove/select. Keep the blend + opacity `<template v-if="activeLayer > 0">` block (it edits the active layer). Optionally retitle the section "Layer" and let it show only blend/opacity for the active non-base layer.

- [ ] **Step 5: Typecheck + compile-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c error` (must not rise).

- [ ] **Step 6: Verify in the gradient lab**

Open `dev/gradient-studio-lab`, full-reload. Using the UI (not console this time):
- Add layers up to 6; confirm the add button disables at 6.
- Select each layer; confirm Shape/Color/Blend/Opacity edit the selected layer.
- Drag to reorder; confirm the composite order changes and the active selection follows.
- Toggle a layer's eye; confirm it hides/shows.
- Duplicate a layer; confirm a copy appears above it.
Screenshot the 4–6 layer state as proof.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/GradientStudioSurface.vue \
        frontend/app/lib/gradientfx/motion.ts frontend/tests/unit/gradientfx-motion-remap.unit.spec.ts
git commit -m "feat(gradient): N-layer stack UI in the aside panel"
```

---

## Task 5: Shader config — effects[] + migration

**Files:**
- Modify: `frontend/app/lib/shaderstudio/types.ts` (`StudioEffect` fields, `effects[]`, `version`, `LAYER_MAX`)
- Create: `frontend/app/lib/shaderstudio/migrate.ts`
- Create: `frontend/tests/unit/shaderstudio-migrate.unit.spec.ts`

**Interfaces:**
- Consumes: `BlendKind`, `BLEND_MODES` (Task 1).
- Produces:
  - `StudioEffect` gains `blend: BlendKind`, `opacity: number`, `id: string` (stable layer id — distinct from the catalog effect id, which stays as `.effectId`? No — keep the catalog id on `.id` as today; add a NEW `layerId`). **Decision:** rename is risky; keep catalog id on `.id`, add `layerId: string` for identity.
  - `ShaderStudioConfig.effects: StudioEffect[]` replaces `.effect`. Bump `version` to `2`.
  - `export function migrateShaderConfig(raw: any): ShaderStudioConfig` — wraps a legacy `.effect` into `.effects: [ … ]`.

- [ ] **Step 1: Write the migration test**

Create `frontend/tests/unit/shaderstudio-migrate.unit.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { migrateShaderConfig } from '~/lib/shaderstudio/migrate'

describe('shader config migration', () => {
  it('wraps a legacy single effect into effects[]', () => {
    const legacy = { version: 1, effect: { id: 'halftone', params: { u_size: 4 }, enabled: true }, duotone: { enabled: false } }
    const out = migrateShaderConfig(legacy)
    expect(out.effects).toHaveLength(1)
    expect(out.effects[0]!.id).toBe('halftone')
    expect(out.effects[0]!.blend).toBe('normal')
    expect(out.effects[0]!.opacity).toBe(1)
    expect(out.effects[0]!.layerId).toMatch(/.+/)
    expect(out.version).toBe(2)
    // NOTE: `effect` is intentionally KEPT in Task 5 (readers still use it); Task 6
    // switches readers to `effects` and only then deletes `effect`.
  })
  it('passes through an already-migrated config untouched', () => {
    const cur = { version: 2, effects: [{ id: 'x', params: {}, enabled: true, blend: 'screen', opacity: 0.5, layerId: 'a' }] }
    const out = migrateShaderConfig(cur)
    expect(out.effects[0]!.blend).toBe('screen')
  })
})
```

Run: `cd frontend && npx vitest run shaderstudio-migrate` → FAIL.

- [ ] **Step 2: Update the types**

In `frontend/app/lib/shaderstudio/types.ts`:
```ts
import type { BlendKind } from '~/lib/studio/blend'

export const LAYER_MAX = 6

export interface StudioEffect {
  /** stable per-layer id (identity for reorder + motion binding). */
  layerId: string
  /** shaderfx catalog effect id, or '' for none. */
  id: string
  params: Record<string, number>
  enabled: boolean
  blend: BlendKind
  opacity: number
  customChars?: string
}
```
In `ShaderStudioConfig` (lines 98-109): **ADD** `effects: StudioEffect[]` as a NEW field, and KEEP the existing `effect: StudioEffect` field (mark it `/** @deprecated — removed in the reader switch; use effects[] */`). This is additive so `passes.ts`/Surface/Node readers that still use `cfg.effect` keep compiling — Task 6 switches them to `effects` and only then removes `effect`. Bump the `version` default. Update `defaults` (lines 111-137): keep the existing `effect: {...}` default AND add `effects: [{ layerId: newLayerId(), id: '', params: {}, enabled: true, blend: 'normal', opacity: 1 }]`. Add a tiny id generator (seed-free, avoids `Math.random` in render paths — use a module counter):
```ts
let _lid = 0
export function newLayerId(): string { return `L${(_lid++).toString(36)}${Date.now().toString(36)}` }
```

- [ ] **Step 3: Write the migration**

Create `frontend/app/lib/shaderstudio/migrate.ts`:
```ts
import type { ShaderStudioConfig, StudioEffect } from './types'
import { newLayerId } from './types'

/** Normalize a persisted shader config to the current (v2) effects[] shape. */
export function migrateShaderConfig(raw: any): ShaderStudioConfig {
  const cfg = { ...raw }
  if (!Array.isArray(cfg.effects)) {
    const legacy = cfg.effect
    const eff: StudioEffect = legacy
      ? { layerId: newLayerId(), id: legacy.id ?? '', params: legacy.params ?? {}, enabled: legacy.enabled ?? true,
          blend: 'normal', opacity: 1, customChars: legacy.customChars }
      : { layerId: newLayerId(), id: '', params: {}, enabled: true, blend: 'normal', opacity: 1 }
    cfg.effects = [eff]
  }
  // NOTE: `effect` is intentionally NOT deleted here — readers still use it until
  // Task 6 switches them. Task 6 adds `delete cfg.effect` and removes the field.
  cfg.version = 2
  return cfg as ShaderStudioConfig
}
```

Run the test → PASS.

- [ ] **Step 4: Typecheck + commit (stays green — additive)**

Because the change is additive (`effect` kept, `effects` added, no readers touched, migration NOT wired yet), the typecheck must stay at baseline. Run `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c error` — no rise. Then:
```bash
git add frontend/app/lib/shaderstudio/types.ts frontend/app/lib/shaderstudio/migrate.ts \
        frontend/tests/unit/shaderstudio-migrate.unit.spec.ts
git commit -m "feat(shader): additive effects[] config shape + v2 migration"
```
(Wiring `migrateShaderConfig` into the Surface/Node load path happens in Task 6, together with the reader switch, so there is never a red typecheck.)

---

## Task 6: Shader compositing — N-effect chain with per-layer blend

**Files:**
- Modify: `frontend/app/lib/shaderfx/renderer.ts` (hold FBO, snapshot + composite pass)
- Modify: `frontend/app/lib/shaderstudio/passes.ts` (loop effects)
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (composePasses call)
- Modify: `frontend/app/components/vue-canvas/ShaderStudioNode.vue` (composePasses call)
- Create: `frontend/app/pages/dev/shader-studio-lab.vue` (verification harness)

**Interfaces:**
- Consumes: `effects[]` (Task 5), `BLEND_IDX`, `BLEND_LAYERS_GLSL` (Task 1).
- Produces:
  - `ShaderPass` gains optional `snapshot?: boolean` and `composite?: { blendIdx: number; opacity: number }`.
  - `composePasses(cfg, resolveDef, t, texFor)` new signature: `resolveDef: (id: string) => EffectDef | null`, `texFor: (def: EffectDef | null) => EffectTextureBundle`.

- [ ] **Step 1: Add hold-FBO + composite support to the renderer**

In `frontend/app/lib/shaderfx/renderer.ts`:
- Extend `ShaderPass`:
  ```ts
  export interface ShaderPass {
    id: string
    source: string
    uniforms: Uniforms
    textures?: Record<string, TexImageSource>
    /** Copy the current accumulated image into the hold buffer BEFORE this pass runs. */
    snapshot?: boolean
    /** Composite this pass's output over the held image via blendLayers. */
    composite?: { blendIdx: number; opacity: number }
  }
  ```
- Add a third FBO/texture (`holdFbo`, `holdTex`) alongside the two ping-pong FBOs, allocated/resized in `ensure(width,height)` exactly like `fbos`/`fboTex`.
- Add a composite program built from a fragment source that samples `u_image0` (this pass output) and `u_below` (held input) and blends:
  ```ts
  const COMPOSITE_FS = `#version 300 es
  precision highp float;
  in vec2 v_texCoord; out vec4 fragColor;
  uniform sampler2D u_image0; uniform sampler2D u_below;
  uniform float u_blend; uniform float u_opacity;
  ${BLEND_LAYERS_GLSL}
  void main() {
    vec3 below = texture(u_below, v_texCoord).rgb;
    vec3 above = texture(u_image0, v_texCoord).rgb;
    vec3 b = blendLayers(below, above, u_blend);
    fragColor = vec4(mix(below, b, clamp(u_opacity, 0.0, 1.0)), 1.0);
  }`
  ```
  Import `BLEND_LAYERS_GLSL` from `~/lib/studio/blend`.
- In the `render()` loop (line 168), before running a pass:
  - if `pass.snapshot`: blit `readTex` → `holdTex` (bind `holdFbo`, run the blit program with `readTex`), without advancing `readTex`.
  - if `pass.composite`: use the composite program; bind `u_image0 = readTex` (TEXTURE0), `u_below = holdTex` (TEXTURE1), set `u_blend`/`u_opacity`; render to `fbos[i%2]`; set `readTex = fboTex[i%2]`.
  - else: existing generic path.

- [ ] **Step 2: Rewrite composePasses to loop effects**

In `frontend/app/lib/shaderstudio/passes.ts`, replace the single-effect block (lines 38-45) and the signature (lines 30-35):
```ts
import { BLEND_IDX } from '~/lib/studio/blend'

export function composePasses(
  cfg: ShaderStudioConfig,
  resolveDef: (id: string) => EffectDef | null,
  t: number,
  texFor: (def: EffectDef | null) => EffectTextureBundle = () => ({ sources: {}, uniforms: {} }),
): ShaderPass[] {
  const out: ShaderPass[] = []

  // 1. Stylized effect stack (chain; each layer composites over its input by blend+opacity)
  for (const layer of cfg.effects) {
    if (!layer.enabled || !layer.id) continue
    const def = resolveDef(layer.id)
    if (!def) continue
    const tex = texFor(def)
    const uniforms: Uniforms = { ...resolveUniforms(def, layer.params), u_time: t, u_seed: 42, u_hasInput: 1, ...tex.uniforms }
    const needsComposite = layer.blend !== 'normal' || layer.opacity < 0.999
    const expanded = expandPasses(def.id, def.source, uniforms, tex.sources, def.passes ?? 1)
    if (needsComposite && out.length > 0) {
      expanded[0] = { ...expanded[0]!, snapshot: true } // snapshot the layer input before the effect runs
      out.push(...expanded)
      out.push({ id: 'studio:composite', source: '', uniforms: {}, // source filled by renderer's composite program
                 composite: { blendIdx: BLEND_IDX[layer.blend], opacity: layer.opacity } })
    } else {
      out.push(...expanded)
    }
  }
  // 2..N downstream global stages unchanged (duotone, gradient map, adjust, post) …
```
Keep the rest (duotone → post) verbatim. Note: the composite pass's `source` is ignored — the renderer selects its composite program when `composite` is set. Adjust the renderer to key off `pass.composite` rather than compiling `pass.source` for those.

- [ ] **Step 3: Switch readers to `effects`, wire migration, remove the deprecated `effect` field**

This is where the additive Task 5 becomes a clean cutover — do it all in one commit so the typecheck goes red→green within this task only.
- **Migration:** in `migrate.ts`, add `delete cfg.effect` after building `cfg.effects` (now safe — readers no longer use it).
- **Type:** in `shaderstudio/types.ts`, remove the deprecated `effect: StudioEffect` field and its default from `defaults`.
- **Load path:** in `ShaderStudioSurface.vue` (~line 367-368) and `ShaderStudioNode.vue` (~line 32-37), pass the persisted blob through `migrateShaderConfig(...)` before merging over defaults, so old single-`effect` docs load as `effects[]`.
- **Callers:**
  - `ShaderStudioSurface.vue` line 242: `composePasses(cfg, (id) => catalog.value?.effects.find(e => e.id === id) ?? null, t, (def) => texBundle(def))`.
  - `ShaderStudioNode.vue` lines 58 & 92: same, using the local `effectDef` function: `composePasses(cfg, effectDef, t)`.
- Fix any remaining `cfg.effect` references (Surface's `effectDef` computed, `setEffect`, param loop) to read `cfg.effects[activeEffect]` — but the full active-effect UI is Task 7; here just make it compile by reading `cfg.effects[0]` where a single effect was assumed, leaving the multi-effect UI wiring to Task 7. Confirm `grep -rn "\.effect\b" frontend/app/lib/shaderstudio frontend/app/components/vue-canvas/ShaderStudio*` returns no stale singular `.effect` reader.

- [ ] **Step 4: Create the shader studio lab harness**

Create `frontend/app/pages/dev/shader-studio-lab.vue` (mirror `dev/scene3d-lab.vue`): mount `ShaderStudioSurface` with a node id and a seeded source image (a small bundled asset or a data-URL gradient), so the modal opens with an image to process.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import ShaderStudioSurface from '~/components/vue-canvas/ShaderStudioSurface.vue'
const open = ref(true)
// minimal node stub with a source image already set
const nodes = ref([{ id: 'lab-1', type: 'shaderStudio', data: { properties: {} } }])
</script>
<template>
  <div class="fixed inset-0 bg-black">
    <ShaderStudioSurface v-if="open" node-id="lab-1" :nodes="nodes" :edges="[]" @close="open = false" />
  </div>
</template>
```
(Match the actual prop names `ShaderStudioSurface` expects — read its `defineProps` and adapt. Provide a source image via whatever the surface uses; if it needs an uploaded asset, seed `data.properties.sailor_shaderStudio.source` with a data-URL.)

- [ ] **Step 5: Typecheck + compile-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c error` (must not rise; the `.effect` references from Task 5 are now resolved).

- [ ] **Step 6: Verify in the shader lab**

Open `dev/shader-studio-lab`, full-reload.
- Back-compat: one effect, blend normal, opacity 1 — confirm the output matches the pre-change single-effect render (compare against `git stash`-free: eyeball a known effect).
- Chain: add a second effect; confirm it processes the first's output.
- Blend/opacity: set the second layer to `multiply` @ 0.5; confirm the hold-FBO composite blends it over its input, and that the pure-normal fast path (opacity 1) shows no composite pass (log `passes.length`).
Screenshot as proof.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/shaderfx/renderer.ts frontend/app/lib/shaderstudio/passes.ts \
        frontend/app/components/vue-canvas/ShaderStudioSurface.vue \
        frontend/app/components/vue-canvas/ShaderStudioNode.vue \
        frontend/app/pages/dev/shader-studio-lab.vue \
        frontend/app/lib/shaderstudio/types.ts frontend/app/lib/shaderstudio/migrate.ts \
        frontend/tests/unit/shaderstudio-migrate.unit.spec.ts
git commit -m "feat(shader): N-effect chain with per-layer blend + opacity"
```

---

## Task 7: Shader UI — effect stack in the aside

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`

**Interfaces:**
- Consumes: `StudioLayerStack` (Task 2), `effects[]` (Task 5), `LAYER_MAX`.
- Produces: `activeEffect` index state; the right column edits `config.effects[activeEffect]`.

- [ ] **Step 1: Add active-effect state + aside stack**

Add `const activeEffect = ref(0)`. Add the `#aside` template:
```vue
<template #aside>
  <StudioLayerStack
    :layers="config.effects.map((e, i) => ({ label: effectLabel(e), enabled: e.enabled }))"
    :active-index="activeEffect" :max="LAYER_MAX"
    @select="activeEffect = $event"
    @add="addEffect" @remove="removeEffect" @duplicate="duplicateEffect"
    @reorder="reorderEffect" @toggle="toggleEffect" />
</template>
```
`effectLabel(e)` returns the catalog def's display name for `e.id` or `'Empty'`.

- [ ] **Step 2: Rewire the Stylized Effects section to the active layer**

- `effectDef` computed → resolve for `config.effects[activeEffect].id`.
- `setEffect` (line 322) sets `config.effects[activeEffect] = { ...config.effects[activeEffect], id, params: {} }` (preserving `layerId`, `blend`, `opacity`, `enabled`).
- The params loop (lines 515-539) reads/writes `config.effects[activeEffect].params`.
- Add blend + opacity controls (a `<select>` over `BLEND_MODES` + an opacity range) shown when `activeEffect > 0`, bound to `config.effects[activeEffect].blend/opacity`.

- [ ] **Step 3: Add/remove/duplicate/reorder/toggle handlers + motion path remap**

```ts
function addEffect() {
  if (config.value.effects.length >= LAYER_MAX) return
  config.value.effects.push({ layerId: newLayerId(), id: '', params: {}, enabled: true, blend: 'normal', opacity: 1 })
  activeEffect.value = config.value.effects.length - 1
}
function removeEffect(i: number) {
  if (config.value.effects.length <= 1) return
  config.value.effects.splice(i, 1)
  remapEffectTracks('remove', i)
  activeEffect.value = Math.min(activeEffect.value, config.value.effects.length - 1)
}
function duplicateEffect(i: number) {
  if (config.value.effects.length >= LAYER_MAX) return
  const clone = { ...structuredClone(toRaw(config.value.effects[i]!)), layerId: newLayerId() }
  config.value.effects.splice(i + 1, 0, clone)
  remapEffectTracks('insert', i + 1)
  activeEffect.value = i + 1
}
function reorderEffect(from: number, to: number) {
  const [m] = config.value.effects.splice(from, 1)
  config.value.effects.splice(to, 0, m!)
  remapEffectTracks('move', from, to)
  activeEffect.value = to
}
function toggleEffect(i: number) { const e = config.value.effects[i]!; e.enabled = !e.enabled }
```
`remapEffectTracks(kind, a, b?)` rewrites motion track `path`s of the form `effects.<idx>.params.<u>`: on `move` swap the index per the same math as gradient's `remapTracksOnReorder`; on `insert` bump indices `>= a`; on `remove` drop tracks whose index === a and decrement `> a`. (Motion `path` migration for legacy `effect.params.*` → `effects.0.params.*` happens in `migrateShaderConfig` — add that rewrite to Task 5's migration: any track path starting `effect.params.` becomes `effects.0.params.`.)

- [ ] **Step 4: Scope the agent to the active effect**

`shaderAgentControls` (line 68) currently targets the single effect. Pass `activeEffect` so it edits `config.effects[activeEffect]`. Follow the gradient pattern (`makeConfigParams(() => config, () => activeLayer)`).

- [ ] **Step 5: Backfill the Task 5 migration for motion paths**

In `migrateShaderConfig`, after wrapping the effect, rewrite motion track paths:
```ts
for (const tr of cfg.motion?.tracks ?? []) {
  if (typeof tr.path === 'string' && tr.path.startsWith('effect.params.')) tr.path = tr.path.replace('effect.params.', 'effects.0.params.')
}
```
Extend `frontend/tests/unit/shaderstudio-migrate.unit.spec.ts` with a case asserting this rewrite.

- [ ] **Step 6: Typecheck + verify in the shader lab**

Run the typecheck (must not rise). Open `dev/shader-studio-lab`, full-reload:
- Add effects up to 6; add disables at 6.
- Select each; confirm picker + params + blend + opacity edit the selected layer.
- Reorder; confirm chain order + active selection follow.
- Toggle + duplicate; confirm behavior.
Screenshot the multi-effect state.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderStudioSurface.vue \
        frontend/app/lib/shaderstudio/migrate.ts frontend/tests/unit/shaderstudio-migrate.unit.spec.ts
git commit -m "feat(shader): N-effect stack UI in the aside panel"
```

---

## Task 8: Cross-studio verification + back-compat

**Files:** none new (verification + any fixes surfaced).

- [ ] **Step 1: Blend parity check**

Set a gradient layer to `multiply` @ 0.5 over a solid base, and a shader layer to `multiply` @ 0.5 over the same base image; confirm the composited result matches (both now use `BLEND_LAYERS_GLSL`). Any mismatch is a bug in one studio's wiring — fix and re-verify.

- [ ] **Step 2: Back-compat load test**

- Load a pre-change saved gradient node (2 layers) — confirm identical render.
- Load a pre-change saved shader node (single effect) — confirm `migrateShaderConfig` yields an identical render (blend normal / opacity 1 → no composite pass).
If you lack a saved node, construct the legacy blob by hand and inject it into a lab node's `data.properties`.

- [ ] **Step 3: Full unit suite + typecheck**

```bash
cd frontend && npx vitest run studio-blend gradientfx-motion-remap shaderstudio-migrate
npx vue-tsc --noEmit 2>&1 | grep -c error
```
Expected: all unit tests pass; error count ≤ baseline.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A frontend/app
git commit -m "test(studio): cross-studio blend parity + back-compat verification"
```

---

## Self-Review

**Spec coverage:**
- Shared `StudioLayerStack` → Task 2 (used in 4, 7). ✓
- Shared `~/lib/studio/blend.ts` → Task 1. ✓
- Gradient 2→N (types/shader/renderer/UI) → Tasks 3, 4. ✓
- `sampler2DArray` field/ramp + `u_fieldW` scaling → Task 3. ✓
- Relief stays layer 0 → Global Constraints + Task 3 note. ✓
- Shader single→effects[] + migration → Task 5. ✓
- Shader hold-FBO composite + pure-chain fast path → Task 6. ✓
- Shader UI + motion path remap + agent scope → Task 7. ✓
- Blend in right column / list in aside / max 6 → Tasks 4, 7 + Global Constraints. ✓
- Back-compat byte-identical → Tasks 3, 6, 8. ✓
- `dev/shader-studio-lab` harness → Task 6. ✓
- Motion track remap (gradient index; shader path) → Tasks 4, 7. ✓

**Type consistency:** `LAYER_MAX` (both studios), `BLEND_IDX`/`BLEND_MODES`/`BLEND_LAYERS_GLSL` (Task 1, consumed 3/6), `migrateShaderConfig` (5, called 5/6), `StudioEffect.layerId` (5, used 6/7), `remapTracksOnReorder`/`dropTracksForLayer` (4), `ShaderPass.snapshot`/`composite` (6). Names consistent across tasks.

**Placeholder scan:** each code step shows real code; verification steps name exact labs/commands. The one right-sizing caveat (merge Task 5+6 if typecheck can't stay green between them) is called out explicitly rather than left vague.

**Known risk to watch during execution:** Task 3's texture-unit reassignment — confirm units 0/1 (now the array textures) don't collide with mesh/flow textures in `renderer.ts`; Step 7 includes the grep check.
