# Shape Studio — full Paint fill system

**Date:** 2026-08-16
**Status:** Approved, ready for implementation plan

## Plain-language summary

Shape Studio's Fill and Overlap-fill are currently solid colors only. This wires
in Sailor's **full paint system** — the same `FillControl` picker the Compositor,
Space Type, and Vector Type use: **solid · multi-stop gradient (linear/radial) ·
procedural patterns (grid/stripes/noise/checkerboard/ombre/dots/qr) · image ·
shader (GLSL)**. Stroke stays a solid color.

The win is that almost everything is reuse: the canvas resolver
(`resolvePaint`), the SVG exporter (`paintToVectorPaint`), and the editor
(`FillControl`) already exist and already handle every arm. The only genuinely
new code is small adapter/wiring in the geoshape render + surface + config.

## Decisions (locked with the user)

- **Full FillControl** (solid, gradient, patterns, image, shader) on Fill +
  Overlap-fill. Stroke stays solid.
- **Store compositor `Paint`** (`string | Gradient | Fill | ImageFill`) for
  `fill`/`overlapFill` — NOT `VectorPaint`. FillControl edits `Paint` natively,
  `resolvePaint` renders `Paint` to canvas natively, and `paintToVectorPaint`
  converts `Paint`→`VectorPaint` at SVG-export time.
- **Raster export is acceptable for image/shader.** Gradients and the procedural
  patterns export as *true, editable vector* (`<linearGradient>`/`<pattern>` of
  rects). Image and shader fills can't be pure SVG, so they export as a
  `<pattern>` holding one embedded raster `<image>` — the existing
  `paintToVectorPaint` TIER-3 behavior. Crisp in PNG/on-screen; not infinitely
  scalable in the SVG.
- **Staged delivery** (each stage lands green): (1) solid+gradient+patterns
  [fully vector, synchronous], (2) image fills [async load + repaint + raster
  export], (3) shader fills [field render on canvas + raster export].

## Reuse map (verified)

| Piece | Source | Role |
|---|---|---|
| `Paint` type + guards | `lib/compositor/paint.ts` (`isGradient/isFill/isImageFill`) | the stored type |
| `FillControl.vue` | `components/vue-canvas/compositor/FillControl.vue` (`modelValue: Paint`, `allowImage`, `nested`) | the editor UI |
| `resolvePaint(ctx, paint, box, field, spread?)` | `lib/paint/resolve.ts` | Paint → canvas fillStyle (all arms) |
| `paintToVectorPaint(paint, opts)` | `lib/paint/toVector.ts` | Paint → VectorPaint for SVG |
| shader field render | `lib/shaderfill/field.ts` (`resolveField`) via resolvePaint | shader arm on canvas |
| image bitmap cache | `lib/paint/imageFillCache.ts` (`getFillBitmap`) via resolvePaint | image arm on canvas |

## Design

### A. Config (`lib/geoshape/config.ts`)

- `fill: Paint`, `overlapFill: Paint` (was `VectorPaint`). `stroke: string | null`
  unchanged. `DEFAULT_CONFIG.fill`/`overlapFill` stay the solid strings
  (`'#111111'`) — a solid string is a valid `Paint`, so defaults are unchanged in
  behavior.
