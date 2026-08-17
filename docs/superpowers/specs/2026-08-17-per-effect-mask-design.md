# Per-effect spatial mask for Shader Studio

**Date:** 2026-08-17
**Status:** Design approved (verbal), implementing.

## Plain summary

Today every Shader Studio effect (warp, pixelate, halftone, …) applies to the
**whole frame**. This feature lets you confine an effect to a **region** of the
image — a circle/ellipse, a band (thin strip), or a linear gradient falloff —
and move/resize that region. So "make the warp thinner" becomes "put the warp in
a narrow band," and "warp just this corner" becomes "put a radius mask there."

The mask is **per effect**, not per layer: if a layer runs a warp and a colour
shift, you can mask the warp while the colour shift stays full-frame.

It is **off by default**. An effect with no mask behaves exactly as it does
today and costs nothing extra (no added render pass).

## Goals / non-goals

**Goals (this spec):**
- A reusable mask that works on **all** effects without editing any `.frag` file.
- Three analytic region shapes: `radius` (ellipse), `band` (strip), `linear`
  (directional gradient).
- Move, resize, rotate, feather, and invert the region.
- Phase 1: data model + render pipeline + panel controls (fully functional,
  pixel-verifiable).
- Phase 2: on-canvas drag handles on the studio preview (the intended UX).

**Non-goals (future, separate spec):**
- Drawn/freeform mask painted with a brush (needs a `u_mask` texture + brush UI).
  The design leaves room for this as "mask source = texture" later.
- Boolean combination of multiple masks per effect.

## Architecture

The chosen approach is a **renderer-level masked composite** (Approach A from
brainstorming). The effect shaders never change; masking is one extra pass the
renderer inserts after a masked effect's passes.

This maps directly onto machinery that already exists in
`frontend/app/lib/shaderfx/renderer.ts`:

- `holdTex` / `holdFbo` — a snapshot buffer, already used by `snapshot: true` to
  capture a layer's input before its effect runs.
- The `composite` pass — already reads the effect **output** (`u_image0`) and the
  held **input** (`u_below`) and does `mix(below, above, …)`.

A mask pass is the same read pattern with a spatial mix factor instead of a
scalar opacity:

```
maskedOutput = mix(effectInput, effectOutput, maskValue(uv))
```

where `effectInput` is the held snapshot and `maskValue(uv) ∈ [0,1]` is computed
analytically from the mask uniforms.

### Data model

`frontend/app/lib/shaderstudio/types.ts` — a new optional field on `StudioEffect`:

```ts
export type MaskShape = 'radius' | 'band' | 'linear'

export interface EffectMask {
  enabled: boolean
  shape: MaskShape
  cx: number       // center x, 0..1 (normalized image space)
  cy: number       // center y, 0..1
  size: number     // 0..1: radius (radius) | half-width (band) | half-extent (linear)
  aspect: number   // ellipse x/y ratio; 1 = circle. band/linear ignore.
  angle: number    // radians; rotates band/linear (and ellipse) orientation
  feather: number  // 0..1 edge softness (fraction of size)
  invert: boolean  // effect OUTSIDE the region instead of inside
}

export interface StudioEffect {
  // …existing fields…
  mask?: EffectMask   // absent/enabled:false ⇒ full-frame, no extra pass
}
```

`mask` is **optional** so `hydrateConfig`'s deep-merge leaves older saved configs
untouched (absent ⇒ `undefined` ⇒ disabled). `defaultMask()` provides a centered
circle at half size when the user first enables a mask.

Because `cx`/`cy`/`size`/`aspect`/`angle`/`feather` are numeric leaves, existing
**motion** already animates them for free via dotted paths
(`effects.0.mask.size`, `effects.0.mask.cx`, …) — no motion-system changes needed.

### Shared mask module

`frontend/app/lib/shaderstudio/mask.ts` (new) holds:
- `defaultMask(): EffectMask`
- `MASK_GLSL: string` — the `maskValue(vec2 uv)` GLSL function (single source of truth).
- `maskUniforms(m: EffectMask): Record<string, number>` — flattens the mask to the
  pass uniforms (`u_maskShape`, `u_maskCenter`→ handled as two floats or a vec2, etc).
- `sampleMask(m, u, v, aspectRatio): number` — a **JS mirror** of the GLSL, for unit
  tests (properties: inside≈1, outside≈0, feather monotonic, invert symmetric).

The GLSL and the JS mirror are tested against the *same properties*, and the real
GLSL is proven by a live pixel diff (a JS↔GLSL parity test alone can agree on a
wrong answer — see project memory).

### maskValue GLSL (single source)

```glsl
// 0 = radius/ellipse, 1 = band, 2 = linear
uniform float u_maskShape;
uniform vec2  u_maskCenter;   // 0..1
uniform float u_maskSize;
uniform float u_maskAspect;
uniform float u_maskAngle;
uniform float u_maskFeather;
uniform float u_maskInvert;

float maskValue(vec2 uv, vec2 res) {
  float ar = res.x / max(res.y, 1.0);          // square the space so circles stay round
  vec2 d = uv - u_maskCenter;
  d.x *= ar;
  float ca = cos(u_maskAngle), sa = sin(u_maskAngle);
  d = mat2(ca, -sa, sa, ca) * d;
  float size = max(u_maskSize, 1e-4);
  float fw = clamp(u_maskFeather, 1e-4, 1.0);
  float m;
  if (u_maskShape < 0.5) {                       // ellipse
    d.x /= max(u_maskAspect, 1e-3);
    float dist = length(d) / size;
    m = 1.0 - smoothstep(1.0 - fw, 1.0, dist);
  } else if (u_maskShape < 1.5) {                // band (strip along rotated x)
    float dist = abs(d.y) / size;
    m = 1.0 - smoothstep(1.0 - fw, 1.0, dist);
  } else {                                        // linear gradient across rotated y
    m = clamp((d.y / size) * 0.5 + 0.5, 0.0, 1.0);
  }
  return mix(m, 1.0 - m, step(0.5, u_maskInvert));
}
```

