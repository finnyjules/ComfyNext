# Shape image fill — pour a canvas image into a Frame shape

**Date:** 2026-08-08
**Status:** Design approved, pending spec review

## Plain summary

In a Frame (the Compositor artboard / `ArtifactFrameNode`), when you select a
shape, you can set an image that's on the Vue node canvas as that shape's fill,
with the usual fit options — Cover, Contain, Tile, Stretch — plus scale and X/Y
offset. The image is picked from any image-bearing node on the canvas, and its
URL is **snapshotted** at pick time (a stable copy, not a live link).

## Product decisions (from brainstorming)

- **Fill source:** any image node on the canvas (not just wired inputs), chosen
  via a picker.
- **Fit modes:** Cover / Contain / Tile / Stretch, plus a **scale** slider and
  **X/Y offset** controls.
- **Reference model:** **snapshot** — store the picked node's current image URL.
  Survives deleting the source node; does not auto-update if the source
  re-generates (re-pick to update).

## 1. Data model — a new `ImageFill` Paint variant

A shape's `fill` is a `Paint = string | Gradient | Fill`
(`frontend/app/lib/compositor/paint.ts`). Add a fourth arm:

```ts
export interface ImageFill {
  type: 'image'
  src: string                            // snapshot URL: the picked node's images[0]
                                         // (e.g. /view?filename=…&type=input) or a data URL
  fit: 'cover' | 'contain' | 'tile' | 'stretch'
  scale?: number                         // default 1
  offset?: { x: number; y: number }      // fraction of the box, 0-centered; default {0,0}
}
export type Paint = string | Gradient | Fill | ImageFill
```

- `isImageFill(p): p is ImageFill` — guard on `typeof p === 'object' && p.type === 'image' && 'src' in p`.
  Unambiguous vs. `Gradient` (`type` is `linear`/`radial`) and `Fill` (has `a`
  and `density`). Add it next to `isGradient`/`isFill`.
- Plain JSON → serializes and round-trips with the layer with no extra work.
- Every shape kind (rect, ellipse, line, path, polygon, star, brush) already
  carries `fill: Paint`, so this single addition makes them all image-fillable.
- `hasPaint` must treat an `ImageFill` with a non-empty `src` as paint, and an
  empty/absent `src` as no-paint (draws unfilled, like `'none'`).

## 2. Rendering

`resolvePaint` (`frontend/app/lib/paint/resolve.ts`) is synchronous and returns
`string | CanvasGradient | CanvasPattern`. Add an `ImageFill` arm that returns a
`CanvasPattern`, reading decoded bitmaps from a shared cache that hosts preload —
the same shape the image-**layer** path already uses (`ImageLayer` +
`ensureLayerImages` + `wiredImages`).

### Shared image cache

New module `frontend/app/lib/paint/imageFillCache.ts`:

- `getFillBitmap(src): HTMLImageElement | null` — synchronous cache read.
- `ensureFillBitmap(src, onReady): void` — on a miss, start an `Image()` load and
  call `onReady` when it lands (host re-renders). Mirrors `wiredImages` behavior.

The cache is keyed by `src`. Because `src` is a snapshot URL, two shapes filled
with the same image share one decode.

### Host preload

Extend `ensureLayerImages` (or add a sibling `ensureFillImages`) to also collect
`ImageFill` `src`s from every layer's `fill` (and `stroke`, harmlessly) and
preload them before the paint pass. Call sites:

