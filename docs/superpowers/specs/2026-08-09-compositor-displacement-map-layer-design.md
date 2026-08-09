# Compositor Displacement Map Layer — Design

**Date:** 2026-08-09
**Status:** Design approved, ready for implementation plan
**Surface:** Compositor (Frame node + Compositor modal + export bake)

## Plain-language summary

Today, an image you paste into the Compositor is drawn as a picture. This feature adds a
toggle on an image layer's properties — **Displacement map** — that turns that layer into a
*lens* instead: its pixels stop being drawn and instead bend (distort) everything stacked
below it. Bright parts of the map push the underlying pixels one way, dark parts another, so
the layers below appear warped as if seen through rippled glass. Move, scale, or rotate the
map layer to aim the warp; toggle it off and it goes back to being an ordinary image.

The mental model is the **adjustment layer** from Photoshop / After Effects: a thing in the
stack that modifies what's beneath it rather than adding color of its own.

## Why this shape (history)

The idea evolved through three framings before landing:

1. **A blend mode** (like Multiply/Screen). Rejected as the *mechanism*: blend modes are
   per-pixel functions of two co-located pixels (`result(x,y) = f(top(x,y), bottom(x,y))`),
   which is exactly what Canvas `globalCompositeOperation` expresses. Displacement is a
   *gather/resample* — `result(x,y) = backdrop(x + offset)` — reading the backdrop somewhere
   *else*. It cannot ride `globalCompositeOperation`, and it needs controls (amount, channel
   mapping) that a blend mode has no place for. Good instinct (it correctly spotted that
   displacement is *relational*), wrong slot.
2. **Its own inspector section** with a separate map-image input. Workable, but it adds an
   input to wire and doesn't reuse the fact that the map is already a layer in the stack.
3. **A toggle on an image layer that repurposes it as a map** (chosen). Rides the
   adjustment-layer metaphor, needs no separate input (the map *is* the layer), and stacking
   order becomes the wiring.

## Decisions locked

- **Scope:** an active map layer displaces **everything below it** (the flattened backdrop),
  adjustment-layer semantics. Not "only the layer directly below," not "each lower layer
  individually."
- **Map reading (default):** **brightness / height (refract)** — read the map as grayscale
  brightness and push along the gradient of that height field, so bright areas act like
  lenses/bumps. Predictable for any pasted image, colour or B&W, and it reuses the existing
  `toHeightPixels` height model. A selector also offers **colour channels (R→x, G→y)**, the
  literal Photoshop "Displace" behaviour, for glitch/chromatic looks.
- **Activation:** **manual only.** Pasting yields a normal image layer; the toggle is off by
  default. Non-destructive and reversible — the toggle only adds/removes a field; original
  pixels are untouched. No auto-conversion, no context-menu shortcut in v1.
- **Layer kinds:** **image layers only** in v1 (matches "paste an image → toggle").
  Extensible later to any raster layer, since layers already render to offscreens.
- **Implementation approach:** **CPU resample inside `paintLayerStack`** (Approach 1 below).

## Architecture context (as-is)

Two files carry the layer system:
- `frontend/app/composables/useCompositorLayers.ts` — the render engine. `paintLayerStack`
  (`:1531`) is the single source of truth, used by the Frame node card, the Compositor modal,
  and the export bake. It iterates `items` **bottom-to-top** (background first, then each
  layer). Blend modes apply via `localBlendOp` → `WIRED_BLEND_OP` → `globalCompositeOperation`.
- `frontend/app/components/vue-canvas/CompositorModal.vue` — the inspector UI. The local-layer
  inspector branch is at `:4515`; the post-effects block mounts `PostEffectsControls` at
  `:5061`.

Reusable precedents:
- **Backdrop-reprocessing pattern:** `applyBackdropBlur` (`useCompositorLayers.ts:1442`)
  already snapshots the backdrop below a layer, processes it, and stamps it back. The
  doc-level `applyStackPost` (`postEffects.ts:330`) snapshots the whole canvas. Displacement
  "everything below" is the same shape.
