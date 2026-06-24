# Gradient Studio — Liquid Flow (domain-warped gradients)

**Date:** 2026-06-24
**Status:** Design approved, pending spec review
**Inspiration:** `studio.neato.fun/gradients` (liquid / marble flow gradients)

## Summary

Add a **liquid flow** gradient family to Gradient Studio: silky, domain-warped
"marble" gradients where the color ramp is smeared through fbm noise into organic
swirls (see neato.fun reference screenshot). Rather than a separate engine, this
is implemented as a **global coordinate-warp stage** plus one new base layout:

1. **A shared warp** (`flow` config) displaces the sample coordinate *before* the
   existing `computeLayer` maps it — so it distorts **every** layout (linear /
   radial / orbit / stack), melting the geometric gradients into liquid versions
   of themselves. This is the user's explicit "use liquid to distort the existing
   geometric gradients" ask.
2. **A new `'liquid'` layout** — no bars/field, just the color ramp sampled along
   the warped angle-gradient. This is the pure neato look, with its own Depth &
   Light fold shading.

At warp `intensity = 0`, the warp is a no-op and **every existing gradient renders
byte-identical to today** (back-compat guaranteed).

**v1 scope:** still image only (`time = 0`). Animated flow is a documented
fast-follow (§8).

## Reference controls (from neato.fun)

- **Canvas:** Canvas Size (aspect) — already exists.
- **Colors:** positioned color stops + Add stop — already exists (`ColorStop` + ramp LUT).
- **Flow:** Angle, Noise Scale, Noise Intensity, Curve Distortion, Detail — NEW.
- **Depth & Light:** Depth, Highlights, Shadows, Fold Scale — NEW (liquid shading).
- **Grain:** already exists (`relief.grain`).
- **Actions:** Randomize, Reset, Download PNG (exists); Record MP4 (deferred to §8).

## Architecture

The engine is a single WebGL2 fragment shader driven by one serializable
`GradientConfig`. The warp slots in as a pre-transform on the sample coordinate;
nothing else in the render path changes. Randomize/locks, PNG export, the node
preview, and the future video pipeline all keep working untouched.

### Data flow (per pixel)

```
p (uv) ──▶ applyFlow(p)  ─── warped coord ──▶ computeLayer(layout, ·) ──▶ ramp sample ──▶ composite ──▶ relief ──▶ grain
              ▲                                       │
       flow.{noiseScale,                              └─ layout == 'liquid': plain angle-gradient base
        intensity, distortion,                           + flow fold-shading (depth/highlights/shadows/foldScale)
        detail, angle}
```

## Components / file changes

### 1. `app/lib/gradientfx/types.ts`

- Add `'liquid'` to `LayoutKind` and append to `LAYOUTS`.
- New interface:

```ts
export interface FlowConfig {
  /** Base gradient direction (liquid) + warp bias, degrees 0..360. */
  angle: number
  /** Warp noise frequency, ~0.5..8. */
  noiseScale: number
  /** Displacement amount, 0..100. 0 = off (no distortion, back-compat). */
  intensity: number
  /** Iterative curl / "Curve Distortion", 0..100. */
  distortion: number
  /** fbm octaves, 1..6. */
  detail: number
  /** Liquid fold shading (ignored by geometric layouts in v1). */
  depth: number       // 0..100 — emboss amplitude
  highlights: number  // 0..100 — bright-side gain
  shadows: number     // 0..100 — dark-side gain
  foldScale: number   // 0..100 — fold frequency
}
```

- Add `flow: FlowConfig` to `GradientConfig` (sibling of `relief`).
- `DEFAULT_FLOW`: `intensity = 0` so default/old configs render unchanged. Sensible
  liquid defaults for the rest (e.g. `noiseScale 3.5, distortion 50, detail 2,
  depth 60, highlights 50, shadows 55, foldScale 60, angle 45`).
- Extend `ensureConfigDefaults(cfg)` to backfill `cfg.flow ??= { ...DEFAULT_FLOW }`.
  This is the single back-compat seam — persisted node blobs without `flow` get the
  no-op default. Add a `flowConfig(cfg)` accessor mirroring `reliefLight`/`canvasCenter`.

### 2. `app/lib/gradientfx/shaders.ts`

- Add GLSL helpers: `hash`, `valueNoise`/`fbm` (octaves param), and:
  - `vec2 applyFlow(vec2 p)` — domain-warped fbm (Inigo-Quilez "fbm of fbm"):
    compute `q = (fbm(p), fbm(p+a))`, `r = (fbm(p + distortion*q + b), …)`,
    return `p + intensity * r`. Octaves = `u_flowDetail`, frequency = `u_flowScale`,
    strengths from `u_flowIntensity` / `u_flowDistortion`. Returns `p` unchanged
    when `u_flowIntensity == 0`.
  - `float flowHeight(vec2 p)` — scalar fold height for liquid shading
    (fbm at `u_flowFoldScale`), used for finite-difference normal + Lambert.
