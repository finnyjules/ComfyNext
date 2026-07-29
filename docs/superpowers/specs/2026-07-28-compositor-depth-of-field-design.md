# Compositor Depth of Field — design

**Date:** 2026-07-28
**Status:** approved, ready to plan

## Summary

Add a depth-of-field effect to Compositor image layers, driven by an AI-estimated
depth map. This is the first slice of a larger "local inference" direction: it
introduces the transformers.js runtime, the depth capability, and a GPU post stage
in the Compositor, then uses all three to ship one visible feature.

The point is not cost saving. It is that analysis becomes ambient — depth exists
for an image, so distance-aware effects become live controls rather than requests.

## Scope

**In:** a `dof` post effect on `kind: 'image'` layers, with a photographic control
set; a Nitro depth endpoint backed by transformers.js; a WebGL2 post stage in the
Compositor; bake/export parity.

**Out (each its own later cycle):** tilt-shift, bokeh swirl, cat's-eye clipping,
anamorphic squeeze; doc-level DOF across composited layers; eager depth on image
arrival; browser-side inference; SAM, matting and embeddings.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Surface | Compositor image layers | Flat photos have no depth, so this genuinely needs the model. Scene3D already has true depth and belongs in the existing post-pass plan. |
| Control set | Photographic | Focus, range, aperture, blades, highlight bloom. Minimal (focus + amount) would read as a gradient blur and fail the brief. |
| Where inference runs | Nitro server (Node) | Depth is computed once per image, not per frame. The live part is the shader, so server-side loses nothing and avoids a client weight download. |
| Depth timing | Lazy, cached by content hash | No surprise load on large compositions. Eager can be layered on later without changing the data model. |
| Pixels | New WebGL2 post stage | A variable-radius shaped-aperture blur is ~700 samples/px. Canvas 2D cannot do this at interactive rates. |

### Explicitly rejected

- **Canvas 2D approximation** (blend between pre-blurred copies). Ships faster but
  produces gaussian mush with no aperture shape or bokeh discs — cannot deliver the
  chosen control set.
- **Server-side DOF render.** Best quality, but turns the focus slider back into a
  request, defeating the premise.
- **Reinstating depth for Scene3D surface relief.** `server/api/scene3d/gen-map.post.ts`
  documents why this was removed: depth reports scene distance, which is near-flat on a
  material sample shot straight-on. Relief stays brightness→height.

## Architecture

### 1. `POST /api/depth` (new)

- Body `{ filename }` — an image in ComfyUI's input dir (`ImageLayer.filename`).
- Reads the file from disk; no data-URL round trip.
- Runs Depth Anything V2 via transformers.js in Node. Model loads once into a
  module-level singleton and stays warm.
- Writes a greyscale PNG to a cache dir, keyed by **content hash**.
- Returns `{ depthFilename }`. Idempotent — a cache hit never touches the model.
- **`/api/depth` must be added to `NITRO_API_PREFIXES` in
  `server/middleware/comfyui-proxy.ts`**, or the proxy swallows the route.

### 2. `lib/compositor/gpuPost.ts` (new)

Minimal WebGL2 pass runner modelled on `lib/shaderfx/renderer.ts`. Warm offscreen
canvas, one program, two input textures (colour + depth). Output is read back into
the 2D chain via `drawImage`, with an explicit finish before readback — reading a
studio WebGL canvas without one returns stale pixels, which has bitten this codebase
before.

### 3. `lib/compositor/dofPass.ts` + fragment shader (new)

Per pixel:

```
coc = clamp(abs(depth − focus) − range/2, 0, 1) × aperture
```

Then 32 taps on a golden-angle spiral scaled by `coc`, clipped to a polygon of
`bladeCount` sides. That polygon **is** the aperture: 6 blades → hexagonal bokeh;
`bladeCount < 3` → circle.

Accumulation happens in **linear light**, with samples above `bloomThreshold`
boosted by `bloomStrength` before accumulating. This is what turns bright
out-of-focus points into glowing discs rather than grey mush, and is the single
difference between "depth of field" and "blurry photo".

Taps are weighted by whether the sample's own CoC reaches the centre pixel, which
reduces the dark halo on foreground edges.

