# Gradient Studio — Simple Gradients (Linear / Radial / Conic)

**Date:** 2026-08-14
**Status:** Design approved, ready for planning

## Plain-language summary

Gradient Studio today can make elaborate things — liquid marble, stacked rings,
soft meshes, staggered stripe fields — but it **cannot make a plain gradient**.
There is no "two colours fading across the frame at 45°", no "colour radiating
out from a point", no colour-wheel sweep. The layout named `linear` is actually a
field of full-height stripes, and `radial` is that same stripe model bent into
polar coordinates. Neither is the simple primitive a designer reaches for first.

This adds the three missing primitives — **Linear**, **Radial**, **Conic** — as
new layouts, and renames the two existing stripe layouts to **Linear stripes** and
**Radial stripes** so the plain names are free for the plain gradients. A brand-new
gradient opens on the simple Linear ramp. Along the way, two shaping controls that
the colour-stop editor genuinely cannot express — **Repeat** (once / mirror / tile)
and **Falloff** (linear / ease / smooth interpolation) — land for *every* layout,
because they're cheaper to add universally than to gate.

## Goals

1. Three new gradient primitives that produce clean, flat, mathematically-correct
   ramps: an angled linear ramp, a centre-out radial, and an angular/conic sweep.
2. Rename the existing `linear`/`radial` layouts to "Linear stripes" / "Radial
   stripes" **at the display layer only** — no key changes, no migration.
3. Simple Linear becomes the default layout for a new gradient document.
4. Repeat and Falloff controls, available on all layouts.
5. A "Close loop" toggle for Conic, so a 360° sweep can be made seamless.
6. Authored style presets for the new layouts.

## Non-goals

- On-preview drag handles for the gradient axis. Sliders only this round
  (angle / centre / size / sweep). The config is shaped so handles can be added
  later without reshaping it.
- Reworking the existing stripe layouts' behaviour. They are untouched beyond
  their display name.
- Per-stop opacity or mid-point biasing beyond the global Falloff curve.

## The key insight: rename is labels-only

`LayoutKind` keys are the durable identity of a gradient. They are stored verbatim
in every saved project (`data.properties.sailor_gradientStudio`), referenced by all
8 authored presets in `presetConfigs.ts`, encoded into `LAYOUT_IDX` for the shader,
and used as literals across `randomize.ts`, `presets.ts`, and the embed bundles.

Therefore the rename **must not touch the keys**. `'linear'` and `'radial'` keep
meaning the stripe fields. A new display-label map does the renaming:

```ts
// types.ts
export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  ramp:       'Linear',
  radialRamp: 'Radial',
  conic:      'Conic',
  linear:     'Linear stripes',
  radial:     'Radial stripes',
  orbit:      'Orbit',
  stack:      'Stack',
  liquid:     'Liquid',
  mesh:       'Mesh',
}
```

Consequence: **zero migration, zero risk** that a saved document silently changes
look. Old docs render byte-identical.

## Architecture

The three primitives are new `LayoutKind` values — `ramp`, `radialRamp`, `conic`
— appended to `LAYOUTS` and `LAYOUT_IDX` (indices 6, 7, 8). Being layouts, they
inherit the entire studio for free: the multi-layer stack + blend modes, the
colour-ramp editor, posterize/hue, focus blur, the Flow noise warp, the shared post
stack, motion targets, agent vocabulary, PNG/SVG/video export, and embeds. Nothing
new is bolted onto the surface — they slot into the mechanisms that already exist.

### 1. Types — new fields (`types.ts`)

```ts
export type LayoutKind =
  | 'ramp' | 'radialRamp' | 'conic'          // NEW simple primitives
  | 'linear' | 'radial' | 'orbit' | 'stack' | 'liquid' | 'mesh'

export type RampShape = 'circle' | 'ellipse'
export type RepeatKind = 'once' | 'mirror' | 'tile'
export type FalloffKind = 'linear' | 'ease' | 'smooth'

// Per-layer axis for the simple primitives. Optional for back-compat; a layer
// without it uses RAMP_DEFAULTS. Per-layer (not per-canvas) so stacked layers can
// each carry their own angle — the source of good multi-ramp blends.
export interface RampConfig {
  /** Linear ramp direction / conic start rotation, degrees 0..360. */
  angle: number
  /** Radial ramp size, 0.05..2 (1 ≈ touches frame edge). */
  radius: number
  /** Radial contour: circle (aspect-corrected) or ellipse (frame-stretched). */
  shape: RampShape
  /** Conic arc, degrees 20..360. */
  sweep: number
  /** Conic: wrap the ramp so first==last colour meet seamlessly. */
  closeLoop: boolean
}
```

