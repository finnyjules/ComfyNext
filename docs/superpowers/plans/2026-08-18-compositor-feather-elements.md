# Compositor Feather Elements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-layer "feather" edge treatment to the Frame Compositor that fades an element's edges smoothly out to transparent (a soft edge-mask), uniform on all sides.

**Architecture:** Feather mirrors the existing `tornEdge` feature end-to-end. A new `lib/compositor/feather.ts` module reuses the distance-transform primitive already in `tornEdge.ts` to fade each opaque pixel's alpha based on its distance to the nearest transparent pixel. It's wired into `paintLayer`'s existing "effected path" offscreen, exposed via a small panel component, and made agent-reachable through the compositor agent surface.

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript), Canvas 2D `ImageData`, Vitest for unit tests.

## Global Constraints

- Feather `amount` is **normalized to canvas width** (like the other Figma-style per-layer effects), so it survives resize/export. Converted to device px at render time via `amount * canvasW * scale`.
- `amount` is clamped to `[0, 0.5]`; `curve` is one of `'linear' | 'smooth'`.
- Follow the studio colour convention: action blue is the only accent; do not introduce purple.
- The zero-amount / absent case MUST be byte-identical to today (gated by `featherActive`).
- All new distances reuse `distanceInside` from `tornEdge.ts` — do NOT duplicate the distance transform.
- Typecheck baseline is ~328 pre-existing errors; the bar is **no NEW errors that reference feather code**, not zero.

---

### Task 1: `feather.ts` module — data model, helpers, and render core

**Files:**
- Modify: `frontend/app/lib/compositor/tornEdge.ts` (export the private `distanceInside`)
- Create: `frontend/app/lib/compositor/feather.ts`
- Test: `frontend/tests/unit/compositor-feather.unit.spec.ts`

**Interfaces:**
- Consumes: `distanceInside(inside: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number): Float32Array` from `tornEdge.ts`.
- Produces:
  - `interface FeatherSpec { amount: number; curve: 'linear' | 'smooth' }`
  - `const DEFAULT_FEATHER: FeatherSpec`
  - `function featherActive(f: FeatherSpec | undefined | null): f is FeatherSpec`
  - `function sanitizeFeather(raw: unknown, cur?: FeatherSpec): FeatherSpec`
  - `function applyFeatherToData(data: Uint8ClampedArray, W: number, H: number, spec: FeatherSpec, scale: number, canvasW: number): void`
  - `function applyFeather(canvas: HTMLCanvasElement, spec: FeatherSpec, opts: { scale?: number; canvasW: number }): void`

- [ ] **Step 1: Export `distanceInside` from `tornEdge.ts`**

In `frontend/app/lib/compositor/tornEdge.ts`, change the `distanceInside` declaration from module-private to exported. Find:

```ts
/** Approx Euclidean distance (chamfer 1 / √2) from each inside pixel to the
 *  nearest background pixel, computed only within [x0..x1]×[y0..y1]. */
function distanceInside(
```

Change `function distanceInside(` to `export function distanceInside(`. Leave the body unchanged.

- [ ] **Step 2: Write the failing test**