**Accepted limitation:** occlusion bleed is mitigated, not solved. Correct handling
needs layer separation and is a separate project.

### 4. `lib/compositor/postEffects.ts` (changed)

Gains `DofEffect`, its defaults and its clamps. It does **not** join `CHAIN_TYPES`;
a parallel `GPU_TYPES` set routes it, leaving `applyEffectChain` and the whole 2D
path untouched.

### Chain position

```
dof → adjust → duotone → bloom → vignette → grain
```

DOF is first because defocus happens at the lens. Grain is on the negative, vignette
is the barrel, grading is post-capture — all should apply to the already-defocused
image. Placing DOF last would blur the grain, which is both wrong and visible.

## Parameters

| Param | Range | Notes |
|---|---|---|
| `focus` | 0..1 | Normalised depth of the focal plane |
| `range` | 0..1 | Depth band that stays sharp |
| `aperture` | 0..1 | Max blur radius, **normalised to canvas width** |
| `bladeCount` | 0..12 | `< 3` renders a circular iris |
| `bladeRotation` | 0..360 | Degrees |
| `bloomThreshold` | 0..1 | Linear-light luminance cutoff |
| `bloomStrength` | 0..4 | Highlight boost before accumulation |

`aperture` must be normalised to canvas width, exactly as `bloom.radius` already is.
CoC is measured in pixels, so an un-normalised value renders half the blur on a 2×
bake — correct in preview, wrong on export.

## Data flow

1. User adds DOF to an image layer.
2. Panel shows a computing state; `POST /api/depth` fires.
3. `depthFilename` is held in a module-level `Map` keyed by `filename`.
4. GL pass renders; the result composites into the 2D chain.

**Render stays synchronous.** `paintLayer` is synchronous and must remain so. Depth
readiness is state, not a render-time fetch: when depth is absent the pass renders
through unchanged, and a re-render is triggered on arrival. No model call ever sits
inside a paint.

**Persistence:** the layer stores only the DOF params. `depthFilename` is derived and
never saved — on document load it is re-fetched, which is a cache hit and therefore
instant. Documents stay small, and the same photo in another document costs nothing.

DOF is offered only on `kind: 'image'` layers; the panel hides it for everything else.

## Error handling

No silent fallbacks. In every failure mode the layer still renders, DOF visibly does
not apply, and the panel states why.

- **No WebGL2** — DOF disabled with an explicit message. It must *not* degrade to a
  2D blur; a plausible-looking fallback would hide a broken integration.
- **Depth request fails or times out** — pass-through, with a retry affordance.
- **Model fails to load** — same, surfaced once rather than per layer.

The pass sets an assertion marker when it actually runs, so tests can distinguish
"DOF applied" from "DOF silently skipped".

## Bake and export parity

DOF lives inside `paintLayer`, and `useCompositorLayers.ts:1318` confirms the Frame
node, the Compositor modal and the bake all reach it through `paintLayerStack`. One
implementation therefore serves all three. `gpuPost.ts` is the only place the GL work
exists; there is no second copy for export.

## Testing

- **Unit** — CoC math; aperture polygon generation; param clamps; a guard that
  `DofEffect` is absent from `CHAIN_TYPES` (the routing bug that would silently
  2D-render it).
- **Integration** — depth endpoint: cache miss writes, cache hit does not re-run the
  model, the same file twice returns the same key.
- **Visual** — render one layer at `aperture: 0` and at maximum and assert the pixels
  differ beyond a threshold. Then deliberately break the depth binding and assert the
  test *fails*. A visual test that passes while the feature is disconnected proves
  nothing.

## Risks

| Risk | Mitigation |
|---|---|
| Stale pixels reading back from the GL canvas | Explicit finish before `drawImage`; assertion marker verified in tests |
| Bake/preview blur mismatch | `aperture` normalised to canvas width, asserted in a test at two scales |
| Depth quality on hair and fine detail | Accepted; soft depth edges are where DOF artefacts appear, and no v1 mitigation is proposed |
| Occlusion bleed on foreground edges | Tap weighting reduces it; full fix deferred to a layer-separation project |
| First-run model download latency | Warm singleton; computing state in the panel; never blocks paint |