- `mergeConfig`'s `paint()` validator: accept a string as-is; accept an object
  whose `type` is a known Paint/Fill/Gradient/ImageFill kind (loose structural
  check — validate the discriminant + required primitive fields, deep-copy),
  else fall back to the default. Keep `config.ts` dependency-light: import only
  `type Paint` (+ the small guards if they're pure) — do NOT drag `three`/`paper`
  or heavy render code into the config import graph. If the compositor guards
  aren't safe to import here, keep a local loose validator.

### B. Paint carried with geometry (`GeoVectorShape`)

The composite output feeds two render targets that want different paint forms
(canvas wants `Paint`; `shapesToSVG` wants `VectorPaint`). Carry the authored
`Paint` on the shape and convert per target:

```ts
type GeoVectorShape = VectorShape & { paint?: Paint }
```

- `composite()` sets `shape.paint = cfg.fill` (base) / `cfg.overlapFill` (overlap
  shape), and sets a solid fallback `shape.fill` (the paint's base color, for any
  consumer that reads `.fill` directly). Geometry logic is otherwise unchanged.
- `shapesToSVG` ignores the extra `paint` field (reads only known VectorShape
  keys), so it's inert for callers that don't convert.

### C. Preview / PNG (`lib/geoshape/render.ts` `drawToCanvas`)

For each shape, resolve its `Paint` to a canvas fill via the shared resolver:

```ts
const box = { w: b.w, h: b.h }          // b = contentBounds(shapes)
const style = resolvePaint(ctx, shape.paint ?? shape.fill, box, STILL_FIELD)
ctx.fillStyle = style
ctx.fill(path, shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
```

- `STILL_FIELD` is a default `ShaderFieldFrameCtx` (time 0) — geoshape has no
  animation. Confirm the real shape/args of `ShaderFieldFrameCtx` in
  `paint/resolve.ts` and construct a still one.
- **Async warm-and-repaint:** image + shader fills resolve through caches
  (`getFillBitmap` / `resolveField`) that return a fallback until warm.
  `renderPreview` gains a post-draw step: if any shape's paint is image/shader,
  await the cache warm (load bitmap / render field) then repaint once. Guard with
  the existing `renderToken` so a stale warm doesn't overwrite a newer frame.
  (Stage 2/3 only — stage 1 paints are all synchronous.)

### D. SVG export (`lib/geoshape/render.ts` `toSvg`)

Before `shapesToSVG`, convert each shape's authored `Paint` to `VectorPaint`:

```ts
const b = contentBounds(shapes)
for (const s of shapes) if (s.paint) s.fill = paintToVectorPaint(s.paint, { box: {x: b.minX, y: b.minY, width: b.w, height: b.h}, units: 'userSpaceOnUse', /* + raster for image/shader */ })
```

- Gradients/patterns need only `box`. Image/shader (TIER 3) additionally need a
  rasterized image passed in `opts` — rasterize the fill to an offscreen canvas
  (reuse the same resolve path as the preview) and hand it to
  `paintToVectorPaint`. Confirm `paintToVectorPaint`'s exact `opts` for the raster
  hand-off. (Stage 3 for shader; stage 2 for image.)

### E. Surface UI (`components/vue-canvas/ShapeStudioSurface.vue`)

- Replace the `#control-fill` and `#control-overlapFill` `StudioColorField` with
  `<FillControl :model-value="config.fill" allow-image @update:model-value="setGeoControl('fill', $event)" />` (and overlapFill). Keep `#control-stroke` as
  `StudioColorField` (solid).
- Remove the `paintToHex` reduction for fill/overlapFill (they're full `Paint`
  now). Autosave already persists `config`, so `Paint` round-trips through
  `sailor_shapeStudio` (mergeConfig validates on hydrate).
- `overlapFill`'s control still gates on `overlapMode === 'shape'`.

### F. Agent + controls

- `GEO_CONTROLS`: `fill`/`overlapFill` stay declared (bespoke `#control-*` slots
  render FillControl). The agent vocabulary treats them as opaque paint (the
  agent can set a solid color string; richer paint is a UI affordance) — keep the
  guidance honest.

## Testing

- **Config:** `mergeConfig` round-trips a solid, a gradient `Paint`, a pattern
  `Fill`, and an `ImageFill`; junk paint → default; a Paint with a bogus `type` →
  default. Drift guard unaffected (fill/overlapFill still have controls).
- **Render (pure/asserted, no GPU):** `paintToVectorPaint(cfg.fill)` for a
  gradient config yields a `VectorGradient` and `toSvg` output contains
  `<linearGradient`/`<radialGradient`; for a pattern, `<pattern`. A solid stays a
  string. (These are pure conversions — unit-testable without a canvas.)
- **Canvas render-proof (live):** in the studio, set Fill = a gradient → the
  preview mark shows the gradient (pixel check: sampled fill pixels vary in
  color, not a flat wash — per the repo's "flat-wash passed the parity test"
  lesson). Set a pattern, an image, a shader → each shows. Download SVG and
  confirm gradient/pattern are real vector, image/shader are an embedded image.

## Risks / watch-items

- **`config.ts` dependency weight.** `Paint`'s guards live in
  `compositor/paint.ts`, which imports `spacetype/fillTile` + `imageFillCache`.
  If importing those into `config.ts` bloats the Collection dynamic-import graph
  (the reason config is dependency-light), keep a LOCAL loose paint validator in
  config.ts and import only `type Paint`.
- **`resolvePaint` is synchronous** and returns a fallback for un-warmed
  image/shader — the async warm-and-repaint (C) is what makes them actually
  appear. Without it, image/shader show a placeholder in the preview (SVG still
  exports correctly if given the raster).
- **Shader/image SVG export needs a rasterizer hand-off** to `paintToVectorPaint`
  — verify its `opts` contract before Stage 2/3; Stage 1 (gradient/pattern) needs
  none.
- **`overlapFill` default** should stay solid so the default mark is unchanged.
