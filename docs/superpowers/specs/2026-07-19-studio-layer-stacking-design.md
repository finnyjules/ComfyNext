# Studio Layer Stacking — Gradient + Shader

**Date:** 2026-07-19
**Status:** Approved design, pending implementation plan
**Scope:** Gradient studio and Shader studio only. Pattern studio is a deferred follow-up spec.

## Goal

Let users stack an arbitrary number (up to 6) of **full-instance layers** in the Gradient
and Shader studios, with a consistent mental model across both:

- Each layer is a complete output of that studio — a whole gradient, or a whole
  stylized effect.
- Layers composite top-to-bottom, each with its own **blend mode** and **opacity**.
- Layers are reorderable, selectable, addable, removable, duplicable, and per-row
  toggleable.
- The layer list lives in the modal's **left aside panel**; the right controls column
  edits the *active* layer.

This generalizes what the Gradient studio already does (a 2-layer array, hard-capped)
and brings the same model to the Shader studio (which today has a single effect slot).

## Non-goals

- **Pattern studio** — no layering concept exists there today (single global motif with
  1–3 role fills, single-pass enum shader with a CPU-parity twin). A full-instance stack
  is roughly as much work as both studios here combined, and gets its own spec.
- Relief / mesh behavior changes in the Gradient studio (relief keeps lighting layer 0).
- Motion expansion beyond keeping tracks valid across reorder/remove.
- The non-shell "studios" (LipSync, Shot Director) — they don't use `StudioModalShell`.

## Approach

Two studios stack different *contents* but need the *same chrome*: an ordered list with
reorder / add / remove / duplicate / select-active / per-row enable, plus per-layer
**blend + opacity**. We share the chrome and keep compositing native to each studio
(gradient composites in a single fragment shader; shader composites across ping-pong
passes — a shared render abstraction would fight both).

- **Max 6 layers** in both. Gradient *requires* a compile-time cap (fixed-size GLSL
  arrays); matching shader to it keeps them consistent and bounds pattern-studio perf
  when it lands.
- **Layer list in the left `#aside` panel** (`w-56`), mirroring 3D Studio's object list.
  The right controls column shows the active layer's body plus a small blend+opacity
  header. The `w-56` aside is too narrow for per-row sliders, so blend/opacity live in
  the right column, scoped to the active layer.
- **Reorder** via a vertical draggable list, replacing gradient's current horizontal
  numbered chips (which don't scale past ~3 and can't show per-row state).

## Shared modules (the anti-drift core)

### `StudioLayerStack.vue` (new)

Pure-presentation aside component. Renders an ordered list of layer rows and emits
events; holds no studio-specific logic.

- **Props:** `layers` (array — each item provides a `label`/thumbnail + `enabled`),
  `activeIndex`, `max`.
- **Row affordances:** drag handle (reorder), active-select highlight, per-row enable
  toggle, delete-on-hover, add button (disabled at `max`), duplicate.
- **Emits:** `select(i)`, `reorder(from, to)`, `add`, `remove(i)`, `duplicate(i)`,
  `toggle(i)`.

Mounted by both studios in `<template #aside>`. Pattern inherits it later.

### `~/lib/studio/blend.ts` (new — extracted, no behavior change)

Move out of `gradientfx`:

- `BlendKind` type and `BLEND_MODES` array (`normal | lighten | screen | add | multiply
  | darken | overlay`).
- The blend-index map used to upload the blend enum as a float uniform.
- The GLSL `blendLayers()` snippet string.

Gradient's in-shader composite and shader's new composite pass both import the *same*
GLSL string, so the two studios can't diverge in how they blend. `gradientfx` re-exports
from here for back-compat of existing imports.

## Gradient studio — 2 → N layers

The core work is **textures**, not just array sizes. Each layer binds two dedicated
textures — a field and a color ramp — through fixed samplers (`u_field0/1`,
`u_ramp0/1`), and both the upload loop and the fragment shader are hardwired to 2. GLSL
ES cannot index a sampler array by a loop variable, so the clean generalization is to
convert those to **2D array textures**.

### Types — `lib/gradientfx/types.ts`

- Add `export const LAYER_MAX = 6`.
- Retag `layers: LayerConfig[]` as `1..LAYER_MAX` (comment only; the type is already an
  array). `LayerConfig` is unchanged — it already carries `blend` + `opacity`.

### Shader — `lib/gradientfx/shaders.ts`

