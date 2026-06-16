# Gradient Studio — procedural gradient node

**Date:** 2026-06-16
**Status:** Approved, implementing
**Branch:** `feat/gradient-studio`

## Goal

A canvas node that procedurally generates gradient images/animations in the
spirit of Leo Benzoni's **GRADIENTOOL** — soft, grainy bars of gradient color
arranged linearly or radially, randomized from a seed, exported as a still PNG
(wired into the Compositor/Frame pipeline) and, on demand, as a baked video clip
for the timeline.

Reference behaviour (from the tool):
- **Structure** — the canvas is built from *bars* whose depth follows a shape
  function: **Pyramid/V**, **Wave** (equalizer peaks), **Noise** (fBm terrain).
- **Layout** — bars arranged **Linear** (columns), **Radial** (glowing ring),
  or **Orbit** (rotating spokes).
- **Colour** — a gradient ramp (stops) mapped onto the structure via
  **Per bar / Field / Across**, with steps quantization + hue drift/rotate.
- **Layers** — up to 2, blend mode + opacity.
- **Relief & grain** — film-grain + relief shading (the signature soft look).
- **Randomize** — seeded rolls; separate Colours / Structure re-rolls; roll
  history; field locks skip re-roll.
- **Motion** — animate a param (phase/scrub/peaks…) with easing/loops; export a
  frame sequence → video.

## Decisions (from brainstorming)

1. **Purpose:** primarily a background/texture source feeding the pipeline.
2. **Scope:** full parity, including Motion.
3. **Motion output:** both — always a still PNG output, plus a baked video on demand.
4. **Approach:** dedicated node + dedicated WebGL renderer (not the float-only
   shader_effects manifest, not a server-side generator).

## Architecture

Mirror the **Space Type** pattern exactly — a frontend-only node (no backend
`class_type`, never executes), config persisted in
`node.data.properties.comfynext_gradientStudio`, a live-preview card, and a
full-screen surface editor that bakes its own outputs.

```
frontend/app/lib/gradientfx/
  types.ts        # GradientConfig + sub-types (single serializable source of truth)
  rng.ts          # xmur3 hash + mulberry32 — deterministic seeded RNG
  ramp.ts         # gradient stops → 256px RGBA LUT (Uint8) + hex helpers
  field.ts        # CPU bar-depth field per shape (pyramid/wave/noise/fbm)
  randomize.ts    # buildConfig(seed) + reroll(config, 'all'|'colours'|'structure', locks)
  renderer.ts     # GradientFxRenderer — WebGL2 singleton, render(config,w,h,t)→canvas
  shaders.ts      # the fragment shader source (layout + colour + grain + blend)
  motion.ts       # evaluate motion tracks → per-frame param overrides
  bake.ts         # reuse ensureSpaceTypeBake rails for the frame sequence

frontend/app/components/vue-canvas/
  GradientStudioNode.vue     # canvas card: live preview + Edit + handle (mirror SpaceTypeNode)
  GradientStudioSurface.vue  # editor: preview + Randomize/Rolls + Canvas/Shape/Colour/
                             #   Relief/Layers/Motion/Export panels (mirror SpaceTypeSurface)
```

Registration touch points (all mirror SpaceType):
- `ARTIFACT_NODE_COMPONENTS` in `useVueNodes.ts`: `GradientStudio: 'gradient-studio'`
- `node-types` map in `VueNodeCanvas.vue`: `'gradient-studio': markRaw(GradientStudioNode)`
- `createNodeData` wildcard-output special case (frontend-only node)
- open/output events: `comfynext:openGradientStudio` + `comfynext:gradientStudioOutput`
  (handlers clone the SpaceType ones)
- `default.vue` Load menu: a "Gradient" entry dispatching `addNode` `GradientStudio`

## Render pipeline (per layer, then composite)

1. **Field (CPU, `field.ts`)** — shape function → `Float32Array(count)` of bar
   depths 0..1, shaped by count, curve exponent, jitter, peaks/detail, phase.
   Uploaded as an `N×1` R-channel data texture.
2. **Layout (GLSL)** — map each pixel into field-space: Linear = column index +
   depth axis (direction/mirror); Radial/Orbit = angle→bar, radius→depth
   (margin/innerRadius). Soft feather at the fill boundary → the blurred look.
3. **Colour (GLSL)** — sample the 256px ramp LUT; mapping mode picks the lookup
   coord (across=bar axis, perbar=within-bar depth, field=depth value); `steps`
   quantizes; hue drift/rotate in HSL.
4. **Relief & grain (GLSL)** — hash grain over `gl_FragCoord+seed`; relief =
   subtle shading from the depth gradient.
5. **Layers** — one fragment shader computes layer0 + layer1 (uniforms suffixed
   per layer, fields/ramps as separate textures), blends layer1 over layer0 via
   blend mode + opacity, over the background color.

Animation = the same `render()` evaluated with motion-overridden params at time
`t`, so preview and bake are identical.

## Output wiring

- **Still:** surface renders at export resolution to an offscreen canvas →
  `toBlob` PNG → `uploadFrameBatch` → `comfynext:gradientStudioOutput` creates a
  downstream **Image** artifact wired from the node (provenance edge), exactly
  like Space Type's "Generate as image".
- **Video:** `ensureSpaceTypeBake(cfg, …, { renderFrame })` bakes the PNG
  sequence, POST `/comfynext/spacetype_encode` returns an MP4 → **Video**
  artifact. (Reuses the existing encoder route; no new backend.)
- **Export PNG/JPG (2K/4K/8K):** direct browser download from the offscreen render.

## Seed / randomize / rolls

- Seed = short hash string (e.g. `#b061ca8z`) → `xmur3`→`mulberry32`. Same seed +
  locks ⇒ identical image.
- Randomize = new seed → `reroll('all')`. Colours / Structure re-roll only their
  field group. Locked fields are never touched.
- Rolls = in-memory `{seed, thumb}` history (capped ~48), click to restore,
  CLEAR empties. Only the active config is saved to the node (history is session-scoped).

## Testing

- Unit (vitest): rng determinism, field shape per mode (length, range 0..1,
  determinism), ramp LUT (endpoints, monotonic position), randomize determinism +
  lock respect, motion evaluation (endpoints, ping-pong symmetry).
- In-app verification via preview tools: add node, open surface, randomize,
  switch layouts/shapes, generate-as-image wires an Image artifact.

## Non-goals (v1)

- Pixel-exact parity with GRADIENTOOL's look (faithful approximation).
- Per-field lock UI for *every* field (lock the high-value groups first).
- No purple/violet accent colors (project rule) — neutral + emerald.