- `ArtifactFrameNode.vue` — inline canvas render.
- `CompositorModal.vue` — modal render.
- The headless export bake (whatever path bakes the Frame's IMAGE output) — must
  run the same preload before `paintLayerStack`.

All three go through the shared stack, so they stay pixel-identical (render
parity is a known hazard here — route through the shared module, never a
per-surface copy).

### Pattern construction

`resolvePaint` has the box `{ w, h }`. Given a loaded bitmap:

- **cover / contain / stretch** → allocate a `w×h` canvas, draw the image with
  object-fit dest-rect math, apply `scale` and `offset` (offset in box
  fractions), then `ctx.createPattern(cv, 'no-repeat')`.
  - cover: scale to fill, center-crop; contain: scale to fit, letterbox
    (transparent); stretch: draw to full `w×h` ignoring aspect.
- **tile** → allocate a canvas at `natural × scale`, `createPattern(cv, 'repeat')`,
  apply `offset` via `pattern.setTransform` / a `DOMMatrix`.
- **bitmap not loaded** → return `'transparent'` for that frame; the `onReady`
  callback fires a re-render.

Respect the resolver's centered-origin convention (box maps to
`[-w/2..w/2] × [-h/2..h/2]`) — the pattern transform must line up with how the
Compositor draws primitives centered at their origin, exactly as the existing
`Fill` arm does.

## 3. UI — `FillControl.vue`

`FillControl.vue` is the fill editor used by every `<FillControl>` site in
`CompositorModal.vue` (shape fill and stroke). Changes:

- Add `'image'` to the type dropdown.
- Selecting `image` with an empty `src` opens a **canvas image picker**:
  - Inject `vueFlowNodes` (provided by `VueNodeCanvas.vue`).
  - Filter to nodes exposing `data.images?.[0]` (ArtifactImageNode, Frame, and
    other image-bearing nodes).
  - Render a thumbnail grid; pick → snapshot that URL into `src`.
- After a pick, show the current thumbnail with a **Replace** affordance, then:
  - four fit buttons **Cover / Contain / Tile / Stretch**,
  - a **scale** slider,
  - **X/Y offset** inputs.
- Each edit emits an updated `ImageFill` via the existing
  `update:modelValue` contract — no changes at the `<FillControl>` call sites.
- `FillControl` currently normalizes an unrecognized `Paint` into a `Fill`; add
  an `ImageFill` pass-through so it isn't flattened on load.

**v1 scope:** the image picker is offered on **fill only**. Stroke stays
solid/gradient/pattern (image-stroke works at the data layer for free but isn't
surfaced yet).

## 4. Scope & edge cases

- **SVG / vector export** (`frontend/app/lib/paint/toVector.ts`): the Frame's
  primary output is a **raster PNG bake**, fully covered by §2. For the SVG spine,
  emit the image as an `<image>`/pattern with a data-URI href (cover/tile).
  **Flagged as a fast-follow** if it grows large — the raster path is the one the
  Frame node's IMAGE output depends on.
- **Empty picker** (no image nodes on canvas) → "No images on the canvas yet"
  message.
- **Loading bitmap** → shape renders transparent for a frame; no flash of a wrong
  color.
- **Deleted source node** → irrelevant; `src` is a snapshot, keeps rendering.

## Files touched

- `frontend/app/lib/compositor/paint.ts` — `ImageFill` type, `isImageFill`,
  `paintTileBox` arm (corner-origin sibling), `hasPaint` awareness.
- `frontend/app/lib/paint/resolve.ts` — `resolvePaint` image arm.
- `frontend/app/lib/paint/imageFillCache.ts` — new shared cache.
- `frontend/app/composables/useCompositorLayers.ts` — `ensureLayerImages`/
  `ensureFillImages` preload; `Paint` re-export already covers `ImageFill`.
- `frontend/app/components/vue-canvas/compositor/FillControl.vue` — image type,
  picker, fit/scale/offset controls.
- `frontend/app/lib/paint/toVector.ts` — SVG image-fill emit (fast-follow).

## Testing

- Unit: `isImageFill` guard, `hasPaint` with empty/non-empty `src`, object-fit
  dest-rect math for cover/contain/stretch (pure function, no DOM).
- Parity: same `ImageFill` on a rect renders identically in `ArtifactFrameNode`
  and `CompositorModal` (compare baked pixels), and correlates with the source
  image (not a flat wash — the known parity-test failure mode).
- Runtime hand-check: pick an image node, cycle fit modes, adjust scale/offset,
  confirm the source node can be deleted without breaking the fill.