- Inject `LAYER_MAX` as a `#define` at the top of the fragment source.
- Widen every `[2]` uniform array (`u_count`, `u_dir`, `u_mirrorH/V`, `u_gradHoriz`,
  `u_gap`, `u_rounding`, `u_mapping`, `u_steps`, `u_hueDrift`, `u_hueRotate`, `u_sweep`,
  `u_scrub`, `u_blend`, `u_opacity`, `u_crisp`, `u_rotStep`, `u_pivot`, `u_ringScale`,
  `u_ringShape`) to `[LAYER_MAX]`.
- Convert the two field samplers and two ramp samplers into `sampler2DArray u_fields`
  and `sampler2DArray u_ramps`; `computeLayer(i, …)` samples array layer `i` via
  `texture(u_fields, vec3(uv, float(i)))`.
- Replace the unrolled composite (currently `computeLayer(0)` then
  `if (u_layerCount > 1.5) computeLayer(1)`) with a bounded loop:

  ```glsl
  vec3 col = u_bg; float cover = 0.0;
  for (int i = 0; i < LAYER_MAX; i++) {
    if (float(i) > u_layerCount - 0.5) break;
    vec4 li = computeLayer(i, pw);
    if (i == 0) { col = mix(col, li.rgb, li.a); cover = li.a; }
    else {
      vec3 b = blendLayers(col, li.rgb, u_blend[i]);
      float a = li.a * u_opacity[i];
      col = mix(col, b, a);
      cover = max(cover, a);
    }
  }
  ```
- Relief (`bandHeight(0, …)`) still keys off **layer 0** only — unchanged.

### Renderer — `lib/gradientfx/renderer.ts`

- The per-layer upload loop (`for (let i = 0; i < 2; i++)`) iterates `layers.length`
  instead. `uploadField` / `uploadRamp` write into array-texture layer `i` via
  `texSubImage3D` rather than distinct 2D textures.
- Allocate the two array textures at `LAYER_MAX` depth (resize with the canvas, same as
  today's offscreen targets).
- `u_layerCount = layers.length` already exists; bind `u_fields`/`u_ramps` to their
  texture units once.

### UI — `components/vue-canvas/GradientStudioSurface.vue`

- Replace the horizontal chip strip with `<template #aside><StudioLayerStack …></template>`.
- `addLayer`'s `>= 2` guard becomes `>= LAYER_MAX`. Wire duplicate/reorder/remove/toggle
  to the stack events.
- Blend + opacity render as a small header at the top of the right controls column, shown
  for every layer except index 0 (the base).
- `activeLayer` continues to drive the Shape/Color sections.

### Texture budget

6 layers × (field + ramp) as **two array textures** = 2 texture units total — fewer than
today's 4 fixed samplers. The array-texture route removes any budget concern.

## Shader studio — single slot → N-effect chain

### Config — `lib/shaderstudio/types.ts`

- `effect: StudioEffect` becomes `effects: StudioEffect[]`.
- `StudioEffect` gains `blend: BlendKind`, `opacity: number`, and a stable `id: string`
  (for motion-track binding and reorder identity).
- Add `LAYER_MAX = 6` (soft cap — no GLSL fixed-array constraint here).
- Bump `version`; add a load-time migration wrapping a legacy `effect` as
  `effects: [{ …effect, blend: 'normal', opacity: 1, id }]`.

### Compositing — `lib/shaderstudio/passes.ts` + `lib/shaderfx/renderer.ts`

The one real new backend piece. Today it's a pure ping-pong chain over two FBOs.
Chaining N effects where each *also* mixes back over its input by blend+opacity needs the
layer's input preserved while its output is computed.

- `composePasses` loops the enabled `effects`, expands each effect's passes (as today via
  `expandPasses`), and — **only when a layer has opacity < 1 or blend ≠ normal** — emits a
  snapshot marker + a composite pass. Pure `normal` / opacity-1 layers stay a plain chain,
  byte-identical to today's behavior with zero overhead.
- The renderer gains a third "hold" FBO. When it sees a snapshot marker it blits the
  current accumulated image into the hold buffer; the composite pass then samples
  (this-layer output, held input) and blends via the **shared GLSL `blendLayers()`**.
- Downstream global stages (duotone → gradient-map → adjust → post) run after the effect
  stack — unchanged.

### UI — `components/vue-canvas/ShaderStudioSurface.vue`

- The "Stylized Effects" section splits: the layer list moves to `#aside`
  (`StudioLayerStack`); the right column shows the active effect's picker + params +
  blend + opacity.
- `setEffect` replaces the **active** layer's effect only, not the whole config.
- Add / remove / duplicate / reorder / toggle wire to the stack events.