Two fields are added to the **existing** `ColorConfig` (so they work on every
layout, not just the new ones):

```ts
export interface ColorConfig {
  // ...existing...
  /** Ramp repetition: once (default) / mirror (reflect) / tile ×N. */
  repeat?: RepeatKind
  /** Tile count when repeat === 'tile', 2..16. */
  repeatCount?: number
  /** Interpolation curve of the ramp LUT: linear (default) / ease / smooth. */
  falloff?: FalloffKind
}
```

Centre and inner-radius are **reused, not duplicated**: the radial and conic
primitives read the already-declared `canvas.center` (offset) and
`canvas.innerRadius` (hard start / hole). Both are already animatable and
agent-visible.

`RAMP_DEFAULTS = { angle: 90, radius: 1, shape: 'circle', sweep: 360, closeLoop: false }`.
`ensureConfigDefaults` backfills `layer.ramp` for the new layouts and defaults
`color.repeat`/`color.falloff` to `'once'`/`'linear'` — so any config saved before
this feature renders exactly as before.

### 2. Renderer encoding (`renderer.ts`)

`LAYOUT_IDX` extends to `{ …existing, ramp: 6, radialRamp: 7, conic: 8 }`. New
uniforms `u_rampAngle`, `u_rampRadius`, `u_rampShape`, `u_rampSweep`,
`u_rampCloseLoop` (per-layer, mirroring the existing `u_*[i]` arrays), plus
`u_repeat[i]`, `u_repeatCount[i]`. Falloff is **not** a uniform — it changes the
LUT itself (see §4), so it costs nothing in the shader.

### 3. Shader branch (`shaders.ts`)

The current branch ladder opens with `if (u_layout > 4.5) { …mesh }`. Indices 6–8
would fall into that. So the simple primitives are tested **first**, above the
whole existing ladder, which is then left byte-for-byte untouched:

```glsl
// --- Simple primitives (ramp / radialRamp / conic): a clean parametric t → LUT.
if (u_layout > 5.5) {
  float t;
  if (u_layout < 6.5) {                 // ramp — angled linear
    float a = u_rampAngle[i] * PI / 180.0;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 pc = p - 0.5; pc.x *= u_aspect;
    t = dot(pc, dir) + 0.5;
  } else if (u_layout < 7.5) {          // radialRamp — centre-out
    vec2 d = p - 0.5 - u_center;
    if (u_rampShape[i] > 0.5) d.x *= u_aspect;   // circle: aspect-correct
    float r = length(d) * 2.0 / max(u_rampRadius[i], 0.001);
    t = (r - u_innerRadius) / max(1.0 - u_innerRadius, 0.001);
  } else {                              // conic — angular sweep
    vec2 d = p - 0.5 - u_center; d.x *= u_aspect;
    float ang = atan(d.y, d.x) / TAU + 0.5;            // 0..1 around
    ang = fract(ang - u_rampAngle[i] / 360.0);
    float sweep = clamp(u_rampSweep[i] / 360.0, 0.05, 1.0);
    t = ang / sweep;
    if (u_rampCloseLoop[i] > 0.5) t = 1.0 - abs(fract(t) * 2.0 - 1.0); // wrap seamless
  }
  t = applyRepeat(t, u_repeat[i], u_repeatCount[i]);   // shared, see §5
  t = clamp(t, 0.0, 1.0);
  t = quantize(t, u_steps[i]);
  vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
  return vec4(col, 1.0);
}
// ...existing mesh / liquid / radial / linear ladder, unchanged...
```

Flow already runs before `computeLayer` via `applyFlow(p)` on the coordinate, so
the noise warp works on the new primitives with no extra wiring — a flat ramp
picks up the organic Sailor warp for free.