Create `frontend/tests/unit/compositor-feather.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEATHER, featherActive, sanitizeFeather, applyFeatherToData, type FeatherSpec,
} from '~/lib/compositor/feather'

describe('feather spec helpers', () => {
  it('DEFAULT_FEATHER is an active spec', () => {
    expect(DEFAULT_FEATHER.amount).toBeGreaterThan(0)
    expect(featherActive(DEFAULT_FEATHER)).toBe(true)
  })

  it('featherActive is false for undefined, null, and amount 0', () => {
    expect(featherActive(undefined)).toBe(false)
    expect(featherActive(null)).toBe(false)
    expect(featherActive({ ...DEFAULT_FEATHER, amount: 0 })).toBe(false)
  })

  it('sanitizeFeather clamps amount and rejects a bad curve', () => {
    const s = sanitizeFeather({ amount: 99, curve: 'nope' })
    expect(s.amount).toBe(0.5)                 // clamped to max
    expect(s.curve).toBe(DEFAULT_FEATHER.curve) // invalid → default
    const neg = sanitizeFeather({ amount: -5 })
    expect(neg.amount).toBe(0)                  // clamped to min
  })

  it('sanitizeFeather merges a partial patch over current', () => {
    const cur: FeatherSpec = { amount: 0.2, curve: 'linear' }
    const s = sanitizeFeather({ curve: 'smooth' }, cur)
    expect(s.amount).toBe(0.2)      // preserved
    expect(s.curve).toBe('smooth')  // overridden
  })
})

/** Build a WxH RGBA buffer with an opaque square inset by `pad`. */
function squareBuffer(W: number, H: number, pad: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const solid = x >= pad && x < W - pad && y >= pad && y < H - pad
    if (solid) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 40; data[i + 3] = 255 }
  }
  return data
}
const alphaAt = (d: Uint8ClampedArray, W: number, x: number, y: number) => d[(y * W + x) * 4 + 3]!

describe('applyFeatherToData', () => {
  const W = 80, H = 80, PAD = 10
  // amount 0.1 * canvasW 80 * scale 1 = featherDev 8px
  const spec: FeatherSpec = { amount: 0.1, curve: 'linear' }

  it('leaves the deep interior fully opaque but fades edge pixels', () => {
    const d = squareBuffer(W, H, PAD)
    applyFeatherToData(d, W, H, spec, 1, W)
    expect(alphaAt(d, W, 40, 40)).toBe(255)              // center untouched
    const edge = alphaAt(d, W, PAD, 40)                  // left edge column (d≈1)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)                       // faded
  })

  it('is a no-op on a fully transparent buffer', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    const before = d.slice()
    applyFeatherToData(d, W, H, spec, 1, W)
    expect(d).toEqual(before)
  })

  it('amount 0 leaves alpha bytes unchanged (identity gate)', () => {
    const d = squareBuffer(W, H, PAD)
    const before = d.slice()
    applyFeatherToData(d, W, H, { amount: 0, curve: 'smooth' }, 1, W)
    expect(d).toEqual(before)
  })

  it('smooth and linear curves differ inside the band', () => {
    const dl = squareBuffer(W, H, PAD)
    const ds = squareBuffer(W, H, PAD)
    applyFeatherToData(dl, W, H, { amount: 0.1, curve: 'linear' }, 1, W)
    applyFeatherToData(ds, W, H, { amount: 0.1, curve: 'smooth' }, 1, W)
    // x=14 is ~5px inside the left edge → t≈0.625, where the two curves diverge
    expect(alphaAt(dl, W, 14, 40)).not.toBe(alphaAt(ds, W, 14, 40))
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/compositor-feather.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/feather` (module does not exist yet).

- [ ] **Step 4: Write the module**

Create `frontend/app/lib/compositor/feather.ts`:

```ts
import { distanceInside } from '~/lib/compositor/tornEdge'

export interface FeatherSpec {
  amount: number              // feather depth, normalized to canvas WIDTH (0..0.5)
  curve: 'linear' | 'smooth'  // alpha falloff shape across the band
}

export const DEFAULT_FEATHER: FeatherSpec = {
  amount: 0.03,
  curve: 'smooth',
}

/** Active when it would visibly fade the edge. */
export function featherActive(f: FeatherSpec | undefined | null): f is FeatherSpec {
  return !!f && f.amount > 0
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Merge a partial/raw patch over `cur` (or DEFAULT), clamping every field. */
export function sanitizeFeather(raw: unknown, cur?: FeatherSpec): FeatherSpec {
  const base = cur ? { ...cur } : { ...DEFAULT_FEATHER }
  const r = (raw ?? {}) as Record<string, unknown>
  const curve = r.curve === 'linear' || r.curve === 'smooth' ? r.curve : base.curve
  return {
    amount: num(r.amount, 0, 0.5, base.amount),
    curve,
  }
}

/** Fade the alpha of each opaque pixel by its distance to the nearest transparent
 *  pixel, across a `featherDev`-wide band. Mutates `data`.
 *  `scale` = device px per logical px; `canvasW` = logical canvas width. Feather
 *  reaches `amount * canvasW * scale` device px inward from the silhouette edge. */
export function applyFeatherToData(
  data: Uint8ClampedArray, W: number, H: number, spec: FeatherSpec, scale: number, canvasW: number,
): void {
  const s = scale > 0 ? scale : 1
  const featherDev = Math.max(0, spec.amount * canvasW * s)
  if (featherDev <= 0) return

  // binary alpha mask + bounding box of opaque content
  const inside = new Uint8Array(W * H)
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3]! > 8) {
      inside[y * W + x] = 1
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
    }
  }
  if (maxx < 0) return   // fully transparent — nothing to feather

  const band = featherDev + 2
  const x0 = Math.max(0, Math.floor(minx - band)), y0 = Math.max(0, Math.floor(miny - band))
  const x1 = Math.min(W - 1, Math.ceil(maxx + band)), y1 = Math.min(H - 1, Math.ceil(maxy + band))
  const dist = distanceInside(inside, W, x0, y0, x1, y1)
  const smooth = spec.curve === 'smooth'

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x
    if (!inside[i]) continue
    const d = dist[i]!
    if (d >= featherDev) continue          // deep interior — full alpha
    let t = d / featherDev                  // 0 at edge, →1 at band inner rim
    if (t < 0) t = 0
    if (smooth) t = t * t * (3 - 2 * t)     // smoothstep
    const o = i * 4 + 3
    data[o] = Math.round(data[o]! * t)
  }
}

/** Canvas wrapper — reads device pixels, feathers them, writes them back. */
export function applyFeather(
  canvas: HTMLCanvasElement, spec: FeatherSpec, opts: { scale?: number; canvasW: number },
): void {
  const W = canvas.width, H = canvas.height
  if (!W || !H) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, W, H)
  applyFeatherToData(img.data, W, H, spec, opts.scale ?? 1, opts.canvasW)
  ctx.putImageData(img, 0, 0)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/compositor-feather.unit.spec.ts`
