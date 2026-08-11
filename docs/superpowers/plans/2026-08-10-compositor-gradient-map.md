# Gradient-map post effect (Compositor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gradientMap` post effect (luminance → fully-customisable multi-stop ramp) to Compositor image layers, modelled on the existing `duotone` effect.

**Architecture:** New effect in the Compositor's own post system (`postEffects.ts`) — a CPU kernel (`gradientMapInPlace`) in the canvas-2D chain, plus a panel section reusing the existing `StudioGradientRamp` multi-stop editor. No GPU, no shared-manifest changes.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), Vitest (unit).

## Global Constraints

- CPU only; model on `duotoneInPlace` — same getImageData→mutate→putImageData shape and the same `hexToRgb`/`clamp01` helpers already in the file.
- Gradient stop shape is `{ pos: number; color: string }` (matches `StudioGradientRamp`'s `GradientStop` and the shader). Cap enforced by the editor, not the kernel.
- Fixed chain order becomes `adjust → duotone → gradientMap → bloom → vignette → grain`.
- Frontend unit tests: `cd frontend && npm run test:unit`.
- Commit hygiene (shared working tree): stage only the exact paths each step names; never `git add -A`/`.`, never `git stash`; commit to `main`. If a file to edit is unexpectedly already modified by another session, STOP and report. Commit trailer exactly: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Effect type + `gradientMapInPlace` kernel + chain wiring

**Files:**
- Modify: `frontend/app/lib/compositor/postEffects.ts`
- Modify: `frontend/app/composables/useCompositorLayers.ts` (re-export ~112, `LayerEffect` union ~114)
- Test: `frontend/tests/unit/gradient-map-post.unit.spec.ts` (create)

**Interfaces:**
- Produces: `GradientMapStop { pos: number; color: string }`, `GradientMapEffect { type:'gradientMap'; stops: GradientMapStop[]; contrast: number; mix: number; visible: boolean }`, `gradientMapInPlace(data, stops, contrast, mix): void`, all exported from `postEffects.ts`. `'gradientMap'` added to `CHAIN_TYPES`, `POST_EFFECT_DEFAULTS`, `POST_FX_PARAM_CLAMP`, and the `PostEffect` union.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/gradient-map-post.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gradientMapInPlace, duotoneInPlace, hexToRgb, type GradientMapStop } from '~/lib/compositor/postEffects'

// Build a 1-pixel RGBA buffer at a given grey level.
function px(v: number): Uint8ClampedArray {
  return new Uint8ClampedArray([v, v, v, 255])
}
const BW: GradientMapStop[] = [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]

