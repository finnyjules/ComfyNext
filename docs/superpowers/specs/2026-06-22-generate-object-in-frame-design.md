# Generate Object — drag-to-generate in the frame modal

**Date:** 2026-06-22
**Status:** Approved (design)
**Scope:** `CompositorModal.vue` only (the "frame modal")

## Summary

Add a tool to the frame modal that lets the user **drag a rectangle on the
canvas, describe what they want, and generate a brand-new transparent object**
into that box as its own layer. It is additive — unlike inpaint, it never
replaces or modifies existing layers; it produces a new image layer placed in
the marquee region.

Two generation modes, chosen by a toggle in the floating panel:

- **Style** — generate from the user's text prompt, optionally driven by one of
  their **trained LoRAs/styles**. The object is generated in isolation.
- **Scene** — generate something that **fits the existing frame** (lighting,
  perspective, palette) by inpainting the marquee region of the current
  composite with the surrounding pixels as context.

In **both** modes the generated image is run through background removal so the
result is a **transparent cutout** placed and scaled to the drawn box.

## Why

The frame modal already supports text/shape/image layers and precise editing,
but every visual element has to be drawn, imported, or wired in from a node.
There is no way to summon a new object directly into the composition. This adds
fast, prompt-driven object creation that lands as a normal, movable,
transparent image layer — no graph re-wiring, no separate generator surface.

## Existing infrastructure this builds on

All confirmed present in the repo:

- **Generation routes** (`frontend/server/api/inpaint/`): `text2img`
  (flux-schnell), `flux-fill` (mask inpaint), `remove-bg` (transparent cutout
  via `851-labs/background-remover`).
- **Replicate helpers** (`frontend/server/utils/replicate.ts`): `runReplicate`,
  `fetchAsDataUrl`, `firstOutputUrl`, `requireReplicateToken`.
- **Client composable** (`frontend/app/composables/useInpaint.ts`): `text2img`,
  `fluxFill`, `removeBackground`, `uploadDataUrl`, plus image helpers
  (`loadImage`, `capDims`, `imageToDataUrl`, `dataUrlToFile`).
- **LoRA/style catalog** (`frontend/server/api/loras-local.get.ts`): lists each
  style with `replicate_model`, `trigger`, `aesthetic`, `kind`, `coverUrl`,
  `canGenerateCover`. Trained LoRAs run **directly** as their own private
  Replicate model (`POST /v1/models/{owner}/{model}/predictions`), not via
  `flux-dev-lora` lora_weights. Prompt is composed as
  `trigger + aesthetic-keywords + caption` (see
  `replicate_refs.build_flux_style_prompt`).
- **Style picker UI** (`LoraGalleryModal.vue` / `WidgetLoraPicker.vue`): an
  existing searchable gallery over `/api/loras-local` we reuse for selection.
- **Layer model** (`frontend/app/composables/useCompositorLayers.ts`):
  `createImageLayer(filename, aspect, partial?)`, `imageLayerUrl(filename)`,
  `ensureLayerImages`. Local layers persist on
  `node.data.properties.comfynext_localLayers` and the unified z-order at
  `comfynext_stackOrder`.
- **Asset recording** (`frontend/app/composables/useProjectGenerations.ts`):
  `recordAsset(projectUuid, 'image', filename)`.
- **Composite rasterization**: the modal already renders/bakes the composite for
  preview/export — reused to produce the Scene-mode context image.

The only missing backend piece is a route for **trained-LoRA inference from the
frontend** (Style mode with a style selected). Everything else is wired.

## Architecture

### Components / units