### 4. Falloff — a LUT transform (`ramp.ts`)

Falloff reshapes the interpolation factor `f` inside `buildRampLut`, so it fixes
long-ramp banding on **every** layout with zero shader cost:

```ts
function shapeF(f: number, falloff: FalloffKind): number {
  if (falloff === 'ease')   return f * f * (3 - 2 * f)        // smoothstep
  if (falloff === 'smooth') return f * f * f * (f * (f * 6 - 15) + 10) // smootherstep
  return f                                                    // linear (default)
}
```

`buildRampLut(stops, falloff = 'linear')`. Default arg keeps every existing caller
byte-identical — asserted by a golden test.

### 5. Repeat — a shared `t` transform (`shaders.ts` GLSL helper)

```glsl
float applyRepeat(float t, float mode, float count) {
  if (mode < 0.5) return t;                        // once
  float n = max(1.0, count);
  if (mode < 1.5) return abs(fract(t * n * 0.5) * 2.0 - 1.0); // mirror (reflect)
  return fract(t * n);                             // tile
}
```

Placed right before `quantize` in **every** layout branch (or factored so each
branch calls it) — one declaration, universal reach. Extracted as a pure TS twin
`applyRepeat(t, mode, count)` in a small module so it can be unit-tested without a
GL context.

### 6. Control gating (`controls.ts`) — the trap

`isBanded` is currently defined by **exclusion**: `!isLiquid && !isMesh`. If left
as-is, the three new layouts would silently inherit the entire Shape + Relief +
Margin control set — nonsense for a flat ramp. It flips to **inclusion**:

```ts
const isBanded = (c) => ['linear','radial','orbit','stack'].includes(c.canvas.layout)
const isSimple = (c) => ['ramp','radialRamp','conic'].includes(c.canvas.layout)
const isRadial = (c) => ['radial','orbit'].includes(c.canvas.layout)          // stripe polar (unchanged)
const usesCenter = (c) => isRadial(c) || c.canvas.layout === 'radialRamp' || c.canvas.layout === 'conic'
```

New controls, all `ControlSpec`s so inspector + agent + motion derive together:

| key | kind | range / options | `when` |
|---|---|---|---|
| `layer.ramp.angle` | slider | 0–360 | `ramp` or `conic` |
| `layer.ramp.radius` | slider | 0.05–2 | `radialRamp` |
| `layer.ramp.shape` | select | circle / ellipse | `radialRamp` |
| `layer.ramp.sweep` | slider | 20–360 | `conic` |
| `layer.ramp.closeLoop` | switch | — | `conic` |
| `layer.color.repeat` | select | once / mirror / tile | all |
| `layer.color.repeatCount` | slider | 2–16 | `repeat === 'tile'` |
| `layer.color.falloff` | select | linear / ease / smooth | all |

`canvas.center.*` / `canvas.innerRadius` `when` predicates widen from `isRadial`
to `usesCenter`. Margin stays gated to `isBanded` (it insets the stripe/ring
frame; the simple ramps fill the frame like liquid/mesh).

A new `'Gradient'` section header is added to `GRADIENT_SECTIONS` (between Canvas
and Colours) to hold the ramp axis controls.

### 7. Surface (`GradientStudioSurface.vue`)

- The layout picker renders `LAYOUT_LABELS[l]` instead of the raw key, drops the
  `capitalize` class, and orders simple-first (Linear, Radial, Conic, then the
  stripe/liquid/mesh set). Order is a presentation array; the `LAYOUTS` export
  itself (used by randomize) is unchanged.
- New `v-if="isSimpleRamp"` block for the Gradient axis sliders, mirroring the
  existing `isRadial` block's markup and `BindableRow` pattern (so promote-to-
  variable / bind-to-column works identically).
- Repeat/Falloff rows added to the Colours or Layer section, visible on all layouts.

### 8. Defaults & randomize (`randomize.ts`, `types.ts`)

- `defaultConfig` (the new-doc default) switches `layout: 'linear'` →
  `layout: 'ramp'`, sets a simple 3-stop palette, and attaches `RAMP_DEFAULTS`.
  Because `defaultConfig` also backs the `linear` **preset** builder (§9), that
  preset is repointed to a dedicated stripe builder so the preset keeps its
  stripe look.