- In `computeLayer`, transform the incoming coord through `applyFlow` for all layouts.
- Add a `u_layout == 4` (liquid) branch: `t = warpedAngleProjection(p, u_flowAngle)`,
  `rgb = sampleRamp(0, t)`; then apply Depth & Light using `flowHeight` with
  `u_flowDepth` (amplitude), `u_flowHighlights`, `u_flowShadows` as bright/dark gains.
- New uniforms: `u_flowAngle, u_flowScale, u_flowIntensity, u_flowDistortion,
  u_flowDetail, u_flowDepth, u_flowHighlights, u_flowShadows, u_flowFoldScale`.

### 3. `app/lib/gradientfx/renderer.ts`

- `LAYOUT_IDX.liquid = 4`.
- After the relief uniforms, upload the flow uniforms from `flowConfig(c)`
  (normalize 0..100 → shader-friendly ranges in JS, consistent with how `sweep`
  etc. are pre-scaled here).

### 4. `app/lib/gradientfx/randomize.ts`

- `defaultConfig`: include `flow: { ...DEFAULT_FLOW }` (intensity 0 → unchanged look).
- New `liquidConfig(seed?)` preset: `layout: 'liquid'`, warm neato-style stops
  (orange → peach → pink → indigo → near-black), `intensity ~70, distortion ~80,
  detail 2`, depth/light on. Wire a "Liquid" preset button next to Ripple/Stack.
- `reroll(..., 'structure')` and `buildConfig`: roll the flow params (and
  occasionally pick the `'liquid'` layout). Respect a new `flow` lock key.

### 5. `app/components/vue-canvas/GradientStudioSurface.vue`

- Add `'liquid'` to the Layout picker (iterates `LAYOUTS`).
- New **FLOW** section (Angle, Noise Scale, Noise Intensity, Curve Distortion,
  Detail) — visible for all layouts (it's the global warp). Matches the existing
  collapsible-section + slider primitives.
- New **DEPTH & LIGHT** section (Depth, Highlights, Shadows, Fold Scale) — shown
  only when `layout === 'liquid'`.
- When `layout === 'liquid'`, hide the geometric Shape controls (count, gap,
  rounding, bands/pyramid/wave/noise, mapping, mirror, direction) — they don't apply.
- Lock toggles for the new sections, consistent with existing per-section locks.

### 6. `app/components/vue-canvas/GradientStudioNode.vue`

- No structural change — it renders from `config` via the shared renderer, so liquid
  gradients and warped geometric gradients display automatically.

## Reuse notes

- **Colors / ramp LUT** (`ramp.ts`), **grain** (`relief.grain`), **aspect**
  (`canvas.aspect`), **randomize + locks** (`randomize.ts`), **seeded RNG**
  (`rng.ts`), **PNG export** (`renderToBlob`) — all reused unchanged.
- **Relief shading** (`relief.ts` math pattern) — the liquid fold shading reuses the
  same finite-difference-normal + Lambert approach, but driven by `flowHeight` and
  the explicit Depth/Highlights/Shadows controls instead of azimuth/elevation.

## Scope boundary (v1)

| Concern | v1 |
|---|---|
| Warp displacement | **All** layouts (distorts geometric gradients) |
| Depth & Light fold shading | **Liquid layout only** (geometric keeps existing relief) |
| Motion | **Still image only** (`time = 0`) |
| Two-layer composite for liquid | Single ramp/base; layer-2 blend not used by liquid |

## Error handling & back-compat

- Persisted configs without `flow` → `ensureConfigDefaults` backfills `DEFAULT_FLOW`
  (intensity 0 ⇒ no visual change). This is the only migration needed.
- New uniforms are read from a guaranteed-present `flow` block, so no
  `getUniformLocation` returns are conditional.
- `intensity == 0` early-returns `p` in `applyFlow`, so existing gradients incur no
  noise cost and are pixel-identical.

## Testing

- **Unit:** extend the gradientfx tests — `ensureConfigDefaults` backfills `flow`;
  `liquidConfig` produces a `'liquid'` layout with intensity > 0; `LAYOUTS` includes
  `'liquid'`; reroll respects the `flow` lock.
- **Visual (required, per project rule — never ship a WebGL effect on unit tests
  alone):** render liquid presets + warped geometric layouts via the preview/harness,
  screenshot-compare against the neato reference, iterate until the look is signed off.
- **Back-compat:** load an existing saved gradient blob (no `flow`) and confirm the
  rendered image is unchanged.

## Future (post-v1)

§8 **Animated flow / Record MP4:** advance the warp over time. Add a continuous
`flowSpeed` (the warp's `applyFlow` already takes `p`; feed a time-scrolled offset
into the fbm via the existing `u_time` uniform) and expose it through the existing
motion pipeline so it bakes to looping WebM exactly like the other Space Type /
gradient video exports. Also consider extending Depth & Light fold-shading to
geometric layouts.