1. **Marquee + floating panel UI** (in `CompositorModal.vue`, extracted into a
   child component `GenerateObjectPanel.vue` to keep the modal file focused).
   - New "Generate" tool button in the modal toolbar. Activating it enters
     marquee mode (canvas cursor = crosshair; existing selection/editing
     interactions suspended while active).
   - Drag draws a rectangle in canvas coordinates. On release, a small floating
     panel anchors to the box: prompt textarea, **Style ↔ Scene** segmented
     toggle, style picker button (visible only in Style mode; opens the existing
     LoRA gallery, shows selected style's cover + name, clearable), Generate
     button.
   - During generation: spinner overlay inside the box. On success: the new
     layer is created, selected, and a **Regenerate** / **Discard** control set
     stays anchored until the user clicks away or commits.
   - Esc / click-outside-while-empty cancels marquee mode.

2. **`useGenerateObject.ts`** (new composable) — orchestrates the pipeline.
   Inputs: `{ mode, prompt, style?, box, compositeRasterizer }`. Returns the
   uploaded filename + intrinsic aspect for layer creation. Internally calls
   `useInpaint` methods and the new LoRA route. Single source of the
   two-mode logic so the panel stays presentational.

3. **`POST /api/inpaint/lora-gen`** (new Nitro route) — trained-LoRA inference.
   - Request: `{ replicateModel, prompt, trigger?, aesthetic?, aspectRatio,
     loraScale?, guidanceScale? }`.
   - Builds the final prompt (`trigger + aesthetic-keywords + prompt`, mirroring
     `build_flux_style_prompt`), calls `runReplicate` against the trained model,
     returns a base64 data URL (CORS-safe, matching sibling routes).

### Data flow

```
drag box (canvas coords)
   │
   ├─ Style mode ─┬─ style picked → POST /api/inpaint/lora-gen (trained model)
   │              └─ no style      → useInpaint.text2img (flux-schnell)
   │                                   aspect = nearest supported to box
   │
   └─ Scene mode ── rasterize composite → build box mask
                     → useInpaint.fluxFill(composite, mask, prompt)
                     → crop the box region
   │
   ▼
useInpaint.removeBackground(image)        // transparent cutout, both modes
   ▼
useInpaint.uploadDataUrl(dataUrl)         // → ComfyUI input dir, returns filename
   ▼
createImageLayer(filename, aspect, { x, y, w, h from box })   // placed + scaled
   ▼
push to comfynext_localLayers + comfynext_stackOrder (top), select it
   ▼
recordAsset(projectUuid, 'image', filename)
```

### Aspect handling

The marquee box can be any aspect. Generation models accept a limited set of
aspect ratios, so:
- Generate at the **nearest supported aspect ratio** to the box (Style) or at
  the composite's native dimensions then crop the box (Scene).
- Because the output is a transparent cutout, the object has its own silhouette;
  the layer is **scaled to fit within the box** preserving the cutout's aspect.
  The box defines placement/size, not a hard frame.

## Cost control

The user weighs per-generation credit cost. Therefore:
- **One image per Generate.** No auto-batching. Variations only via explicit
  **Regenerate**.
- Cheap paths (flux-schnell, remove-bg) are default; the pricier paths
  (trained-LoRA model, flux-fill) run only when the user picks a style or Scene
  mode.
- Cap context-image dimensions with the existing `capDims` helper before sending
  to flux-fill.

## Error handling

- Missing Replicate token → surface the existing route's 500 message inline in
  the panel ("Add a Replicate token in Settings → AI"), do not crash the modal.
- Replicate failure/timeout → inline error in the panel with Retry; the marquee
  box stays so the user can adjust the prompt and retry without re-dragging.
- remove-bg failure → fall back to placing the rectangular (non-cutout) image so
  the user still gets a result, with a non-blocking note.
- Zero-size / tiny marquee → ignore (require a minimum drag size).

## Testing

- **Unit (composable):** `useGenerateObject` mode routing — Style+style →
  lora-gen, Style+no-style → text2img, Scene → fluxFill; both paths terminate in
  removeBackground + uploadDataUrl + createImageLayer with correct box geometry.
  Mock `useInpaint` and fetch.
- **Unit (route):** `lora-gen` prompt composition (trigger + aesthetic + prompt)
  and Replicate input mapping (`guidance_scale`/`lora_scale` for trained models).
- **Visual sign-off (required for UI/WebGL-adjacent work):** run the modal,
  drag a box, generate in each mode, confirm a transparent layer lands in the
  box and is movable/scalable; screenshot before/after. Per project convention,
  visual features are not signed off on unit tests alone.

## Out of scope

- The on-canvas Frame artifact (`ArtifactFrameNode.vue`) — modal only.
- Backend graph/node changes — this is fully client + Nitro.
- Multi-result grids, prompt history, regenerate-with-variation seeds.
- Scene-mode `kontext` (mask-free) path — flux-fill with the drawn box is the
  chosen scene approach.

## Open questions

None blocking. Toggle labels ("Style" / "Scene"), exact `loraScale`/guidance
defaults, and minimum marquee size to be finalized during implementation.
