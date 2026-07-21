# Compositor Paintbrush — Design

Date: 2026-07-20
Status: Approved (design), pending implementation plan

## Summary

Add a **Brush** tool to the Frame / Compositor that lets the user paint freehand
regions on the artboard. The painted region is treated as a **first-class
freehand alpha shape** — structurally identical to the existing `rect` / `ellipse`
/ `path` shape layers, but with hand-painted geometry instead of a rectangle or a
vector path.

Because it is just another fillable, maskable shape layer, it inherits the app's
entire fill system, silhouette-masking, effects, blend, opacity, cloner and motion
with almost no new rendering code.

The tool has two modes behind one toolbar button:

1. **Paint** — lay down / extend a freehand region on a **paint layer**. The region
   is filled by the layer's `fill` (solid / gradient / ombre / grid / noise /
   checkerboard / stripes / qr / image-through-mask).
2. **Mask** — paint visibility (reveal / erase) directly onto the **currently
   selected** layer of any kind, stored as freehand mask strokes on that layer.

## Goals

- A real paintbrush that draws colored regions on the artboard, editable and crisp
  at any zoom and at full export resolution.
- The painted area supports the same fills already defined elsewhere in the app
  (solid, gradient, ombre, grid, noise, checkerboard, stripes, qr), via the
  existing `FillControl`.
- An existing image can fill the painted area.
- The painted area can be used as a mask for another image.
- A brush with color, size, eraser, opacity/flow, hardness (softness) and smoothing.
- Undo/redo unified with the compositor's normal layer history.

## Non-goals (v1)

- Pressure sensitivity / tablet tilt.
- Custom or textured brush tips.
- Per-stroke blend modes (layer-level blend covers this).
- Multiple distinct flat colors coexisting on **one** paint layer — the fill lives
  at the layer level (like every other shape). Different colors = different paint
  layers, or a gradient/pattern across the region. (Confirmed with user.)
- Wiring the brush into the AI generate-in-region flow.
- Inline (on-canvas Frame node) brush UI — v1 lives in the full-screen
  `CompositorModal`; the inline Frame opens the modal to paint. Inline can follow.

## Existing architecture this builds on

- **Single 2D renderer.** `paintLayerStack()` in `useCompositorLayers.ts` is the one
  Canvas-2D function used by the node preview, the modal, and full-res export — so a
  new layer kind renders pixel-identically everywhere automatically.
- **Universal fill.** `Paint = string | Gradient | Fill`; `resolvePaint(ctx, paint,
  {w,h})` turns any Paint into a canvas fill. Shape layers do
  `ctx.fillStyle = resolvePaint(ctx, layer.fill, {w,h})`. `FillControl.vue` emits a
  `Paint` that "drops straight into resolvePaint without new render code" and already
  covers solid / gradient / ombre / grid / noise / checkerboard / stripes / qr
  (`FILL_TYPES` in `lib/spacetype/fillTile`).
- **Cross-layer silhouette mask.** `LayerCommon.maskedByKey` (a `StackKey`,
  `w:<slot>` | `l:<id>`) clips a layer to *another layer's alpha silhouette*.
  `maskShowSource` optionally still renders the source at its z-position.
  `layerMaskRef()` resolves the ref (with legacy `maskedById` fallback).
- **Inherited layer capabilities.** `LayerCommon` already carries `opacity`,
  `blend`, `effects`, `mask` (rect/ellipse crop), `maskedByKey`, `cloner`,
  `animation` — a `PaintLayer extends LayerCommon` gets all of them free.
- **Mature brush input engine.** `useBrushMask.ts` (normalized-polyline strokes +
  width-fraction radius + erase, `down/move/up`, undo/redo, `stampMask`, `render`
  preview, `bakeMask`) and `brushHistory.ts`. `InpaintModal.vue` is the reference
  brush UX (paint/erase, `[`/`]` size keys, ⌘Z, pointer→normalized coords, cursor
  ring). Today these only produce **masks for the AI**, never colored pixels.

## Data model (`useCompositorLayers.ts`)

Add `'paint'` to `LocalLayerKind` and `PaintLayer` to the `LocalLayer` union.