- `LAYOUTS` (the randomize pool) gains the three keys, so "Randomize all" can land
  on them. `randFlow` treats them as geometric (subtle/no warp), like the stripe
  layouts.

### 9. Style presets (`presetConfigs.ts`, `presets.ts`)

New authored presets keyed by fresh names (to avoid colliding with the existing
`linear` preset): proposed **`dawn`** (soft linear sky ramp), **`halo`** (radial
glow), **`spectrum`** (conic colour wheel, close-loop on). Each is a hand-built
config pasted as JSON, added to `AUTHORED_PRESETS`; `GRADIENT_PRESET_NAMES` picks
them up automatically. The existing `linear` preset name is repointed from
`defaultConfig` (now a simple ramp) to a small `stripeConfig` builder so it still
produces the stripe archetype the agent expects.

## Data flow

```
GradientConfig (layer.ramp + color.repeat/falloff)
  → ensureConfigDefaults (backfills ramp block + repeat/falloff defaults)
  → renderer.ts uploads u_ramp* / u_repeat* uniforms + buildRampLut(stops, falloff)
  → shaders.ts: simple-primitive branch computes parametric t, applyRepeat, quantize, sampleRamp
  → same composite / post / focus pipeline as every other layout
```

Motion, agent, SVG export, embeds: all derive from the `ControlSpec` list and the
`layout` key, so they pick up the new layouts and fields with no bespoke wiring —
the standard factory payoff.

## Testing strategy

The known failure mode in this repo: a new shader branch that quietly falls through
still renders *a* gradient, and "it rendered" reads as success
([[graceful-fallback-hides-integration-failure]]). Proof is therefore **differential**,
not "it looks like a gradient":

**Unit (pure functions, no GL):**
- `applyRepeat` TS twin: `once` is identity; `tile ×2` doubles; `mirror` reflects
  (t and 1−t symmetric); count clamps.
- `shapeF` falloff: `linear` identity; `ease`/`smooth` monotonic, endpoints pinned
  at 0/1, midpoint pulled correctly.
- **Golden LUT parity:** `buildRampLut(stops)` (default falloff) byte-identical to
  pre-change output — proves the default path is untouched.
- `LAYOUT_LABELS` completeness: one label per `LayoutKind`, no key renamed.
- `ensureConfigDefaults` backfills `ramp`/`repeat`/`falloff` on a legacy blob and
  leaves a fully-specified blob unchanged.
- `visibleGradientControls`: the simple layouts expose the ramp axis controls and
  **not** Shape/Relief; the stripe layouts still expose Shape/Relief and not ramp.

**Rendered / differential (live Browser pane, per [[reproduce-open-findings-at-head-first]]):**
- Each new layout rendered and asserted **not** pixel-identical to the `linear`
  stripe layout at the same palette (proves the branch is actually reached).
- **Broken-control checks** ([[runtime-bugs-unit-tests-missed]]): Linear angle 0
  vs 90 must rotate the image (row-mean vs col-mean divergence flips); radial
  `radius → 0` collapses toward a single colour; conic `sweep` narrows the arc;
  `closeLoop` on removes the seam (first-col vs last-col delta drops near 0).
- Repeat `tile ×3` produces 3 detectable ramp cycles across the axis; `mirror`
  produces a symmetric field.
- The three authored presets load and render their intended look.

## Risks & mitigations

- **Branch-ladder ordering** — the new branch MUST sit above `u_layout > 4.5`, or
  indices 6–8 render as mesh. Mitigated by the not-identical-to-stripe render test.
- **`isBanded` inversion** — if missed, Shape/Relief leak onto flat ramps. Covered
  by the `visibleGradientControls` gating test.
- **Preset-name collision** on `linear` — repointing that preset to a stripe
  builder is easy to forget; a preset test asserts `buildGradientPreset('linear')`
  still yields `layout: 'linear'`.
- **Per-layer uniform arrays** — the ramp uniforms must be `[i]`-indexed like the
  rest, not scalar, or stacked layers all share one angle. Covered by a two-layer
  render test with different angles.
```