describe('gradientMapInPlace', () => {
  it('maps a mid-grey through a 2-stop ramp to the interpolated colour', () => {
    // ramp black→red; mid-grey (lum 0.5) → ~ (128,0,0)
    const d = px(128)
    gradientMapInPlace(d, [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ff0000' }], 0, 1)
    expect(d[0]).toBeGreaterThan(120); expect(d[0]).toBeLessThan(140)
    expect(d[1]).toBe(0); expect(d[2]).toBe(0)
    expect(d[3]).toBe(255) // alpha untouched
  })

  it('mix=0 is a no-op', () => {
    const d = px(90)
    gradientMapInPlace(d, BW, 0, 0)
    expect(Array.from(d)).toEqual([90, 90, 90, 255])
  })

  it('empty stops is a no-op', () => {
    const d = px(90)
    gradientMapInPlace(d, [], 0, 1)
    expect(Array.from(d)).toEqual([90, 90, 90, 255])
  })

  it('a single stop is a flat tint', () => {
    const d = px(200)
    gradientMapInPlace(d, [{ pos: 0.3, color: '#00ff00' }], 0, 1)
    expect(Array.from(d)).toEqual([0, 255, 0, 255])
  })

  it('handles unsorted input stops (sorts internally)', () => {
    const a = px(128), b = px(128)
    gradientMapInPlace(a, [{ pos: 1, color: '#ffffff' }, { pos: 0, color: '#000000' }], 0, 1)
    gradientMapInPlace(b, BW, 0, 1)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('parity with duotone: black→white 2-stop at contrast 0, mix 1 == duotoneInPlace', () => {
    for (const v of [0, 40, 128, 200, 255]) {
      const g = px(v), dt = px(v)
      gradientMapInPlace(g, [{ pos: 0, color: '#101010' }, { pos: 1, color: '#f0d0b0' }], 0, 1)
      duotoneInPlace(dt, hexToRgb('#101010'), hexToRgb('#f0d0b0'), 1)
      expect(Array.from(g)).toEqual(Array.from(dt))
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test:unit -- gradient-map-post`
Expected: FAIL — `gradientMapInPlace`/`GradientMapStop` not exported.

- [ ] **Step 3: Add the type, defaults, clamp, CHAIN_TYPES, kernel**

In `frontend/app/lib/compositor/postEffects.ts`:

Add the interfaces after `DuotoneEffect` (~line 45):

```ts
export interface GradientMapStop { pos: number; color: string }
export interface GradientMapEffect {
  type: 'gradientMap'
  stops: GradientMapStop[]  // {pos 0..1, hex}; sorted at apply; >= 1 stop
  contrast: number          // -1..1, 0 = neutral (luminance stretch around 0.5)
  mix: number               // 0..1 — blend original -> mapped
  visible: boolean
}
```

Add `GradientMapEffect` to the `PostEffect` union (~line 60):

```ts
export type PostEffect = AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect | GradientMapEffect | DofEffect
```

Add to `POST_EFFECT_DEFAULTS` (after the `duotone` entry, ~line 67):

```ts
  gradientMap: {
    type: 'gradientMap',
    stops: [{ pos: 0, color: '#1a1a40' }, { pos: 0.5, color: '#c0397a' }, { pos: 1, color: '#ffe8d6' }],
    contrast: 0, mix: 0.85, visible: true,
  },
```

Add to `POST_FX_PARAM_CLAMP` (after the `duotone` entry, ~line 84):

```ts
  gradientMap: { contrast: [-1, 1], mix: [0, 1] },
```

Add `'gradientMap'` to `CHAIN_TYPES` (~line 92):

```ts
const CHAIN_TYPES = new Set<string>(['adjust', 'duotone', 'gradientMap', 'bloom', 'vignette', 'grain'])
```

Add the kernel after `duotoneInPlace` (~line 169):

```ts
/** Gradient-map RGB by luminance across an arbitrary multi-stop ramp; alpha
 *  untouched. `contrast` (-1..1) stretches luminance around 0.5 before the
 *  lookup; `mix` blends toward the mapped colour. Mirrors gradient_map.frag but
 *  runs on the CPU (a gradient map is cheap; no GPU stage needed). */
export function gradientMapInPlace(
  data: Uint8ClampedArray,
  stops: GradientMapStop[],
  contrast: number,
  mix: number,
): void {
  const m = clamp01(mix)
  if (m === 0 || !stops.length) return
  const ramp = stops.map(s => ({ pos: clamp01(s.pos), rgb: hexToRgb(s.color) }))
    .sort((a, b) => a.pos - b.pos)
  const c = 1 + clamp(contrast, -1, 1)
  const n = ramp.length
  for (let i = 0; i < data.length; i += 4) {
    let lum = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    lum = clamp01((lum - 0.5) * c + 0.5)
    let r: number, g: number, b: number
    if (lum <= ramp[0]!.pos) { r = ramp[0]!.rgb.r; g = ramp[0]!.rgb.g; b = ramp[0]!.rgb.b }
    else if (lum >= ramp[n - 1]!.pos) { r = ramp[n - 1]!.rgb.r; g = ramp[n - 1]!.rgb.g; b = ramp[n - 1]!.rgb.b }
    else {
      let hi = 1
      while (hi < n && ramp[hi]!.pos < lum) hi++
      const a = ramp[hi - 1]!, bb = ramp[hi]!
      const span = bb.pos - a.pos
      const f = span <= 1e-6 ? 0 : (lum - a.pos) / span
      r = a.rgb.r + (bb.rgb.r - a.rgb.r) * f
      g = a.rgb.g + (bb.rgb.g - a.rgb.g) * f
      b = a.rgb.b + (bb.rgb.b - a.rgb.b) * f
    }
    data[i] = data[i]! + (r - data[i]!) * m
    data[i + 1] = data[i + 1]! + (g - data[i + 1]!) * m
    data[i + 2] = data[i + 2]! + (b - data[i + 2]!) * m
  }
}
```

- [ ] **Step 4: Wire the kernel into `applyEffectChain`**

In `applyEffectChain`, immediately AFTER the `duotone` block (ends ~line 254, before the `bloom` block), insert:

```ts
  const gradientMap = find<GradientMapEffect>('gradientMap')
  if (gradientMap && gradientMap.mix > 0 && gradientMap.stops.length) {
    const img = ctx.getImageData(0, 0, off.width, off.height)
    gradientMapInPlace(img.data, gradientMap.stops, gradientMap.contrast, gradientMap.mix)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.putImageData(img, 0, 0)
    ctx.restore()
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm run test:unit -- gradient-map-post`
Expected: PASS (6 tests).

- [ ] **Step 6: Wire the layer types**

In `frontend/app/composables/useCompositorLayers.ts`:

Add `GradientMapEffect` to the re-export (~line 112):

```ts
export type { AdjustEffect, BloomEffect, DofEffect, DuotoneEffect, GradientMapEffect, GrainEffect, PostEffect, VignetteEffect }
```

Add `| GradientMapEffect` to the `LayerEffect` union among the chain effects (~line 114):

```ts
  | AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect | GradientMapEffect
```

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E 'postEffects|useCompositorLayers|gradientMap|GradientMap' | tail -20`
Expected: no errors naming these files/symbols (repo carries a large pre-existing baseline).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/compositor/postEffects.ts frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/gradient-map-post.unit.spec.ts
git commit -m "feat(compositor): gradientMap post effect kernel + chain wiring

CPU luminance->multi-stop ramp modelled on duotone; joins the canvas chain
after duotone. Parity-tested against duotoneInPlace."
```

(append the `Co-Authored-By` trailer)

---

### Task 2: Panel section with the multi-stop ramp editor

**Files:**
- Modify: `frontend/app/components/vue-canvas/PostEffectsControls.vue`

**Interfaces:**
- Consumes: `GradientMapStop` + the `gradientMap` effect (Task 1), `StudioGradientRamp` (existing).

- [ ] **Step 1: Add the section + ramp control**

In `frontend/app/components/vue-canvas/PostEffectsControls.vue`:

Add imports (near the existing imports, ~line 15):

```ts
import { type GradientMapStop } from '~/lib/compositor/postEffects'
import StudioGradientRamp from '~/components/vue-canvas/studio/StudioGradientRamp.vue'
```

Extend `SectionSpec` (~line 48) with a `ramp` flag:

```ts
interface SectionSpec { type: PostEffect['type']; label: string; params: ParamSpec[]; colors?: [string, string][]; ramp?: boolean }
```

Add the `gradientMap` section to `SECTIONS` (after the `duotone` entry, ~line 74):

```ts
  { type: 'gradientMap', label: 'Gradient Map', ramp: true, params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
  ] },
```

Widen `patch`'s value type (~line 100) so it accepts the stops array:

```ts
function patch(type: PostEffect['type'], key: string, value: number | string | GradientMapStop[]) {
```

In the template, inside the `v-if="fx(s.type)"` block, add the ramp editor BEFORE the `<div v-for="p in s.params" ...>` sliders loop (i.e. right after the `colors` block):

```html
        <StudioGradientRamp
          v-if="s.ramp"
          :model-value="(fx(s.type)!.stops as GradientMapStop[])"
          @update:model-value="(v: GradientMapStop[]) => patch(s.type, 'stops', v)"
        />
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E 'PostEffectsControls|StudioGradientRamp|gradientMap' | tail -20`
Expected: no errors naming these files/symbols.

- [ ] **Step 3: Browser-pane verification**

With ComfyUI + the dev server up, open the canvas. On an image layer in a Frame, open the post-effects panel:
- Confirm a **Gradient Map** section with an **Add** button; add it.
- Confirm a gradient ramp bar appears with draggable stops + Mix/Contrast sliders; the image recolours by luminance.
- Add/drag/delete a stop and change a stop colour → the layer updates live.
- Drop Mix to 0 → image returns to original; back up → map returns.
- Trigger a render/bake and confirm the effect persists in the output.
Screenshot the recoloured layer + panel.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/PostEffectsControls.vue
git commit -m "feat(compositor): Gradient Map panel section with multi-stop ramp editor"
```

(append the `Co-Authored-By` trailer)

---

## Self-Review

**Spec coverage:**
- `gradientMap` effect on image layers → Task 1 (type + kernel + CHAIN_TYPES) + Task 2 (panel). ✓
- Fully customisable multi-stop gradient → Task 2 reuses `StudioGradientRamp`. ✓
- Reuse gradient-map maths / `{pos,color}` / ramp editor → kernel ports the frag; type matches; editor reused. ✓
- CPU, modelled on duotone → kernel + chain placement + parity test. ✓
- Available whole-frame too (CHAIN_TYPE) → free via `CHAIN_TYPES` membership. ✓
- Edge cases (mix 0 / empty / single / unsorted / contrast clamp) → Task 1 tests. ✓
- No agent change needed (add/remove + numeric clamps generic; UI stops round-trip) → not in scope, correctly untouched. ✓

**Placeholder scan:** none — full code in every code step.

**Type consistency:** `GradientMapStop {pos,color}` defined in Task 1, consumed in Task 2; structurally identical to `StudioGradientRamp`'s `GradientStop` so the `v-model` bind checks. `gradientMapInPlace` signature matches its tests and its `applyEffectChain` call. `GradientMapEffect` added to `PostEffect` (Task 1) AND the `LayerEffect` union + re-export (Task 1 Step 6).