```ts
export interface PaintStroke {
  points: { x: number; y: number }[] // normalized artboard coords (0..1)
  radius: number                     // brush radius as a fraction of artboard WIDTH (WYSIWYG at any zoom)
  hardness: number                   // 1 = hard edge … 0 = fully soft
  opacity: number                    // 0..1 per-stroke coverage / flow (builds up alpha)
  erase: boolean                     // eraser stroke → destination-out within the layer
}

export interface PaintLayer extends LayerCommon {
  kind: 'paint'
  strokes: PaintStroke[]
  fill: Paint                        // the region fill — full FillControl set + image-via-mask
  stroke?: Paint                     // optional outline of the painted silhouette
  strokeWidth?: number               // normalized to width, matching other shapes
}
```

Freehand **layer mask** (Brush "Mask mode"), stored on the base layer so it works on
any kind. Reuses the same stroke shape minus color:

```ts
// optional additions on LayerCommon
maskStrokes?: MaskStroke[]           // reveal/erase visibility painted on THIS layer
maskBase?: 'visible' | 'hidden'      // default 'visible'; brush hides, eraser un-hides, invert flips

export interface MaskStroke {
  points: { x: number; y: number }[]
  radius: number
  hardness: number
  erase: boolean                     // erase = subtract visibility
}
```

Strokes are stored resolution-independently (normalized polylines), exactly like
`useBrushMask`, so the same paint previews on the editor canvas and bakes crisp into
full export resolution with no drift.

## Rendering

### Paint layer — one new `case 'paint'` in `drawItemContent`

1. **Build the alpha region** on an offscreen canvas at the current render size:
   - Hard brush (`hardness` → 1): round-capped/joined polyline + dot stamps at each
     sample (the `stampMask` technique) with `lineWidth = 2 * rPx`.
   - Soft brush (`hardness` < 1): stamp radial-gradient circles spaced ≤ radius
     apart along the (smoothed) path — solid inner stop at `hardness`, transparent
     at the edge.
   - `erase` strokes use `globalCompositeOperation = 'destination-out'`.
   - Per-stroke `globalAlpha = opacity`.
   - Smoothing: render the path as a Catmull-Rom (or quadratic) curve through the
     stored points, so raw points stay faithful and re-editable.
2. **Fill the region**: `octx.globalCompositeOperation = 'source-in';
   octx.fillStyle = resolvePaint(octx, layer.fill, { w, h }); octx.fillRect(...)`.
   Gradient/pattern geometry lines up with the other shapes (center-translated
   offscreen, mirroring the image-tint path at `useCompositorLayers.ts:596-609`).
3. **Optional outline**: if `layer.stroke` has paint, trace the silhouette edge.
4. Draw the offscreen into `ctx`.

The **outer pipeline** (already wrapping `drawItemContent`) then applies effects /
blend / opacity / `maskedByKey` / rect-ellipse `mask` / cloner / motion — no extra
work per capability.

### Painted area ↔ image (both user asks, one mechanism: `maskedByKey`)

Because `maskedByKey` renders any item's alpha silhouette as the clip, a paint layer
is automatically valid on **both** sides:

- **Painted area as a mask for another image**: set the image layer's `maskedByKey`
  to the paint layer's `StackKey`. Surfaced as "Mask with…" on the image layer.
- **Image as a fill of the painted area**: the *same* link, surfaced on the paint
  layer's fill picker as an "Image…" option that shows a chosen image through the
  painted shape. (Under the hood: an image layer masked by this paint layer, with
  `maskShowSource = false`.)

No new masking engine — this is the existing silhouette-mask, surfaced from two
entry points.

### Freehand layer mask (Brush "Mask mode")

Build a mask canvas from `maskStrokes` (white where `maskBase === 'visible'` or
transparent if `'hidden'`; paint strokes add visibility via `source-over`, erase
subtract via `destination-out`), then apply to the target layer's offscreen with
`destination-in`. This reuses the offscreen-mask compositing path already used for
clip/silhouette masks.

## Input engine — `useBrushPaint.ts`

New composable modeled on `useBrushMask.ts`, same tool-mode contract
(`setActive` / `down` / `move` / `up` / `radiusNorm` / `cursor`).