- **Device-sized offscreen recipe:** `paintLayer` effected path (`:1116`),
  `drawLocalLayerSelf` (`:936`), `drawLayerSilhouette` (`:852`) — render a layer to a
  device-pixel offscreen, composite in identity space, stamp back.
- **Luminance→height:** `toHeightPixels(rgba, invert, contrast)` (`scene3d/relief.ts:21`) —
  pure, unit-tested, Rec.709 luma. The single definition of "height" to reuse.
- **Procedural warp precedent (GPU, not reused directly):** `shapefx/post.ts:33` — value-noise
  `uDistort` fragment shader with a `distortion/100 * 45px` pixel budget and `clamp(uv,0,1)`
  edge guard. Informs the amount/edge conventions.
- **CPU projective warp precedent:** `compositor/warp.ts` `drawQuadWarp` (`:95`) — the closest
  existing CPU resample in the compositor.

## Data model

Add an optional field to `ImageLayer` (sibling of `tint?`, `useCompositorLayers.ts:280`).
Absent = ordinary image layer.

```ts
export interface DisplaceMapSpec {
  read: 'height' | 'channels'   // default 'height'
  amount: number                // max push in SCREEN px (dpr-invariant); range 0–200, default 40
  invert?: boolean              // height mode: flip high/low; default false
  softness?: number             // blur the field before warping (smooths jaggies); px, default 2
}

// on ImageLayer:
displaceMap?: DisplaceMapSpec
```

- **Presence = active.** When `displaceMap` exists, the layer becomes a driver: it stops
  drawing its own pixels and warps everything below.
- **Footprint gating:** the map layer's own alpha (and transform) decide *where* it warps.
  Outside the map's coverage the offset is zero, so a small pasted PNG only distorts the
  backdrop under its box.
- While active, this layer's `blend` and `opacity` are meaningless (it isn't composited as
  colour) and are **hidden** in the inspector; `amount` is the strength control instead.

## Mechanism (render loop hook)

The feature lives at one branch in `paintLayerStack`'s loop (`useCompositorLayers.ts:1636`).
When the current item is an image layer with `displaceMap` set, branch **instead of**
`drawLocalLayer`:

```
1. Snapshot backdrop   srcData = ctx.getImageData(0, 0, devW, devH)
                       At this loop point ctx is at identity and holds everything below —
                       the same guarantee applyBackdropBlur relies on. devW/devH are the
                       canvas device pixels (dpr / export scale already baked in).

2. Render the map      mapData = <map layer rendered to a device-sized offscreen>
                       via the existing drawLocalLayerSelf/silhouette recipe, so the map's
                       transform, scale, rotation, and alpha are baked into mapData.

3. Build offset field  field = buildDisplacementField(mapData, { read, invert, softness })
   (PURE FN)             • 'height'   → toHeightPixels → per-pixel gradient (dx, dy)
                         • 'channels' → (R-0.5, G-0.5) per pixel → ×2 so each axis spans [-1, 1]
                         • map alpha multiplies the offset (footprint gating)
                       Returns a Float32Array of (dx, dy) per pixel in normalized [-1, 1] units;
                       the resample multiplies by `amount` to get the device-px push. (Height
                       mode normalizes the gradient the same way so `amount` means px in both.)

4. Resample            outData = resampleBilinear(srcData, field, amount, devW, devH)
   (PURE FN)             outUV = xy + field * amount, bilinear sample of srcData,
                         clamped to edges (never reads out of bounds).

5. Write back          ctx.putImageData(outData, 0, 0)
```

The map layer's own pixels are **not** drawn. Layers *above* the map draw normally afterward,
on top of the warped result — the adjustment-layer behaviour.

Two new **pure functions** carry all the logic and touch no DOM:
- `buildDisplacementField(mapRGBA: ImageData, opts) => Float32Array`
- `resampleBilinear(srcRGBA: ImageData, field: Float32Array, amount: number, w, h) => ImageData`

Everything else is snapshot/offscreen plumbing that already exists.

**Consequence:** step 1 reads the *live* backdrop, so an animated or edited lower layer
re-warps every frame. That is correct behaviour and is where the CPU cost lands (see Risks).

## Inspector UI

