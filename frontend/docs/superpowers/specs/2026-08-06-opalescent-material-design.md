# Opalescent (thin-film / holographic) material — 3D Studio

**Date:** 2026-08-06
**Surface:** Scene3D Studio (`app/lib/scene3d/`, `Scene3DStudioSurface.vue`)

## Plain summary

3D Studio gets a new material called **Opalescent** — the flowing rainbow you see on
soap bubbles, opals, and holographic foil. The rainbow shifts as the object turns in the
light (like a real opal) and can optionally drift on its own over time. You pick the
colours from the same gradient-stop editor the Gradient material already uses, so any
palette works, and an agent or a motion track can drive every knob.

## Why the current tools don't reach it

- Stock THREE `iridescence` (already a slider) is lit by a soft neutral `RoomEnvironment`,
  so it reads muted/grey, not the vivid black-background spectrum.
- The `gradient` material is vivid but **spatial** — its ramp runs along a world axis, so
  it can't do the *normal/view-dependent* flow that makes an opal shimmer when it rotates.

## Approach (chosen)

**Normal + Fresnel spectral ramp.** A `MeshStandardMaterial` + `onBeforeCompile` GLSL
injection — the exact pattern `fresnel` and `gradient` already use. In the fragment shader:

```
fresnelTerm = pow(1.0 - abs(dot(viewDir, normal)), 1.0)      // rim-weighted
s = mix(normalComponent, fresnelTerm, opalAngleMix)          // 0..1 driver
s = fract(s * opalFrequency + opalHueShift/360 + uTime*opalFlowSpeed)
rainbow = texture(uRamp, vec2(s, 0.5)).rgb                   // reused ramp texture
outgoingLight = mix(litBase, rainbow, opalStrength)          // over soft lit substrate
```

`uRamp` is built by the **existing** `buildRampTexture(gradientStopsOf(mat))`. Base substrate
is the standard lit result using `color`/`roughness`/`metalness`, so the form still reads as
a soft 3D object rather than a flat decal.

Rejected: physical thin-film (user wants ramp+hue art-direction, not thickness/IOR);
baked matcap (not view-correct, not animatable, not art-directable).

## Data model (`config.ts`)

- `MaterialType` union + `MATERIAL_TYPES` array gain `'opalescent'`.
- New `SceneMaterial` fields (all optional, absent = default → old docs render identically):
  - `opalHueShift?: number`   // 0–360, rotates the spectrum
  - `opalFrequency?: number`  // 0.5–5, rainbow bands across the surface
  - `opalAngleMix?: number`   // 0–1, normal-driven ↔ view/fresnel-driven
  - `opalFlowSpeed?: number`  // 0–2, time drift; **0 = still**
  - `opalStrength?: number`   // 0–1, rainbow vs lit base
- **Reused** fields: `gradientStops` (spectrum), `color`, `roughness`, `metalness`.
- `MATERIAL_DEFAULTS`: hueShift 0, frequency 1.5, angleMix 0.6, flowSpeed 0, strength 1.
- Parser (`parseMaterial`): clamp + `num()` each new field like the existing iridescence lines.

## Material factory (`materials.ts`)

- New `case 'opalescent'` in build: `MeshStandardMaterial({ roughness, metalness })` with
  `onBeforeCompile` injecting the decls/bodies above; uniforms `{ uRamp, uHueShift,
  uFrequency, uAngleMix, uStrength, uTime }` held outside the closure (mutable in-place).
  `customProgramCacheKey = () => 'scene3d-opalescent'`. Stash `userData.opalUniforms` +
  `userData.rampSig = rampSignature(stops)`.
- New `case 'opalescent'` in update: set uniform `.value`s in place; rebuild ramp only when
  `rampSignature` changes (same guard the gradient case uses). Colour/roughness/metalness
  update in place.
- GLSL as module const strings (`OPAL_FRAG_DECL`, `OPAL_FRAG_BODY`) next to the gradient ones.

## Time feed (only genuinely new plumbing)

- Track built opal materials in a module `Set` (mirrors `imageMaterials`).
- The engine already calls a once-per-host-frame refresh (`refreshShaderFields(elapsedSec)`).
  Add an opal pass in that same call path that writes `elapsedSec` into every live opal
  material's `uTime`. No new host wiring. With `opalFlowSpeed` 0 the value is multiplied out,
  so a still scene stays still and needs no per-frame work beyond the uniform write.

## Controls (`controls.ts`) + agent (`agentControls.ts`)

- Register the 5 new scalars as `ControlSpec` sliders gated to `type === 'opalescent'`, so the
  slider UI, agent expression, AND motion tracks all derive from the one list (the Gradient
  precedent). Add `'opalescent'` to whichever gates make sense (it reads `color`, so add to
  `COLOR_TYPES`; it reads `gradientStops`, so surface the stop editor for it).
- Extend the `agentControls.ts` doc string: opalescent derives colour from `gradientStops` +
  hue/frequency/angleMix/flow, ignores base `color` except as substrate tint.

## UI (`Scene3DStudioSurface.vue`)

- New `<template v-else-if="matType === 'opalescent'">` block: the **existing gradient-stop
  editor** (bound to `gradientStops`) + the 5 sliders + base colour/roughness. Reuse the
  gradient block's stop-editor markup so the two stay consistent.

## Testing (TDD)

1. **Config round-trip:** parse → serialize preserves all opal fields; absent fields fill
   defaults; out-of-range values clamp.
2. **ControlSpec registration:** the 5 opal controls appear exactly when `type==='opalescent'`
   and are withheld otherwise (mirrors existing material-gating tests).
3. **Input-correlation (guards against the "parity agrees on a wrong answer" trap):** render
   the opal material offscreen at two hueShift / two stop-set / two frequency values → pixels
   MUST differ; render at two values of an unrelated knob held constant → pixels MUST match.
   A deliberately-neutralised shader (rainbow strength forced 0) must FAIL the "differ" check,
   proving the test can see the effect.
4. Live look-check in the Browser pane (local WebGL, no paid render) — confirm the shimmer
   flows on rotate and the flow knob animates.

## Out of scope (YAGNI)

Physical thin-film mode, sheen/specular highlight knob, per-facet prismatic variant,
frame-anchored spectrum. Fast-follow if the base look lands.