State:
- `mode: 'paint' | 'mask'`
- `sizePx` (display-px diameter), `color`, `opacity`, `hardness`, `smoothing`, `eraser`
- `cursor` (normalized, for the brush-size ring)

Behavior:
- On `down`, start a live in-progress stroke; render it as an immediate overlay for
  feedback.
- On `up`, **commit** the stroke into the target layer through the existing
  local-layer mutation path (`useLocalLayerEditor`), so it enters the compositor's
  **normal undo stack** — ⌘Z removes the last stroke. No separate `brushHistory`
  instance for committed strokes.
- **Paint target**: the selected paint layer; if none is selected/active, the first
  stroke creates a new paint layer (seeded with the brush color as a solid fill).
- **Mask target**: the currently selected layer's `maskStrokes`.

The brush `color` sets the paint layer's **solid** fill; switching to
gradient/pattern/image is done via the layer's `FillControl` panel and spans the
whole region.

## UI (`CompositorModal.vue` + `CompositorInlineToolbar.vue`)

- **Brush tool button** in the tool row, next to Select / Pen. Activating sets a
  `brushActive` tool mode that gates the canvas pointer, following the existing
  tool-mode pattern (`isSelectTool`, the gen-tool gating at
  `CompositorModal.vue:1086-1157`).
- **Brush options bar** while active: Paint/Mask segmented toggle · color swatch
  (paint mode) · size slider + `[` / `]` keys · opacity slider · hardness slider ·
  smoothing toggle · eraser toggle · undo/redo.
- **Fill** for the paint layer is edited through the existing `FillControl` in the
  layer's properties panel (including the new "Image…" option).
- **Brush-size cursor ring** drawn on the overlay (reuse the `cursor` pattern from
  `useBrushMask` / `InpaintModal`).
- v1 is modal-only; the inline Frame node opens the modal to paint.

## Data flow (controls → pixels)

1. `useBrushPaint` captures pointer → normalized stroke; live overlay shows it.
2. On commit, the stroke is appended to the target `PaintLayer.strokes` (or the
   selected layer's `maskStrokes`) via `useLocalLayerEditor` → enters undo history.
3. `renderStack()` → `paintLayerStack()` → new `case 'paint'` rasterizes strokes and
   fills via `resolvePaint`; the outer pipeline applies effects/mask/blend/etc.
4. Node preview, modal, and `exportCompositeCanvas()` all call the same function, so
   preview == export.

## Testing

- **Unit (no WebGL/DOM canvas):** stroke geometry helpers — `radiusNorm`, smoothing
  resampling, hard/soft stamp radius math, `maskBase`/erase alpha logic — pure
  functions unit-tested like `bakeRadius` in `useBrushMask`.
- **Render:** a `case 'paint'` render test that stamps a known stroke into an
  offscreen and asserts alpha coverage + fill color at sampled pixels; a
  `maskedByKey` round-trip asserting an image is clipped to a painted silhouette.
- **Manual / paid-render checklist (runtime):**
  - Paint a region; confirm solid, gradient, ombre, and a pattern fill each render
    in modal, node preview, and exported PNG identically.
  - Eraser carves within the layer only; opacity builds up; soft edge feathers.
  - Set an image to fill the painted region (image-via-mask); set a painted layer as
    the mask for a separate image — both directions.
  - Mask mode reveal/erase on a non-paint layer; invert.
  - ⌘Z removes the last stroke; redo restores; brush size `[` / `]`.
  - Move/scale/rotate/opacity/blend/effects/motion on a paint layer behave like other
    shapes.

## Open items / risks

- **Fill geometry alignment** for gradients/patterns inside the freehand offscreen
  must match the center-translated convention used elsewhere (image tint at
  `useCompositorLayers.ts:596-609`); verify no offset drift vs rect/ellipse fills.
- **Soft-brush performance**: many radial-gradient stamps on long strokes — spacing
  and offscreen reuse must stay within the rAF budget of the animation loop.
- **Undo granularity**: commit one history entry per stroke, not per pointer move.
- **Parallel-session hygiene**: `useCompositorLayers.ts` and `CompositorModal.vue`
  are large and edited by other work; stage only this feature's hunks when committing.