A new group in the image-layer inspector (`CompositorModal.vue:4515`), above the post-effects
block, following the `localShadow`/`setLocalShadow` getter/setter pattern (`:2075`):

```
▸ Displacement map          [ toggle ]
    Read      ( Height ▾ | Channels )
    Amount    ●———————  40 px
    Softness  ●—          2 px
    Invert    [ ]                       ← height mode only
```

- Toggling on writes `displaceMap` with defaults; toggling off deletes it.
- While on, the layer's **Blend** and **Opacity** rows are hidden.

### Driver-layer state ("consumed as driver")

Because an active map layer's pixels aren't drawn, it would otherwise appear to vanish. Handle
it explicitly:

- **On canvas:** render the map layer as a faint ghost (low-alpha preview) with its selection
  box and transform handles fully interactive, so it can be moved/scaled/rotated to aim the
  warp. A small "⤳ Map" badge is pinned to its box.
- **In the layer list:** a distinct row treatment (badge + dimmed thumbnail) so it reads as a
  lens, not a picture.
- The ghost and badge are **editor-only affordances** — they never appear in the export bake,
  which just applies the warp.

## Testing

**Unit (the pure functions carry the logic, so they carry the tests):**
- `buildDisplacementField` — a half-bright/half-dark map produces offsets **only at the
  brightness edge** and ~zero in the flat regions (input-correlation check; a flat field that
  "runs clean" is the failure mode to catch — see memory `parity-tests-agree-on-wrong-answer`).
- `resampleBilinear` — a checkerboard backdrop + a known field shifts pixels by the expected
  amount; `amount: 0` returns the source **byte-identical** (no-op-must-be-a-copy trap — see
  `universal-post-stack-landed`); edge clamp never reads out of bounds.
- `channels` vs `height` produce visibly different fields on the same colour input (the
  selector isn't secretly a no-op).

**Live hand-check (required — green units are not proof):** paste a real image over a photo in
the actual Compositor modal, toggle map mode, drag Amount, and confirm the backdrop distorts
under the map's footprint and nowhere else. Then revert `buildDisplacementField` to a
deliberately broken version and confirm the check *fails* — proving the assertion is real (see
memories `synthetic-pointer-events-prove-nothing`, `graceful-fallback-hides-integration-failure`).

## Risks & mitigations

**Per-frame CPU cost.** Step 1 reads the live backdrop, so an animating stack re-warps every
frame at device resolution (a full `getImageData` + per-pixel bilinear pass). At ~1–2 MP that
is a few ms in JS; on a large 2×-dpr animated canvas it could get tight. Mitigations, cheapest
first:
1. **Recompute only when inputs change** — cache the output; skip the pass entirely when
   backdrop, map pixels, transform, and params are all unchanged (a static composite pays the
   cost once).
2. **Build the field at the map layer's resolution**, not the full canvas — it is
   low-frequency, like the relief 2048 cap (`RELIEF_SOURCE_MAX`).
3. If still insufficient, downscale the resample, or fall back to a WebGL pass (Approach 2 —
   out of scope for v1, noted as the escape hatch).

## Approaches considered

1. **CPU resample in `paintLayerStack` (chosen).** Reuses `toHeightPixels` and the
   device-sized-offscreen pattern; pure-function warp math (testable); works in card, modal,
   and export for free because all three go through `paintLayerStack`. Cost: per-frame CPU.
2. **WebGL pass (like `shapefx/post.ts`).** Fast, but injects a GL context into a
   canvas-based pipeline that also runs headless/export — context-loss handling, a foreign
   pattern, higher risk for v1. Reserved as the performance escape hatch.
3. **Model as a post-effect in the existing chain.** Rejected — post-effects run on a single
   layer's *own* offscreen via `applyEffectChain` and have no access to the backdrop below,
   which is the whole point.

## Out of scope (v1)

- Non-image layer kinds as maps.
- A separate/wired map-image input (the map is the layer itself).
- Auto-conversion on paste; right-click "Use as displacement map" shortcut.
- Edge modes other than clamp (wrap / transparent).
- WebGL implementation.
- Procedural (noise/gradient) displacement sources.