Expected: PASS (all cases in both describe blocks).

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/feather.ts frontend/app/lib/compositor/tornEdge.ts frontend/tests/unit/compositor-feather.unit.spec.ts
git commit -m "feat(compositor): feather module — silhouette-aware edge fade

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire feather into `paintLayer`

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (add `feather?` field to `LayerCommon`; import + apply in `paintLayer`'s effected path)

**Interfaces:**
- Consumes: `FeatherSpec`, `featherActive`, `applyFeather` from Task 1.
- Produces: `LocalLayer` gains an optional `feather?: FeatherSpec` field (read by the panel in Task 3 and the agent surface in Task 4).

- [ ] **Step 1: Import the feather module**

In `frontend/app/composables/useCompositorLayers.ts`, find the tornEdge import (line ~47):

```ts
import { applyTornEdge, tornEdgeActive } from '~/lib/compositor/tornEdge'
```

Add directly below it:

```ts
import { applyFeather, featherActive } from '~/lib/compositor/feather'
```

- [ ] **Step 2: Add the `feather` field to `LayerCommon`**

In the same file, find the `tornEdge?` field in `LayerCommon` (around line 185-186):

```ts
   *  lip. Absent/inactive ⇒ a clean edge. See lib/compositor/tornEdge. */
  tornEdge?: import('~/lib/compositor/tornEdge').TornEdgeSpec
```

Add directly below it:

```ts
  /** Soft alpha falloff at the layer's edges (feather). Absent/inactive ⇒ crisp
   *  edge. amount is normalized to canvas width. See lib/compositor/feather. */
  feather?: import('~/lib/compositor/feather').FeatherSpec
```

- [ ] **Step 3: Resolve + gate feather in `paintLayer`**

Find, in `paintLayer` (around line 1030):

```ts
  const tornEdge = tornEdgeActive(layer.tornEdge) ? layer.tornEdge : undefined
```

Add directly below it:

```ts
  const feather = featherActive(layer.feather) ? layer.feather : undefined
```

Then find the effected-path gate (around line 1138):

```ts
    if (shadow || blur || inner || chain.length || tornEdge) {
```

Change it to:

```ts
    if (shadow || blur || inner || chain.length || tornEdge || feather) {
```

- [ ] **Step 4: Apply feather after torn edge, before the stamp**

Find the torn-edge application inside that block (around line 1171):

```ts
        if (tornEdge) applyTornEdge(off, tornEdge, { scale: s })
```

Add directly below it:

```ts
        // Feather softens whatever silhouette exists (including a torn one) by
        // fading alpha inward. Runs before the drop-shadow/blur stamp below so
        // those follow the feathered edge. amount is canvas-width-relative, so
        // pass the logical canvas width W and device scale s.
        if (feather) applyFeather(off, feather, { scale: s, canvasW: W })
```

- [ ] **Step 5: Typecheck — no new feather errors**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i feather`
Expected: no output (no type errors reference feather). The overall error count stays at the ~328 baseline.

- [ ] **Step 6: Run the compositor unit suite to confirm no regression**

Run: `cd frontend && npx vitest run tests/unit/compositor.unit.spec.ts tests/unit/torn-edge.unit.spec.ts tests/unit/compositor-feather.unit.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useCompositorLayers.ts
git commit -m "feat(compositor): apply feather in paintLayer effected path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Feather panel UI

**Files:**
- Create: `frontend/app/components/vue-canvas/compositor/CompositorFeatherPanel.vue`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (import, `setFeather`/`toggleFeather` handlers, place panel next to the torn-edge panel)

**Interfaces:**
- Consumes: `DEFAULT_FEATHER`, `FeatherSpec` from Task 1; the `layer.feather` field from Task 2.
- Produces: nothing consumed by later tasks (UI leaf).

- [ ] **Step 1: Create the panel component**

Create `frontend/app/components/vue-canvas/compositor/CompositorFeatherPanel.vue`:

```vue
<!-- frontend/app/components/vue-canvas/compositor/CompositorFeatherPanel.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_FEATHER, type FeatherSpec } from '~/lib/compositor/feather'

const props = defineProps<{ value?: FeatherSpec }>()
const emit = defineEmits<{
  (e: 'update', patch: Partial<FeatherSpec>): void
  (e: 'toggle', on: boolean): void
}>()

const on = computed(() => !!props.value)
const v = computed<FeatherSpec>(() => props.value ?? DEFAULT_FEATHER)
const set = (patch: Partial<FeatherSpec>) => emit('update', patch)
// Slider works in whole percent-of-canvas-width; store as a 0..0.5 fraction.
const amountPct = computed(() => Math.round(v.value.amount * 100))
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <div class="panel-label">Feather</div>
      <button type="button" class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
        @click="emit('toggle', !on)">{{ on ? 'Remove' : 'Add' }}</button>
    </div>

    <template v-if="on">
      <div class="space-y-2">
        <div>
          <div class="flex items-center justify-between panel-sublabel mb-1"><span>Amount</span><span class="tabular-nums normal-case">{{ amountPct }}</span></div>
          <input type="range" min="0" max="40" step="1" :value="amountPct" class="w-full accent-white cursor-pointer"
            @input="set({ amount: +($event.target as HTMLInputElement).value / 100 })">
        </div>

        <div>
          <div class="panel-sublabel mb-1">Falloff</div>
          <div class="flex gap-1">
            <button type="button"
              class="flex-1 text-[11px] px-2 py-1 rounded border"
              :class="v.curve === 'linear' ? 'border-[#3b82f6] text-white bg-[#3b82f6]/10' : 'border-[#2a2a2a] text-white/60 hover:text-white/90'"
              @click="set({ curve: 'linear' })">Linear</button>
            <button type="button"
              class="flex-1 text-[11px] px-2 py-1 rounded border"
              :class="v.curve === 'smooth' ? 'border-[#3b82f6] text-white bg-[#3b82f6]/10' : 'border-[#2a2a2a] text-white/60 hover:text-white/90'"
              @click="set({ curve: 'smooth' })">Smooth</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Import the panel in CompositorModal**

In `frontend/app/components/vue-canvas/CompositorModal.vue`, find the tornEdge panel import (line ~56-57):

```ts
import CompositorTornEdgePanel from '~/components/vue-canvas/compositor/CompositorTornEdgePanel.vue'
import { DEFAULT_TORN_EDGE } from '~/lib/compositor/tornEdge'
```

Add directly below:

```ts
import CompositorFeatherPanel from '~/components/vue-canvas/compositor/CompositorFeatherPanel.vue'
import { DEFAULT_FEATHER } from '~/lib/compositor/feather'
```

- [ ] **Step 3: Add the setFeather / toggleFeather handlers**

Find the tornEdge handlers (around line 2203-2211):

```ts
function setTornEdge(l: any, patch: Record<string, any>) {
```

Directly ABOVE that function, add:

```ts
function setFeather(l: any, patch: Record<string, any>) {
  if (!l) return
  const cur = l.feather || { ...DEFAULT_FEATHER }
  setLocal(l.id, { feather: { ...cur, ...patch } })
}
function toggleFeather(l: any, on: boolean) {
  if (!l) return
  setLocal(l.id, { feather: on ? { ...DEFAULT_FEATHER } : undefined })
}
```

- [ ] **Step 4: Place the panel next to the torn-edge panel**

Find the torn-edge panel in the template (around line 5253):

```vue
            <CompositorTornEdgePanel
              :value="(selectedLocal as any).tornEdge"
              @update="(patch) => setTornEdge(selectedLocal!, patch)"
```

Read the full `<CompositorTornEdgePanel ... />` element (it also has a `@toggle` handler and a closing tag). Directly AFTER its closing `/>` (or `</CompositorTornEdgePanel>`), add:

```vue
            <CompositorFeatherPanel
              :value="(selectedLocal as any).feather"
              @update="(patch) => setFeather(selectedLocal!, patch)"
              @toggle="(on) => toggleFeather(selectedLocal!, on)"
            />
```

(Match the exact indentation and the `selectedLocal!` accessor pattern used by the torn-edge panel one line above — if that panel uses a different guarded accessor, mirror it verbatim.)

- [ ] **Step 5: Verify the dev server compiles**

Ensure the compositor dev server is running (`preview_start` with the project's dev config), then reload and check for compile errors:

Run (compile check): `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "feather|CompositorModal" | head`
Expected: no NEW errors referencing feather or the added handlers.

- [ ] **Step 6: Visual verification in the Compositor**

Open the Frame Compositor in the browser preview, add or select an image layer scaled smaller than the frame (so it has transparent margin), open its panel, click **Add** under Feather, and drag **Amount** up. Confirm the element's edges fade to transparent; toggle Falloff Linear↔Smooth and confirm the edge softness changes. Take a screenshot as proof.

Note: a full-bleed layer that fills the whole frame has no transparent margin, so it will not feather at the canvas border — this is expected (same as torn edge). Verify on a placed (sub-frame) element.

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/compositor/CompositorFeatherPanel.vue frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): feather panel UI (amount + falloff)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Agent expressibility

**Files:**
- Modify: `frontend/app/lib/agent/surfaces/compositor.ts` (import, op descriptor, describe line, command case)
- Test: `frontend/tests/unit/agent-feather.unit.spec.ts`

**Interfaces:**
- Consumes: `sanitizeFeather`, `featherActive` from Task 1.
- Produces: a `setLayerFeather` compositor command op (natural-language reachable).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/agent-feather.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyCompositorCommand, describeCompositor } from '~/lib/agent/surfaces/compositor'
import type { CompositorState } from '~/lib/agent/surfaces/compositor'

const baseState = (): CompositorState => ({
  layers: [{ id: 'a', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.4, h: 0.3, fill: '#fff', stroke: '', strokeWidth: 0, radius: 0 } as any],
})

describe('setLayerFeather', () => {
  it('sets a feather with clamped amount and defaults', () => {
    const r = applyCompositorCommand(baseState(), {
      op: 'setLayerFeather', target: 'a', args: { patch: { amount: 99, curve: 'smooth' } },
    })
    expect(r.ok).toBe(true)
    const layer = (r as any).template.layers[0]
    expect(layer.feather.amount).toBe(0.5)   // clamped
    expect(layer.feather.curve).toBe('smooth')
  })

  it('merges a partial patch over an existing feather', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'a', args: { patch: { amount: 0.2 } } }) as any).template
    const s2 = (applyCompositorCommand(s1, { op: 'setLayerFeather', target: 'a', args: { patch: { curve: 'linear' } } }) as any).template
    expect(s2.layers[0].feather.amount).toBe(0.2)
    expect(s2.layers[0].feather.curve).toBe('linear')
  })

  it('remove:true clears the feather', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'a', args: { patch: { amount: 0.2 } } }) as any).template
    const s2 = (applyCompositorCommand(s1, { op: 'setLayerFeather', target: 'a', args: { remove: true } }) as any).template
    expect(s2.layers[0].feather).toBeUndefined()
  })

  it('errors on an unknown layer', () => {
    const r = applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'nope', args: { patch: {} } })
    expect(r.ok).toBe(false)
  })

  it('describeCompositor reports an active feather', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'a', args: { patch: { amount: 0.2 } } }) as any).template
    expect(describeCompositor(s1)).toMatch(/feather/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/agent-feather.unit.spec.ts`
Expected: FAIL — `setLayerFeather` is an unknown op (error result), and describe has no feather line.

- [ ] **Step 3: Import the feather helpers**

In `frontend/app/lib/agent/surfaces/compositor.ts`, find the tornEdge import (line ~16):

```ts
import { sanitizeTornEdge, tornEdgeActive } from '~/lib/compositor/tornEdge'
```

Add directly below:

```ts
import { sanitizeFeather, featherActive } from '~/lib/compositor/feather'
```

- [ ] **Step 4: Add the op descriptor**

Find the `setLayerTornEdge` op descriptor object (around line 113, in the ops list array). Directly after that entry, add:

```ts
  { op: 'setLayerFeather', hint: 'Feather (soften) a layer\'s edges so they fade smoothly to transparent — a soft edge-mask, uniform on all sides. target = layer id; args: { patch: {...}, remove? }. patch keys: amount (0..0.5, feather depth as a fraction of canvas width; ~0.02 subtle … 0.15 heavy), curve ("linear" = even fade | "smooth" = eased fade). Omitted keys keep their current value. remove:true removes the feather. This is what "feather the edges", "soften the edges", "fade the edges" mean.' },
```

- [ ] **Step 5: Add the describe line**

Find the tornEdge describe line (around line 129):

```ts
    if (tornEdgeActive(l.tornEdge)) cur.tornEdge = `${l.tornEdge.style} (amount ${l.tornEdge.amount}, lip ${l.tornEdge.lipWidth})`
```

Add directly below:

```ts
    if (featherActive(l.feather)) cur.feather = `${l.feather.curve} (amount ${l.feather.amount})`
```

- [ ] **Step 6: Add the command case**

Find the `case 'setLayerTornEdge': {` block (around line 305-311). Directly after its closing `}` (end of the case), add:

```ts
    case 'setLayerFeather': {
      const layer = state.layers.find(l => l.id === cmd.target)
      if (!layer) return { ok: false, error: `no layer ${cmd.target}` }
      if (cmd.args?.remove === true) { delete layer.feather; return { ok: true, template: state, inverse: snapshot() } }
      const patch = cmd.args?.patch ?? {}
      layer.feather = sanitizeFeather(patch, layer.feather)
      return { ok: true, template: state, inverse: snapshot() }
    }
```

(Match the exact shape of the `setLayerTornEdge` case as it reads in the file — the same `snapshot()` / return-envelope names. If that case reads `layer` via a helper rather than `state.layers.find`, mirror it verbatim.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/agent-feather.unit.spec.ts`
Expected: PASS (all five cases).

- [ ] **Step 8: Run the agent surface suite to confirm no regression**

Run: `cd frontend && npx vitest run tests/unit/agent-torn-edge.unit.spec.ts tests/unit/agent-feather.unit.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/agent/surfaces/compositor.ts frontend/tests/unit/agent-feather.unit.spec.ts
git commit -m "feat(compositor): agent-expressible feather (setLayerFeather)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 Data model (`FeatherSpec`, `DEFAULT_FEATHER`, `featherActive`, `sanitizeFeather`) → Task 1. ✓
- §2 Rendering (`applyFeather`, reuse `distanceInside`, ramp curves, device-px scaling) → Task 1 (core + tests) + Task 2 (paintLayer wiring). ✓
- §3 Wiring into `paintLayer` (gate extension, ordering after tornEdge / before stamp, `feather?` field) → Task 2. ✓
- §4 UI panel (enable toggle, Amount, Falloff) → Task 3. ✓
- §5 Agent expressibility (`setLayerFeather`, sanitize, describe) → Task 4. ✓
- §Testing (interior opaque, edge faded, transparent no-op, amount-0 identity, sanitize clamp, curve difference) → Task 1 tests + Task 4 tests. ✓
- Edge cases (amount 0 gate, transparent early return, amount clamp `[0,0.5]`, retina scale) → Task 1. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `FeatherSpec` shape `{ amount, curve }` is identical across Tasks 1–4. `applyFeather(canvas, spec, { scale, canvasW })` signature matches its call site in Task 2. `applyFeatherToData(data, W, H, spec, scale, canvasW)` matches its test calls in Task 1. `sanitizeFeather`/`featherActive` names consistent between module, paintLayer, and agent surface. ✓
