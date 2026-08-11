# Gradient-map post effect for Compositor image layers

**Date:** 2026-08-10
**Status:** Design approved, ready for implementation plan

## Plain-language summary

Add a **gradient map** post-processing effect to the Frame/Compositor. A gradient
map recolours an image by its brightness: dark pixels take the colour at the
start of a gradient, bright pixels the colour at the end, midtones the colours
in between. The gradient is **fully customisable** — a multi-stop ramp where you
add/move/delete stops and pick each stop's colour. It behaves like the existing
Duotone effect, but with any number of colour stops instead of just two.

## Goals

- A `gradientMap` effect selectable on image layers (and, since it joins the
  shared chain, whole-frame too) in the Compositor's post-effects panel.
- Fully customisable gradient via the existing multi-stop ramp editor.
- Reuse: the gradient-map maths (already in `shader_effects/gradient_map.frag`),
  the `{pos, color}` stop shape, and `StudioGradientRamp.vue`.
- CPU implementation modelled on the existing `duotoneInPlace` — no new GPU
  plumbing (a gradient map is cheap).

## Non-goals

- GPU path (the `.frag` exists; not needed for cost — documented alternative).
- Agent-authored custom gradients: the agent can add/remove the effect and set
  `mix`/`contrast` (generic sanitizer), and UI-set stops round-trip safely, but
  agent-authored *stop arrays* are out of scope for this change.
- Changing Duotone or any other existing effect.

## Background (verified)

- Compositor post effects live in `frontend/app/lib/compositor/postEffects.ts`:
  a discriminated union `PostEffect`, `POST_EFFECT_DEFAULTS`,
  `POST_FX_PARAM_CLAMP`, a `CHAIN_TYPES` set, and `applyEffectChain` (canvas-2D,
  fixed order `adjust → duotone → bloom → vignette → grain`). The closest analog
  is `duotoneInPlace` (`:155`) — a luminance→2-colour map.
- `LayerEffect` (`useCompositorLayers.ts:113`) enumerates each post type
  explicitly and re-exports them (`:112`) — a new effect must be added there.
- Panel: `PostEffectsControls.vue` — a `SECTIONS` array of `{type, label,
  params[], colors?}`; renders `type=color` inputs then `type=range` sliders;
  `patch(type, key, value)` emits the full replacement chain.
- Reusable ramp editor: `StudioGradientRamp.vue` — `defineModel<GradientStop[]>`
  (`GradientStop = {pos:number; color:string}`), full add/drag/delete UX, emits a
  fresh array on every change.
- Agent sanitizer `sanitizePostEffect` (`agent/surfaces/compositor.ts:52`)
  validates `type ∈ POST_EFFECT_DEFAULTS`, clamps numeric params in
  `POST_FX_PARAM_CLAMP`, and preserves current values via `{...default, ...cur}`.
  A new effect with numeric clamps is handled with no sanitizer change; UI-set
  stops round-trip because `cur` is spread into the base.

## Design

### 1. Effect type + kernel — `lib/compositor/postEffects.ts`

Add the stop type + effect:

```ts
export interface GradientMapStop { pos: number; color: string }
export interface GradientMapEffect {
  type: 'gradientMap'
  stops: GradientMapStop[]  // {pos 0..1, hex}; sorted at apply; ≥1 stop
  contrast: number          // -1..1, 0 = neutral (luminance stretch around 0.5)
  mix: number               // 0..1 — blend between original and mapped
  visible: boolean
}
```

- Add `GradientMapEffect` to the `PostEffect` union.
- `POST_EFFECT_DEFAULTS.gradientMap`: a pleasing non-identity ramp
  `[{pos:0,color:'#1a1a40'},{pos:0.5,color:'#c0397a'},{pos:1,color:'#ffe8d6'}]`,
  `contrast: 0`, `mix: 0.85`, `visible: true`.
- `POST_FX_PARAM_CLAMP.gradientMap`: `{ contrast: [-1, 1], mix: [0, 1] }` (stops
  aren't a numeric slider, so they're not clamped here — the editor bounds them).
- Add `'gradientMap'` to `CHAIN_TYPES`.

Kernel (models `duotoneInPlace`; CPU, no MAXS cap):

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
    // Bracket lum between two stops (ends clamp, no wrap).
    let r: number, g: number, b: number
    if (lum <= ramp[0]!.pos) { ({ r, g, b } = ramp[0]!.rgb) }
    else if (lum >= ramp[n - 1]!.pos) { ({ r, g, b } = ramp[n - 1]!.rgb) }
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

Wire into `applyEffectChain` right after the `duotone` block (same
getImageData → mutate → putImageData shape), guarded by `mix > 0 && stops.length`.

### 2. Layer type wiring — `composables/useCompositorLayers.ts`

- Add `GradientMapEffect` to the `export type { ... }` re-export (`:112`).
- Add `| GradientMapEffect` to the `LayerEffect` union (with the other chain
  effects, `:114`).

### 3. Panel — `PostEffectsControls.vue`

- Import `StudioGradientRamp` and `GradientMapStop`.
- Extend `SectionSpec` with `ramp?: boolean`.
- Add a section: `{ type: 'gradientMap', label: 'Gradient Map', ramp: true,
  params: [{key:'mix',label:'Mix',min:0,max:1,step:0.01},
  {key:'contrast',label:'Contrast',min:-1,max:1,step:0.01}] }`.
- Widen `patch`'s `value` param to also accept `GradientMapStop[]`.
- In the template, inside `v-if="fx(s.type)"`, when `s.ramp` render the ramp
  above the sliders:
  ```html
  <StudioGradientRamp
    v-if="s.ramp"
    :model-value="fx(s.type)!.stops"
    @update:model-value="(v: GradientMapStop[]) => patch(s.type, 'stops', v)"
  />
  ```
  (`StudioGradientRamp`'s `GradientStop` is structurally identical to
  `GradientMapStop`, so the bind type-checks.)

## Edge cases

- `mix = 0` or empty `stops` → kernel returns early (no-op).
- Single stop → flat tint (whole image maps to that colour, scaled by `mix`).
- `contrast` extremes clamp to [-1, 1]; luminance clamps to [0, 1] before lookup.
- The ramp editor enforces its own min/max stop count; the kernel accepts any
  count ≥ 1, so a hand/agent-set array with more stops still renders.
- Because it's a `CHAIN_TYPE`, gradient map is available both per-image-layer
  and whole-frame with no extra wiring (request is image layers — that's the
  primary surface).

## Testing

- **Unit (`gradientMapInPlace`)**:
  - A known luminance through a known 2-stop ramp lands on the interpolated
    colour (with `contrast:0, mix:1`).
  - `mix = 0` leaves pixels unchanged; empty `stops` leaves pixels unchanged.
  - **Parity with duotone**: a black→white 2-stop map at `contrast:0, mix:1`
    produces the same output as `duotoneInPlace` with those two colours — proves
    the ramp maths matches the established effect (not just "runs").
  - Unsorted input stops are handled (sorted internally); single stop = flat
    tint.
- **Browser-pane** (canvas glue): add Gradient Map to an image layer, edit stops
  (add/drag/delete + colour), confirm the layer recolours by luminance and it
  survives a render/bake. Handed to Julien for the live click-through
  (leader-lock on his open tab).