### Render pipeline wiring

`frontend/app/lib/shaderstudio/passes.ts` — inside the effect-stack loop, when
`layer.mask?.enabled`:

1. Force `snapshot: true` on the effect's **first** pass (captures the effect's
   input into `holdTex`). This is the same flag the blend path already uses; set
   it once whether the mask, the blend, or both need it.
2. After the effect's expanded passes, push a mask pass:
   `{ id: 'studio:mask', source: '', uniforms: {}, maskComposite: maskUniforms(layer.mask) }`.
3. If the layer *also* needs a blend/opacity composite (non-normal blend or
   opacity < 1, stacked), that existing composite pass runs **after** the mask
   pass. Both read `holdTex` as the image beneath; the mask pass writes to a
   ping-pong FBO (not `holdTex`), so the held input survives for the blend pass.
   Order: effect passes → mask mix → blend/opacity composite.

`frontend/app/lib/shaderfx/renderer.ts`:
- Add `maskComposite?: MaskUniforms` to `ShaderPass`.
- Add a `MASK_FS` program (compiled lazily, cached like `composite`/`blit`).
- In the render loop, add a branch mirroring the `composite` branch: bind
  `readTex` → `u_image0` (effect output), `holdTex` → `u_below` (effect input),
  set `u_resolution` and the mask uniforms, draw into `fbos[i % 2]`, advance
  `readTex`. `MASK_FS` reuses `MASK_GLSL` from the shared module.

No change to the existing blit, base-texture, or per-layer composite behavior.

### UI

**Phase 1 — panel** (in the Shader Studio effect controls,
`frontend/app/components/vue-canvas/ShaderStudioSurface.vue` / its control rows):
a collapsible **Mask** section per effect — enable toggle, shape picker
(Radius / Band / Linear), invert toggle, feather slider, size slider, and (for
band/linear) an angle control. Follows the existing studio control-row
conventions; action-blue accent only.

**Phase 2 — on-canvas handles**: an overlay on the studio preview with draggable
handles — center (move), edge (size, and x for ellipse aspect), and a rotation
handle for band/linear — plus a dashed region outline. Reuses the on-preview
editor pattern (loft spine / gradient stop editors). Overlay root is
`pointer-events-none` with `pointer-events-auto` children so it never eats wire
drags on the canvas.

## Data flow

```
config.effects[i].mask
   └─ composePasses() ─ if enabled ─▶ snapshot input + append studio:mask pass
        └─ shaderFx.render()
             ├─ effect passes  → effect output in ping-pong
             ├─ studio:mask    → mix(holdTex input, output, maskValue) → ping-pong
             └─ studio:composite (only if non-normal blend/opacity) → blend over holdTex
```

## Edge cases

- **Mask disabled / absent:** no pass added; identical to today; goldens unchanged.
- **Base (non-stacked) layer:** snapshot captures the original base; mask mixes
  effect output against the untouched original → effect shows only in-region.
- **Multi-pass effect (bloom, passes>1):** the mask mixes the effect's *final*
  output against its input — the mask gates the effect as a whole, not each
  internal pass (snapshot is on pass 0 only; mask pass is appended after all).
- **size → 0:** clamped to avoid divide-by-zero; region collapses to nothing
  (effect off) — acceptable, and invert makes it full-frame.
- **feather → 0:** clamped to a hair so the edge is a hard step, not NaN.
- **Non-square image:** aspect-corrected so a `radius` mask stays circular.

## Testing / verification

- **Unit** (`mask.spec.ts`): `sampleMask` — center inside ≈ 1, far outside ≈ 0,
  feather region monotonic decreasing, `invert` gives `1 - m`, radius stays
  circular under a non-1 aspect ratio.
- **Unit** (`passes.spec.ts` extension): enabling a mask appends exactly one
  `studio:mask` pass with the effect's snapshot set; disabling adds none; mask +
  non-normal blend yields effect → mask → composite in that order.
- **Live pixel proof** (the decisive one): in the running studio, apply the warp
  with a `radius` mask and assert pixels **outside** the region equal the
  untouched input while **inside** differ; move the center → region follows;
  switch to `band` and narrow it → warp confined to a thin strip; `invert` flips
  which side is warped. Verified by screenshot + sampled pixels, not synthetic
  events (project memory: synthetic events prove nothing).
- **Golden parity** (`tests/shaderfx-golden.spec.ts`): unchanged — masks off by
  default add no pass, so existing goldens must still match.

## Files touched

- `frontend/app/lib/shaderstudio/types.ts` — `EffectMask`, `MaskShape`, `mask?` field, default.
- `frontend/app/lib/shaderstudio/mask.ts` — **new**: defaults, `MASK_GLSL`, `maskUniforms`, `sampleMask`.
- `frontend/app/lib/shaderstudio/passes.ts` — append mask pass when enabled.
- `frontend/app/lib/shaderfx/renderer.ts` — `MASK_FS` + `maskComposite` pass branch.
- `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (+ control rows) — panel UI (Phase 1) and on-canvas overlay (Phase 2).
- Tests: `frontend/tests/unit/shaderstudio-mask.unit.spec.ts` (+ passes coverage).
</content>
</invoke>