### Motion + agent

- `MotionTrack` gains an effect `id` (or index) so a track binds to the correct layer;
  remapped on reorder, dropped on remove — mirroring gradient's track handling via the
  shared remap helper.
- `shaderAgentControls` scopes to the active effect layer (like gradient's `activeLayer`).

### Node + bake

- `ShaderStudioNode.vue`'s thumbnail and headless `bakeOutput` both go through
  `composePasses`, so they inherit the change. Verify they read `effects`.

## Data flow

1. User edits in the studio surface → mutates the reactive config
   (`layers[]` / `effects[]`).
2. Config persists to `node.data.properties.sailor_gradientStudio` /
   `sailor_shaderStudio` (unchanged blob keys; shader gains a `version` for migration).
3. Render path reads the config: gradient uploads per-layer array-texture slices + widened
   uniforms and runs the composite loop; shader composes the effect chain into a
   `ShaderPass[]` and ping-pongs (with the hold-FBO composite when a layer blends).
4. Node thumbnail + headless bake reuse the same render/compose path.

## Back-compat & migration

- **Gradient:** no migration — already `layers[]`; we lift the cap and widen the render
  path. Existing 1–2 layer docs must render **byte-identically** (acceptance test).
- **Shader:** `version` bump + load-time `effect → effects[]` wrap. Existing single-effect
  docs must render **byte-identically** (acceptance test).
- Randomize / presets: gradient randomize keeps emitting 1–2 layers; shader presets become
  single-element `effects` arrays. Users stack further by hand.

## Error handling & edge cases

- **Empty stack:** removing the last layer is disallowed (min 1), matching gradient today.
- **All layers disabled:** render falls through to the background (gradient) / source image
  (shader) — no crash.
- **Reorder with motion tracks:** tracks remap to the moved layer's new index/id; tracks
  pointing at a removed layer are dropped by the shared helper.
- **Blend on layer 0:** hidden in the UI; layer 0 is always the base, composited over the
  background/source directly.
- **Texture-array allocation failure (gradient):** fall back gracefully (log + render what
  fits) rather than throwing in the render loop.

## Testing & verification

- **Typecheck** against the ~328 baseline (no new errors).
- **Vite compile-check** on all touched modules.
- **Gradient runtime:** `dev/gradient-studio-lab` mounts the full modal. Drive 3–6 layers,
  reorder, per-layer blend/opacity, confirm compositing and no artifacts. Note: GLSL
  program changes require a **full page reload** (not HMR) to rebuild the program.
- **Shader runtime:** add a small `dev/shader-studio-lab` page that mounts
  `ShaderStudioSurface` with a seeded source image (mirrors the gradient lab — the existing
  `shaderfx-harness` is headless single-effect and insufficient). Drive multiple effects,
  reorder, blend/opacity, confirm the chain and the hold-FBO composite.
- **Back-compat load test:** load a saved 2-layer gradient and a saved single-effect shader
  doc; confirm identical render pre/post change.

## Risks

1. **Gradient `sampler2DArray` conversion** — the main risk. `uploadField`/`uploadRamp`
   move to `texSubImage3D`; verify on the actual GL context, including array depth
   allocation and per-slice upload.
2. **Shader third-FBO composite** — a new render path; verify the hold-buffer snapshot
   timing and that the pure-chain fast path stays byte-identical.
3. **Motion-track remap correctness** across reorder/remove in both studios.
4. **Shared `StudioLayerStack` fit** — must satisfy both studios' row content (gradient
   layer vs. effect layer) without leaking studio-specific logic.

## Files touched

**New:**
- `frontend/app/components/vue-canvas/StudioLayerStack.vue`
- `frontend/app/lib/studio/blend.ts`
- `frontend/app/pages/dev/shader-studio-lab.vue`

**Gradient:**
- `frontend/app/lib/gradientfx/types.ts`
- `frontend/app/lib/gradientfx/shaders.ts`
- `frontend/app/lib/gradientfx/renderer.ts`
- `frontend/app/components/vue-canvas/GradientStudioSurface.vue`
- gradient motion track remap helper (`lib/gradientfx/motion.ts` or shared)

**Shader:**
- `frontend/app/lib/shaderstudio/types.ts`
- `frontend/app/lib/shaderstudio/passes.ts`
- `frontend/app/lib/shaderfx/renderer.ts`
- `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`
- `frontend/app/components/vue-canvas/ShaderStudioNode.vue` (verify only)
- shader motion + agent-controls generalization
